// End-to-end tests for Loans and the month end: giving a loan and its
// schedule, the owner's changes to a month, closing a month (salary less absent
// days, and the loan instalments, posted once), the lock that follows, and
// reopening. They boot the whole app in-process, use the database from .env,
// create everything through the real API with unique "e2e-<run>" data, and
// delete it all afterwards.
//
//   npm run test:e2e -- month-end
import { Harness, Member, Workspace } from '../utils/harness';

jest.setTimeout(240000);

type Loan = {
  id: string;
  amount: number;
  deducted: number;
  outstanding: number;
  status: string;
  schedule: { month: string; amount: number; status: string }[];
};
type Row = {
  workerId: string;
  earned: number;
  instalment: number;
  paid: number;
  balance: number;
  salary: { net: number; absentDays: number; cut: number } | null;
};
type Sheet = {
  month: string;
  closed: { postings: unknown[] } | null;
  rows: Row[];
  totals: { balance: number };
};
type Khata = { type: string; kind: string; amount: number; balance: number };

const codeOf = (res: { body: unknown }) => (res.body as { code?: string }).code;

describe('Loans and month end (e2e)', () => {
  let h: Harness;
  let A: Workspace;
  let B: Workspace;
  let manager: Member;
  let munshi: Member;
  let partner: Member;
  let f1: string;
  let cash: string;
  let bank: string;
  let monthly: string;
  let daily: string;

  const call = (...args: Parameters<Harness['call']>) => h.call(...args);
  const owner = () => A.ownerToken;

  const worker = async (over: Record<string, unknown>) =>
    (
      await call('post', '/workers', owner(), {
        name: `W ${Math.random().toString(36).slice(2, 8)}`,
        factoryId: f1,
        joinedOn: '2026-01-01',
        ...over,
      }).expect(201)
    ).body.id as string;
  const giveLoan = (token: string, over: Record<string, unknown> = {}) =>
    call('post', '/loans', token, {
      workerId: daily,
      date: '2026-10-02',
      amount: 30000,
      monthlyInstalment: 5000,
      firstMonth: '2026-11',
      priorRepaid: 0,
      accountId: cash,
      reason: 'Family wedding',
      ...over,
    });
  const loansOf = async (w: string) =>
    (await call('get', `/loans?workerId=${w}`, owner()).expect(200))
      .body as Loan[];
  const sheet = async (month: string, token = owner()) =>
    (await call('get', `/months/${month}/sheet`, token).expect(200))
      .body as Sheet;
  const khata = async (w: string) =>
    (await call('get', `/workers/${w}/khata`, owner()).expect(200))
      .body as Khata[];
  const balanceOf = async (account: string) =>
    (
      (await call('get', '/cash-bank/accounts', owner()).expect(200)).body as {
        id: string;
        balance: number;
      }[]
    ).find((a) => a.id === account)!.balance;

  beforeAll(async () => {
    h = await Harness.start();
    A = await h.createCompany('me-a');
    B = await h.createCompany('me-b');
    manager = await h.addMember(A, 'manager', 'MgrME');
    munshi = await h.addMember(A, 'munshi', 'MunshiME');
    partner = await h.addMember(A, 'partner', 'PartnerME');
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
        openingBalance: 500000,
        openingDate: '2026-01-01',
      }).expect(201)
    ).body.id as string;
    bank = (
      await call('post', '/cash-bank/accounts', owner(), {
        kind: 'bank',
        name: 'HBL',
        last4: '1111',
        openingBalance: 500000,
        openingDate: '2026-01-01',
      }).expect(201)
    ).body.id as string;
    monthly = await worker({
      name: 'Munshi Monthly',
      payType: 'month',
      rate: 30000,
      jobTitle: 'Munshi',
    });
    daily = await worker({
      name: 'Daily Helper',
      payType: 'day',
      rate: 800,
      jobTitle: 'Helper',
    });
  });

  afterAll(async () => {
    await h.stop();
  });

  describe('loans', () => {
    it('should give a loan out of an account and lay out its schedule', async () => {
      const before = await balanceOf(cash);
      const res = await giveLoan(owner()).expect(201);
      expect(res.body).toMatchObject({
        amount: 30000,
        deducted: 0,
        outstanding: 30000,
        status: 'active',
      });
      expect(await balanceOf(cash)).toBe(before - 30000);
      const schedule = (res.body as Loan).schedule;
      expect(schedule).toHaveLength(6);
      expect(schedule[0]).toEqual({
        month: '2026-11',
        amount: 5000,
        status: 'scheduled',
      });
      expect(schedule[5]).toMatchObject({ month: '2027-04', amount: 5000 });
    });

    it('should take off what was repaid before StoneFlow, with a smaller last instalment', async () => {
      const w = await worker({ name: 'Prior Loan', payType: 'day', rate: 800 });
      const res = await giveLoan(owner(), {
        workerId: w,
        amount: 10000,
        priorRepaid: 4000,
        monthlyInstalment: 2500,
        accountId: undefined,
      }).expect(201);
      expect((res.body as Loan).schedule.map((r) => r.amount)).toEqual([
        2500, 2500, 1000,
      ]);
      expect((res.body as Loan).outstanding).toBe(6000);
    });

    it('should refuse a repaid amount too high, a future date, and a munshi paying from a bank', async () => {
      expect(
        codeOf(await giveLoan(owner(), { priorRepaid: 30000 }).expect(409)),
      ).toBe('PRIOR_TOO_HIGH');
      expect(
        codeOf(await giveLoan(owner(), { date: '2999-01-01' }).expect(409)),
      ).toBe('FUTURE_DATE');
      await giveLoan(munshi.token, { accountId: bank }).expect(403);
    });

    it('should change one month and skip another, and reset them', async () => {
      const w = await worker({
        name: 'Change Loan',
        payType: 'day',
        rate: 800,
      });
      const loan = (
        await giveLoan(owner(), {
          workerId: w,
          firstMonth: '2026-11',
          accountId: undefined,
        }).expect(201)
      ).body as Loan;
      await call('put', `/loans/${loan.id}/months/2026-12`, owner(), {
        amount: 2000,
      }).expect(200);
      await call('put', `/loans/${loan.id}/months/2027-01`, owner(), {
        skip: true,
      }).expect(200);
      const changed = (await loansOf(w))[0];
      expect(changed.schedule.find((r) => r.month === '2026-12')).toMatchObject(
        { amount: 2000, status: 'scheduled' },
      );
      expect(changed.schedule.find((r) => r.month === '2027-01')).toMatchObject(
        { amount: 0, status: 'skipped' },
      );
      await call('delete', `/loans/${loan.id}/months/2026-12`, owner()).expect(
        200,
      );
      await call('delete', `/loans/${loan.id}/months/2027-01`, owner()).expect(
        200,
      );
      const reset = (await loansOf(w))[0];
      expect(reset.schedule.every((r) => r.amount === 5000)).toBe(true);
      expect(
        codeOf(
          await call('put', `/loans/${loan.id}/months/2026-12`, owner(), {
            amount: 0,
          }).expect(422),
        ),
      );
    });

    it('should let a munshi see loans but not give one', async () => {
      await call('get', '/loans', munshi.token).expect(200);
      await giveLoan(munshi.token).expect(403);
    });
  });

  describe('closing the month', () => {
    const month = '2026-10';

    it('should show the month before closing: a monthly salary less absent days, and the loan instalment due', async () => {
      // Karim was absent on two days of October; the monthly worker on one of them.
      await call('put', '/workers/attendance', owner(), {
        date: '2026-10-05',
        absentIds: [monthly],
      }).expect(200);
      await call('put', '/workers/attendance', owner(), {
        date: '2026-10-06',
        absentIds: [monthly],
      }).expect(200);
      const loan = (
        await giveLoan(owner(), {
          workerId: monthly,
          firstMonth: month,
          amount: 25000,
          monthlyInstalment: 5000,
          accountId: cash,
        }).expect(201)
      ).body as Loan;
      expect(loan.schedule[0]).toEqual({
        month,
        amount: 5000,
        status: 'scheduled',
      });

      const s = await sheet(month);
      expect(s.closed).toBeNull();
      const row = s.rows.find((r) => r.workerId === monthly)!;
      // 30000 - 2 absent days at 30000 / 30 = 2000
      expect(row.salary).toMatchObject({
        net: 28000,
        absentDays: 2,
        cut: 2000,
      });
      expect(row.earned).toBe(28000);
      expect(row.instalment).toBe(5000);
      expect(row.balance).toBe(23000);
    });

    it('should close the month: post the salary and the instalment once, and lock it', async () => {
      const before = (await sheet(month)).rows.find(
        (r) => r.workerId === monthly,
      )!.balance;
      const close = (
        await call('post', `/months/${month}/close`, owner()).expect(201)
      ).body as { postings: unknown[] };
      expect(close.postings.length).toBeGreaterThan(0);

      const after = (await sheet(month)).rows.find(
        (r) => r.workerId === monthly,
      )!;
      expect(after.balance).toBe(before);
      expect(after.salary?.net).toBe(28000);

      const rows = await khata(monthly);
      expect(
        rows.some(
          (r) =>
            r.type === 'salary' && r.kind === 'charge' && r.amount === 28000,
        ),
      ).toBe(true);
      expect(
        rows.some(
          (r) =>
            r.type === 'instalment' && r.kind === 'credit' && r.amount === 5000,
        ),
      ).toBe(true);

      const loans = await loansOf(monthly);
      expect(loans[0].deducted).toBe(5000);
      expect(loans[0].outstanding).toBe(20000);
    });

    it('should refuse closing it twice, and anything that changes the closed month', async () => {
      expect(
        codeOf(
          await call('post', `/months/${month}/close`, owner()).expect(409),
        ),
      ).toBe('ALREADY_CLOSED');
      expect(
        codeOf(
          await call('put', '/workers/attendance', owner(), {
            date: '2026-10-08',
            absentIds: [],
          }).expect(409),
        ),
      ).toBe('MONTH_CLOSED');
      expect(
        codeOf(
          await call('post', '/workers/payments', owner(), {
            workerId: daily,
            amount: 100,
            date: '2026-10-08',
            accountId: cash,
          }).expect(409),
        ),
      ).toBe('MONTH_CLOSED');
      const loan = (await loansOf(monthly))[0];
      expect(
        codeOf(
          await call('put', `/loans/${loan.id}/months/${month}`, owner(), {
            amount: 100,
          }).expect(409),
        ),
      ).toBe('MONTH_CLOSED');
      expect(
        codeOf(
          await giveLoan(owner(), {
            workerId: monthly,
            firstMonth: month,
          }).expect(409),
        ),
      ).toBe('MONTH_CLOSED');
    });

    it('should let only the owner reopen a month, and only partners or the owner close one', async () => {
      await call('post', '/months/2026-09/close', manager.token).expect(403);
      await call('post', `/months/${month}/reopen`, manager.token).expect(403);
      await call('post', `/months/${month}/reopen`, partner.token).expect(403);
      expect(
        codeOf(
          await call('post', `/months/${month}/close`, partner.token).expect(
            409,
          ),
        ),
      ).toBe('ALREADY_CLOSED');
    });

    it('should reopen the month: take the postings back with opposite rows, and unlock it', async () => {
      await call('post', `/months/${month}/reopen`, owner()).expect(200);
      const rows = await khata(monthly);
      expect(rows.some((r) => r.type === 'salary' && r.kind === 'credit')).toBe(
        true,
      );
      expect(
        rows.some((r) => r.type === 'instalment' && r.kind === 'charge'),
      ).toBe(true);
      const after = (await sheet(month)).rows.find(
        (r) => r.workerId === monthly,
      )!;
      expect(after.salary?.net).toBe(28000);
      expect(after.balance).toBe(23000);
      const loans = await loansOf(monthly);
      expect(loans[0].deducted).toBe(0);
      expect(
        codeOf(
          await call('post', `/months/${month}/reopen`, owner()).expect(409),
        ),
      ).toBe('NOT_CLOSED');
      await call('put', '/workers/attendance', owner(), {
        date: '2026-10-08',
        absentIds: [],
      }).expect(200);
      const log = (await call('get', '/months/log', owner()).expect(200))
        .body as { month: string; action: string }[];
      expect(log.map((l) => l.action)).toEqual(
        expect.arrayContaining(['closed', 'reopened']),
      );
    });

    it("should keep a company's sheet and closes to itself", async () => {
      const s = await sheet(month, B.ownerToken);
      expect(s.rows).toEqual([]);
      expect(s.closed).toBeNull();
    });
  });
});
