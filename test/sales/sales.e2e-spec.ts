// End-to-end tests for Sales: bills (charge, stone booked until collected,
// edit, cancel), collections that move stock, orders with advances, and the
// money received from customers (cash, bank, cheque). They boot the whole app
// in-process, use the database from .env, create everything through the real
// API with unique "e2e-<run>" data, and delete it all afterwards.
//
//   npm run test:e2e -- sales
import { Harness, Member, Workspace } from '../utils/harness';

jest.setTimeout(240000);

type Item = {
  itemType: string;
  factoryId: string;
  material: string;
  soot?: string;
  size?: string;
  width?: number;
  finish?: string;
};
type Bill = {
  id: string;
  billNo: string;
  customerId: string | null;
  customerName: string;
  total: number;
  status: string;
  paid: number;
  note: string;
  lines: { lineNo: number; qty: number; rate: number; item: Item }[];
  collections: { collNo: string; lines: { lineNo: number; qty: number }[] }[];
  payments: { amount: number; method: string }[];
  log: { text: string }[];
};
type Customer = {
  id: string;
  balance: number;
  totalBusiness: number;
  received: number;
  unclearedCheques: number;
};
type Khata = {
  kind: string;
  amount: number;
  balance: number;
  detail: string;
  reversal?: boolean;
  returned?: boolean;
};
type Payment = {
  id: string;
  receiptNo: string;
  amount: number;
  method: string;
  status: string;
  chequeId: string | null;
  billNo: string | null;
  orderNo: string | null;
};
type Cheque = { id: string; status: string; chequeNo: string; amount: number };
type Order = {
  id: string;
  orderNo: string;
  cancelled: boolean;
  lines: { id: string; lineNo: number; qty: number }[];
  advances: { amount: number; method: string }[];
};

const last = <T>(items: T[]): T => items[items.length - 1];

const codeOf = (res: { body: unknown }) => (res.body as { code?: string }).code;

