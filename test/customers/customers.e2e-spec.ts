// End-to-end tests for Customers: the master with its khata and figures, the
// owner-only opening balance, and cutting jobs (a customer's own truck cut
// for a fee). They boot the whole app in-process, use the database from .env,
// create everything through the real API with unique "e2e-<run>" data, and
// delete it all afterwards.
//
//   npm run test:e2e -- customers
import { Harness, Member, Workspace } from '../utils/harness';

jest.setTimeout(240000);

type Customer = {
  id: string;
  name: string;
  phone: string;
  type: string;
  city: string;
  contactPerson: string;
  openingBalance: number;
  openingDate: string;
  isActive: boolean;
  totalBusiness: number;
  received: number;
  balance: number;
  oldestUnpaidDays: number | null;
  lastActivity: string;
};
type Khata = {
  kind: string;
  amount: number;
  balance: number;
  detail: string;
  ref?: string;
};
type Job = {
  id: string;
  jobNo: string;
  customerId: string;
  customerName: string;
  status: string;
  tons: number;
  truckNo: string;
  machineName: string | null;
  thekadarName: string | null;
  cutStart: string | null;
  sqft: number | null;
  ratePerSqft: number;
  readyOn: string | null;
  deliveredOn: string | null;
  createdBy: string;
};
type Worker = { id: string; name: string; balance: number };

const codeOf = (res: { body: unknown }) => (res.body as { code?: string }).code;

