// End-to-end tests for payments to suppliers and the cheques given. They boot
// the whole app in-process, use the database from .env, create everything
// through the real API with unique "e2e-<run>" data, and delete it all afterwards.
//
//   npm run test:e2e -- supplier-payments
import { Harness, Member, Workspace } from '../utils/harness';

jest.setTimeout(240000);

type Payment = {
  id: string;
  voucherNo: string;
  date: string;
  supplierId: string;
  supplierName: string;
  method: string;
  accountId: string;
  accountName: string;
  amount: number;
  reference: string;
  chequeId: string | null;
  forPurchaseIds: string[];
  status: string;
  note: string;
  createdBy: string;
};

type Cheque = {
  id: string;
  no: string;
  accountId: string;
  supplierId: string;
  amount: number;
  issuedOn: string;
  chequeDate: string;
  status: string;
  statusDate: string | null;
  reason: string | null;
  charge: number;
  paymentId: string;
  replacedByPaymentId: string | null;
};

type Supplier = { id: string; balance: number; unclearedCheques: number };
type Khata = {
  detail: string;
  kind: 'charge' | 'credit';
  amount: number;
  balance: number;
  unclearedCheque: boolean;
};
type Account = { id: string; balance: number | null };

const codeOf = (res: { body: unknown }) => (res.body as { code?: string }).code;
const last = <T>(items: T[]): T => items[items.length - 1];