describe('Sales (e2e)', () => {
  let h: Harness;
  let A: Workspace;
  let B: Workspace;
  let manager: Member;
  let munshi: Member;
  let viewer: Member;
  let f1: string;
  let cash: string;
  let bank: string;
  let phone = 6000000;

  const call = (...args: Parameters<Harness['call']>) => h.call(...args);
  const owner = () => A.ownerToken;
  const nextPhone = () => `0302-${String(++phone).padStart(7, '0')}`;

  const piece = (size: string, over: Partial<Item> = {}): Item => ({
    itemType: 'piece',
    factoryId: f1,
    material: 'Ziarat White',
    soot: '14',
    size,
    finish: 'unpolished',
    ...over,
  });
  const counter = (): Item => ({
    itemType: 'counter',
    factoryId: f1,
    material: 'Ziarat White',
    width: 2,
    finish: 'unpolished',
  });
  const slab = (): Item => ({
    itemType: 'slab',
    factoryId: f1,
    material: 'Ziarat White',
  });

  const customer = async (over: Record<string, unknown> = {}) =>
    (
      await call('post', '/customers', owner(), {
        name: `Cust ${phone}`,
        phone: nextPhone(),
        type: 'builder',
        ...over,
      }).expect(201)
    ).body as Customer;
  const getCustomer = async (id: string) =>
    (await call('get', `/customers/${id}`, owner()).expect(200))
      .body as Customer;
  const khata = async (id: string) =>
    (await call('get', `/customers/${id}/khata`, owner()).expect(200))
      .body as Khata[];
  const opening = (item: Item, qty: number, inches?: number) =>
    call('post', '/stock-entries', owner(), {
      type: 'opening',
      date: '2026-10-01',
      item,
      qty,
      ...(inches ? { inches } : {}),
    }).expect(201);
  const stock = async () =>
    (await call('get', '/stock?limit=200', owner()).expect(200)).body.rows as {
      itemType: string;
      sootSizeName: string | null;
      widthInches: number | null;
      finish: string | null;
      qty: number;
      inches: number;
    }[];
  const qtyOf = async (size: string) =>
    (await stock()).find(
      (r) =>
        r.itemType === 'piece' &&
        r.sootSizeName === size &&
        r.finish === 'unpolished',
    )?.qty ?? 0;
  const balanceOf = async (account: string) =>
    (
      (await call('get', '/cash-bank/accounts', owner()).expect(200)).body as {
        id: string;
        balance: number;
      }[]
    ).find((a) => a.id === account)!.balance;

  const bill = (token: string, over: Record<string, unknown> = {}) =>
    call('post', '/bills', token, {
      date: '2026-10-09',
      factoryId: f1,
      lines: [{ item: piece('12x24'), qty: 40, rate: 190 }],
      takeAll: false,
      ...over,
    });
  const made = async (customerId: string, over: Record<string, unknown> = {}) =>
    (await bill(owner(), { customerId, ...over }).expect(201)).body as Bill;
  const getBill = async (id: string) =>
    (await call('get', `/bills/${id}`, owner()).expect(200)).body as Bill;
  const give = (
    token: string,
    id: string,
    over: Record<string, unknown> = {},
  ) =>
    call('post', `/bills/${id}/collections`, token, {
      date: '2026-10-10',
      vehicle: 'Suzuki KHI-1',
      lines: [{ lineNo: 1, qty: 10 }],
      ...over,
    });
  const pay = (token: string, body: Record<string, unknown>) =>
    call('post', '/customer-payments', token, {
      date: '2026-10-11',
      method: 'cash',
      ...body,
    });

  beforeAll(async () => {
    h = await Harness.start();
    A = await h.createCompany('sales-a');
    B = await h.createCompany('sales-b');
    manager = await h.addMember(A, 'manager', 'MgrSales');
    munshi = await h.addMember(A, 'munshi', 'MunshiSales');
    viewer = await h.addMember(A, 'viewer', 'ViewerSales');
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
        openingBalance: 0,
        openingDate: '2026-01-01',
      }).expect(201)
    ).body.id as string;
    bank = (
      await call('post', '/cash-bank/accounts', owner(), {
        kind: 'bank',
        name: 'HBL Current',
        last4: '1234',
        openingBalance: 0,
        openingDate: '2026-01-01',
      }).expect(201)
    ).body.id as string;
    await opening(piece('12x24'), 1000);
    await opening(piece('12x12'), 3000);
    await opening(counter(), 20, 600);
  });

  afterAll(async () => {
    await h.stop();
  });

  describe('making a bill', () => {
    it('should price a bill by the sq.ft of its pieces, charge the khata and keep stone in the yard', async () => {
      const c = await customer();
      const before = await qtyOf('12x24');
      const b = await made(c.id);
      // 40 pieces x 2 sq.ft x 190.
      expect(b).toMatchObject({ total: 15200, status: 'active', paid: 0 });
      expect(b.billNo).toMatch(/^B-\d{4}$/);
      expect(b.lines[0]).toMatchObject({ lineNo: 1, qty: 40, rate: 190 });
      expect(b.log[0].text).toBe('Bill made');
      const after = await getCustomer(c.id);
      expect(after).toMatchObject({
        balance: 15200,
        totalBusiness: 15200,
        received: 0,
      });
      expect((await khata(c.id))[0]).toMatchObject({
        kind: 'charge',
        amount: 15200,
      });
      expect(await qtyOf('12x24')).toBe(before);
    });

    it('should apply discount and transport, and price counters by inch and slabs by ton', async () => {
      const c = await customer();
      await opening(slab(), 5);
      const b = await made(c.id, {
        lines: [
          { item: piece('12x12'), qty: 10, rate: 100 },
          { item: counter(), qty: 2, inches: 48, rate: 5 },
          { item: slab(), qty: 1, tons: 2.5, rate: 14000 },
        ],
        discount: 100,
        transport: 500,
      });
      // 10 x 1 x 100 + 48 x 5 + 2.5 x 14000 - 100 + 500
      expect(b.total).toBe(1000 + 240 + 35000 - 100 + 500);
    });

    it('should refuse more than is on hand, and more than other bills have booked', async () => {
      const c = await customer();
      const have = await qtyOf('12x24');
      const over = await bill(owner(), {
        customerId: c.id,
        lines: [{ item: piece('12x24'), qty: have + 1, rate: 190 }],
      }).expect(409);
      expect(codeOf(over)).toBe('NOT_AVAILABLE');
      expect(over.body.available).toBeLessThanOrEqual(have);
      await opening(piece('9x9'), 100);
      await made(c.id, {
        lines: [{ item: piece('9x9'), qty: 90, rate: 100 }],
      });
      const booked = await bill(owner(), {
        customerId: c.id,
        lines: [{ item: piece('9x9'), qty: 11, rate: 100 }],
      }).expect(409);
      expect(booked.body.available).toBe(10);
      expect(codeOf(booked)).toBe('NOT_AVAILABLE');
    });

    it('should refuse a bill with no price, no quantity, no inches, no tons, or a future date', async () => {
      const c = await customer();
      const codes = async (lines: object[]) =>
        codeOf(await bill(owner(), { customerId: c.id, lines }).expect(409));
      expect(await codes([{ item: piece('12x24'), qty: 5, rate: 0 }])).toBe(
        'RATE_REQUIRED',
      );
      expect(await codes([{ item: piece('12x24'), qty: 0, rate: 5 }])).toBe(
        'QTY_REQUIRED',
      );
      expect(await codes([{ item: counter(), qty: 2, rate: 5 }])).toBe(
        'INCHES_REQUIRED',
      );
      expect(await codes([{ item: slab(), qty: 1, rate: 5 }])).toBe(
        'TONS_REQUIRED',
      );
      const future = await bill(owner(), {
        customerId: c.id,
        date: '2999-01-01',
      }).expect(409);
      expect(codeOf(future)).toBe('DATE_IN_FUTURE');
    });

    it('should take all the stone now when asked, as one collection', async () => {
      const c = await customer();
      const before = await qtyOf('12x24');
      const b = await made(c.id, { takeAll: true });
      expect(b.collections).toHaveLength(1);
      expect(b.collections[0].collNo).toMatch(/^G-\d{3}$/);
      expect(b.collections[0].lines).toEqual([
        { lineNo: 1, qty: 40, inches: 0 },
      ]);
      expect(await qtyOf('12x24')).toBe(before - 40);
      expect(b.log.map((l) => l.text)).toEqual([
        'Bill made',
        'All stone collected',
      ]);
    });

    it('should add a new customer from a name and phone, and refuse one that already exists', async () => {
      const p = nextPhone();
      const b = (
        await bill(owner(), {
          name: 'Brand New',
          phone: p,
          customerType: 'dealer',
        }).expect(201)
      ).body as Bill;
      expect(b.customerName).toBe('Brand New');
      expect((await getCustomer(b.customerId!)).balance).toBe(15200);
      const again = await bill(owner(), { name: 'Brand New', phone: p }).expect(
        409,
      );
      expect(codeOf(again)).toBe('DUPLICATE_PHONE');
    });

    it('should need a customer or a walk-in', async () => {
      await bill(owner(), {}).expect(422);
    });
  });

  describe('paying with the bill', () => {
    it('should put cash payment-now into the cash account and cover the bill', async () => {
      const c = await customer();
      const cashBefore = await balanceOf(cash);
      const b = await made(c.id, {
        payment: { method: 'cash', amount: 10000 },
      });
      expect(b.payments).toEqual([
        expect.objectContaining({ amount: 10000, method: 'cash' }),
      ]);
      expect(b.paid).toBe(10000);
      expect(await balanceOf(cash)).toBe(cashBefore + 10000);
      const cu = await getCustomer(c.id);
      expect(cu).toMatchObject({ balance: 5200, received: 10000 });
      const rows = await khata(c.id);
      expect(rows.map((r) => [r.kind, r.amount])).toEqual([
        ['charge', 15200],
        ['credit', 10000],
      ]);
    });

    it('should put a bank payment into the chosen bank account', async () => {
      const c = await customer();
      const before = await balanceOf(bank);
      await made(c.id, {
        payment: { method: 'bank', amount: 5000, accountId: bank },
      });
      expect(await balanceOf(bank)).toBe(before + 5000);
      const noAccount = await bill(owner(), {
        customerId: c.id,
        payment: { method: 'bank', amount: 100 },
      }).expect(422);
      expect(JSON.stringify(noAccount.body)).toContain('accountId');
    });

    it('should make a walk-in pay the whole bill now, with no khata', async () => {
      const before = await balanceOf(cash);
      const short = await bill(owner(), {
        walkin: true,
        name: 'Walk In',
        payment: { method: 'cash', amount: 100 },
      }).expect(409);
      expect(codeOf(short)).toBe('WALKIN_FULL_PAYMENT');
      const none = await bill(owner(), {
        walkin: true,
        name: 'Walk In',
      }).expect(409);
      expect(codeOf(none)).toBe('WALKIN_FULL_PAYMENT');
      const b = (
        await bill(owner(), {
          walkin: true,
          name: 'Walk In',
          phone: '0300-0000000',
          payment: { method: 'cash', amount: 15200 },
        }).expect(201)
      ).body as Bill;
      expect(b).toMatchObject({
        customerId: null,
        customerName: 'Walk In',
        paid: 15200,
      });
      expect(await balanceOf(cash)).toBe(before + 15200);
    });

    it('should not let a munshi take a bank payment', async () => {
      const c = await customer();
      const res = await bill(munshi.token, {
        customerId: c.id,
        payment: { method: 'bank', amount: 100, accountId: bank },
      }).expect(403);
      expect(codeOf(res)).toBe('BANK_ACCOUNT_NOT_ALLOWED');
      await bill(munshi.token, {
        customerId: c.id,
        payment: { method: 'cash', amount: 100 },
      }).expect(201);
    });
  });

  describe('collecting stone', () => {
    it('should give stone in parts, moving stock each time, and refuse more than is left', async () => {
      const c = await customer();
      const b = await made(c.id);
      const before = await qtyOf('12x24');
      const part = (await give(owner(), b.id).expect(200)).body as Bill;
      expect(part.collections).toHaveLength(1);
      expect(last(part.log)?.text).toBe('Part collected · Suzuki KHI-1');
      expect(await qtyOf('12x24')).toBe(before - 10);
      const over = await give(owner(), b.id, {
        lines: [{ lineNo: 1, qty: 31 }],
      }).expect(409);
      expect(codeOf(over)).toBe('MORE_THAN_REMAINING');
      expect(over.body.remaining).toBe(30);
      const rest = (
        await give(owner(), b.id, {
          lines: [{ lineNo: 1, qty: 30 }],
          vehicle: '',
        }).expect(200)
      ).body as Bill;
      expect(rest.collections).toHaveLength(2);
      expect(last(rest.log)?.text).toBe('All stone collected');
      expect(await qtyOf('12x24')).toBe(before - 40);
    });

    it('should refuse nothing to give, a future date, a date before the bill, and a bad line', async () => {
      const c = await customer();
      const b = await made(c.id);
      expect(
        codeOf(
          await give(owner(), b.id, { lines: [{ lineNo: 1, qty: 0 }] }).expect(
            409,
          ),
        ),
      ).toBe('NOTHING_TO_GIVE');
      expect(
        codeOf(await give(owner(), b.id, { date: '2999-01-01' }).expect(409)),
      ).toBe('DATE_IN_FUTURE');
      expect(
        codeOf(await give(owner(), b.id, { date: '2026-10-01' }).expect(409)),
      ).toBe('DATE_BEFORE_BILL');
      await give(owner(), b.id, { lines: [{ lineNo: 9, qty: 1 }] }).expect(404);
    });

    it('should refuse giving what has left the yard since the bill was made', async () => {
      const c = await customer();
      await opening(piece('6x12'), 20);
      const b = await made(c.id, {
        lines: [{ item: piece('6x12'), qty: 20, rate: 50 }],
      });
      await call('post', '/stock-entries', owner(), {
        type: 'adjustment',
        date: '2026-10-09',
        direction: -1,
        reason: 'broken',
        item: piece('6x12'),
        qty: 15,
      }).expect(201);
      const res = await give(owner(), b.id, {
        lines: [{ lineNo: 1, qty: 20 }],
      }).expect(409);
      expect(codeOf(res)).toBe('INSUFFICIENT_STOCK');
      expect(res.body.available).toBe(5);
    });

    it('should track counters in inches', async () => {
      const c = await customer();
      const b = await made(c.id, {
        lines: [{ item: counter(), qty: 2, inches: 100, rate: 5 }],
      });
      const before = (await stock()).find((r) => r.itemType === 'counter')!;
      await give(owner(), b.id, {
        lines: [{ lineNo: 1, qty: 2, inches: 100 }],
      }).expect(200);
      const after = (await stock()).find((r) => r.itemType === 'counter')!;
      expect(after.qty).toBe(before.qty - 2);
      expect(after.inches).toBe(before.inches - 100);
    });
  });

  describe('editing and cancelling', () => {
    it('should take the old charge back and post the new one', async () => {
      const c = await customer();
      const b = await made(c.id);
      const res = await call('patch', `/bills/${b.id}`, owner(), {
        date: '2026-10-09',
        lines: [{ lineNo: 1, item: piece('12x24'), qty: 40, rate: 200 }],
        discount: 0,
        transport: 0,
        note: 'repriced',
      }).expect(200);
      expect(res.body).toMatchObject({ total: 16000, note: 'repriced' });
      expect((await getCustomer(c.id)).balance).toBe(16000);
      const rows = await khata(c.id);
      expect(rows.map((r) => [r.kind, r.amount, !!r.reversal])).toEqual([
        ['charge', 15200, false],
        ['credit', 15200, true],
        ['charge', 16000, false],
      ]);
      expect(last((res.body as Bill).log).text).toBe(
        'Edited · new total 16000',
      );
    });

    it('should not cut a line below what was collected, or remove it', async () => {
      const c = await customer();
      const b = await made(c.id);
      await give(owner(), b.id).expect(200);
      const edit = (lines: object[]) =>
        call('patch', `/bills/${b.id}`, owner(), {
          date: '2026-10-09',
          lines,
          discount: 0,
          transport: 0,
        });
      const below = await edit([
        { lineNo: 1, item: piece('12x24'), qty: 5, rate: 190 },
      ]).expect(409);
      expect(codeOf(below)).toBe('BELOW_COLLECTED');
      const removed = await edit([
        { item: piece('12x12'), qty: 5, rate: 100 },
      ]).expect(409);
      expect(codeOf(removed)).toBe('BELOW_COLLECTED');
      await edit([
        { lineNo: 1, item: piece('12x24'), qty: 12, rate: 190 },
      ]).expect(200);
    });

    it('should not edit a bill into more than is available', async () => {
      const c = await customer();
      const b = await made(c.id);
      const have = await qtyOf('12x24');
      const res = await call('patch', `/bills/${b.id}`, owner(), {
        date: '2026-10-09',
        lines: [{ lineNo: 1, item: piece('12x24'), qty: have + 5, rate: 190 }],
        discount: 0,
        transport: 0,
      }).expect(409);
      expect(codeOf(res)).toBe('NOT_AVAILABLE');
    });

    it('should cancel a bill nothing was collected on, and keep the payment as an advance', async () => {
      const c = await customer();
      const b = await made(c.id, { payment: { method: 'cash', amount: 4000 } });
      const res = await call('post', `/bills/${b.id}/cancel`, owner(), {
        reason: 'wrong customer',
      }).expect(200);
      expect(res.body).toMatchObject({
        status: 'cancelled',
        cancelReason: 'wrong customer',
      });
      const cu = await getCustomer(c.id);
      expect(cu.balance).toBe(-4000);
      expect(
        codeOf(
          await call('post', `/bills/${b.id}/cancel`, owner(), {
            reason: 'x',
          }).expect(409),
        ),
      ).toBe('BILL_CANCELLED');
      expect(codeOf(await give(owner(), b.id).expect(409))).toBe(
        'BILL_CANCELLED',
      );
    });

    it('should refuse cancelling a bill with stone collected', async () => {
      const c = await customer();
      const b = await made(c.id, { takeAll: true });
      const res = await call('post', `/bills/${b.id}/cancel`, owner(), {
        reason: 'x',
      }).expect(409);
      expect(codeOf(res)).toBe('HAS_COLLECTIONS');
    });

    it('should free the stone a cancelled bill had booked', async () => {
      const c = await customer();
      await opening(piece('3x6'), 30);
      const b = await made(c.id, {
        lines: [{ item: piece('3x6'), qty: 30, rate: 10 }],
      });
      const blocked = await bill(owner(), {
        customerId: c.id,
        lines: [{ item: piece('3x6'), qty: 1, rate: 10 }],
      }).expect(409);
      expect(codeOf(blocked)).toBe('NOT_AVAILABLE');
      await call('post', `/bills/${b.id}/cancel`, owner(), {
        reason: 'x',
      }).expect(200);
      await bill(owner(), {
        customerId: c.id,
        lines: [{ item: piece('3x6'), qty: 30, rate: 10 }],
      }).expect(201);
    });
  });

  describe('money from customers', () => {
    it('should receive cash, credit the khata, and say how much was above what is owed', async () => {
      const c = await customer();
      await made(c.id);
      const before = await balanceOf(cash);
      const res = await pay(owner(), {
        customerId: c.id,
        amount: 20000,
      }).expect(201);
      expect(res.body.advance).toBe(4800);
      expect(res.body.payment).toMatchObject({
        amount: 20000,
        method: 'cash',
        status: 'posted',
      });
      expect(res.body.payment.receiptNo).toMatch(/^RC-\d{4}$/);
      expect(await balanceOf(cash)).toBe(before + 20000);
      expect(await getCustomer(c.id)).toMatchObject({
        balance: -4800,
        received: 20000,
      });
    });

    it('should cover the oldest bill first', async () => {
      const c = await customer();
      const first = await made(c.id, { date: '2026-10-01' });
      const second = await made(c.id, { date: '2026-10-05' });
      await pay(owner(), { customerId: c.id, amount: 20000 }).expect(201);
      expect((await getBill(first.id)).paid).toBe(15200);
      expect((await getBill(second.id)).paid).toBe(4800);
    });

    it('should receive bank money into the chosen bank, and refuse the wrong kind of account', async () => {
      const c = await customer();
      const before = await balanceOf(bank);
      await pay(owner(), {
        customerId: c.id,
        amount: 3000,
        method: 'bank',
        accountId: bank,
      }).expect(201);
      expect(await balanceOf(bank)).toBe(before + 3000);
      const wrong = await pay(owner(), {
        customerId: c.id,
        amount: 3000,
        method: 'bank',
        accountId: cash,
      }).expect(422);
      expect(JSON.stringify(wrong.body)).toContain('wrongKind');
      await pay(owner(), {
        customerId: c.id,
        amount: 3000,
        method: 'bank',
      }).expect(422);
    });

    it('should refuse a bad amount, a future date and another company', async () => {
      const c = await customer();
      await pay(owner(), { customerId: c.id, amount: 0 }).expect(422);
      expect(
        codeOf(
          await pay(owner(), {
            customerId: c.id,
            amount: 5,
            date: '2999-01-01',
          }).expect(409),
        ),
      ).toBe('DATE_IN_FUTURE');
      await pay(B.ownerToken, { customerId: c.id, amount: 5 }).expect(404);
    });

    it('should link a payment to a bill or an order', async () => {
      const c = await customer();
      const b = await made(c.id);
      const res = await pay(owner(), {
        customerId: c.id,
        amount: 100,
        billId: b.id,
      }).expect(201);
      expect(res.body.payment.billNo).toBe(b.billNo);
      const other = await customer();
      await pay(owner(), {
        customerId: other.id,
        amount: 100,
        billId: b.id,
      }).expect(422);
    });

    it("should take a cheque as the customer's credit without touching the bank until it clears", async () => {
      const c = await customer();
      await made(c.id);
      const before = await balanceOf(bank);
      const res = await pay(owner(), {
        customerId: c.id,
        amount: 5000,
        method: 'cheque',
        bankName: 'Meezan Bank',
        chequeNo: `CQ${phone}`,
        chequeDate: '2026-11-10',
      }).expect(201);
      expect(res.body.payment.chequeId).toBeTruthy();
      expect(await balanceOf(bank)).toBe(before);
      expect(await getCustomer(c.id)).toMatchObject({
        balance: 10200,
        unclearedCheques: 5000,
      });

      const cheques = (
        await call('get', '/customer-cheques', owner()).expect(200)
      ).body as Cheque[];
      const cheque = cheques.find((x) => x.id === res.body.payment.chequeId)!;
      expect(cheque.status).toBe('pending');

      const cleared = await call(
        'post',
        `/customer-cheques/${cheque.id}/clear`,
        owner(),
        { accountId: bank, date: '2026-10-12' },
      ).expect(200);
      expect(cleared.body).toMatchObject({
        status: 'cleared',
        clearedOn: '2026-10-12',
      });
      expect(await balanceOf(bank)).toBe(before + 5000);
      expect((await getCustomer(c.id)).unclearedCheques).toBe(0);
      expect(
        codeOf(
          await call('post', `/customer-cheques/${cheque.id}/clear`, owner(), {
            accountId: bank,
            date: '2026-10-12',
          }).expect(409),
        ),
      ).toBe('ALREADY_DECIDED');
    });

    it('should put the amount back on the khata when a cheque bounces', async () => {
      const c = await customer();
      const res = await pay(owner(), {
        customerId: c.id,
        amount: 7000,
        method: 'cheque',
        bankName: 'UBL',
        chequeNo: `BN${phone}`,
        chequeDate: '2026-10-20',
      }).expect(201);
      expect((await getCustomer(c.id)).balance).toBe(-7000);
      const bounced = await call(
        'post',
        `/customer-cheques/${res.body.payment.chequeId}/bounce`,
        owner(),
        {
          reason: 'no funds',
          date: '2026-10-13',
        },
      ).expect(200);
      expect(bounced.body).toMatchObject({
        status: 'bounced',
        bounceReason: 'no funds',
      });
      const cu = await getCustomer(c.id);
      expect(cu).toMatchObject({ balance: 0, received: 0, totalBusiness: 0 });
      const rows = await khata(c.id);
      expect(rows.map((r) => [r.kind, !!r.returned])).toEqual([
        ['credit', false],
        ['charge', true],
      ]);
      // The same cheque number may be received again once it has bounced.
      await pay(owner(), {
        customerId: c.id,
        amount: 7000,
        method: 'cheque',
        bankName: 'UBL',
        chequeNo: `BN${phone}`,
        chequeDate: '2026-10-25',
      }).expect(201);
    });

    it('should refuse the same cheque twice, a cheque without details, and clearing before it was received', async () => {
      const c = await customer();
      const body = {
        customerId: c.id,
        amount: 100,
        method: 'cheque',
        bankName: 'HBL',
        chequeNo: `DUP${phone}`,
        chequeDate: '2026-11-01',
      };
      const first = await pay(owner(), body).expect(201);
      expect(codeOf(await pay(owner(), body).expect(409))).toBe(
        'DUPLICATE_CHEQUE',
      );
      await pay(owner(), { ...body, chequeNo: undefined }).expect(422);
      const early = await call(
        'post',
        `/customer-cheques/${first.body.payment.chequeId}/clear`,
        owner(),
        { accountId: bank, date: '2026-10-01' },
      ).expect(409);
      expect(codeOf(early)).toBe('BEFORE_RECEIVED');
    });

    it('should reverse a cash payment: the account row and the khata both go back', async () => {
      const c = await customer();
      const before = await balanceOf(cash);
      const res = await pay(owner(), { customerId: c.id, amount: 3000 }).expect(
        201,
      );
      const id = res.body.payment.id as string;
      expect(await balanceOf(cash)).toBe(before + 3000);
      await call(
        'post',
        `/customer-payments/${id}/reverse`,
        manager.token,
      ).expect(200);
      expect(await balanceOf(cash)).toBe(before);
      const cu = await getCustomer(c.id);
      expect(cu).toMatchObject({ balance: 0, received: 0 });
      const list = (
        await call('get', '/customer-payments', owner()).expect(200)
      ).body as Payment[];
      expect(list.find((p) => p.id === id)?.status).toBe('reversed');
      expect(
        codeOf(
          await call(
            'post',
            `/customer-payments/${id}/reverse`,
            owner(),
          ).expect(409),
        ),
      ).toBe('ALREADY_REVERSED');
      await call(
        'post',
        `/customer-payments/${id}/reverse`,
        munshi.token,
      ).expect(403);
    });

    it("should drop a reversed payment's cheque and refuse reversing a bounced one", async () => {
      const c = await customer();
      const a = await pay(owner(), {
        customerId: c.id,
        amount: 100,
        method: 'cheque',
        bankName: 'HBL',
        chequeNo: `RV${phone}`,
        chequeDate: '2026-11-01',
      }).expect(201);
      await call(
        'post',
        `/customer-payments/${a.body.payment.id}/reverse`,
        owner(),
      ).expect(200);
      const cheques = (
        await call('get', '/customer-cheques', owner()).expect(200)
      ).body as Cheque[];
      expect(
        cheques.find((x) => x.id === a.body.payment.chequeId),
      ).toBeUndefined();
      const b = await pay(owner(), {
        customerId: c.id,
        amount: 100,
        method: 'cheque',
        bankName: 'HBL',
        chequeNo: `RB${phone}`,
        chequeDate: '2026-11-01',
      }).expect(201);
      await call(
        'post',
        `/customer-cheques/${b.body.payment.chequeId}/bounce`,
        owner(),
        { reason: 'x', date: '2026-10-12' },
      ).expect(200);
      expect(
        codeOf(
          await call(
            'post',
            `/customer-payments/${b.body.payment.id}/reverse`,
            owner(),
          ).expect(409),
        ),
      ).toBe('ALREADY_RETURNED');
    });

    it('should list payments with filters and search', async () => {
      const c = await customer({ name: 'Searchable Traders' });
      await pay(owner(), { customerId: c.id, amount: 111 }).expect(201);
      const byName = (
        await call('get', '/customer-payments?q=searchable', owner()).expect(
          200,
        )
      ).body as Payment[];
      expect(byName.length).toBeGreaterThan(0);
      const cheques = (
        await call('get', '/customer-payments?method=cheque', owner()).expect(
          200,
        )
      ).body as Payment[];
      expect(cheques.every((p) => p.method === 'cheque')).toBe(true);
    });
  });

  describe('orders', () => {
    const order = (token: string, over: Record<string, unknown> = {}) =>
      call('post', '/sales-orders', token, {
        date: '2026-10-07',
        neededBy: '2026-10-20',
        factoryId: f1,
        lines: [
          { item: piece('12x24', { finish: 'polished' }), qty: 300, rate: 315 },
        ],
        ...over,
      });

    it('should take an order with an advance that credits the khata', async () => {
      const c = await customer();
      const before = await balanceOf(cash);
      const res = await order(owner(), {
        customerId: c.id,
        advance: { method: 'cash', amount: 50000 },
      }).expect(201);
      const o = res.body as Order;
      expect(o.orderNo).toMatch(/^OR-\d{3}$/);
      expect(o.advances).toEqual([
        expect.objectContaining({ amount: 50000, method: 'cash' }),
      ]);
      expect(await balanceOf(cash)).toBe(before + 50000);
      expect(await getCustomer(c.id)).toMatchObject({ balance: -50000 });
      expect((await khata(c.id))[0].detail).toContain(o.orderNo);
    });

    it('should not reserve stone, and not need any to be taken', async () => {
      const c = await customer();
      await order(owner(), {
        customerId: c.id,
        lines: [{ item: piece('12x24'), qty: 999999, rate: 1 }],
      }).expect(201);
    });

    it('should refuse a date before the order, a past-dated need, and a missing customer', async () => {
      const c = await customer();
      expect(
        codeOf(
          await order(owner(), {
            customerId: c.id,
            neededBy: '2026-10-01',
          }).expect(409),
        ),
      ).toBe('NEEDED_BEFORE_ORDER');
      await order(owner(), {}).expect(422);
      await order(owner(), { customerId: B.id }).expect(422);
    });

    it('should cap a bill line at what remains on the order line', async () => {
      const c = await customer();
      const o = (
        await order(owner(), {
          customerId: c.id,
          lines: [{ item: piece('12x12'), qty: 100, rate: 210 }],
        }).expect(201)
      ).body as Order;
      const line = o.lines[0];
      const fill = (qty: number) =>
        bill(owner(), {
          customerId: c.id,
          orderId: o.id,
          lines: [
            { item: piece('12x12'), qty, rate: 210, orderLineId: line.id },
          ],
        });
      await fill(60).expect(201);
      const over = await fill(41).expect(409);
      expect(codeOf(over)).toBe('MORE_THAN_ORDER_REMAINING');
      expect(over.body.remaining).toBe(40);
      await fill(40).expect(201);
    });

    it('should cancel an order and keep the advance', async () => {
      const c = await customer();
      const o = (
        await order(owner(), {
          customerId: c.id,
          advance: { method: 'cash', amount: 1000 },
        }).expect(201)
      ).body as Order;
      await call('post', `/sales-orders/${o.id}/cancel`, owner()).expect(200);
      const list = (await call('get', '/sales-orders', owner()).expect(200))
        .body as Order[];
      expect(list.find((x) => x.id === o.id)?.cancelled).toBe(true);
      expect((await getCustomer(c.id)).balance).toBe(-1000);
    });
  });

  describe('permissions and companies', () => {
    it('should let everyone with sales.view look and no one without sales.create make a bill', async () => {
      const c = await customer();
      await call('get', '/bills', viewer.token).expect(200);
      await call('get', '/sales-orders', viewer.token).expect(200);
      await call('get', '/customer-payments', viewer.token).expect(200);
      await call('get', '/customer-cheques', viewer.token).expect(200);
      await bill(viewer.token, { customerId: c.id }).expect(403);
      await pay(viewer.token, { customerId: c.id, amount: 1 }).expect(403);
    });

    it('should let a munshi make bills and give stone but not edit or cancel them', async () => {
      const c = await customer();
      const b = (await bill(munshi.token, { customerId: c.id }).expect(201))
        .body as Bill;
      await give(munshi.token, b.id).expect(200);
      await call('patch', `/bills/${b.id}`, munshi.token, {
        date: '2026-10-09',
        lines: [{ lineNo: 1, item: piece('12x24'), qty: 40, rate: 190 }],
      }).expect(403);
      await call('post', `/bills/${b.id}/cancel`, munshi.token, {
        reason: 'x',
      }).expect(403);
      await call('post', `/bills/${b.id}/cancel`, manager.token, {
        reason: 'x',
      }).expect(409);
    });

    it("should not show another company's bills, payments or customers", async () => {
      const c = await customer();
      const b = await made(c.id);
      await call('get', `/bills/${b.id}`, B.ownerToken).expect(404);
      await give(B.ownerToken, b.id).expect(404);
      await call('patch', `/bills/${b.id}`, B.ownerToken, {
        date: '2026-10-09',
        lines: [{ item: piece('12x24'), qty: 1, rate: 1 }],
      }).expect(404);
      expect(
        (await call('get', '/bills', B.ownerToken).expect(200)).body,
      ).toEqual([]);
      expect(
        (await call('get', '/customer-payments', B.ownerToken).expect(200))
          .body,
      ).toEqual([]);
      expect(
        (await call('get', '/customer-cheques', B.ownerToken).expect(200)).body,
      ).toEqual([]);
    });

    it('should list bills newest first with their figures', async () => {
      const all = (await call('get', '/bills', owner()).expect(200))
        .body as Bill[];
      expect(all.length).toBeGreaterThan(5);
      expect(all.every((b) => typeof b.paid === 'number')).toBe(true);
    });
  });
});
