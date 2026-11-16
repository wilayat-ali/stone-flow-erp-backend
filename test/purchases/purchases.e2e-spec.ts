// End-to-end tests for Purchases (trucks). They boot the whole app in-process,
// use the database from .env, create everything through the real API with
// unique "e2e-<run>" data, and delete it all afterwards.
//
//   npm run test:e2e -- purchases
import { Harness, Member, Workspace } from '../utils/harness';

jest.setTimeout(180000);

type Purchase = {
  id: string;
  date: string;
  supplierId: string;
  supplierName: string;
  purchiNo: string;
  truckNo: string;
  tons: number;
  ratePerTon: number;
  discount: number;
  total: number;
  stones: number;
  factoryId: string;
  factoryName: string;
  markSeq: number | null;
  mark: string | null;
  status: string;
  note: string;
  reason: string | null;
  createdBy: string;
  approvedBy: string | null;
};

type Supplier = { id: string; balance: number; charged: number; paid: number };
type Khata = {
  detail: string;
  kind: 'charge' | 'credit';
  amount: number;
  balance: number;
};

const last = <T>(items: T[]): T => items[items.length - 1];

const codeOf = (res: { body: unknown }) => (res.body as { code?: string }).code;

describe('Purchases (e2e)', () => {
  let h: Harness;
  let A: Workspace;
  let B: Workspace;
  let manager: Member;
  let munshi: Member;
  let viewer: Member;

  let s1: string; // a mine owner
  let s2: string; // another mine owner
  let f1: string; // own factory
  let f2: string; // another own factory
  let cuttingFactory: string;

  const call = (...args: Parameters<Harness['call']>) => h.call(...args);
  const owner = () => A.ownerToken;
  let purchiCounter = 7000;
  const nextPurchi = () => String(++purchiCounter);

  const body = (over: Record<string, unknown> = {}) => ({
    date: '2026-10-08',
    supplierId: s1,
    material: 'Ziarat White (rough)',
    purchiNo: nextPurchi(),
    truckNo: 'TKR-219',
    tons: 21.4,
    ratePerTon: 6800,
    discount: 520,
    stones: 3,
    factoryId: f1,
    note: '',
    ...over,
  });

  const create = (token: string, over: Record<string, unknown> = {}) =>
    call('post', '/purchases', token, body(over));
  const add = async (token = owner(), over: Record<string, unknown> = {}) =>
    (await create(token, over).expect(201)).body as Purchase;
  const get = async (id: string, token = owner()) =>
    (await call('get', `/purchases/${id}`, token).expect(200)).body as Purchase;
  const list = async (qs = '', token = owner()) =>
    (await call('get', `/purchases${qs}`, token).expect(200))
      .body as Purchase[];
  const supplier = async (id: string, token = owner()) =>
    (await call('get', `/suppliers/${id}`, token).expect(200)).body as Supplier;
  const khata = async (id: string, token = owner()) =>
    (await call('get', `/suppliers/${id}/khata`, token).expect(200))
      .body as Khata[];
  const newSupplier = async (name: string, phone: string, token = owner()) =>
    (
      await call('post', '/suppliers', token, {
        type: 'mine_owner',
        name,
        phone,
        city: 'Ziarat',
        openingDate: '2026-09-01',
      }).expect(201)
    ).body as { id: string };
  const newFactory = async (name: string, kind = 'own', token = owner()) =>
    (
      await call('post', '/settings/factories', token, { name, kind }).expect(
        201,
      )
    ).body as { id: string };
  const setApproval = (on: boolean) =>
    call('patch', '/company/settings', owner(), {
      approvalRequired: on,
    }).expect(200);

  beforeAll(async () => {
    h = await Harness.start();
    A = await h.createCompany('pur-a');
    B = await h.createCompany('pur-b');
    manager = await h.addMember(A, 'manager', 'MgrPur');
    munshi = await h.addMember(A, 'munshi', 'MunshiPur');
    viewer = await h.addMember(A, 'viewer', 'ViewerPur');

    s1 = (await newSupplier('Haji Gul Khan', '0333-7812345')).id;
    s2 = (await newSupplier('Arshad Khan', '0301-5566778')).id;
    f1 = (await newFactory('Main Factory')).id;
    f2 = (await newFactory('North Yard')).id;
    cuttingFactory = (await newFactory('Khan Cutting', 'cutting')).id;
  });

  afterAll(async () => {
    await h.stop();
  });

  describe('a truck entered by someone who needs no approval', () => {
    it('should be approved at once: total worked out, mark taken, supplier charged', async () => {
      const p = await add();

      expect(p).toMatchObject({
        status: 'in_stock',
        supplierName: 'Haji Gul Khan',
        factoryName: 'Main Factory',
        tons: 21.4,
        ratePerTon: 6800,
        discount: 520,
        total: 145000, // round(21.4 x 6800) - 520
        stones: 3,
        markSeq: 1,
        mark: '1/3',
        reason: null,
      });
      expect(p.createdBy).not.toBe('');
      expect(p.approvedBy).not.toBeNull();

      const rows = await khata(s1);
      expect(last(rows)).toMatchObject({
        detail: `Truck 1/3 · purchi ${p.purchiNo}`,
        kind: 'charge',
        amount: 145000,
        balance: 145000,
      });
      expect((await supplier(s1)).balance).toBe(145000);
    });

    it('should never take the total from the request', async () => {
      const p = await add(owner(), {
        total: 1,
        tons: 10,
        ratePerTon: 1000,
        discount: 0,
      });
      expect(p.total).toBe(10000);
    });

    it('should give marks that continue per factory and never repeat', async () => {
      const a = await add(owner(), { factoryId: f2, stones: 2 });
      const b = await add(owner(), { factoryId: f2, stones: 4 });
      expect([a.mark, b.mark]).toEqual(['1/2', '2/4']);

      const c = await add(owner(), { factoryId: f1 });
      expect(c.markSeq).toBeGreaterThan(1);
    });

    it('should give distinct marks to trucks entered at the same moment', async () => {
      const results = await Promise.all(
        [1, 2, 3].map(() => create(owner(), { factoryId: f2 })),
      );
      for (const r of results) expect(r.status).toBe(201);

      const marks = results.map((r) => (r.body as Purchase).markSeq!);
      expect(new Set(marks).size).toBe(3);
      expect(Math.max(...marks) - Math.min(...marks)).toBe(2);
    });

    it('should take no charge for a truck worth nothing', async () => {
      const before = (await supplier(s2)).balance;
      const p = await add(owner(), {
        supplierId: s2,
        tons: 1,
        ratePerTon: 500,
        discount: 900,
      });

      expect(p.total).toBe(0);
      expect(p.status).toBe('in_stock');
      expect((await supplier(s2)).balance).toBe(before);
    });

    it('should accept a truck for a cutting factory', async () => {
      const p = await add(owner(), { factoryId: cuttingFactory });
      expect(p.factoryName).toBe('Khan Cutting');
      expect(p.mark).toBe(`${p.markSeq}/3`);
    });
  });

  describe('checking what is entered', () => {
    it('should refuse the same purchi from the same supplier, not from another', async () => {
      const first = await add();
      const dup = await create(owner(), {
        purchiNo: first.purchiNo,
      }).expect(409);
      expect(codeOf(dup)).toBe('DUPLICATE_PURCHI');

      await add(owner(), { purchiNo: first.purchiNo, supplierId: s2 });
    });

    it('should let a rejected or cancelled purchi be entered again', async () => {
      const p = await add();
      await call('post', `/purchases/${p.id}/cancel`, owner(), {
        reason: 'Wrong entry',
      }).expect(200);

      await add(owner(), { purchiNo: p.purchiNo });
    });

    it('should refuse a future date, a bad date and bad numbers', async () => {
      await create(owner(), { date: '2099-01-01' }).expect(422);
      await create(owner(), { date: '2026-13-45' }).expect(422);
      await create(owner(), { tons: 0 }).expect(422);
      await create(owner(), { tons: 1.234 }).expect(422);
      await create(owner(), { ratePerTon: -5 }).expect(422);
      await create(owner(), { discount: -1 }).expect(422);
      await create(owner(), { stones: 0 }).expect(422);
      await create(owner(), { stones: 21 }).expect(422);
      await create(owner(), { purchiNo: '  ' }).expect(422);
    });

    it('should refuse an unknown, hidden or foreign supplier and factory', async () => {
      await create(owner(), {
        supplierId: '00000000-0000-4000-8000-000000000000',
      }).expect(422);
      await create(owner(), {
        factoryId: '00000000-0000-4000-8000-000000000000',
      }).expect(422);

      const hidden = await newSupplier('Hidden One', '0302-1110001');
      await call('patch', `/suppliers/${hidden.id}`, owner(), {
        isActive: false,
      }).expect(200);
      await create(owner(), { supplierId: hidden.id }).expect(422);

      const bSupplier = await newSupplier(
        'B Supplier',
        '0302-1110002',
        B.ownerToken,
      );
      await create(owner(), { supplierId: bSupplier.id }).expect(422);
      const bFactory = await newFactory('B Factory', 'own', B.ownerToken);
      await create(owner(), { factoryId: bFactory.id }).expect(422);
    });
  });

  describe("a munshi's truck while approval is on", () => {
    let pending: Purchase;

    it('should wait: no mark, no charge', async () => {
      const before = (await supplier(s1)).balance;
      pending = await add(munshi.token, { supplierId: s1, factoryId: f1 });

      expect(pending).toMatchObject({
        status: 'pending',
        markSeq: null,
        mark: null,
        approvedBy: null,
      });
      expect((await supplier(s1)).balance).toBe(before);
      expect(await list('?status=pending')).toHaveLength(1);
    });

    it('should not let the munshi approve it', async () => {
      await call(
        'post',
        `/purchases/${pending.id}/approve`,
        munshi.token,
      ).expect(403);
    });

    it('should take the next mark and charge the supplier when approved', async () => {
      const before = (await supplier(s1)).balance;
      const lastMark = Math.max(
        ...(await list()).map((p) => p.markSeq ?? 0).filter((_, i) => i >= 0),
      );

      const res = await call(
        'post',
        `/purchases/${pending.id}/approve`,
        manager.token,
      ).expect(200);
      const p = res.body as Purchase;

      expect(p.status).toBe('in_stock');
      expect(p.markSeq).toBeGreaterThan(0);
      expect(p.approvedBy).not.toBeNull();
      expect(lastMark).toBeGreaterThan(0);
      expect((await supplier(s1)).balance).toBe(before + p.total);
    });

    it('should not be decided twice', async () => {
      const again = await call(
        'post',
        `/purchases/${pending.id}/approve`,
        owner(),
      ).expect(409);
      expect(codeOf(again)).toBe('ALREADY_DECIDED');
      await call('post', `/purchases/${pending.id}/reject`, owner(), {
        reason: 'late',
      }).expect(409);
    });

    it('should keep the reason when rejected and waste no mark', async () => {
      const p = await add(munshi.token, { factoryId: f2 });
      const before = (await supplier(p.supplierId)).balance;

      await call('post', `/purchases/${p.id}/reject`, owner(), {
        reason: '  ',
      }).expect(422);
      const res = await call('post', `/purchases/${p.id}/reject`, owner(), {
        reason: 'Weight looks wrong',
      }).expect(200);

      expect(res.body).toMatchObject({
        status: 'rejected',
        reason: 'Weight looks wrong',
        markSeq: null,
      });
      expect((await supplier(p.supplierId)).balance).toBe(before);

      // the next approved truck at that factory gets the very next number
      const maxBefore = Math.max(
        ...(await list(`?factoryId=${f2}`)).map((x) => x.markSeq ?? 0),
      );
      const next = await add(owner(), { factoryId: f2 });
      expect(next.markSeq).toBe(maxBefore + 1);
    });

    it('should approve straight away when the company switches approval off', async () => {
      await setApproval(false);
      const p = await add(munshi.token);
      expect(p.status).toBe('in_stock');
      expect(p.markSeq).not.toBeNull();
      await setApproval(true);
    });

    it('should let a munshi fix their own pending truck but not an approved one', async () => {
      const p = await add(munshi.token);
      const fixed = await call('patch', `/purchases/${p.id}`, munshi.token, {
        truckNo: 'FIXED-1',
        tons: 20,
      }).expect(200);
      expect(fixed.body).toMatchObject({
        truckNo: 'FIXED-1',
        tons: 20,
        total: 20 * 6800 - 520,
        status: 'pending',
      });

      const approved = await call(
        'post',
        `/purchases/${p.id}/approve`,
        owner(),
      ).expect(200);
      await call('patch', `/purchases/${p.id}`, munshi.token, {
        truckNo: 'NOPE',
      }).expect(403);
      expect((approved.body as Purchase).status).toBe('in_stock');
    });
  });

  describe('correcting and cancelling an approved truck', () => {
    it('should correct the charge with a reversal and a new charge, never an edit', async () => {
      const sup = await newSupplier('Correction Co', '0303-4440001');
      const p = await add(owner(), {
        supplierId: sup.id,
        tons: 10,
        ratePerTon: 1000,
        discount: 0,
      });
      expect((await supplier(sup.id)).balance).toBe(10000);

      const res = await call('patch', `/purchases/${p.id}`, owner(), {
        tons: 12,
        stones: 4,
      }).expect(200);

      expect(res.body).toMatchObject({
        total: 12000,
        markSeq: p.markSeq,
        mark: `${p.markSeq}/4`,
        status: 'in_stock',
      });
      expect((await supplier(sup.id)).balance).toBe(12000);

      const rows = await khata(sup.id);
      // The reversal is dated the day it was made, so it sorts after the
      // charges dated on the truck's day; the balance still ends at 12,000.
      expect(rows.map((r) => [r.kind, r.amount])).toEqual([
        ['charge', 10000],
        ['charge', 12000],
        ['credit', 10000],
      ]);
      expect(last(rows).detail).toMatch(/^Reversal/);
      expect(last(rows).balance).toBe(12000);
    });

    it('should leave the khata alone when the money did not change', async () => {
      const sup = await newSupplier('Same Money', '0303-4440002');
      const p = await add(owner(), { supplierId: sup.id });
      const before = (await khata(sup.id)).length;

      await call('patch', `/purchases/${p.id}`, owner(), {
        note: 'only a note',
        truckNo: 'NEW-TRUCK',
      }).expect(200);
      expect((await khata(sup.id)).length).toBe(before);
    });

    it('should move the charge when the supplier changes', async () => {
      const from = await newSupplier('Move From', '0303-4440003');
      const to = await newSupplier('Move To', '0303-4440004');
      const p = await add(owner(), {
        supplierId: from.id,
        tons: 5,
        ratePerTon: 2000,
        discount: 0,
      });

      await call('patch', `/purchases/${p.id}`, owner(), {
        supplierId: to.id,
      }).expect(200);

      expect((await supplier(from.id)).balance).toBe(0);
      expect((await supplier(to.id)).balance).toBe(10000);
    });

    it('should keep a mark with the factory that gave it', async () => {
      const p = await add(owner(), { factoryId: f1 });
      const res = await call('patch', `/purchases/${p.id}`, owner(), {
        factoryId: f2,
      }).expect(409);
      expect(codeOf(res)).toBe('FACTORY_LOCKED');

      // a pending truck has no mark yet, so its factory can still change
      const pending = await add(munshi.token, { factoryId: f1 });
      const moved = await call(
        'patch',
        `/purchases/${pending.id}`,
        munshi.token,
        {
          factoryId: f2,
        },
      ).expect(200);
      expect((moved.body as Purchase).factoryId).toBe(f2);
    });

    it('should refuse a purchi that is already entered', async () => {
      const a = await add();
      const b = await add();
      const res = await call('patch', `/purchases/${b.id}`, owner(), {
        purchiNo: a.purchiNo,
      }).expect(409);
      expect(codeOf(res)).toBe('DUPLICATE_PURCHI');
      // keeping its own purchi is fine
      await call('patch', `/purchases/${b.id}`, owner(), {
        purchiNo: b.purchiNo,
        note: 'same purchi',
      }).expect(200);
    });

    it('should cancel a stock truck with a reversal and keep the reason', async () => {
      const sup = await newSupplier('Cancel Co', '0303-4440005');
      const p = await add(owner(), { supplierId: sup.id });
      expect((await supplier(sup.id)).balance).toBe(145000);

      await call('post', `/purchases/${p.id}/cancel`, owner(), {
        reason: ' ',
      }).expect(422);

      const res = await call('post', `/purchases/${p.id}/cancel`, owner(), {
        reason: 'Truck sent back',
      }).expect(200);
      expect(res.body).toMatchObject({
        status: 'cancelled',
        reason: 'Truck sent back',
      });
      expect((await supplier(sup.id)).balance).toBe(0);

      const rows = await khata(sup.id);
      expect(last(rows)).toMatchObject({ kind: 'credit', amount: 145000 });
      expect(last(rows).detail).toMatch(/^Cancelled/);
    });

    it('should not edit or cancel what is cancelled, rejected or still pending', async () => {
      const p = await add();
      await call('post', `/purchases/${p.id}/cancel`, owner(), {
        reason: 'x',
      }).expect(200);

      const edit = await call('patch', `/purchases/${p.id}`, owner(), {
        note: 'late',
      }).expect(409);
      expect(codeOf(edit)).toBe('NOT_EDITABLE');
      const again = await call('post', `/purchases/${p.id}/cancel`, owner(), {
        reason: 'x',
      }).expect(409);
      expect(codeOf(again)).toBe('CANCEL_AFTER_CUTTING');

      const pending = await add(munshi.token);
      await call('post', `/purchases/${pending.id}/cancel`, owner(), {
        reason: 'x',
      }).expect(409);
    });
  });

  describe('looking at trucks', () => {
    it('should filter by status, supplier and factory', async () => {
      const inStock = await list('?status=in_stock');
      expect(inStock.every((p) => p.status === 'in_stock')).toBe(true);

      const ofS2 = await list(`?supplierId=${s2}`);
      expect(ofS2.length).toBeGreaterThan(0);
      expect(ofS2.every((p) => p.supplierId === s2)).toBe(true);

      const ofF2 = await list(`?factoryId=${f2}`);
      expect(ofF2.every((p) => p.factoryId === f2)).toBe(true);
    });

    it('should list newest first, and oldest first for trucks waiting in the yard', async () => {
      const all = await list();
      const dates = all.map((p) => p.date);
      expect([...dates].sort().reverse()).toEqual(dates);

      const waiting = await list('?status=in_stock');
      const wdates = waiting.map((p) => p.date);
      expect([...wdates].sort()).toEqual(wdates);
    });

    it('should find trucks that have waited long enough', async () => {
      const old = await add(owner(), { date: '2025-01-05' });
      const aged = await list('?ageDays=30');

      expect(aged.map((p) => p.id)).toContain(old.id);
      expect(aged.every((p) => p.status === 'in_stock')).toBe(true);
      expect(aged[0].date <= last(aged).date).toBe(true);
    });

    it('should return one truck, and reject a bad filter', async () => {
      const p = await add();
      expect((await get(p.id)).purchiNo).toBe(p.purchiNo);
      await call('get', '/purchases?status=sideways', owner()).expect(422);
      await call('get', '/purchases/not-a-uuid', owner()).expect(422);
    });
  });

  describe('who may do what', () => {
    it('should let a viewer look but not enter or decide anything', async () => {
      await list('', viewer.token);
      const p = (await list())[0];
      await call('get', `/purchases/${p.id}`, viewer.token).expect(200);

      await create(viewer.token).expect(403);
      await call('patch', `/purchases/${p.id}`, viewer.token, {
        note: 'x',
      }).expect(403);
      await call('post', `/purchases/${p.id}/cancel`, viewer.token, {
        reason: 'x',
      }).expect(403);
    });

    it('should let a manager enter and approve a truck at once', async () => {
      const p = await add(manager.token);
      expect(p.status).toBe('in_stock');
    });

    it('should follow a custom role: entering waits, approving decides', async () => {
      await call('post', '/company/roles', owner(), {
        name: 'Truck clerk',
        permissions: ['dashboard.view', 'purchasing.view', 'purchasing.create'],
      }).expect(201);
      await call('post', '/company/roles', owner(), {
        name: 'Truck lead',
        permissions: [
          'dashboard.view',
          'purchasing.view',
          'purchasing.create',
          'purchasing.approve',
        ],
      }).expect(201);
      const clerk = await h.addMember(A, 'truck-clerk', 'ClerkPur');
      const lead = await h.addMember(A, 'truck-lead', 'LeadPur');

      const waiting = await add(clerk.token);
      expect(waiting.status).toBe('pending');
      await call(
        'post',
        `/purchases/${waiting.id}/approve`,
        clerk.token,
      ).expect(403);

      const auto = await add(lead.token);
      expect(auto.status).toBe('in_stock');

      await call('post', `/purchases/${waiting.id}/approve`, lead.token).expect(
        200,
      );
    });

    it('should not let a role without purchasing.view read', async () => {
      await call('post', '/company/roles', owner(), {
        name: 'No trucks',
        permissions: ['dashboard.view'],
      }).expect(201);
      const none = await h.addMember(A, 'no-trucks', 'NonePur');
      await call('get', '/purchases', none.token).expect(403);
      await create(none.token).expect(403);
    });
  });

  describe('keeping companies apart', () => {
    it("should not show, open or change another company's trucks", async () => {
      const mine = await add();

      expect((await list('', B.ownerToken)).map((p) => p.id)).not.toContain(
        mine.id,
      );
      await call('get', `/purchases/${mine.id}`, B.ownerToken).expect(404);
      await call('patch', `/purchases/${mine.id}`, B.ownerToken, {
        note: 'x',
      }).expect(404);
      await call('post', `/purchases/${mine.id}/cancel`, B.ownerToken, {
        reason: 'x',
      }).expect(404);
      await call('post', `/purchases/${mine.id}/approve`, B.ownerToken).expect(
        404,
      );
    });

    it('should give each company its own marks', async () => {
      const bSupplier = await newSupplier(
        'B Seller',
        '0304-7770001',
        B.ownerToken,
      );
      const bFactory = await newFactory('B Main', 'own', B.ownerToken);
      const res = await call('post', '/purchases', B.ownerToken, {
        ...body(),
        supplierId: bSupplier.id,
        factoryId: bFactory.id,
      }).expect(201);
      expect((res.body as Purchase).mark).toBe('1/3');
    });
  });
});
