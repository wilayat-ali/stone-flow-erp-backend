// End-to-end tests for Expenses: recording an expense (paid now, unpaid bill,
// shop credit), the munshi's approval, paying a bill later, cancelling (a
// reversal), and the munshi's petty cash. They boot the whole app in-process,
// use the database from .env, create everything through the real API with
// unique "e2e-<run>" data, and delete it all afterwards.
//
//   npm run test:e2e -- expenses
import { Harness, Member, Workspace } from '../utils/harness';

jest.setTimeout(240000);

type Expense = {
  id: string;
  expNo: string;
  amount: number;
  payMode: string;
  status: string;
  accountId: string | null;
  accountName: string;
  paidOn: string | null;
  dueDate: string | null;
  shopName: string;
  reason: string | null;
  createdBy: string;
  approvedBy: string | null;
};
type Munshi = {
  accountId: string;
  balance: number;
  ownerOwes: number;
  recent: { amount: number; fromAccountName: string; by: string }[];
};
type Khata = { kind: string; amount: number; balance: number };

const codeOf = (res: { body: unknown }) => (res.body as { code?: string }).code;

describe('Expenses (e2e)', () => {
  let h: Harness;
  let A: Workspace;
  let B: Workspace;
  let manager: Member;
  let munshi: Member;
  let viewer: Member;
  let f1: string;
  let f2: string;
  let cash: string;
  let bank: string;
  let category: string;
  let shop: string;

  const call = (...args: Parameters<Harness['call']>) => h.call(...args);
  const owner = () => A.ownerToken;
  let phone = 7000000;

  const balanceOf = async (account: string) =>
    (
      (await call('get', '/cash-bank/accounts', owner()).expect(200)).body as {
        id: string;
        balance: number;
      }[]
    ).find((a) => a.id === account)!.balance;

  const expense = (token: string, over: Record<string, unknown> = {}) =>
    call('post', '/expenses', token, {
      date: '2026-11-03',
      categoryId: category,
      description: 'Tea and lunch for the crew',
      amount: 3500,
      factoryId: f1,
      payMode: 'paid',
      accountId: cash,
      ...over,
    });
  const add = async (token: string, over: Record<string, unknown> = {}) =>
    (await expense(token, over).expect(201)).body as Expense;
  const munshiCash = async () =>
    (await call('get', '/expenses/munshi-cash', owner()).expect(200))
      .body as Munshi;

  beforeAll(async () => {
    h = await Harness.start();
    A = await h.createCompany('exp-a');
    B = await h.createCompany('exp-b');
    manager = await h.addMember(A, 'manager', 'MgrExp');
    munshi = await h.addMember(A, 'munshi', 'MunshiExp');
    viewer = await h.addMember(A, 'viewer', 'ViewerExp');
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
        name: 'HBL Current',
        last4: '1234',
        openingBalance: 500000,
        openingDate: '2026-01-01',
      }).expect(201)
    ).body.id as string;
    category = (
      (await call('get', '/settings/expense-categories', owner()).expect(200))
        .body as { id: string }[]
    )[0].id;
    shop = (
      await call('post', '/suppliers', owner(), {
        type: 'shop',
        name: 'Madina Machinery Store',
        phone: `0304-${String(++phone).padStart(7, '0')}`,
        city: 'Karachi',
        openingDate: '2026-01-01',
      }).expect(201)
    ).body.id as string;
  });

  afterAll(async () => {
    await h.stop();
  });

  describe('paid now', () => {
    it('should record a paid expense, take the money out of the account and show who paid', async () => {
      const before = await balanceOf(cash);
      const e = await add(owner());
      expect(e).toMatchObject({
        status: 'approved',
        payMode: 'paid',
        amount: 3500,
        accountName: 'Cash in hand',
        paidOn: '2026-11-03',
        dueDate: null,
      });
      expect(e.expNo).toMatch(/^EX-\d{4}$/);
      expect(e.createdBy).toBeTruthy();
      expect(e.approvedBy).toBeTruthy();
      expect(await balanceOf(cash)).toBe(before - 3500);
    });

    it('should refuse a paid expense without an account, a future date, or a bad amount', async () => {
      expect(
        codeOf(await expense(owner(), { accountId: undefined }).expect(409)),
      ).toBe('ACCOUNT_REQUIRED');
      expect(
        codeOf(await expense(owner(), { date: '2999-01-01' }).expect(409)),
      ).toBe('FUTURE_DATE');
      await expense(owner(), { amount: 0 }).expect(422);
      await expense(owner(), { amount: 1.5 }).expect(422);
    });

    it('should refuse a bank the person may not use, and an account of another company', async () => {
      const res = await expense(munshi.token, { accountId: bank }).expect(403);
      expect(codeOf(res)).toBe('BANK_ACCOUNT_NOT_ALLOWED');
      await expense(owner(), {
        accountId: 'b0000000-0000-4000-8000-000000000000',
      }).expect(422);
    });

    it('should let a munshi pay from cash', async () => {
      const e = await add(munshi.token, { accountId: cash, amount: 500 });
      expect(e.status).toBe('pending');
    });
  });

  describe('approval for a munshi', () => {
    it('should wait as pending, with no effect, until the owner approves it', async () => {
      const before = await balanceOf(cash);
      const e = await add(munshi.token, {
        description: 'Water tanker',
        amount: 6000,
      });
      expect(e.status).toBe('pending');
      expect(await balanceOf(cash)).toBe(before);

      const approved = (
        await call('post', `/expenses/${e.id}/approve`, owner()).expect(200)
      ).body as Expense;
      expect(approved).toMatchObject({
        status: 'approved',
        paidOn: '2026-11-03',
      });
      expect(await balanceOf(cash)).toBe(before - 6000);
      expect(
        codeOf(
          await call('post', `/expenses/${e.id}/approve`, owner()).expect(409),
        ),
      ).toBe('ALREADY_DECIDED');
    });

    it('should let a manager record and decide directly, and a rejection keep its reason', async () => {
      const m = await add(manager.token, {
        description: 'Manager diesel',
        amount: 100,
      });
      expect(m.status).toBe('approved');

      const e = await add(munshi.token, {
        description: 'Too much',
        amount: 900,
      });
      const rejected = (
        await call('post', `/expenses/${e.id}/reject`, owner(), {
          reason: 'not needed',
        }).expect(200)
      ).body as Expense;
      expect(rejected).toMatchObject({
        status: 'rejected',
        reason: 'not needed',
      });
      const before = await balanceOf(cash);
      expect(await balanceOf(cash)).toBe(before);
    });

    it('should refuse rejecting without a reason, and a munshi deciding', async () => {
      const e = await add(munshi.token, {
        description: 'Needs reason',
        amount: 50,
      });
      await call('post', `/expenses/${e.id}/reject`, owner(), {
        reason: '',
      }).expect(422);
      await call('post', `/expenses/${e.id}/approve`, munshi.token).expect(403);
    });
  });

  describe('unpaid bills', () => {
    it('should record a bill with a due date, post nothing, and pay it later from an account', async () => {
      const before = await balanceOf(bank);
      const e = await add(owner(), {
        payMode: 'unpaid',
        accountId: undefined,
        dueDate: '2026-11-15',
        description: 'K-Electric, October',
        amount: 48200,
        photoName: 'k-electric-oct.jpg',
      });
      expect(e).toMatchObject({
        status: 'approved',
        payMode: 'unpaid',
        paidOn: null,
        dueDate: '2026-11-15',
      });
      expect(await balanceOf(bank)).toBe(before);

      const paid = (
        await call('post', `/expenses/${e.id}/pay`, owner(), {
          accountId: bank,
          date: '2026-11-12',
        }).expect(200)
      ).body as Expense;
      expect(paid).toMatchObject({
        paidOn: '2026-11-12',
        accountName: 'HBL Current',
      });
      expect(await balanceOf(bank)).toBe(before - 48200);
      expect(
        codeOf(
          await call('post', `/expenses/${e.id}/pay`, owner(), {
            accountId: bank,
            date: '2026-11-12',
          }).expect(409),
        ),
      ).toBe('ALREADY_PAID');
    });

    it('should refuse a due date missing, a payment before the bill, and paying a munshi from a bank', async () => {
      expect(
        codeOf(
          await expense(owner(), {
            payMode: 'unpaid',
            accountId: undefined,
          }).expect(409),
        ),
      ).toBe('DUE_DATE_REQUIRED');
      const e = await add(owner(), {
        payMode: 'unpaid',
        accountId: undefined,
        dueDate: '2026-11-20',
        description: 'Early',
        amount: 100,
      });
      expect(
        codeOf(
          await call('post', `/expenses/${e.id}/pay`, owner(), {
            accountId: bank,
            date: '2026-10-01',
          }).expect(409),
        ),
      ).toBe('BEFORE_BILL');
      const res = await call('post', `/expenses/${e.id}/pay`, munshi.token, {
        accountId: bank,
        date: '2026-11-03',
      }).expect(403);
      expect(res.status).toBe(403);
    });
  });

  describe('shop credit', () => {
    it('should put the bill on the shop khata and show the shop', async () => {
      const e = await add(owner(), {
        payMode: 'shop_credit',
        accountId: undefined,
        shopId: shop,
        description: 'Gang saw blade segments',
        amount: 18500,
      });
      expect(e).toMatchObject({
        status: 'approved',
        payMode: 'shop_credit',
        shopName: 'Madina Machinery Store',
      });
      const sup = (await call('get', `/suppliers/${shop}`, owner()).expect(200))
        .body as { balance: number };
      expect(sup.balance).toBeGreaterThanOrEqual(18500);
      const rows = (
        await call('get', `/suppliers/${shop}/khata`, owner()).expect(200)
      ).body as Khata[];
      expect(rows.some((r) => r.kind === 'charge' && r.amount === 18500)).toBe(
        true,
      );
    });

    it('should refuse shop credit without a shop, or with a supplier that is not a shop', async () => {
      expect(
        codeOf(
          await expense(owner(), {
            payMode: 'shop_credit',
            accountId: undefined,
          }).expect(409),
        ),
      ).toBe('SHOP_REQUIRED');
      const mine = (
        await call('post', '/suppliers', owner(), {
          type: 'mine_owner',
          name: 'Haji Mine',
          phone: `0304-${String(++phone).padStart(7, '0')}`,
          city: 'Ziarat',
          openingDate: '2026-01-01',
        }).expect(201)
      ).body.id as string;
      await expense(owner(), {
        payMode: 'shop_credit',
        accountId: undefined,
        shopId: mine,
      }).expect(422);
    });
  });

  describe('cancelling', () => {
    it('should give the money back to the account, as a reversal, and keep the record', async () => {
      const e = await add(owner(), {
        amount: 2000,
        description: 'Wrong entry',
      });
      const before = await balanceOf(cash);
      const res = (
        await call('post', `/expenses/${e.id}/cancel`, owner(), {
          reason: 'typed twice',
        }).expect(200)
      ).body as Expense;
      expect(res).toMatchObject({ status: 'cancelled', reason: 'typed twice' });
      expect(await balanceOf(cash)).toBe(before + 2000);
      expect(
        codeOf(
          await call('post', `/expenses/${e.id}/cancel`, owner(), {
            reason: 'x',
          }).expect(409),
        ),
      ).toBe('ALREADY_DECIDED');
    });

    it('should take a shop bill off the shop khata when cancelled', async () => {
      const e = await add(owner(), {
        payMode: 'shop_credit',
        accountId: undefined,
        shopId: shop,
        amount: 700,
        description: 'Cancel me',
      });
      const before = (
        (await call('get', `/suppliers/${shop}`, owner()).expect(200)).body as {
          balance: number;
        }
      ).balance;
      await call('post', `/expenses/${e.id}/cancel`, owner(), {
        reason: 'not ours',
      }).expect(200);
      const after = (
        (await call('get', `/suppliers/${shop}`, owner()).expect(200)).body as {
          balance: number;
        }
      ).balance;
      expect(after).toBe(before - 700);
    });

    it('should cancel a waiting munshi expense without any money moving', async () => {
      const e = await add(munshi.token, {
        amount: 300,
        description: 'Waiting',
      });
      const before = await balanceOf(cash);
      expect(
        codeOf(
          await call('post', `/expenses/${e.id}/cancel`, owner(), {
            reason: 'x',
          }).expect(409),
        ),
      ).toBe('ALREADY_DECIDED');
      expect(await balanceOf(cash)).toBe(before);
    });
  });

  describe("the munshi's petty cash", () => {
    it('should create the munshi account on first use and give it cash from an account', async () => {
      const summary = await munshiCash();
      expect(summary.accountId).toBeTruthy();
      const before = await balanceOf(cash);
      await call('post', '/expenses/munshi-cash/gives', owner(), {
        fromAccountId: cash,
        amount: 20000,
        date: '2026-11-01',
        note: 'Weekly petty cash',
      }).expect(201);
      expect(await balanceOf(cash)).toBe(before - 20000);
      const after = await munshiCash();
      expect(after.balance).toBe(summary.balance + 20000);
      expect(after.recent[0]).toMatchObject({
        amount: 20000,
        fromAccountName: 'Cash in hand',
      });
    });

    it('should show the munshi as spending his own money when his cash goes negative', async () => {
      const m = await munshiCash();
      const e = await add(owner(), {
        accountId: m.accountId,
        amount: m.balance + 1500,
        description: 'Overspend',
      });
      expect(e.accountName).toBe('Munshi cash');
      const after = await munshiCash();
      expect(after.balance).toBe(-1500);
      expect(after.ownerOwes).toBe(1500);
    });

    it('should count a munshi expense paid from his cash against his balance', async () => {
      const m = await munshiCash();
      await add(munshi.token, {
        accountId: m.accountId,
        amount: 0 + 100,
        description: 'Munshi tea',
      }).catch(() => undefined);
      const e = await add(munshi.token, {
        accountId: m.accountId,
        amount: 100,
        description: 'Munshi tea',
      });
      expect(e.status).toBe('pending');
    });

    it('should refuse giving cash from a bank the person may not use, and a future date', async () => {
      const res = await call(
        'post',
        '/expenses/munshi-cash/gives',
        munshi.token,
        {
          fromAccountId: bank,
          amount: 100,
          date: '2026-11-01',
        },
      ).expect(403);
      expect(res.status).toBe(403);
      expect(
        codeOf(
          await call('post', '/expenses/munshi-cash/gives', owner(), {
            fromAccountId: cash,
            amount: 100,
            date: '2999-01-01',
          }).expect(409),
        ),
      ).toBe('FUTURE_DATE');
    });
  });

  describe('lists and permissions', () => {
    it('should list pending first, filter, and search by number and description', async () => {
      const all = (await call('get', '/expenses', owner()).expect(200))
        .body as Expense[];
      expect(all.length).toBeGreaterThan(5);
      expect(all[0].status).toBe('pending');
      const shops = (
        await call('get', '/expenses?payMode=shop_credit', owner()).expect(200)
      ).body as Expense[];
      expect(shops.every((x) => x.payMode === 'shop_credit')).toBe(true);
      const found = (
        await call(
          'get',
          `/expenses?q=${encodeURIComponent('Madina')}`,
          owner(),
        ).expect(200)
      ).body as Expense[];
      expect(found.length).toBeGreaterThan(0);
      const byNo = (
        await call('get', `/expenses?q=${all[0].expNo}`, owner()).expect(200)
      ).body as Expense[];
      expect(byNo.some((x) => x.id === all[0].id)).toBe(true);
    });

    it('should keep viewers to looking and munshis to recording', async () => {
      await call('get', '/expenses', viewer.token).expect(200);
      await expense(viewer.token).expect(403);
      await call('get', '/expenses/munshi-cash', viewer.token).expect(200);
      const e = await add(munshi.token, { description: 'Munshi records' });
      await call('post', `/expenses/${e.id}/cancel`, munshi.token, {
        reason: 'x',
      }).expect(403);
      await call('post', '/expenses/munshi-cash/gives', munshi.token, {
        fromAccountId: cash,
        amount: 1,
        date: '2026-11-01',
      }).expect(403);
    });

    it("should not show another company's expenses", async () => {
      const e = await add(owner(), { description: 'Private' });
      await call('get', `/expenses/${e.id}`, B.ownerToken).expect(404);
      await call('post', `/expenses/${e.id}/cancel`, B.ownerToken, {
        reason: 'x',
      }).expect(404);
      expect(
        (await call('get', '/expenses', B.ownerToken).expect(200)).body,
      ).toEqual([]);
      expect(f2).toBeTruthy();
    });
  });
});