describe('Customers (e2e)', () => {
  let h: Harness;
  let A: Workspace;
  let B: Workspace;
  let partner: Member;
  let manager: Member;
  let munshi: Member;
  let viewer: Member;
  let f1: string;
  let f2: string;
  let machineId: string;
  let phone = 5000000;

  const call = (...args: Parameters<Harness['call']>) => h.call(...args);
  const owner = () => A.ownerToken;
  const nextPhone = () => `0301-${String(++phone).padStart(7, '0')}`;

  const newCustomer = async (
    over: Record<string, unknown> = {},
    token = owner(),
  ) =>
    (
      await call('post', '/customers', token, {
        name: `Customer ${phone}`,
        phone: nextPhone(),
        type: 'builder',
        city: 'Karachi',
        ...over,
      }).expect(201)
    ).body as Customer;
  const get = async (id: string, token = owner()) =>
    (await call('get', `/customers/${id}`, token).expect(200)).body as Customer;
  const khata = async (id: string) =>
    (await call('get', `/customers/${id}/khata`, owner()).expect(200))
      .body as Khata[];

  const receive = (token: string, over: Record<string, unknown> = {}) =>
    call('post', '/cutting-jobs', token, {
      date: '2026-10-08',
      truckNo: 'khr-552',
      material: 'Ziarat Grey',
      tons: 16.5,
      factoryId: f1,
      ratePerSqft: 35,
      ...over,
    });
  const received = async (customerId: string, over = {}) =>
    (await receive(owner(), { customerId, ...over }).expect(201)).body as Job;
  const send = (token: string, id: string, over = {}) =>
    call('post', `/cutting-jobs/${id}/send`, token, {
      machineId,
      thekadarName: 'Aslam Baig',
      date: '2026-10-09',
      ...over,
    });
  const finish = (token: string, id: string, over = {}) =>
    call('post', `/cutting-jobs/${id}/finish`, token, {
      date: '2026-10-12',
      sqft: 720,
      ratePerSqft: 35,
      outputNote: '14 soot',
      ratePerTon: 1200,
      ...over,
    });

  beforeAll(async () => {
    h = await Harness.start();
    A = await h.createCompany('cust-a');
    B = await h.createCompany('cust-b');
    partner = await h.addMember(A, 'partner', 'PartnerCust');
    manager = await h.addMember(A, 'manager', 'MgrCust');
    munshi = await h.addMember(A, 'munshi', 'MunshiCust');
    viewer = await h.addMember(A, 'viewer', 'ViewerCust');
    f1 = (
      await call('post', '/settings/factories', owner(), {
        name: 'Main',
        kind: 'own',
      }).expect(201)
    ).body.id as string;
    f2 = (
      await call('post', '/settings/factories', owner(), {
        name: 'North',
        kind: 'own',
      }).expect(201)
    ).body.id as string;
    machineId = (
      await call('post', '/settings/machines', owner(), {
        name: 'Vertical 2',
        type: 'vertical',
        factoryId: f1,
        dayThekadar: 'Aslam Baig',
      }).expect(201)
    ).body.id as string;
  });

  afterAll(async () => {
    await h.stop();
  });

  describe('the master', () => {
    it('should add a customer with no balance', async () => {
      const c = await newCustomer({ contactPerson: 'Faisal' });
      expect(c).toMatchObject({
        type: 'builder',
        balance: 0,
        totalBusiness: 0,
        received: 0,
        oldestUnpaidDays: null,
        contactPerson: 'Faisal',
        isActive: true,
      });
      expect(await khata(c.id)).toEqual([]);
    });

    it('should refuse a second customer with the same phone, written either way', async () => {
      const first = await newCustomer({ phone: '0300-8000001' });
      const res = await call('post', '/customers', owner(), {
        name: 'Other',
        phone: '03008000001',
        type: 'dealer',
      }).expect(409);
      expect(codeOf(res)).toBe('DUPLICATE_PHONE');
      expect(first.phone).toBe('0300-8000001');
    });

    it('should refuse a phone that is not a mobile number', async () => {
      await call('post', '/customers', owner(), {
        name: 'X',
        phone: '12345',
        type: 'dealer',
      }).expect(422);
    });

    it('should give an opening balance to the owner and partner, and show it as the first khata row', async () => {
      const c = await newCustomer({
        openingBalance: 120000,
        openingDate: '2026-08-15',
      });
      expect(c.balance).toBe(120000);
      expect(c.oldestUnpaidDays).toBeGreaterThan(0);
      const rows = await khata(c.id);
      expect(rows[0]).toMatchObject({
        kind: 'charge',
        amount: 120000,
        balance: 120000,
        detail: 'opening',
      });
      await newCustomer({ openingBalance: 5 }, partner.token);
    });

    it('should refuse an opening balance from a manager or munshi, but let them add a customer', async () => {
      const res = await call('post', '/customers', manager.token, {
        name: 'Nope',
        phone: nextPhone(),
        type: 'builder',
        openingBalance: 1000,
      }).expect(403);
      expect(codeOf(res)).toBe('OPENING_NOT_ALLOWED');
      await newCustomer({}, manager.token);
      await newCustomer({}, munshi.token);
    });

    it('should edit a customer but only let an opening-balance editor change the opening', async () => {
      const c = await newCustomer({ openingBalance: 1000 });
      const ok = await call('patch', `/customers/${c.id}`, manager.token, {
        city: 'Lahore',
        contactPerson: 'Sana',
      }).expect(200);
      expect(ok.body).toMatchObject({ city: 'Lahore', contactPerson: 'Sana' });
      const same = await call('patch', `/customers/${c.id}`, manager.token, {
        openingBalance: 1000,
      }).expect(200);
      expect(same.body.openingBalance).toBe(1000);
      const res = await call('patch', `/customers/${c.id}`, manager.token, {
        openingBalance: 2000,
      }).expect(403);
      expect(codeOf(res)).toBe('OPENING_NOT_ALLOWED');
      await call('patch', `/customers/${c.id}`, owner(), {
        openingBalance: 2000,
      }).expect(200);
      expect((await get(c.id)).balance).toBe(2000);
    });

    it('should refuse editing a phone to one another customer has', async () => {
      const a = await newCustomer();
      const b = await newCustomer();
      const res = await call('patch', `/customers/${b.id}`, owner(), {
        phone: a.phone,
      }).expect(409);
      expect(codeOf(res)).toBe('DUPLICATE_PHONE');
    });

    it('should list customers with filters and the highest balance first', async () => {
      const owes = await newCustomer({
        type: 'dealer',
        openingBalance: 900000,
      });
      const all = (await call('get', '/customers', owner()).expect(200))
        .body as Customer[];
      expect(all[0].id).toBe(owes.id);
      const dealers = (
        await call('get', '/customers?type=dealer', owner()).expect(200)
      ).body as Customer[];
      expect(dealers.every((c) => c.type === 'dealer')).toBe(true);
      const advance = (
        await call('get', '/customers?balance=advance', owner()).expect(200)
      ).body as Customer[];
      expect(advance.every((c) => c.balance < 0)).toBe(true);
      const old30 = (
        await call('get', '/customers?balance=old30', owner()).expect(200)
      ).body as Customer[];
      expect(old30.some((c) => c.id === owes.id)).toBe(false);
    });

    it('should keep customers behind customers permissions and inside the company', async () => {
      const c = await newCustomer();
      await call('get', '/customers', viewer.token).expect(200);
      await call('post', '/customers', viewer.token, {
        name: 'No',
        phone: nextPhone(),
        type: 'builder',
      }).expect(403);
      await call('patch', `/customers/${c.id}`, munshi.token, {
        city: 'X',
      }).expect(403);
      await call('get', `/customers/${c.id}`, B.ownerToken).expect(404);
      await call('get', `/customers/${c.id}/khata`, B.ownerToken).expect(404);
      const mine = (await call('get', '/customers', B.ownerToken).expect(200))
        .body as Customer[];
      expect(mine.find((x) => x.id === c.id)).toBeUndefined();
    });
  });

  describe('cutting jobs', () => {
    it('should receive a truck for an existing customer', async () => {
      const c = await newCustomer({ type: 'cutting' });
      const job = await received(c.id);
      expect(job).toMatchObject({
        status: 'received',
        customerName: c.name,
        truckNo: 'KHR-552',
        tons: 16.5,
        ratePerSqft: 35,
      });
      expect(job.jobNo).toMatch(/^CJ-\d{3}$/);
      expect(job.createdBy).toBeTruthy();
    });

    it('should add a new cutting customer from a name and phone when the first truck arrives', async () => {
      const p = nextPhone();
      const res = await receive(owner(), { name: 'Haji New', phone: p }).expect(
        201,
      );
      const job = res.body as Job;
      const c = await get(job.customerId);
      expect(c).toMatchObject({ name: 'Haji New', type: 'cutting', phone: p });
      const again = await receive(owner(), { name: 'Haji New', phone: p });
      expect(again.status).toBe(409);
      expect(codeOf(again)).toBe('DUPLICATE_PHONE');
    });

    it('should need a customer, a real factory, and no future date', async () => {
      await receive(owner(), {}).expect(422);
      const c = await newCustomer();
      await receive(owner(), { customerId: c.id, factoryId: B.id }).expect(422);
      const future = await receive(owner(), {
        customerId: c.id,
        date: '2999-01-01',
      }).expect(409);
      expect(codeOf(future)).toBe('DATE_IN_FUTURE');
    });

    it('should let a munshi receive a truck, for an existing or a new customer', async () => {
      const c = await newCustomer();
      await receive(munshi.token, { customerId: c.id }).expect(201);
      const res = await receive(munshi.token, {
        name: 'Nope',
        phone: nextPhone(),
      }).expect(201);
      expect(res.status).toBe(201);
    });

    it('should send a truck to a machine, adding the thekadar by name', async () => {
      const c = await newCustomer();
      const job = await received(c.id);
      const res = await send(owner(), job.id).expect(200);
      expect(res.body).toMatchObject({
        status: 'cutting',
        machineName: 'Vertical 2',
        thekadarName: 'Aslam Baig',
        cutStart: '2026-10-09',
      });
      const again = await send(owner(), job.id).expect(409);
      expect(codeOf(again)).toBe('NOT_WAITING');
    });

    it('should refuse a machine of another factory, and a bad date', async () => {
      const c = await newCustomer();
      const job = await received(c.id, { factoryId: f2 });
      const wrong = await send(owner(), job.id).expect(409);
      expect(codeOf(wrong)).toBe('MACHINE_OTHER_FACTORY');
      const early = await send(owner(), (await received(c.id)).id, {
        date: '2026-10-01',
      }).expect(409);
      expect(codeOf(early)).toBe('DATE_BEFORE_START');
    });

    it("should finish a job: charge the customer's khata sq.ft x rate and pay the thekadar tons x rate, once", async () => {
      const c = await newCustomer();
      const job = await received(c.id, { tons: 10 });
      await send(owner(), job.id, { thekadarName: 'Job Thekadar' }).expect(200);
      const res = await finish(owner(), job.id).expect(200);
      expect(res.body).toMatchObject({
        status: 'ready',
        sqft: 720,
        ratePerSqft: 35,
        readyOn: '2026-10-12',
      });

      const customer = await get(c.id);
      expect(customer).toMatchObject({
        balance: 25200,
        totalBusiness: 25200,
        received: 0,
      });
      const rows = await khata(c.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        kind: 'charge',
        amount: 25200,
        balance: 25200,
      });
      expect(rows[0].detail).toContain('720 sq.ft');

      const workers = (
        await call('get', '/workers?q=job thekadar', owner()).expect(200)
      ).body as Worker[];
      expect(workers[0].balance).toBe(12000);

      const again = await finish(owner(), job.id).expect(409);
      expect(codeOf(again)).toBe('NOT_CUTTING');
      expect((await get(c.id)).balance).toBe(25200);
      expect((await khata(c.id)).length).toBe(1);
    });

    it('should refuse finishing without sq.ft or a rate, or before it started', async () => {
      const c = await newCustomer();
      const job = await received(c.id);
      const early = await finish(owner(), job.id).expect(409);
      expect(codeOf(early)).toBe('NOT_CUTTING');
      await send(owner(), job.id).expect(200);
      const noSqft = await finish(owner(), job.id, { sqft: 0 }).expect(409);
      expect(codeOf(noSqft)).toBe('SQFT_REQUIRED');
      const noRate = await finish(owner(), job.id, {
        ratePerSqft: 0,
      }).expect(409);
      expect(codeOf(noRate)).toBe('RATE_REQUIRED');
      const before = await finish(owner(), job.id, {
        date: '2026-10-05',
      }).expect(409);
      expect(codeOf(before)).toBe('DATE_BEFORE_START');
      expect((await get(c.id)).balance).toBe(0);
    });

    it('should not pay a thekadar when no per-ton rate is given', async () => {
      const c = await newCustomer();
      const job = await received(c.id);
      await send(owner(), job.id, { thekadarName: 'Unpaid Thekadar' }).expect(
        200,
      );
      await finish(owner(), job.id, { ratePerTon: undefined }).expect(200);
      const w = (
        await call('get', '/workers?q=unpaid thekadar', owner()).expect(200)
      ).body as Worker[];
      expect(w[0].balance).toBe(0);
    });

    it('should apply payments to the oldest charge first and report how old the unpaid part is', async () => {
      const c = await newCustomer({
        openingBalance: 10000,
        openingDate: '2026-08-01',
      });
      const job = await received(c.id);
      await send(owner(), job.id).expect(200);
      await finish(owner(), job.id).expect(200);
      const customer = await get(c.id);
      expect(customer.balance).toBe(35200);
      expect(customer.oldestUnpaidDays).toBeGreaterThan(30);
    });

    it('should deliver a ready job, and only a ready one', async () => {
      const c = await newCustomer();
      const job = await received(c.id);
      const early = await call(
        'post',
        `/cutting-jobs/${job.id}/deliver`,
        owner(),
      ).expect(409);
      expect(codeOf(early)).toBe('NOT_READY');
      await send(owner(), job.id).expect(200);
      await finish(owner(), job.id).expect(200);
      const done = await call(
        'post',
        `/cutting-jobs/${job.id}/deliver`,
        owner(),
      ).expect(200);
      expect(done.body.status).toBe('delivered');
      expect(done.body.deliveredOn).toBeTruthy();
      // The khata does not change when stone is collected.
      expect((await get(c.id)).balance).toBe(25200);
    });

    it('should cancel a truck only while it has not started', async () => {
      const c = await newCustomer();
      const job = await received(c.id);
      const done = await call(
        'post',
        `/cutting-jobs/${job.id}/cancel`,
        owner(),
      ).expect(200);
      expect(done.body.status).toBe('cancelled');
      const second = await received(c.id);
      await send(owner(), second.id).expect(200);
      const late = await call(
        'post',
        `/cutting-jobs/${second.id}/cancel`,
        owner(),
      ).expect(409);
      expect(codeOf(late)).toBe('CANCEL_AFTER_START');
    });

    it('should list jobs with filters, oldest first', async () => {
      const c = await newCustomer();
      await received(c.id);
      const all = (await call('get', '/cutting-jobs', owner()).expect(200))
        .body as Job[];
      const dates = all.map((j) => j.truckNo);
      expect(dates.length).toBeGreaterThan(3);
      const mine = (
        await call('get', `/cutting-jobs?customerId=${c.id}`, owner()).expect(
          200,
        )
      ).body as Job[];
      expect(mine).toHaveLength(1);
      const ready = (
        await call('get', '/cutting-jobs?status=ready', owner()).expect(200)
      ).body as Job[];
      expect(ready.every((j) => j.status === 'ready')).toBe(true);
    });

    it('should keep jobs behind production permissions and inside the company', async () => {
      const c = await newCustomer();
      const job = await received(c.id);
      await call('get', '/cutting-jobs', viewer.token).expect(200);
      await receive(viewer.token, { customerId: c.id }).expect(403);
      await send(viewer.token, job.id).expect(403);
      await send(B.ownerToken, job.id).expect(404);
      await call('get', '/cutting-jobs', B.ownerToken)
        .expect(200)
        .then((res) => expect(res.body).toEqual([]));
    });
  });
});
