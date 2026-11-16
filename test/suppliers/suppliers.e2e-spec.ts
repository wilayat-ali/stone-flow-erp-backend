// End-to-end tests for Suppliers. They boot the whole app in-process, use the
// database from .env, create everything through the real API with unique
// "e2e-<run>" data, and delete it all afterwards.
//
//   npm run test:e2e -- suppliers
import { LedgerService } from '../../src/ledger-entries/ledger.service';
import { Harness, Member, Workspace } from '../utils/harness';

jest.setTimeout(120000);

type SupplierBody = {
  id: string;
  name: string;
  type: string;
  business: string;
  phone: string;
  city: string;
  cuttingRatePerTon: number | null;
  openingBalance: number;
  openingDate: string;
  isActive: boolean;
  charged: number;
  paid: number;
  balance: number;
  unclearedCheques: number;
};

type KhataBody = {
  id: string;
  date: string;
  detail: string;
  kind: 'charge' | 'credit';
  amount: number;
  balance: number;
  unclearedCheque: boolean;
};

const codeOf = (res: { body: unknown }) => (res.body as { code?: string }).code;

describe('Suppliers (e2e)', () => {
  let h: Harness;
  let A: Workspace;
  let B: Workspace;
  let manager: Member;
  let munshi: Member;
  let viewer: Member;

  const call = (...args: Parameters<Harness['call']>) => h.call(...args);
  const owner = () => A.ownerToken;

  const input = (over: Record<string, unknown> = {}) => ({
    type: 'mine_owner',
    name: 'Haji Gul Khan',
    business: 'Ziarat Marble Mines',
    phone: '0333-7812345',
    city: 'Ziarat',
    openingBalance: 120000,
    openingDate: '2026-09-01',
    ...over,
  });

  const add = async (over: Record<string, unknown> = {}, token = owner()) =>
    (await call('post', '/suppliers', token, input(over)).expect(201))
      .body as SupplierBody;
  const list = async (qs = '', token = owner()) =>
    (await call('get', `/suppliers${qs}`, token).expect(200))
      .body as SupplierBody[];
  const khata = async (id: string, token = owner()) =>
    (await call('get', `/suppliers/${id}/khata`, token).expect(200))
      .body as KhataBody[];

  // A row in the party ledger, as the purchases and payments modules will post it.
  const post = (
    companyId: string,
    supplierId: string,
    side: 'charge' | 'credit',
    amount: number,
    date: string,
    note: string,
  ) =>
    h.app.get(LedgerService).postPartyEntry({
      companyId,
      partyType: 'supplier',
      partyId: supplierId,
      side,
      amount,
      date,
      sourceType: 'test',
      note,
    });

  beforeAll(async () => {
    h = await Harness.start();
    A = await h.createCompany('sup-a');
    B = await h.createCompany('sup-b');
    manager = await h.addMember(A, 'manager', 'MgrSup');
    munshi = await h.addMember(A, 'munshi', 'MunshiSup');
    viewer = await h.addMember(A, 'viewer', 'ViewerSup');
  });

  afterAll(async () => {
    await h.stop();
  });

  describe('adding a supplier', () => {
    it('should add a mine owner and return it', async () => {
      const s = await add();

      expect(s).toMatchObject({
        name: 'Haji Gul Khan',
        type: 'mine_owner',
        business: 'Ziarat Marble Mines',
        phone: '0333-7812345',
        city: 'Ziarat',
        cuttingRatePerTon: null,
        openingBalance: 120000,
        openingDate: '2026-09-01',
        isActive: true,
      });
      expect(s.id).toEqual(expect.any(String));
    });

    it('should refuse the same number again, with or without the dash', async () => {
      const res = await call(
        'post',
        '/suppliers',
        owner(),
        input({ name: 'Other', phone: '03337812345' }),
      ).expect(409);
      expect(codeOf(res)).toBe('DUPLICATE_PHONE');
    });

    it('should allow the same number in another company', async () => {
      await add({}, B.ownerToken);
    });

    it('should need a rate for a cutting factory and drop it for others', async () => {
      await call(
        'post',
        '/suppliers',
        owner(),
        input({
          type: 'cutting_factory',
          name: 'Al-Madina Cutting',
          phone: '0300-2299451',
        }),
      ).expect(422);

      const factory = await add({
        type: 'cutting_factory',
        name: 'Al-Madina Cutting',
        phone: '0300-2299451',
        cuttingRatePerTon: 1500,
        openingBalance: 0,
      });
      expect(factory.cuttingRatePerTon).toBe(1500);

      const shop = await add({
        type: 'shop',
        name: 'Madina Store',
        phone: '0321-2456789',
        cuttingRatePerTon: 900,
        openingBalance: 0,
      });
      expect(shop.cuttingRatePerTon).toBeNull();
    });

    it('should refuse a bad phone, an unknown type and a bad date', async () => {
      await call(
        'post',
        '/suppliers',
        owner(),
        input({ phone: '12345' }),
      ).expect(422);
      await call(
        'post',
        '/suppliers',
        owner(),
        input({ phone: '0301-1111111', type: 'bank' }),
      ).expect(422);
      await call(
        'post',
        '/suppliers',
        owner(),
        input({ phone: '0301-1111112', openingDate: '2026-13-45' }),
      ).expect(422);
    });
  });

  describe('balances and the khata', () => {
    let gul: SupplierBody;
    let advance: SupplierBody;

    beforeAll(async () => {
      gul = (await list()).find((s) => s.phone === '0333-7812345')!;
      advance = await add({
        name: 'Paid Ahead',
        phone: '0345-9081123',
        openingBalance: -50000,
      });

      await post(A.id, gul.id, 'charge', 142000, '2026-09-12', 'Truck 16/3');
      await post(A.id, gul.id, 'credit', 145000, '2026-09-12', 'Payment');
      await post(A.id, gul.id, 'charge', 154000, '2026-09-30', 'Truck 18/3');
    });

    it('should add the opening balance and the ledger into the totals', async () => {
      const s = (await list()).find((x) => x.id === gul.id)!;

      expect(s.charged).toBe(120000 + 142000 + 154000);
      expect(s.paid).toBe(145000);
      expect(s.balance).toBe(271000);
      expect(s.unclearedCheques).toBe(0);
    });

    it('should count an opening advance as paid', async () => {
      const s = (await list()).find((x) => x.id === advance.id)!;

      expect(s).toMatchObject({ charged: 0, paid: 50000, balance: -50000 });
    });

    it('should show the opening row first and a running balance', async () => {
      const rows = await khata(gul.id);

      expect(rows.map((r) => [r.detail, r.kind, r.amount, r.balance])).toEqual([
        ['opening', 'charge', 120000, 120000],
        ['Truck 16/3', 'charge', 142000, 262000],
        ['Payment', 'credit', 145000, 117000],
        ['Truck 18/3', 'charge', 154000, 271000],
      ]);
      expect(rows[0].date).toBe('2026-09-01');
    });

    it('should show an advance as a credit opening row', async () => {
      const rows = await khata(advance.id);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        kind: 'credit',
        amount: 50000,
        balance: -50000,
      });
    });

    it('should filter by type and by who owes whom', async () => {
      const shops = await list('?type=shop');
      expect(shops.every((s) => s.type === 'shop')).toBe(true);
      expect(shops.length).toBe(1);

      const owe = await list('?balance=owe');
      expect(owe.map((s) => s.id)).toContain(gul.id);
      expect(owe.every((s) => s.balance > 0)).toBe(true);

      const ahead = await list('?balance=advance');
      expect(ahead.map((s) => s.id)).toEqual([advance.id]);
    });

    it('should return one supplier with its figures', async () => {
      const res = await call('get', `/suppliers/${gul.id}`, owner()).expect(
        200,
      );
      expect((res.body as SupplierBody).balance).toBe(271000);
    });
  });

  describe('editing a supplier', () => {
    it('should edit fields and keep the number unique', async () => {
      const s = await add({
        name: 'Editable',
        phone: '0302-5550001',
        openingBalance: 0,
      });

      const res = await call('patch', `/suppliers/${s.id}`, owner(), {
        name: 'Edited',
        city: 'Hub',
        phone: '0302-5550002',
      }).expect(200);
      expect(res.body).toMatchObject({
        name: 'Edited',
        city: 'Hub',
        phone: '0302-5550002',
      });

      const clash = await call('patch', `/suppliers/${s.id}`, owner(), {
        phone: '0333-7812345',
      }).expect(409);
      expect(codeOf(clash)).toBe('DUPLICATE_PHONE');

      // keeping your own number is not a clash
      await call('patch', `/suppliers/${s.id}`, owner(), {
        phone: '03025550002',
      }).expect(200);
    });

    it('should drop the rate when a cutting factory becomes a shop', async () => {
      const f = await add({
        type: 'cutting_factory',
        name: 'Was Factory',
        phone: '0302-5550003',
        cuttingRatePerTon: 350,
        openingBalance: 0,
      });

      const res = await call('patch', `/suppliers/${f.id}`, owner(), {
        type: 'shop',
      }).expect(200);
      expect((res.body as SupplierBody).cuttingRatePerTon).toBeNull();

      await call('patch', `/suppliers/${f.id}`, owner(), {
        type: 'cutting_factory',
      }).expect(422);
    });

    it('should deactivate and reactivate', async () => {
      const s = await add({
        name: 'Toggle',
        phone: '0302-5550004',
        openingBalance: 0,
      });

      const off = await call('patch', `/suppliers/${s.id}`, owner(), {
        isActive: false,
      }).expect(200);
      expect((off.body as SupplierBody).isActive).toBe(false);
      expect((await list()).find((x) => x.id === s.id)!.isActive).toBe(false);

      await call('patch', `/suppliers/${s.id}`, owner(), {
        isActive: true,
      }).expect(200);
    });
  });

  describe('who may do what', () => {
    it('should let a viewer look but not add or edit', async () => {
      await list('', viewer.token);
      const any = (await list())[0];
      await call('get', `/suppliers/${any.id}`, viewer.token).expect(200);
      await call('get', `/suppliers/${any.id}/khata`, viewer.token).expect(200);

      await call(
        'post',
        '/suppliers',
        viewer.token,
        input({ phone: '0303-1000001' }),
      ).expect(403);
      await call('patch', `/suppliers/${any.id}`, viewer.token, {
        city: 'X',
      }).expect(403);
    });

    it('should let a munshi add but not edit', async () => {
      const s = await add(
        { name: 'By Munshi', phone: '0303-1000002', openingBalance: 0 },
        munshi.token,
      );
      await call('patch', `/suppliers/${s.id}`, munshi.token, {
        city: 'X',
      }).expect(403);
    });

    it('should let a manager add and edit', async () => {
      const s = await add(
        { name: 'By Manager', phone: '0303-1000003', openingBalance: 0 },
        manager.token,
      );
      await call('patch', `/suppliers/${s.id}`, manager.token, {
        city: 'Quetta',
      }).expect(200);
    });

    it('should follow a custom role', async () => {
      await call('post', '/company/roles', owner(), {
        name: 'Supplier clerk',
        permissions: ['dashboard.view', 'suppliers.view', 'suppliers.create'],
      }).expect(201);
      const clerk = await h.addMember(A, 'supplier-clerk', 'ClerkSup');

      await list('', clerk.token);
      await add(
        { name: 'By Clerk', phone: '0303-1000004', openingBalance: 0 },
        clerk.token,
      );

      await call('patch', '/company/roles/supplier-clerk', owner(), {
        name: 'Supplier clerk',
        permissions: ['dashboard.view'],
      }).expect(200);
      await call('get', '/suppliers', clerk.token).expect(403);
    });
  });

  describe('keeping companies apart', () => {
    it('should not show or open suppliers of another company', async () => {
      const mine = await add({
        name: 'Only A',
        phone: '0304-2000001',
        openingBalance: 0,
      });

      expect((await list('', B.ownerToken)).map((s) => s.id)).not.toContain(
        mine.id,
      );
      await call('get', `/suppliers/${mine.id}`, B.ownerToken).expect(404);
      await call('get', `/suppliers/${mine.id}/khata`, B.ownerToken).expect(
        404,
      );
      await call('patch', `/suppliers/${mine.id}`, B.ownerToken, {
        city: 'X',
      }).expect(404);
    });

    it('should not mix khata rows between companies', async () => {
      const a = await add({
        name: 'Khata A',
        phone: '0304-2000002',
        openingBalance: 0,
      });
      await post(A.id, a.id, 'charge', 1000, '2026-10-01', 'A row');

      await call('get', `/suppliers/${a.id}/khata`, B.ownerToken).expect(404);
      const bList = await list('', B.ownerToken);
      expect(
        bList.every((s) => s.charged === Math.max(s.openingBalance, 0)),
      ).toBe(true);
    });

    it('should reject an id that is not a uuid', async () => {
      await call('get', '/suppliers/not-a-uuid', owner()).expect(422);
    });
  });
});
