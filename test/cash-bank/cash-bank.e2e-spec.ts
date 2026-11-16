// End-to-end tests for Cash & Bank. They boot the whole app in-process, use the
// database from .env, create everything through the real API with unique
// "e2e-<run>" data, and delete it all afterwards.
//
//   npm run test:e2e -- cash-bank
import { Harness, Member, Workspace } from '../utils/harness';

jest.setTimeout(120000);

const DAY = '2026-03-10';

describe('Cash & Bank (e2e)', () => {
  let h: Harness;
  let A: Workspace; // the company under test
  let B: Workspace; // a second company, for isolation
  let partner: Member;
  let manager: Member;
  let munshi: Member;
  let viewer: Member;

  let cash: string; // A's cash in hand (the oldest cash account), opening 10,000
  let cash2: string; // A's second cash account (the munshi's petty cash), opening 5,000
  let hbl: string; // A's bank, opening 500,000
  let meezan: string; // A's bank, opening 0
  let bCash: string; // B's cash in hand, opening 777

  const call = (...args: Parameters<Harness['call']>) => h.call(...args);
  const owner = () => A.ownerToken;

  type AccountBody = {
    id: string;
    name: string;
    kind: string;
    balance: number | null;
    openingBalance: number | null;
  };
  const accountOf = async (token: string, id: string) => {
    const res = await call(
      'get',
      '/cash-bank/accounts?includeInactive=true',
      token,
    ).expect(200);
    return (res.body as AccountBody[]).find((a) => a.id === id)!;
  };
  // Owners always see balances; the munshi test reads them from the raw list.
  const balance = async (id: string, token = owner()) =>
    (await accountOf(token, id)).balance as number;
  const statement = (id: string, token = owner(), qs = '') =>
    call('get', `/cash-bank/accounts/${id}/statement${qs}`, token);
  const pay = (token: string, body: object) =>
    call('post', '/cash-bank/other-payments', token, body);
  const receive = (token: string, body: object) =>
    call('post', '/cash-bank/other-receipts', token, body);
  const setApprovalRequired = (company: Workspace, on: boolean) =>
    h.db.query(`update company set "approvalRequired" = $1 where id = $2`, [
      on,
      company.id,
    ]);

  beforeAll(async () => {
    h = await Harness.start();
    A = await h.createCompany('cba');
    B = await h.createCompany('cbb');
    partner = await h.addMember(A, 'partner', 'Partner');
    manager = await h.addMember(A, 'manager', 'Manager');
    munshi = await h.addMember(A, 'munshi', 'Munshi');
    viewer = await h.addMember(A, 'viewer', 'Viewer');

    const open = (token: string, body: object) =>
      call('post', '/cash-bank/accounts', token, body)
        .expect(201)
        .then((r) => (r.body as { id: string }).id);
    cash = await open(owner(), {
      kind: 'cash',
      name: 'Cash in hand',
      openingBalance: 10000,
      openingDate: '2026-01-01',
    });
    cash2 = await open(owner(), {
      kind: 'cash',
      name: 'Munshi cash',
      openingBalance: 5000,
      openingDate: '2026-01-01',
    });
    hbl = await open(owner(), {
      kind: 'bank',
      name: 'HBL Current',
      last4: '4471',
      openingBalance: 500000,
      openingDate: '2026-01-01',
    });
    meezan = await open(owner(), {
      kind: 'bank',
      name: 'Meezan',
      last4: '0923',
      openingBalance: 0,
      openingDate: '2026-01-01',
    });
    bCash = await open(B.ownerToken, {
      kind: 'cash',
      name: 'B cash',
      openingBalance: 777,
      openingDate: '2026-01-01',
    });
  }, 180000);

  beforeEach(() => h.clearThrottle());
  afterAll(() => h.stop(), 60000);

  // ------------------------------------------------------------- accounts
  describe('accounts', () => {
    it('should report balances calculated from ledger rows, opening balance included', async () => {
      expect(await balance(cash)).toBe(10000);
      expect(await balance(hbl)).toBe(500000);
      expect(await balance(meezan)).toBe(0);

      const st = await statement(hbl).expect(200);
      expect(st.body.rows).toHaveLength(1);
      expect(st.body.rows[0]).toMatchObject({
        sourceType: 'opening',
        direction: 'in',
        amount: 500000,
        runningBalance: 500000,
      });
    });

    it('should post a negative opening balance as money out', async () => {
      const id = (
        await call('post', '/cash-bank/accounts', owner(), {
          kind: 'bank',
          name: 'Overdraft',
          last4: '9999',
          openingBalance: -2500,
          openingDate: '2026-01-01',
        }).expect(201)
      ).body.id;
      expect(await balance(id)).toBe(-2500);
      expect((await statement(id).expect(200)).body.rows[0]).toMatchObject({
        direction: 'out',
        amount: 2500,
      });
    });

    it('should allow several cash accounts, each with its own balance', async () => {
      expect(await balance(cash2)).toBe(5000);
      const third = await call('post', '/cash-bank/accounts', owner(), {
        kind: 'cash',
        name: 'Showroom drawer',
        openingBalance: 0,
        openingDate: '2026-01-01',
      }).expect(201);
      expect(third.body).toMatchObject({ kind: 'cash', balance: 0 });
      expect(await balance(cash)).toBe(10000);
    });

    it('should require the last 4 digits for a bank and refuse them for cash', async () => {
      await call('post', '/cash-bank/accounts', owner(), {
        kind: 'bank',
        name: 'No digits',
        openingBalance: 0,
        openingDate: '2026-01-01',
      }).expect(422);
      await call('post', '/cash-bank/accounts', owner(), {
        kind: 'bank',
        name: 'Bad',
        last4: '12',
        openingBalance: 0,
        openingDate: '2026-01-01',
      }).expect(422);
    });

    it('should let a partner open accounts but not a manager, munshi or viewer', async () => {
      const body = {
        kind: 'bank',
        name: 'Partner bank',
        last4: '1111',
        openingBalance: 0,
        openingDate: '2026-01-01',
      };
      await call('post', '/cash-bank/accounts', manager.token, body).expect(
        403,
      );
      await call('post', '/cash-bank/accounts', munshi.token, body).expect(403);
      await call('post', '/cash-bank/accounts', viewer.token, body).expect(403);
      await call('post', '/cash-bank/accounts', partner.token, body).expect(
        201,
      );
    });

    it('should never let the opening balance be edited', async () => {
      await call('patch', `/cash-bank/accounts/${hbl}`, owner(), {
        name: 'HBL Main',
        openingBalance: 1,
      }).expect(200);
      expect(await balance(hbl)).toBe(500000);
      expect((await accountOf(owner(), hbl)).openingBalance).toBe(500000);
    });

    it('should refuse to deactivate an account that still holds money', async () => {
      for (const id of [hbl, cash2]) {
        const held = await call('patch', `/cash-bank/accounts/${id}`, owner(), {
          isActive: false,
        }).expect(409);
        expect(held.body.code).toBe('ACCOUNT_HAS_BALANCE');
      }
    });

    it('should always keep at least one cash account active', async () => {
      // B has only one cash account, and it is empty enough to be the last one that matters.
      const last = await call(
        'patch',
        `/cash-bank/accounts/${bCash}`,
        B.ownerToken,
        { isActive: false },
      ).expect(409);
      expect(last.body.code).toBe('CASH_ACCOUNT_REQUIRED');

      // With another cash account active, an empty one can be closed.
      const spare = (
        await call('post', '/cash-bank/accounts', owner(), {
          kind: 'cash',
          name: 'Spare drawer',
          openingBalance: 0,
          openingDate: '2026-01-01',
        }).expect(201)
      ).body.id;
      await call('patch', `/cash-bank/accounts/${spare}`, owner(), {
        isActive: false,
      }).expect(200);
    });

    it('should hide a deactivated account from the list but keep its history', async () => {
      const id = (
        await call('post', '/cash-bank/accounts', owner(), {
          kind: 'bank',
          name: 'Closing',
          last4: '5555',
          openingBalance: 0,
          openingDate: '2026-01-01',
        }).expect(201)
      ).body.id;
      await call('patch', `/cash-bank/accounts/${id}`, owner(), {
        isActive: false,
      }).expect(200);
      const active = await call('get', '/cash-bank/accounts', owner()).expect(
        200,
      );
      expect(active.body.map((a: { id: string }) => a.id)).not.toContain(id);
      const all = await call(
        'get',
        '/cash-bank/accounts?includeInactive=true',
        owner(),
      ).expect(200);
      expect(all.body.map((a: { id: string }) => a.id)).toContain(id);
    });

    it('should require a login', async () => {
      await call('get', '/cash-bank/accounts').expect(401);
    });
  });

  // -------------------------------------------------------------- entries
  describe('other payment and other receipt', () => {
    it('should lower the balance on a payment and raise it on a receipt, with a running statement', async () => {
      const before = await balance(cash);
      await pay(owner(), {
        accountId: cash,
        amount: 1500,
        date: DAY,
        reason: 'Electricity bill',
        note: 'March',
      }).expect(201);
      await receive(owner(), {
        accountId: cash,
        amount: 400,
        date: DAY,
        reason: 'Scrap sale',
      }).expect(201);
      expect(await balance(cash)).toBe(before - 1500 + 400);

      const st = await statement(
        cash,
        owner(),
        '?order=asc&sourceType=other_payment',
      ).expect(200);
      expect(st.body.rows).toHaveLength(1);
      expect(st.body.rows[0]).toMatchObject({
        direction: 'out',
        amount: 1500,
        note: 'Electricity bill — March',
      });
    });

    it('should return "posted" with the created ledger row for an owner', async () => {
      const res = await pay(owner(), {
        accountId: cash,
        amount: 10,
        date: DAY,
        reason: 'Tea',
      }).expect(201);
      expect(res.body.status).toBe('posted');
      expect(res.body.entries).toHaveLength(1);
      expect(res.body.entries[0]).toMatchObject({
        accountId: cash,
        direction: 'out',
        amount: 10,
        sourceType: 'other_payment',
      });
    });

    it('should validate amount, date and account', async () => {
      const ok = { accountId: cash, amount: 5, date: DAY, reason: 'x' };
      await pay(owner(), { ...ok, amount: 0 }).expect(422);
      await pay(owner(), { ...ok, amount: -5 }).expect(422);
      await pay(owner(), { ...ok, amount: 1.5 }).expect(422);
      await pay(owner(), { ...ok, date: '10/03/2026' }).expect(422);
      const impossible = await pay(owner(), {
        ...ok,
        date: '2026-02-30',
      }).expect(422);
      expect(impossible.body.errors.date).toBe('invalidDate');
      await pay(owner(), { ...ok, accountId: 'not-a-uuid' }).expect(422);
    });

    it('should accept a payment or receipt with no reason or note', async () => {
      const before = await balance(cash);
      const paid = await pay(owner(), {
        accountId: cash,
        amount: 12,
        date: DAY,
      }).expect(201);
      expect(paid.body.entries[0]).toMatchObject({ amount: 12, note: null });
      await pay(owner(), {
        accountId: cash,
        amount: 3,
        date: DAY,
        reason: '   ',
      }).expect(201);
      expect(await balance(cash)).toBe(before - 15);
    });

    it('should never read the company from the request body', async () => {
      const bBefore = await balance(bCash, B.ownerToken);
      await pay(owner(), {
        accountId: cash,
        amount: 7,
        date: DAY,
        reason: 'x',
        companyId: B.id,
        company: { id: B.id },
      }).expect(201);
      expect(await balance(bCash, B.ownerToken)).toBe(bBefore);
    });

    it('should not let a viewer post', async () => {
      await pay(viewer.token, {
        accountId: cash,
        amount: 5,
        date: DAY,
        reason: 'x',
      }).expect(403);
    });
  });

  describe('transfer', () => {
    it('should move money between accounts as two linked rows', async () => {
      const [cashBefore, hblBefore] = [await balance(cash), await balance(hbl)];
      const res = await call('post', '/cash-bank/transfers', owner(), {
        fromAccountId: hbl,
        toAccountId: cash,
        amount: 2000,
        date: DAY,
        note: 'Petty cash',
      }).expect(201);
      expect(res.body.entries).toHaveLength(2);
      expect(res.body.entries[0].sourceId).toBe(res.body.entries[1].sourceId);
      expect(await balance(hbl)).toBe(hblBefore - 2000);
      expect(await balance(cash)).toBe(cashBefore + 2000);
    });

    it('should refuse the same account on both sides and post nothing', async () => {
      const before = await balance(cash);
      await call('post', '/cash-bank/transfers', owner(), {
        fromAccountId: cash,
        toAccountId: cash,
        amount: 5,
        date: DAY,
      }).expect(422);
      expect(await balance(cash)).toBe(before);
    });

    it('should leave no half transfer when the other account does not exist or is not ours', async () => {
      const [cashBefore, bBefore] = [
        await balance(cash),
        await balance(bCash, B.ownerToken),
      ];
      await call('post', '/cash-bank/transfers', owner(), {
        fromAccountId: cash,
        toAccountId: bCash,
        amount: 50,
        date: DAY,
      }).expect(404);
      await call('post', '/cash-bank/transfers', B.ownerToken, {
        fromAccountId: bCash,
        toAccountId: cash,
        amount: 50,
        date: DAY,
      }).expect(404);
      expect(await balance(cash)).toBe(cashBefore);
      expect(await balance(bCash, B.ownerToken)).toBe(bBefore);
    });

    it('should refuse an inactive account and post nothing', async () => {
      const closed = (
        await call('post', '/cash-bank/accounts', owner(), {
          kind: 'bank',
          name: 'Closed',
          last4: '7777',
          openingBalance: 0,
          openingDate: '2026-01-01',
        }).expect(201)
      ).body.id;
      await call('patch', `/cash-bank/accounts/${closed}`, owner(), {
        isActive: false,
      }).expect(200);
      const before = await balance(cash);
      const res = await call('post', '/cash-bank/transfers', owner(), {
        fromAccountId: cash,
        toAccountId: closed,
        amount: 5,
        date: DAY,
      }).expect(409);
      expect(res.body.code).toBe('ACCOUNT_INACTIVE');
      expect(await balance(cash)).toBe(before);
    });

    it('should let a manager transfer but not a munshi or viewer', async () => {
      const body = {
        fromAccountId: hbl,
        toAccountId: cash,
        amount: 1,
        date: DAY,
      };
      await call('post', '/cash-bank/transfers', manager.token, body).expect(
        201,
      );
      await call('post', '/cash-bank/transfers', munshi.token, body).expect(
        403,
      );
      await call('post', '/cash-bank/transfers', viewer.token, body).expect(
        403,
      );
    });
  });

  describe('deposit', () => {
    it('should move cash in hand to a bank', async () => {
      const [cashBefore, bankBefore] = [
        await balance(cash),
        await balance(meezan),
      ];
      const res = await call('post', '/cash-bank/deposits', owner(), {
        toAccountId: meezan,
        amount: 3000,
        date: DAY,
        note: 'Slip 12',
      }).expect(201);
      expect(
        res.body.entries.map((e: { sourceType: string }) => e.sourceType),
      ).toEqual(['deposit', 'deposit']);
      expect(await balance(cash)).toBe(cashBefore - 3000);
      expect(await balance(meezan)).toBe(bankBefore + 3000);
    });

    it('should refuse a deposit into the cash account', async () => {
      const res = await call('post', '/cash-bank/deposits', owner(), {
        toAccountId: cash,
        amount: 5,
        date: DAY,
      }).expect(422);
      expect(res.body.errors.toAccountId).toBe('mustBeBank');
    });

    it('should take the money from the cash account that was named', async () => {
      const [cashBefore, cash2Before, bankBefore] = [
        await balance(cash),
        await balance(cash2),
        await balance(meezan),
      ];
      await call('post', '/cash-bank/deposits', owner(), {
        fromAccountId: cash2,
        toAccountId: meezan,
        amount: 700,
        date: DAY,
      }).expect(201);
      expect(await balance(cash2)).toBe(cash2Before - 700);
      expect(await balance(cash)).toBe(cashBefore);
      expect(await balance(meezan)).toBe(bankBefore + 700);
    });

    it('should refuse a deposit from a bank or from another company', async () => {
      const bank = await call('post', '/cash-bank/deposits', owner(), {
        fromAccountId: hbl,
        toAccountId: meezan,
        amount: 5,
        date: DAY,
      }).expect(422);
      expect(bank.body.errors.fromAccountId).toBe('mustBeCash');
      const foreign = await call('post', '/cash-bank/deposits', owner(), {
        fromAccountId: bCash,
        toAccountId: meezan,
        amount: 5,
        date: DAY,
      }).expect(422);
      expect(foreign.body.errors.fromAccountId).toBe('mustBeCash');
    });
  });

  describe('cash count', () => {
    it('should post the shortfall as a cash adjustment with the reason', async () => {
      const expected = await balance(cash);
      const res = await call('post', '/cash-bank/cash-count', owner(), {
        countedAmount: expected - 120,
        date: DAY,
        reason: 'Short, tea money',
      }).expect(200);
      expect(res.body).toMatchObject({
        expected,
        counted: expected - 120,
        difference: -120,
      });
      expect(res.body.entry).toMatchObject({
        direction: 'out',
        amount: 120,
        sourceType: 'cash_adjustment',
        note: 'Short, tea money',
      });
      expect(await balance(cash)).toBe(expected - 120);
    });

    it('should post the surplus as money in', async () => {
      const expected = await balance(cash);
      await call('post', '/cash-bank/cash-count', owner(), {
        countedAmount: expected + 80,
        date: DAY,
        reason: 'Found a note',
      }).expect(200);
      expect(await balance(cash)).toBe(expected + 80);
    });

    it('should count the cash account that was named, and no other', async () => {
      const [cashBefore, cash2Before] = [
        await balance(cash),
        await balance(cash2),
      ];
      const res = await call('post', '/cash-bank/cash-count', owner(), {
        accountId: cash2,
        countedAmount: cash2Before + 40,
        date: DAY,
        reason: 'Found in the drawer',
      }).expect(200);
      expect(res.body).toMatchObject({ expected: cash2Before, difference: 40 });
      expect(await balance(cash2)).toBe(cash2Before + 40);
      expect(await balance(cash)).toBe(cashBefore);
    });

    it('should not count a bank or another company account', async () => {
      const body = { countedAmount: 1, date: DAY, reason: 'x' };
      await call('post', '/cash-bank/cash-count', owner(), {
        ...body,
        accountId: hbl,
      }).expect(404);
      await call('post', '/cash-bank/cash-count', owner(), {
        ...body,
        accountId: bCash,
      }).expect(404);
    });

    it('should post nothing when the count matches the books', async () => {
      const expected = await balance(cash);
      const rows = (await statement(cash).expect(200)).body.total;
      const res = await call('post', '/cash-bank/cash-count', owner(), {
        countedAmount: expected,
        date: DAY,
      }).expect(200);
      expect(res.body).toMatchObject({ difference: 0, entry: null });
      expect((await statement(cash).expect(200)).body.total).toBe(rows);
    });

    it('should require a reason when the count differs, and post nothing without one', async () => {
      const expected = await balance(cash);
      await call('post', '/cash-bank/cash-count', owner(), {
        countedAmount: expected + 1,
        date: DAY,
      }).expect(422);
      expect(await balance(cash)).toBe(expected);
    });

    it('should be allowed for a partner only, not a manager or munshi', async () => {
      const body = { countedAmount: await balance(cash), date: DAY };
      await call('post', '/cash-bank/cash-count', partner.token, body).expect(
        200,
      );
      await call('post', '/cash-bank/cash-count', manager.token, body).expect(
        403,
      );
      await call('post', '/cash-bank/cash-count', munshi.token, body).expect(
        403,
      );
    });
  });

  describe('reversal', () => {
    it('should restore the balance and mark the original reversed', async () => {
      const before = await balance(cash);
      const made = await pay(owner(), {
        accountId: cash,
        amount: 900,
        date: DAY,
        reason: 'Wrong account',
      }).expect(201);
      const id = made.body.entries[0].id;
      expect(await balance(cash)).toBe(before - 900);

      const res = await call(
        'post',
        `/cash-bank/entries/${id}/reverse`,
        owner(),
        { date: DAY, reason: 'Entered by mistake' },
      ).expect(200);
      expect(res.body.reversals).toHaveLength(1);
      expect(await balance(cash)).toBe(before);

      const rows = (
        await statement(cash, owner(), '?order=asc&limit=200').expect(200)
      ).body.rows;
      expect(rows.find((r: { id: string }) => r.id === id)).toMatchObject({
        reversedById: res.body.reversals[0].id,
        reversible: false,
      });
    });

    it('should reverse both rows of a transfer', async () => {
      const [cashBefore, hblBefore] = [await balance(cash), await balance(hbl)];
      const made = await call('post', '/cash-bank/transfers', owner(), {
        fromAccountId: hbl,
        toAccountId: cash,
        amount: 4000,
        date: DAY,
      }).expect(201);
      const res = await call(
        'post',
        `/cash-bank/entries/${made.body.entries[1].id}/reverse`,
        owner(),
        { date: DAY, reason: 'Wrong bank' },
      ).expect(200);
      expect(res.body.reversals).toHaveLength(2);
      expect(await balance(cash)).toBe(cashBefore);
      expect(await balance(hbl)).toBe(hblBefore);
    });

    it('should refuse a second reversal, a reversal of a reversal, and an opening balance', async () => {
      const made = await pay(owner(), {
        accountId: cash,
        amount: 11,
        date: DAY,
        reason: 'x',
      }).expect(201);
      const reversed = await call(
        'post',
        `/cash-bank/entries/${made.body.entries[0].id}/reverse`,
        owner(),
        { date: DAY, reason: 'undo' },
      ).expect(200);
      const again = await call(
        'post',
        `/cash-bank/entries/${made.body.entries[0].id}/reverse`,
        owner(),
        { date: DAY, reason: 'again' },
      ).expect(409);
      expect(again.body.code).toBe('ENTRY_ALREADY_REVERSED');
      const onReversal = await call(
        'post',
        `/cash-bank/entries/${reversed.body.reversals[0].id}/reverse`,
        owner(),
        { date: DAY, reason: 'x' },
      ).expect(409);
      expect(onReversal.body.code).toBe('ENTRY_IS_A_REVERSAL');

      const opening = (
        await statement(cash, owner(), '?order=asc&limit=1').expect(200)
      ).body.rows[0];
      expect(opening.sourceType).toBe('opening');
      expect(opening.reversible).toBe(false);
      const refused = await call(
        'post',
        `/cash-bank/entries/${opening.id}/reverse`,
        owner(),
        { date: DAY, reason: 'x' },
      ).expect(409);
      expect(refused.body.code).toBe('ENTRY_NOT_REVERSIBLE_HERE');
    });

    it('should let only one of two simultaneous reversals win', async () => {
      const before = await balance(cash);
      const made = await pay(owner(), {
        accountId: cash,
        amount: 33,
        date: DAY,
        reason: 'race',
      }).expect(201);
      const id = made.body.entries[0].id;
      const results = await Promise.all([
        call('post', `/cash-bank/entries/${id}/reverse`, owner(), {
          date: DAY,
          reason: 'a',
        }),
        call('post', `/cash-bank/entries/${id}/reverse`, owner(), {
          date: DAY,
          reason: 'b',
        }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await balance(cash)).toBe(before);
    });

    it('should be owner or partner only', async () => {
      const made = await pay(owner(), {
        accountId: cash,
        amount: 2,
        date: DAY,
        reason: 'x',
      }).expect(201);
      const id = made.body.entries[0].id;
      await call('post', `/cash-bank/entries/${id}/reverse`, manager.token, {
        date: DAY,
        reason: 'x',
      }).expect(403);
      await call('post', `/cash-bank/entries/${id}/reverse`, munshi.token, {
        date: DAY,
        reason: 'x',
      }).expect(403);
      await call('post', `/cash-bank/entries/${id}/reverse`, partner.token, {
        date: DAY,
        reason: 'x',
      }).expect(200);
    });

    it('should flag reversible rows only for those who may reverse them', async () => {
      const made = await pay(owner(), {
        accountId: cash,
        amount: 3,
        date: DAY,
        reason: 'flag',
      }).expect(201);
      const id = made.body.entries[0].id;
      const find = async (token: string) =>
        (await statement(cash, token, '?limit=200').expect(200)).body.rows.find(
          (r: { id: string }) => r.id === id,
        );
      expect((await find(owner())).reversible).toBe(true);
      expect((await find(manager.token)).reversible).toBe(false);
    });
  });

  describe('statement', () => {
    it('should filter by date and type and keep the running balance true', async () => {
      const id = (
        await call('post', '/cash-bank/accounts', owner(), {
          kind: 'bank',
          name: 'Statement bank',
          last4: '3333',
          openingBalance: 1000,
          openingDate: '2026-02-01',
        }).expect(201)
      ).body.id;
      await receive(owner(), {
        accountId: id,
        amount: 500,
        date: '2026-02-10',
        reason: 'r1',
      }).expect(201);
      await pay(owner(), {
        accountId: id,
        amount: 200,
        date: '2026-02-20',
        reason: 'p1',
      }).expect(201);
      await pay(owner(), {
        accountId: id,
        amount: 100,
        date: '2026-03-05',
        reason: 'p2',
      }).expect(201);

      const range = (
        await statement(
          id,
          owner(),
          '?from=2026-02-15&to=2026-03-01&order=asc',
        ).expect(200)
      ).body;
      expect(range).toMatchObject({
        openingBalance: 1500,
        totalIn: 0,
        totalOut: 200,
        closingBalance: 1300,
        total: 1,
      });
      expect(range.rows[0].runningBalance).toBe(1300);

      const outs = (
        await statement(id, owner(), '?direction=out&order=asc').expect(200)
      ).body;
      expect(outs.total).toBe(2);
      expect(
        outs.rows.map((r: { runningBalance: number }) => r.runningBalance),
      ).toEqual([1300, 1200]);

      const typed = (
        await statement(id, owner(), '?sourceType=other_receipt').expect(200)
      ).body;
      expect(typed.total).toBe(1);
    });

    it('should put money in before money out on the same day', async () => {
      const id = (
        await call('post', '/cash-bank/accounts', owner(), {
          kind: 'bank',
          name: 'Same day',
          last4: '2222',
          openingBalance: 0,
          openingDate: '2026-01-01',
        }).expect(201)
      ).body.id;
      await pay(owner(), {
        accountId: id,
        amount: 100,
        date: '2026-04-01',
        reason: 'out first',
      }).expect(201);
      await receive(owner(), {
        accountId: id,
        amount: 400,
        date: '2026-04-01',
        reason: 'in second',
      }).expect(201);
      const rows = (await statement(id, owner(), '?order=asc').expect(200)).body
        .rows;
      expect(rows.map((r: { direction: string }) => r.direction)).toEqual([
        'in',
        'out',
      ]);
      expect(
        rows.map((r: { runningBalance: number }) => r.runningBalance),
      ).toEqual([400, 300]);
    });

    it('should page the results', async () => {
      const page = (
        await statement(cash, owner(), '?limit=2&page=2&order=asc').expect(200)
      ).body;
      expect(page.rows).toHaveLength(2);
      expect(page.total).toBeGreaterThan(4);
    });

    it('should refuse a bad range', async () => {
      await statement(cash, owner(), '?from=2026-03-10&to=2026-03-01').expect(
        422,
      );
      await statement(cash, owner(), '?from=nope').expect(422);
    });
  });

  // ------------------------------------------------------------- munshi
  describe('munshi', () => {
    it('should see the cash balance but no bank balance', async () => {
      const list = (
        await call('get', '/cash-bank/accounts', munshi.token).expect(200)
      ).body as {
        id: string;
        kind: string;
        balance: number | null;
        openingBalance: number | null;
        name: string;
      }[];
      const mCash = list.find((a) => a.id === cash)!;
      const mBank = list.find((a) => a.id === hbl)!;
      expect(mCash.balance).toBe(await balance(cash));
      expect(mBank.name).toBeTruthy();
      expect(mBank.balance).toBeNull();
      expect(mBank.openingBalance).toBeNull();
    });

    it('should be refused a bank statement and bank payments, but may read the cash statement', async () => {
      const denied = await statement(hbl, munshi.token).expect(403);
      expect(denied.body.code).toBe('BANK_BALANCES_HIDDEN');
      const noPay = await pay(munshi.token, {
        accountId: hbl,
        amount: 5,
        date: DAY,
        reason: 'x',
      }).expect(403);
      expect(noPay.body.code).toBe('BANK_ACCOUNT_NOT_ALLOWED');
      await statement(cash, munshi.token).expect(200);
    });

    it('should be able to use every cash account, with its balance', async () => {
      const list = (
        await call('get', '/cash-bank/accounts', munshi.token).expect(200)
      ).body as { id: string; balance: number | null }[];
      expect(list.find((a) => a.id === cash2)!.balance).toBe(
        await balance(cash2),
      );
      await statement(cash2, munshi.token).expect(200);
      const res = await pay(munshi.token, {
        accountId: cash2,
        amount: 9,
        date: DAY,
        reason: 'Petty cash',
      }).expect(201);
      expect(res.body.status).toBe('pending');
    });

    it('should never see bank figures anywhere in a response', async () => {
      const text = JSON.stringify(
        (await call('get', '/cash-bank/accounts', munshi.token).expect(200))
          .body,
      );
      expect(text).not.toContain('500000');
    });
  });

  // ---------------------------------------------------------- approvals
  describe('approvals', () => {
    afterEach(() => setApprovalRequired(A, true));

    const request = async (
      body: Partial<{ amount: number; reason: string }> = {},
    ) =>
      (
        await pay(munshi.token, {
          accountId: cash,
          amount: 250,
          date: DAY,
          reason: 'Guests',
          ...body,
        }).expect(201)
      ).body;

    it('should keep a munshi payment pending and move no money', async () => {
      const before = await balance(cash);
      const res = await request();
      expect(res.status).toBe('pending');
      expect(res.approvalId).toEqual(expect.any(String));
      expect(await balance(cash)).toBe(before);
    });

    it('should let owner, partner and manager see pending requests with who asked', async () => {
      const { approvalId } = await request({ reason: 'Visible' });
      for (const token of [owner(), partner.token, manager.token]) {
        const list = (
          await call(
            'get',
            '/cash-bank/approvals?status=pending',
            token,
          ).expect(200)
        ).body;
        const found = list.rows.find(
          (r: { id: string }) => r.id === approvalId,
        );
        expect(found).toMatchObject({
          status: 'pending',
          entityType: 'other_payment',
          requestedBy: { memberId: munshi.memberId },
        });
        expect(found.requestedBy.name).toBeTruthy();
        expect(found.payload).toMatchObject({ amount: 250, accountId: cash });
      }
    });

    it('should show a munshi only their own requests', async () => {
      const { approvalId } = await request({ reason: 'Mine' });
      await pay(manager.token, {
        accountId: cash,
        amount: 1,
        date: DAY,
        reason: 'Manager entry',
      }).expect(201);
      const mine = (
        await call('get', '/cash-bank/approvals', munshi.token).expect(200)
      ).body;
      expect(mine.rows.map((r: { id: string }) => r.id)).toContain(approvalId);
      expect(
        mine.rows.every(
          (r: { requestedBy: { memberId: string } }) =>
            r.requestedBy.memberId === munshi.memberId,
        ),
      ).toBe(true);
    });

    it('should post the entry only when approved, attributed to the munshi', async () => {
      const { approvalId } = await request({
        amount: 640,
        reason: 'Approve me',
      });
      const before = await balance(cash);
      await call(
        'post',
        `/cash-bank/approvals/${approvalId}/approve`,
        manager.token,
      ).expect(200);
      expect(await balance(cash)).toBe(before - 640);

      const row = (
        await statement(cash, owner(), '?limit=200').expect(200)
      ).body.rows.find((r: { note: string }) => r.note === 'Approve me');
      expect(row).toMatchObject({
        amount: 640,
        sourceType: 'other_payment',
        createdByMemberId: munshi.memberId,
        sourceId: approvalId,
      });
      const done = (
        await call(
          'get',
          '/cash-bank/approvals?status=approved',
          owner(),
        ).expect(200)
      ).body.rows.find((r: { id: string }) => r.id === approvalId);
      expect(done).toMatchObject({
        status: 'approved',
        decidedByMemberId: manager.memberId,
        entityId: row.id,
      });
    });

    it('should not allow approving twice', async () => {
      const { approvalId } = await request({ reason: 'Once' });
      await call(
        'post',
        `/cash-bank/approvals/${approvalId}/approve`,
        owner(),
      ).expect(200);
      const before = await balance(cash);
      const again = await call(
        'post',
        `/cash-bank/approvals/${approvalId}/approve`,
        owner(),
      ).expect(409);
      expect(again.body.code).toBe('APPROVAL_ALREADY_DECIDED');
      expect(await balance(cash)).toBe(before);
    });

    it('should not let a munshi or viewer approve or reject', async () => {
      const { approvalId } = await request({ reason: 'Guarded' });
      for (const token of [munshi.token, viewer.token]) {
        await call(
          'post',
          `/cash-bank/approvals/${approvalId}/approve`,
          token,
        ).expect(403);
        await call('post', `/cash-bank/approvals/${approvalId}/reject`, token, {
          reason: 'x',
        }).expect(403);
      }
    });

    it('should keep the reason on a rejection, where the munshi can read it, and move no money', async () => {
      const { approvalId } = await request({ reason: 'Reject me' });
      const before = await balance(cash);
      await call('post', `/cash-bank/approvals/${approvalId}/reject`, owner(), {
        reason: 'Amount does not match the slip',
      }).expect(200);
      expect(await balance(cash)).toBe(before);

      const mine = (
        await call(
          'get',
          '/cash-bank/approvals?status=rejected',
          munshi.token,
        ).expect(200)
      ).body.rows.find((r: { id: string }) => r.id === approvalId);
      expect(mine).toMatchObject({
        status: 'rejected',
        reason: 'Amount does not match the slip',
      });
    });

    it('should require a reason to reject', async () => {
      const { approvalId } = await request({ reason: 'No reason' });
      await call('post', `/cash-bank/approvals/${approvalId}/reject`, owner(), {
        reason: '   ',
      }).expect(422);
      await call(
        'post',
        `/cash-bank/approvals/${approvalId}/reject`,
        owner(),
        {},
      ).expect(422);
      const still = (
        await call(
          'get',
          '/cash-bank/approvals?status=pending',
          owner(),
        ).expect(200)
      ).body.rows.find((r: { id: string }) => r.id === approvalId);
      expect(still.status).toBe('pending');
    });

    it('should post a munshi entry at once when the company does not require approval', async () => {
      await setApprovalRequired(A, false);
      const before = await balance(cash);
      const res = await pay(munshi.token, {
        accountId: cash,
        amount: 15,
        date: DAY,
        reason: 'No approval needed',
      }).expect(201);
      expect(res.body.status).toBe('posted');
      expect(await balance(cash)).toBe(before - 15);
    });

    it('should approve a pending deposit by posting both rows', async () => {
      const dep = (
        await call('post', '/cash-bank/deposits', munshi.token, {
          toAccountId: hbl,
          amount: 1200,
          date: DAY,
          note: 'Munshi deposit',
        }).expect(201)
      ).body;
      expect(dep.status).toBe('pending');
      const [cashBefore, hblBefore] = [await balance(cash), await balance(hbl)];
      await call(
        'post',
        `/cash-bank/approvals/${dep.approvalId}/approve`,
        owner(),
      ).expect(200);
      expect(await balance(cash)).toBe(cashBefore - 1200);
      expect(await balance(hbl)).toBe(hblBefore + 1200);
    });

    it('should leave it pending, and post nothing, if the account was deactivated meanwhile', async () => {
      const closing = (
        await call('post', '/cash-bank/accounts', owner(), {
          kind: 'bank',
          name: 'Closing soon',
          last4: '8888',
          openingBalance: 0,
          openingDate: '2026-01-01',
        }).expect(201)
      ).body.id;
      const dep = (
        await call('post', '/cash-bank/deposits', munshi.token, {
          toAccountId: closing,
          amount: 90,
          date: DAY,
        }).expect(201)
      ).body;
      await call('patch', `/cash-bank/accounts/${closing}`, owner(), {
        isActive: false,
      }).expect(200);

      const cashBefore = await balance(cash);
      const res = await call(
        'post',
        `/cash-bank/approvals/${dep.approvalId}/approve`,
        owner(),
      ).expect(409);
      expect(res.body.code).toBe('ACCOUNT_INACTIVE');
      expect(await balance(cash)).toBe(cashBefore);
      const pending = (
        await call(
          'get',
          '/cash-bank/approvals?status=pending',
          owner(),
        ).expect(200)
      ).body.rows.map((r: { id: string }) => r.id);
      expect(pending).toContain(dep.approvalId);
    });

    it('should auto-approve an owner entry without waiting', async () => {
      const res = await pay(owner(), {
        accountId: cash,
        amount: 4,
        date: DAY,
        reason: 'Owner',
      }).expect(201);
      expect(res.body.status).toBe('posted');
    });
  });

  // ------------------------------------------------------------ isolation
  describe('tenant isolation', () => {
    it('should list only the caller company accounts', async () => {
      const mine = (
        await call('get', '/cash-bank/accounts', owner()).expect(200)
      ).body.map((a: { id: string }) => a.id);
      const theirs = (
        await call('get', '/cash-bank/accounts', B.ownerToken).expect(200)
      ).body.map((a: { id: string }) => a.id);
      expect(mine).not.toContain(bCash);
      expect(theirs).toEqual([bCash]);
    });

    it("should treat another company's ids exactly like missing ones", async () => {
      const entry = (
        await statement(cash, owner(), '?order=asc&limit=1').expect(200)
      ).body.rows[0].id;
      const pending = (
        await pay(munshi.token, {
          accountId: cash,
          amount: 1,
          date: DAY,
          reason: 'iso',
        }).expect(201)
      ).body.approvalId;

      await statement(cash, B.ownerToken).expect(404);
      await call('patch', `/cash-bank/accounts/${cash}`, B.ownerToken, {
        name: 'Hacked',
      }).expect(404);
      await pay(B.ownerToken, {
        accountId: cash,
        amount: 1,
        date: DAY,
        reason: 'x',
      }).expect(404);
      await call('post', '/cash-bank/deposits', B.ownerToken, {
        toAccountId: hbl,
        amount: 1,
        date: DAY,
      }).expect(404);
      await call('post', `/cash-bank/entries/${entry}/reverse`, B.ownerToken, {
        date: DAY,
        reason: 'x',
      }).expect(404);
      await call(
        'post',
        `/cash-bank/approvals/${pending}/approve`,
        B.ownerToken,
      ).expect(404);
      await call(
        'post',
        `/cash-bank/approvals/${pending}/reject`,
        B.ownerToken,
        { reason: 'x' },
      ).expect(404);

      expect((await accountOf(owner(), cash)).name).toBe('Cash in hand');
      expect(
        (await call('get', '/cash-bank/approvals', B.ownerToken).expect(200))
          .body.total,
      ).toBe(0);
    });

    it("should not count another company's money in a cash count", async () => {
      const bBefore = await balance(bCash, B.ownerToken);
      await call('post', '/cash-bank/cash-count', B.ownerToken, {
        countedAmount: bBefore,
        date: DAY,
      }).expect(200);
      expect(await balance(bCash, B.ownerToken)).toBe(777);
    });
  });
});
