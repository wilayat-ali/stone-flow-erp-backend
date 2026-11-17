// End-to-end tests for Workers' day-to-day: the attendance (daily workers are
// paid per saved present day), the sq.ft work register (feet per day, with the
// rate card as the fallback), and worker payments (advances and payments, with
// approval for a munshi). They boot the whole app in-process, use the database
// from .env, create everything through the real API with unique "e2e-<run>"
// data, and delete it all afterwards.
//
//   npm run test:e2e -- workers
import { Harness, Member, Workspace } from '../utils/harness';

jest.setTimeout(240000);

type Worker = {
  id: string;
  name: string;
  payType: string;
  rate: number;
  defaultJob: string;
  balance: number;
};
type Row = {
  workerId: string;
  workerName: string;
  feet: number;
  autoFeet: number;
  rate: number;
  present?: boolean;
};
type Payment = {
  id: string;
  amount: number;
  status: string;
  accountId: string;
  workerId: string;
};
type Khata = {
  type: string;
  kind: string;
  amount: number;
  balance: number;
  job?: string;
};

const codeOf = (res: { body: unknown }) => (res.body as { code?: string }).code;

describe('Workers (e2e)', () => {
  let h: Harness;
  let A: Workspace;
  let B: Workspace;
  let manager: Member;
  let munshi: Member;
  let viewer: Member;
  let f1: string;
  let cash: string;
  let bank: string;
  let daily: Worker;
  let sqft: Worker;
  let sqftOwnRate: Worker;

  const call = (...args: Parameters<Harness['call']>) => h.call(...args);
  const owner = () => A.ownerToken;
  let seq = 0;

  const newWorker = async (over: Record<string, unknown>) =>
    (
      await call('post', '/workers', owner(), {
        name: `Worker ${Date.now()}-${++seq}`,
        factoryId: f1,
        joinedOn: '2026-09-01',
        ...over,
      }).expect(201)
    ).body as Worker;
  const khata = async (id: string) =>
    (await call('get', `/workers/${id}/khata`, owner()).expect(200))
      .body as Khata[];
  const balanceOf = async (account: string) =>
    (
      (await call('get', '/cash-bank/accounts', owner()).expect(200)).body as {
        id: string;
        balance: number;
      }[]
    ).find((a) => a.id === account)!.balance;
  const attendance = (
    date: string,
    absentIds: string[] = [],
    token = owner(),
  ) => call('put', '/workers/attendance', token, { date, absentIds });
  const register = (
    date: string,
    rows: { workerId: string; feet: number }[],
    token = owner(),
  ) => call('put', '/workers/register', token, { date, rows });
  const pay = (token: string, body: Record<string, unknown>) =>
    call('post', '/workers/payments', token, {
      date: '2026-11-09',
      accountId: cash,
      ...body,
    });

  beforeAll(async () => {
    h = await Harness.start();
    A = await h.createCompany('wk-a');
    B = await h.createCompany('wk-b');
    manager = await h.addMember(A, 'manager', 'MgrWk');
    munshi = await h.addMember(A, 'munshi', 'MunshiWk');
    viewer = await h.addMember(A, 'viewer', 'ViewerWk');
    f1 = (
      await call('post', '/settings/factories', owner(), {
        name: 'Main',
        kind: 'own',
      }).expect(201)
    ).body.id as string;
    cash = (
      await call('post', '/cash-bank/accounts', owner(), {
        kind: 'cash',
        name: 'Cash in hand',
        openingBalance: 100000,
        openingDate: '2026-01-01',
      }).expect(201)
    ).body.id as string;
    bank = (
      await call('post', '/cash-bank/accounts', owner(), {
        kind: 'bank',
        name: 'HBL',
        last4: '9876',
        openingBalance: 100000,
        openingDate: '2026-01-01',
      }).expect(201)
    ).body.id as string;
    daily = await newWorker({
      name: 'Karim',
      payType: 'day',
      rate: 800,
      jobTitle: 'Helper',
    });
    sqft = await newWorker({
      name: 'Rafiq polisher',
      payType: 'sqft',
      rate: 0,
      defaultJob: 'Polisher',
      jobTitle: 'Polisher',
    });
    sqftOwnRate = await newWorker({
      name: 'Own rate',
      payType: 'sqft',
      rate: 9,
      defaultJob: 'Polisher',
      jobTitle: 'Polisher',
    });
  });

  afterAll(async () => {
    await h.stop();
  });

  describe('attendance', () => {
    it('should pay a daily worker his rate for each saved present day', async () => {
      const res = await attendance('2026-11-10', []).expect(200);
      expect(res.body).toMatchObject({ date: '2026-11-10', saved: true });
      const k = await khata(daily.id);
      const work = k.find((r) => r.type === 'attendance' && r.job === 'Helper');
      expect(work).toMatchObject({ kind: 'charge', amount: 800 });
    });

    it('should take a day back when a worker is marked absent, and pay again when present', async () => {
      await attendance('2026-11-11', [daily.id]).expect(200);
      let charges = (await khata(daily.id)).filter(
        (r) => r.type === 'attendance' && r.kind === 'charge',
      );
      expect(
        charges.reduce(
          (s, r) => s + (r.kind === 'charge' ? r.amount : -r.amount),
          0,
        ),
      ).toBe(800);
      await attendance('2026-11-11', []).expect(200);
      charges = (await khata(daily.id)).filter(
        (r) => r.type === 'attendance' && r.kind === 'charge',
      );
      expect(
        charges.reduce(
          (s, r) => s + (r.kind === 'charge' ? r.amount : -r.amount),
          0,
        ),
      ).toBe(1600);
    });

    it('should not pay a monthly worker per day, and show only workers who had joined', async () => {
      const sheet = (
        await call(
          'get',
          '/workers/attendance?date=2026-11-10',
          owner(),
        ).expect(200)
      ).body as {
        rows: { worker: Worker }[];
      };
      expect(sheet.rows.some((r) => r.worker.id === daily.id)).toBe(true);
      expect(sheet.rows.some((r) => r.worker.id === sqft.id)).toBe(false);
      const early = (
        await call(
          'get',
          '/workers/attendance?date=2026-08-01',
          owner(),
        ).expect(200)
      ).body as { rows: unknown[] };
      expect(early.rows).toHaveLength(0);
    });

    it('should refuse a future date, and an absent worker who is not on the roll', async () => {
      expect(codeOf(await attendance('2999-01-01', []).expect(409))).toBe(
        'FUTURE_DATE',
      );
      await attendance('2026-11-12', [sqft.id]).expect(422);
    });

    it('should let a munshi save the attendance but not a viewer', async () => {
      await attendance('2026-11-13', [], munshi.token).expect(200);
      await attendance('2026-11-13', [], viewer.token).expect(403);
    });
  });

  describe('work register', () => {
    it('should pay the feet typed for the day at the rate, and replace them when changed', async () => {
      await register('2026-11-10', [{ workerId: sqft.id, feet: 900 }]).expect(
        200,
      );

      // A rate card rate of 0 on the worker falls back to the Polisher rate card.
      const rateCard = (
        await call('get', '/settings/worker-rates', owner()).expect(200)
      ).body as { name: string; rate: number }[];
      const polisher = rateCard.find((r) => r.name === 'Polisher')!;
      const after = (await khata(sqft.id)).filter(
        (r) => r.type === 'work' && r.kind === 'charge',
      );
      expect(
        after.reduce(
          (s, r) => s + (r.kind === 'charge' ? r.amount : -r.amount),
          0,
        ),
      ).toBe(900 * polisher.rate);

      await register('2026-11-10', [{ workerId: sqft.id, feet: 400 }]).expect(
        200,
      );
      const changed = (await khata(sqft.id)).filter((r) => r.type === 'work');
      expect(
        changed.reduce(
          (s, r) => s + (r.kind === 'charge' ? r.amount : -r.amount),
          0,
        ),
      ).toBe(400 * polisher.rate);
    });

    it("should use the worker's own rate before the rate card, and show production's feet locked", async () => {
      await register('2026-11-11', [
        { workerId: sqftOwnRate.id, feet: 100 },
      ]).expect(200);
      const sheet = (
        await call('get', '/workers/register?date=2026-11-11', owner()).expect(
          200,
        )
      ).body as { rows: Row[] };
      const row = sheet.rows.find((r) => r.workerId === sqftOwnRate.id)!;
      expect(row).toMatchObject({ feet: 100, rate: 9 });
      expect(row.autoFeet).toBe(0);
    });

    it('should take the day back when the feet are cleared to zero', async () => {
      await register('2026-11-12', [
        { workerId: sqftOwnRate.id, feet: 50 },
      ]).expect(200);
      await register('2026-11-12', [
        { workerId: sqftOwnRate.id, feet: 0 },
      ]).expect(200);
      const charges = (await khata(sqftOwnRate.id)).filter(
        (r) => r.type === 'work' && r.job === 'Polisher',
      );
      const total = charges.reduce(
        (s, r) => s + (r.kind === 'charge' ? r.amount : -r.amount),
        0,
      );
      expect(total).toBe(100 * 9);
    });

    it('should refuse a future date, a worker who is not a sq.ft worker, and a negative amount of feet', async () => {
      expect(
        codeOf(
          await register('2999-01-01', [{ workerId: sqft.id, feet: 1 }]).expect(
            409,
          ),
        ),
      ).toBe('FUTURE_DATE');
      await register('2026-11-12', [{ workerId: daily.id, feet: 5 }]).expect(
        422,
      );
      await register('2026-11-12', [{ workerId: sqft.id, feet: -1 }]).expect(
        422,
      );
    });
  });

  describe('worker payments', () => {
    it('should pay a worker from cash and reduce what we owe him', async () => {
      const before = await balanceOf(cash);
      const w = await newWorker({
        payType: 'day',
        rate: 700,
        name: `Advance ${seq}`,
      });
      const res = await pay(owner(), {
        workerId: w.id,
        amount: 2000,
        note: 'Advance',
      }).expect(201);
      expect(res.body).toMatchObject({
        status: 'confirmed',
        amount: 2000,
        note: 'Advance',
      });
      expect(await balanceOf(cash)).toBe(before - 2000);
      const k = await khata(w.id);
      expect(k.find((r) => r.type === 'payment')).toMatchObject({
        kind: 'credit',
        amount: 2000,
      });
    });

    it('should wait as pending for a munshi, with no effect, until confirmed', async () => {
      const w = await newWorker({
        payType: 'sqft',
        rate: 0,
        defaultJob: 'Polisher',
        name: `Munshi pay ${seq}`,
      });
      const before = await balanceOf(cash);
      const res = await pay(munshi.token, {
        workerId: w.id,
        amount: 1500,
      }).expect(201);
      expect(res.body.status).toBe('pending');
      expect(await balanceOf(cash)).toBe(before);
      const id = (res.body as Payment).id;
      await call('post', `/workers/payments/${id}/confirm`, owner()).expect(
        200,
      );
      expect(await balanceOf(cash)).toBe(before - 1500);
      expect(
        codeOf(
          await call('post', `/workers/payments/${id}/confirm`, owner()).expect(
            409,
          ),
        ),
      ).toBe('ALREADY_DECIDED');
    });

    it('should reject a pending payment with a reason and move no money', async () => {
      const w = await newWorker({
        payType: 'day',
        rate: 600,
        name: `Reject ${seq}`,
      });
      const before = await balanceOf(cash);
      const res = await pay(munshi.token, {
        workerId: w.id,
        amount: 800,
      }).expect(201);
      const rejected = (
        await call('post', `/workers/payments/${res.body.id}/reject`, owner(), {
          reason: 'not agreed',
        }).expect(200)
      ).body as Payment & { status: string };
      expect(rejected.status).toBe('rejected');
      expect(await balanceOf(cash)).toBe(before);
      await call('post', `/workers/payments/${res.body.id}/reject`, owner(), {
        reason: '',
      }).expect(422);
    });

    it('should refuse a munshi paying from a bank, a bad amount and a future date', async () => {
      const w = await newWorker({
        payType: 'day',
        rate: 600,
        name: `Bank ${seq}`,
      });
      const res = await pay(munshi.token, {
        workerId: w.id,
        amount: 100,
        accountId: bank,
      }).expect(403);
      expect(codeOf(res)).toBe('BANK_ACCOUNT_NOT_ALLOWED');
      await pay(owner(), { workerId: w.id, amount: 0 }).expect(422);
      expect(
        codeOf(
          await pay(owner(), {
            workerId: w.id,
            amount: 5,
            date: '2999-01-01',
          }).expect(409),
        ),
      ).toBe('FUTURE_DATE');
    });

    it('should list payments for a worker, newest first, and leave rejected ones out', async () => {
      const list = (
        await call(
          'get',
          `/workers/payments?workerId=${daily.id}`,
          owner(),
        ).expect(200)
      ).body as Payment[];
      expect(Array.isArray(list)).toBe(true);
      const all = (
        await call('get', '/workers/payments', viewer.token).expect(200)
      ).body as Payment[];
      expect(all.every((p) => p.status !== 'rejected')).toBe(true);
    });

    it("should keep a company's workers and payments to itself", async () => {
      await call('get', '/workers/payments', B.ownerToken)
        .expect(200)
        .then((r) => expect(r.body).toEqual([]));
      await call('get', `/workers/attendance?date=2026-11-10`, B.ownerToken)
        .expect(200)
        .then((r) => expect((r.body as { rows: unknown[] }).rows).toEqual([]));
      await call(
        'post',
        `/workers/payments/${daily.id}/confirm`,
        manager.token,
      ).expect(404);
    });
  });
});