describe('Supplier payments and cheques (e2e)', () => {
  let h: Harness;
  let A: Workspace;
  let B: Workspace;
  let manager: Member;
  let munshi: Member;
  let viewer: Member;

  let sup: string; // the supplier we pay, opening balance 500,000 owed
  let cash: string;
  let bank: string;
  let bank2: string;

  const call = (...args: Parameters<Harness['call']>) => h.call(...args);
  const owner = () => A.ownerToken;
  let chequeSeq = 1000;
  const nextCheque = () => String(++chequeSeq);

  const pay = (token: string, over: Record<string, unknown> = {}) =>
    call('post', '/supplier-payments', token, {
      date: '2026-10-08',
      supplierId: sup,
      method: 'cash',
      accountId: cash,
      amount: 10000,
      ...over,
    });
  const add = async (token = owner(), over: Record<string, unknown> = {}) =>
    (await pay(token, over).expect(201)).body as Payment;
  const addCheque = (token = owner(), over: Record<string, unknown> = {}) =>
    add(token, {
      method: 'cheque',
      accountId: bank,
      chequeNo: nextCheque(),
      chequeDate: '2026-10-14',
      ...over,
    });
  const payments = async (token = owner()) =>
    (await call('get', '/supplier-payments', token).expect(200))
      .body as Payment[];
  const cheques = async (token = owner()) =>
    (await call('get', '/supplier-cheques', token).expect(200))
      .body as Cheque[];
  const chequeOf = async (id: string) =>
    (await cheques()).find((c) => c.id === id)!;
  const supplier = async (id = sup, token = owner()) =>
    (await call('get', `/suppliers/${id}`, token).expect(200)).body as Supplier;
  const khata = async (id = sup, token = owner()) =>
    (await call('get', `/suppliers/${id}/khata`, token).expect(200))
      .body as Khata[];
  const balance = async (id: string) =>
    (
      (await call('get', '/cash-bank/accounts', owner()).expect(200))
        .body as Account[]
    ).find((a) => a.id === id)!.balance as number;
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
  const newAccount = async (
    kind: 'cash' | 'bank',
    name: string,
    token = owner(),
  ) =>
    (
      await call('post', '/cash-bank/accounts', token, {
        kind,
        name,
        ...(kind === 'bank' ? { last4: '4471' } : {}),
        openingBalance: 1000000,
        openingDate: '2026-01-01',
      }).expect(201)
    ).body as { id: string };
  const setApproval = (on: boolean) =>
    call('patch', '/company/settings', owner(), {
      approvalRequired: on,
    }).expect(200);

  beforeAll(async () => {
    h = await Harness.start();
    A = await h.createCompany('pay-a');
    B = await h.createCompany('pay-b');
    manager = await h.addMember(A, 'manager', 'MgrPay');
    munshi = await h.addMember(A, 'munshi', 'MunshiPay');
    viewer = await h.addMember(A, 'viewer', 'ViewerPay');

    sup = (
      await call('post', '/suppliers', owner(), {
        type: 'mine_owner',
        name: 'Haji Gul Khan',
        phone: '0333-7812345',
        city: 'Ziarat',
        openingBalance: 500000,
        openingDate: '2026-09-01',
      }).expect(201)
    ).body.id as string;
    cash = (await newAccount('cash', 'Test Cash')).id;
    bank = (await newAccount('bank', 'Test Bank')).id;
    bank2 = (await newAccount('bank', 'Second Bank')).id;
  });

  afterAll(async () => {
    await h.stop();
  });

  describe('cash and bank transfer', () => {
    it('should take the money out and credit the supplier at once', async () => {
      const cashBefore = await balance(cash);
      const supBefore = (await supplier()).balance;

      const p = await add(owner(), { amount: 25000, note: 'Paid at the yard' });

      expect(p).toMatchObject({
        voucherNo: expect.stringMatching(/^PV-\d{4}$/),
        method: 'cash',
        status: 'confirmed',
        amount: 25000,
        accountName: 'Test Cash',
        supplierName: 'Haji Gul Khan',
        chequeId: null,
        forPurchaseIds: [],
        note: 'Paid at the yard',
      });
      expect(p.createdBy).not.toBe('');
      expect(await balance(cash)).toBe(cashBefore - 25000);
      expect((await supplier()).balance).toBe(supBefore - 25000);

      const row = last(await khata());
      expect(row).toMatchObject({
        kind: 'credit',
        amount: 25000,
        unclearedCheque: false,
      });
      expect(row.detail).toBe(`Cash paid · ${p.voucherNo}`);
    });

    it('should pay by bank transfer from a bank account with its reference', async () => {
      const bankBefore = await balance(bank);
      const p = await add(owner(), {
        method: 'bank_transfer',
        accountId: bank,
        amount: 40000,
        reference: 'IBFT 551207',
      });

      expect(p).toMatchObject({
        method: 'bank_transfer',
        reference: 'IBFT 551207',
        status: 'confirmed',
      });
      expect(await balance(bank)).toBe(bankBefore - 40000);
      expect(last(await khata()).detail).toBe(
        'Bank transfer · Test Bank · IBFT 551207',
      );
    });

    it('should number vouchers one after another, even when entered together', async () => {
      const results = await Promise.all(
        [1, 2, 3].map(() => pay(owner(), { amount: 100 })),
      );
      for (const r of results) expect(r.status).toBe(201);

      const seqs = results.map((r) =>
        Number((r.body as Payment).voucherNo.slice(3)),
      );
      expect(new Set(seqs).size).toBe(3);
      expect(Math.max(...seqs) - Math.min(...seqs)).toBe(2);
    });

    it('should remember the trucks it was made for', async () => {
      const f = (
        await call('post', '/settings/factories', owner(), {
          name: 'Pay Factory',
          kind: 'own',
        }).expect(201)
      ).body.id as string;
      const truck = (
        await call('post', '/purchases', owner(), {
          date: '2026-10-08',
          supplierId: sup,
          material: 'Ziarat White (rough)',
          purchiNo: 'PAY-1',
          truckNo: 'TKR-1',
          tons: 10,
          ratePerTon: 1000,
          stones: 3,
          factoryId: f,
        }).expect(201)
      ).body.id as string;

      const p = await add(owner(), { forPurchaseIds: [truck, truck] });
      expect(p.forPurchaseIds).toEqual([truck]);

      const other = await newSupplier('Someone Else', '0301-9990001');
      await pay(owner(), {
        supplierId: other.id,
        forPurchaseIds: [truck],
      }).expect(422);
      await pay(owner(), {
        forPurchaseIds: ['00000000-0000-4000-8000-000000000000'],
      }).expect(422);
    });
  });

  describe('a cheque', () => {
    it('should credit the supplier at once but leave the bank until it clears', async () => {
      const bankBefore = await balance(bank);
      const supBefore = await supplier();

      const p = await addCheque(owner(), { amount: 160000 });
      expect(p).toMatchObject({ method: 'cheque', status: 'confirmed' });
      expect(p.chequeId).not.toBeNull();

      const s = await supplier();
      expect(s.balance).toBe(supBefore.balance - 160000);
      expect(s.unclearedCheques).toBe(supBefore.unclearedCheques + 160000);
      expect(await balance(bank)).toBe(bankBefore);

      const row = last(await khata());
      expect(row).toMatchObject({
        kind: 'credit',
        amount: 160000,
        unclearedCheque: true,
      });
      expect(row.detail).toMatch(
        /^Cheque no\. \d+ · Test Bank · dated 2026-10-14$/,
      );

      const c = await chequeOf(p.chequeId!);
      expect(c).toMatchObject({
        status: 'issued',
        amount: 160000,
        chequeDate: '2026-10-14',
        issuedOn: '2026-10-08',
        statusDate: null,
        charge: 0,
        paymentId: p.id,
        replacedByPaymentId: null,
      });
    });

    it('should take the money from the bank when it clears', async () => {
      const p = await addCheque(owner(), { amount: 30000 });
      const before = await balance(bank);
      const supBefore = await supplier();

      const res = await call(
        'post',
        `/supplier-cheques/${p.chequeId}/clear`,
        owner(),
        { date: '2026-10-15' },
      ).expect(200);
      expect(res.body).toMatchObject({
        status: 'cleared',
        statusDate: '2026-10-15',
      });

      expect(await balance(bank)).toBe(before - 30000);
      // the supplier was credited already: nothing changes for them, except the flag
      const s = await supplier();
      expect(s.balance).toBe(supBefore.balance);
      expect(s.unclearedCheques).toBe(supBefore.unclearedCheques - 30000);
      expect(
        (await khata()).find((r) =>
          r.detail.includes(`no. ${(res.body as Cheque).no}`),
        )!.unclearedCheque,
      ).toBe(false);
    });

    it('should owe the amount again, and charge the bank fee, when it bounces', async () => {
      const p = await addCheque(owner(), { amount: 50000 });
      const bankBefore = await balance(bank);
      const supBefore = await supplier();

      const res = await call(
        'post',
        `/supplier-cheques/${p.chequeId}/bounce`,
        owner(),
        { date: '2026-10-16', reason: 'Signature mismatch', charge: 500 },
      ).expect(200);
      expect(res.body).toMatchObject({
        status: 'bounced',
        statusDate: '2026-10-16',
        reason: 'Signature mismatch',
        charge: 500,
      });

      expect((await supplier()).balance).toBe(supBefore.balance + 50000);
      // only the bank's charge left the account: the cheque itself never did
      expect(await balance(bank)).toBe(bankBefore - 500);
      const rows = await khata();
      expect(last(rows)).toMatchObject({ kind: 'charge', amount: 50000 });
      expect(last(rows).detail).toMatch(/bounced$/);
    });

    it('should let a bounced cheque be replaced once', async () => {
      const old = await addCheque(owner(), { amount: 20000 });
      await call('post', `/supplier-cheques/${old.chequeId}/bounce`, owner(), {
        date: '2026-10-16',
      }).expect(200);

      const replacement = await addCheque(owner(), {
        amount: 20000,
        replacesChequeId: old.chequeId,
      });
      expect((await chequeOf(old.chequeId!)).replacedByPaymentId).toBe(
        replacement.id,
      );

      const again = await pay(owner(), {
        method: 'cheque',
        accountId: bank,
        chequeNo: nextCheque(),
        chequeDate: '2026-10-20',
        replacesChequeId: old.chequeId,
      }).expect(409);
      expect(codeOf(again)).toBe('NOT_REPLACEABLE');

      // a cheque that is still outstanding cannot be replaced
      const live = await addCheque(owner());
      const res = await pay(owner(), {
        method: 'cheque',
        accountId: bank,
        chequeNo: nextCheque(),
        chequeDate: '2026-10-20',
        replacesChequeId: live.chequeId,
      }).expect(409);
      expect(codeOf(res)).toBe('NOT_REPLACEABLE');
    });

    it('should owe the amount again when the supplier returns it unused', async () => {
      const p = await addCheque(owner(), { amount: 15000 });
      const bankBefore = await balance(bank);
      const supBefore = await supplier();

      const res = await call(
        'post',
        `/supplier-cheques/${p.chequeId}/cancel`,
        owner(),
      ).expect(200);
      expect((res.body as Cheque).status).toBe('cancelled');
      expect((await supplier()).balance).toBe(supBefore.balance + 15000);
      expect(await balance(bank)).toBe(bankBefore);
      expect(last(await khata()).detail).toMatch(/cancelled$/);
    });

    it('should decide a cheque only once', async () => {
      const p = await addCheque(owner(), { amount: 1000 });
      await call('post', `/supplier-cheques/${p.chequeId}/clear`, owner(), {
        date: '2026-10-15',
      }).expect(200);

      for (const action of ['clear', 'bounce'] as const) {
        const res = await call(
          'post',
          `/supplier-cheques/${p.chequeId}/${action}`,
          owner(),
          { date: '2026-10-16' },
        ).expect(409);
        expect(codeOf(res)).toBe('ALREADY_DECIDED');
      }
      await call(
        'post',
        `/supplier-cheques/${p.chequeId}/cancel`,
        owner(),
      ).expect(409);
    });

    it('should refuse a decision dated before the cheque was given or in the future', async () => {
      const p = await addCheque(owner(), { amount: 1000, date: '2026-10-08' });
      await call('post', `/supplier-cheques/${p.chequeId}/clear`, owner(), {
        date: '2026-10-01',
      }).expect(422);
      await call('post', `/supplier-cheques/${p.chequeId}/clear`, owner(), {
        date: '2099-01-01',
      }).expect(422);
      await call('post', `/supplier-cheques/${p.chequeId}/bounce`, owner(), {
        date: '2026-10-01',
      }).expect(422);
    });

    it('should use a cheque number once per bank account', async () => {
      const no = nextCheque();
      const first = await addCheque(owner(), { chequeNo: no });

      const dup = await pay(owner(), {
        method: 'cheque',
        accountId: bank,
        chequeNo: no,
        chequeDate: '2026-10-20',
      }).expect(409);
      expect(codeOf(dup)).toBe('DUPLICATE_CHEQUE');

      // another bank account may use the same number
      await addCheque(owner(), { accountId: bank2, chequeNo: no });

      // and once it is cancelled the number is free again
      await call(
        'post',
        `/supplier-cheques/${first.chequeId}/cancel`,
        owner(),
      ).expect(200);
      await addCheque(owner(), { chequeNo: no });
    });

    it('should need a cheque number and date', async () => {
      await pay(owner(), {
        method: 'cheque',
        accountId: bank,
        chequeDate: '2026-10-14',
      }).expect(422);
      await pay(owner(), {
        method: 'cheque',
        accountId: bank,
        chequeNo: nextCheque(),
      }).expect(422);
    });
  });

  describe("a munshi's payment while approval is on", () => {
    it('should wait: no money out, no credit, no effect from its cheque', async () => {
      const cashBefore = await balance(cash);
      const supBefore = await supplier();
      const khataBefore = (await khata()).length;

      const p = await add(munshi.token, { amount: 5000 });
      expect(p.status).toBe('pending');
      expect(await balance(cash)).toBe(cashBefore);
      expect((await supplier()).balance).toBe(supBefore.balance);
      expect((await khata()).length).toBe(khataBefore);
    });

    it('should not let the munshi confirm or reject', async () => {
      const p = await add(munshi.token);
      await call(
        'post',
        `/supplier-payments/${p.id}/confirm`,
        munshi.token,
      ).expect(403);
      await call(
        'post',
        `/supplier-payments/${p.id}/reject`,
        munshi.token,
        {},
      ).expect(403);
    });

    it('should take effect when a manager confirms it', async () => {
      const p = await add(munshi.token, { amount: 7000 });
      const cashBefore = await balance(cash);
      const supBefore = (await supplier()).balance;

      const res = await call(
        'post',
        `/supplier-payments/${p.id}/confirm`,
        manager.token,
      ).expect(200);
      expect((res.body as Payment).status).toBe('confirmed');
      expect(await balance(cash)).toBe(cashBefore - 7000);
      expect((await supplier()).balance).toBe(supBefore - 7000);

      const again = await call(
        'post',
        `/supplier-payments/${p.id}/confirm`,
        owner(),
      ).expect(409);
      expect(codeOf(again)).toBe('ALREADY_DECIDED');
    });

    it('should leave nothing behind when rejected, and cancel its cheque', async () => {
      const cashBefore = await balance(cash);
      const supBefore = (await supplier()).balance;

      const p = await add(munshi.token, { amount: 9000 });
      const res = await call(
        'post',
        `/supplier-payments/${p.id}/reject`,
        owner(),
        {
          reason: 'Wrong amount',
        },
      ).expect(200);
      expect((res.body as Payment).status).toBe('reversed');
      expect(await balance(cash)).toBe(cashBefore);
      expect((await supplier()).balance).toBe(supBefore);
      await call('post', `/supplier-payments/${p.id}/confirm`, owner()).expect(
        409,
      );

      // rejecting works without a reason too
      const q = await add(munshi.token, { amount: 100 });
      await call(
        'post',
        `/supplier-payments/${q.id}/reject`,
        owner(),
        {},
      ).expect(200);
    });

    it("should not count a pending payment's cheque until it is confirmed", async () => {
      // a munshi cannot use a bank account, so the owner's cheque waits through a custom role
      await call('post', '/company/roles', owner(), {
        name: 'Cheque clerk',
        permissions: ['dashboard.view', 'purchasing.view', 'purchasing.create'],
      }).expect(201);
      const clerk = await h.addMember(A, 'cheque-clerk', 'ClerkPay');

      const p = await addCheque(clerk.token, { amount: 12000 });
      expect(p.status).toBe('pending');
      const s = await supplier();

      const clear = await call(
        'post',
        `/supplier-cheques/${p.chequeId}/clear`,
        owner(),
        { date: '2026-10-15' },
      ).expect(409);
      expect(codeOf(clear)).toBe('PAYMENT_PENDING');

      // a pending cheque is not counted as uncleared yet
      expect((await supplier()).unclearedCheques).toBe(s.unclearedCheques);

      await call('post', `/supplier-payments/${p.id}/confirm`, owner()).expect(
        200,
      );
      expect((await supplier()).unclearedCheques).toBe(
        s.unclearedCheques + 12000,
      );

      // rejecting a pending payment cancels its cheque
      const q = await addCheque(clerk.token, { amount: 3000 });
      await call(
        'post',
        `/supplier-payments/${q.id}/reject`,
        owner(),
        {},
      ).expect(200);
      expect((await chequeOf(q.chequeId!)).status).toBe('cancelled');
    });

    it('should take effect at once when the company switches approval off', async () => {
      await setApproval(false);
      const p = await add(munshi.token, { amount: 100 });
      expect(p.status).toBe('confirmed');
      await setApproval(true);
    });

    it('should let a munshi pay from cash only', async () => {
      const res = await pay(munshi.token, {
        method: 'bank_transfer',
        accountId: bank,
      }).expect(403);
      expect(codeOf(res)).toBe('BANK_ACCOUNT_NOT_ALLOWED');
      await pay(munshi.token, {
        method: 'cheque',
        accountId: bank,
        chequeNo: nextCheque(),
        chequeDate: '2026-10-14',
      }).expect(403);
    });
  });

  describe('checking what is entered', () => {
    it('should match the account to the method', async () => {
      await pay(owner(), { method: 'cash', accountId: bank }).expect(422);
      await pay(owner(), { method: 'bank_transfer', accountId: cash }).expect(
        422,
      );
      await pay(owner(), {
        method: 'cheque',
        accountId: cash,
        chequeNo: nextCheque(),
        chequeDate: '2026-10-14',
      }).expect(422);
      await pay(owner(), {
        accountId: '00000000-0000-4000-8000-000000000000',
      }).expect(422);
    });

    it('should refuse a hidden account, a future date and bad amounts', async () => {
      // an account holding money cannot be hidden, so this one opens empty
      const hidden = (
        await call('post', '/cash-bank/accounts', owner(), {
          kind: 'cash',
          name: 'Hidden Cash',
          openingBalance: 0,
          openingDate: '2026-01-01',
        }).expect(201)
      ).body as { id: string };
      await call('patch', `/cash-bank/accounts/${hidden.id}`, owner(), {
        isActive: false,
      }).expect(200);
      const res = await pay(owner(), { accountId: hidden.id }).expect(409);
      expect(codeOf(res)).toBe('ACCOUNT_INACTIVE');

      await pay(owner(), { date: '2099-01-01' }).expect(422);
      await pay(owner(), { date: '2026-13-45' }).expect(422);
      await pay(owner(), { amount: 0 }).expect(422);
      await pay(owner(), { amount: 10.5 }).expect(422);
      await pay(owner(), { method: 'barter' }).expect(422);
    });

    it('should refuse an unknown, hidden or foreign supplier or account', async () => {
      await pay(owner(), {
        supplierId: '00000000-0000-4000-8000-000000000000',
      }).expect(422);

      const hidden = await newSupplier('Hidden Seller', '0302-4440001');
      await call('patch', `/suppliers/${hidden.id}`, owner(), {
        isActive: false,
      }).expect(200);
      await pay(owner(), { supplierId: hidden.id }).expect(422);

      const bSupplier = await newSupplier(
        'B Seller',
        '0302-4440002',
        B.ownerToken,
      );
      await pay(owner(), { supplierId: bSupplier.id }).expect(422);
      const bAccount = await newAccount('cash', 'B Cash', B.ownerToken);
      await pay(owner(), { accountId: bAccount.id }).expect(422);
    });
  });

  describe('who may do what', () => {
    it('should let a viewer look but not pay or decide', async () => {
      await payments(viewer.token);
      await cheques(viewer.token);
      const p = (await payments())[0];
      await call('get', `/supplier-payments/${p.id}`, viewer.token).expect(200);

      await pay(viewer.token).expect(403);
      await call(
        'post',
        `/supplier-payments/${p.id}/confirm`,
        viewer.token,
      ).expect(403);
      const c = (await cheques())[0];
      await call('post', `/supplier-cheques/${c.id}/clear`, viewer.token, {
        date: '2026-10-15',
      }).expect(403);
      await call(
        'post',
        `/supplier-cheques/${c.id}/cancel`,
        viewer.token,
      ).expect(403);
    });

    it('should let a manager pay and decide cheques', async () => {
      const p = await addCheque(manager.token, { amount: 1000 });
      expect(p.status).toBe('confirmed');
      await call(
        'post',
        `/supplier-cheques/${p.chequeId}/clear`,
        manager.token,
        {
          date: '2026-10-15',
        },
      ).expect(200);
    });

    it('should follow a custom role that can approve', async () => {
      await call('post', '/company/roles', owner(), {
        name: 'Pay lead',
        permissions: [
          'dashboard.view',
          'purchasing.view',
          'purchasing.create',
          'purchasing.approve',
        ],
      }).expect(201);
      const lead = await h.addMember(A, 'pay-lead', 'LeadPay');

      const auto = await add(lead.token, { amount: 100 });
      expect(auto.status).toBe('confirmed');

      const waiting = await add(munshi.token, { amount: 100 });
      await call(
        'post',
        `/supplier-payments/${waiting.id}/confirm`,
        lead.token,
      ).expect(200);
    });

    it('should not let a role without purchasing.view read', async () => {
      await call('post', '/company/roles', owner(), {
        name: 'No payments',
        permissions: ['dashboard.view'],
      }).expect(201);
      const none = await h.addMember(A, 'no-payments', 'NonePay');
      await call('get', '/supplier-payments', none.token).expect(403);
      await call('get', '/supplier-cheques', none.token).expect(403);
    });
  });

  describe('looking at payments and cheques', () => {
    it('should list payments newest first, and return one', async () => {
      const list = await payments();
      const dates = list.map((p) => p.date);
      expect([...dates].sort().reverse()).toEqual(dates);

      const one = await call(
        'get',
        `/supplier-payments/${list[0].id}`,
        owner(),
      ).expect(200);
      expect((one.body as Payment).voucherNo).toBe(list[0].voucherNo);
      await call('get', '/supplier-payments/not-a-uuid', owner()).expect(422);
    });

    it('should list every cheque with its supplier and account', async () => {
      const list = await cheques();
      expect(list.length).toBeGreaterThan(0);
      expect(list.every((c) => c.supplierId === sup)).toBe(true);
      expect(
        list.every((c) =>
          ['issued', 'cleared', 'bounced', 'cancelled'].includes(c.status),
        ),
      ).toBe(true);
    });
  });

  describe('keeping companies apart', () => {
    it("should not show, open or decide another company's payments and cheques", async () => {
      const p = await addCheque(owner(), { amount: 2000 });

      expect((await payments(B.ownerToken)).map((x) => x.id)).not.toContain(
        p.id,
      );
      expect((await cheques(B.ownerToken)).map((x) => x.id)).not.toContain(
        p.chequeId,
      );
      await call('get', `/supplier-payments/${p.id}`, B.ownerToken).expect(404);
      await call(
        'post',
        `/supplier-payments/${p.id}/confirm`,
        B.ownerToken,
      ).expect(404);
      await call(
        'post',
        `/supplier-payments/${p.id}/reject`,
        B.ownerToken,
        {},
      ).expect(404);
      await call(
        'post',
        `/supplier-cheques/${p.chequeId}/clear`,
        B.ownerToken,
        {
          date: '2026-10-15',
        },
      ).expect(404);
      await call(
        'post',
        `/supplier-cheques/${p.chequeId}/bounce`,
        B.ownerToken,
        {
          date: '2026-10-15',
        },
      ).expect(404);
      await call(
        'post',
        `/supplier-cheques/${p.chequeId}/cancel`,
        B.ownerToken,
      ).expect(404);
    });

    it('should number vouchers per company', async () => {
      const bSupplier = await newSupplier(
        'B Payee',
        '0302-5550001',
        B.ownerToken,
      );
      const bAccount = await newAccount('cash', 'B Cash 2', B.ownerToken);
      const res = await call('post', '/supplier-payments', B.ownerToken, {
        date: '2026-10-08',
        supplierId: bSupplier.id,
        method: 'cash',
        accountId: bAccount.id,
        amount: 500,
      }).expect(201);
      expect((res.body as Payment).voucherNo).toBe('PV-0001');
    });
  });
});
