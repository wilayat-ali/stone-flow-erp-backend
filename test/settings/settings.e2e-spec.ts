// End-to-end tests for the Settings master lists: factories, machines, soot
// sizes, counter widths, expense categories and the worker rate card, plus the
// company approval switch. They boot the whole app in-process, use the database
// from .env, create everything through the real API with unique "e2e-<run>"
// data, and delete it all afterwards.
//
//   npm run test:e2e -- settings
import { Harness, Member, Workspace } from '../utils/harness';

jest.setTimeout(120000);

type Factory = {
  id: string;
  name: string;
  kind: string;
  ratePerTon: number | null;
  isActive: boolean;
};
type Machine = {
  id: string;
  name: string;
  type: string;
  factoryId: string;
  dayThekadar: string;
  nightThekadar: string | null;
  isActive: boolean;
};
type Item = { id: string; name: string; isActive: boolean };
type Rate = {
  id: string;
  name: string;
  payType: string;
  rate: number;
  isActive: boolean;
};

const codeOf = (res: { body: unknown }) => (res.body as { code?: string }).code;

describe('Settings master lists (e2e)', () => {
  let h: Harness;
  let A: Workspace;
  let B: Workspace;
  let partner: Member;
  let manager: Member;
  let munshi: Member;
  let viewer: Member;

  const call = (...args: Parameters<Harness['call']>) => h.call(...args);
  const owner = () => A.ownerToken;
  const get = async <T>(path: string, token = owner()) =>
    (await call('get', path, token).expect(200)).body as T;

  const addFactory = async (
    over: Record<string, unknown> = {},
    token = owner(),
  ) =>
    (
      await call('post', '/settings/factories', token, {
        name: 'Main Factory',
        kind: 'own',
        ...over,
      }).expect(201)
    ).body as Factory;

  const addMachine = async (
    factoryId: string,
    over: Record<string, unknown> = {},
    token = owner(),
  ) =>
    (
      await call('post', '/settings/machines', token, {
        name: 'Vertical Cutter 1',
        type: 'vertical',
        factoryId,
        dayThekadar: 'Rashid Khan',
        ...over,
      }).expect(201)
    ).body as Machine;

  beforeAll(async () => {
    h = await Harness.start();
    A = await h.createCompany('set-a');
    B = await h.createCompany('set-b');
    partner = await h.addMember(A, 'partner', 'PartnerSet');
    manager = await h.addMember(A, 'manager', 'MgrSet');
    munshi = await h.addMember(A, 'munshi', 'MunshiSet');
    viewer = await h.addMember(A, 'viewer', 'ViewerSet');
  });

  afterAll(async () => {
    await h.stop();
  });

  describe('a new company', () => {
    it('should start with the default lists and no factories or machines', async () => {
      expect(await get<Item[]>('/settings/soot-sizes')).toHaveLength(3);
      expect(await get<Item[]>('/settings/counter-widths')).toHaveLength(3);
      expect(await get<Item[]>('/settings/expense-categories')).toHaveLength(
        10,
      );
      expect(await get<Rate[]>('/settings/worker-rates')).toHaveLength(8);
      expect(await get<Factory[]>('/settings/factories')).toEqual([]);
      expect(await get<Machine[]>('/settings/machines')).toEqual([]);

      const names = (await get<Item[]>('/settings/soot-sizes')).map(
        (i) => i.name,
      );
      expect(names).toEqual(['14 soot', '6 soot', '4 soot']);
    });
  });

  describe('who may read and who may change', () => {
    it('should let everyone in the company read every list', async () => {
      for (const token of [
        viewer.token,
        munshi.token,
        manager.token,
        partner.token,
      ]) {
        for (const path of [
          'factories',
          'machines',
          'soot-sizes',
          'counter-widths',
          'expense-categories',
          'worker-rates',
        ]) {
          await call('get', `/settings/${path}`, token).expect(200);
        }
      }
    });

    it('should only let people with settings.view change them', async () => {
      const body = { name: 'Nope', kind: 'own' };

      for (const t of [viewer, munshi, manager]) {
        await call('post', '/settings/factories', t.token, body).expect(403);
        await call('post', '/settings/soot-sizes', t.token, {
          name: 'Nope',
        }).expect(403);
        await call('post', '/settings/worker-rates', t.token, {
          name: 'Nope',
          payType: 'daily',
          rate: 1,
        }).expect(403);
      }

      await addFactory({ name: 'By Partner' }, partner.token);
    });

    it('should follow a custom role', async () => {
      await call('post', '/company/roles', owner(), {
        name: 'Settings clerk',
        permissions: ['dashboard.view', 'settings.view'],
      }).expect(201);
      const clerk = await h.addMember(A, 'settings-clerk', 'ClerkSet');

      await call('post', '/settings/soot-sizes', clerk.token, {
        name: 'By Clerk',
      }).expect(201);

      await call('patch', '/company/roles/settings-clerk', owner(), {
        name: 'Settings clerk',
        permissions: ['dashboard.view'],
      }).expect(200);
      await call('post', '/settings/soot-sizes', clerk.token, {
        name: 'By Clerk 2',
      }).expect(403);
      // reading stays open
      await call('get', '/settings/soot-sizes', clerk.token).expect(200);
    });
  });

  describe('factories', () => {
    it('should add an own factory and a cutting factory with a rate', async () => {
      const own = await addFactory({ name: 'North Yard', ratePerTon: 999 });
      expect(own).toMatchObject({
        name: 'North Yard',
        kind: 'own',
        ratePerTon: null,
        isActive: true,
      });

      const cutting = await addFactory({
        name: 'Khan Cutting Works',
        kind: 'cutting',
        ratePerTon: 350,
      });
      expect(cutting.ratePerTon).toBe(350);

      const noRate = await addFactory({ name: 'Rate Later', kind: 'cutting' });
      expect(noRate.ratePerTon).toBeNull();
    });

    it('should refuse a name that is taken, ignoring case, and bad input', async () => {
      const dup = await call('post', '/settings/factories', owner(), {
        name: 'NORTH YARD',
        kind: 'cutting',
      }).expect(409);
      expect(codeOf(dup)).toBe('DUPLICATE_NAME');

      await call('post', '/settings/factories', owner(), {
        name: '',
        kind: 'own',
      }).expect(422);
      await call('post', '/settings/factories', owner(), {
        name: 'X',
        kind: 'sideways',
      }).expect(422);
      await call('post', '/settings/factories', owner(), {
        name: 'Y',
        kind: 'cutting',
        ratePerTon: -5,
      }).expect(422);
    });

    it('should edit a factory and drop the rate when it becomes own', async () => {
      const f = await addFactory({
        name: 'Edit Me',
        kind: 'cutting',
        ratePerTon: 400,
      });

      const renamed = await call(
        'patch',
        `/settings/factories/${f.id}`,
        owner(),
        {
          name: 'Edited',
          ratePerTon: 425.5,
        },
      ).expect(200);
      expect(renamed.body).toMatchObject({ name: 'Edited', ratePerTon: 425.5 });

      const own = await call('patch', `/settings/factories/${f.id}`, owner(), {
        kind: 'own',
      }).expect(200);
      expect((own.body as Factory).ratePerTon).toBeNull();
    });

    it('should hide a deactivated factory but keep it available on request', async () => {
      const f = await addFactory({ name: 'To Hide' });

      await call('patch', `/settings/factories/${f.id}`, owner(), {
        isActive: false,
      }).expect(200);

      const active = await get<Factory[]>('/settings/factories');
      expect(active.map((x) => x.id)).not.toContain(f.id);

      const all = await get<Factory[]>(
        '/settings/factories?includeInactive=true',
      );
      expect(all.find((x) => x.id === f.id)!.isActive).toBe(false);

      // a hidden name is still taken
      await call('post', '/settings/factories', owner(), {
        name: 'to hide',
        kind: 'own',
      }).expect(409);
    });
  });

  describe('machines', () => {
    let own: Factory;
    let cutting: Factory;

    beforeAll(async () => {
      own = await addFactory({ name: 'Machine Home' });
      cutting = await addFactory({
        name: 'Machine Cutting',
        kind: 'cutting',
        ratePerTon: 300,
      });
    });

    it('should add a machine to an own factory', async () => {
      const m = await addMachine(own.id, {
        name: 'Gang Saw 1',
        type: 'gangSaw',
        nightThekadar: '  ',
      });

      expect(m).toMatchObject({
        name: 'Gang Saw 1',
        type: 'gangSaw',
        factoryId: own.id,
        dayThekadar: 'Rashid Khan',
        nightThekadar: null,
        isActive: true,
      });

      const night = await addMachine(own.id, {
        name: 'Vertical 2',
        nightThekadar: 'Bilal Ahmed',
      });
      expect(night.nightThekadar).toBe('Bilal Ahmed');
    });

    it('should refuse a cutting factory, an unknown factory and a duplicate name', async () => {
      await call('post', '/settings/machines', owner(), {
        name: 'Bad 1',
        type: 'vertical',
        factoryId: cutting.id,
        dayThekadar: 'X',
      }).expect(422);
      await call('post', '/settings/machines', owner(), {
        name: 'Bad 2',
        type: 'vertical',
        factoryId: '00000000-0000-4000-8000-000000000000',
        dayThekadar: 'X',
      }).expect(422);

      const dup = await call('post', '/settings/machines', owner(), {
        name: 'gang saw 1',
        type: 'vertical',
        factoryId: own.id,
        dayThekadar: 'X',
      }).expect(409);
      expect(codeOf(dup)).toBe('DUPLICATE_NAME');
    });

    it('should move a machine only to another own factory', async () => {
      const other = await addFactory({ name: 'Second Own' });
      const m = await addMachine(own.id, { name: 'Mover' });

      const moved = await call('patch', `/settings/machines/${m.id}`, owner(), {
        factoryId: other.id,
        nightThekadar: 'New Night',
      }).expect(200);
      expect(moved.body).toMatchObject({
        factoryId: other.id,
        nightThekadar: 'New Night',
      });

      await call('patch', `/settings/machines/${m.id}`, owner(), {
        factoryId: cutting.id,
      }).expect(422);

      const cleared = await call(
        'patch',
        `/settings/machines/${m.id}`,
        owner(),
        { nightThekadar: null },
      ).expect(200);
      expect((cleared.body as Machine).nightThekadar).toBeNull();
    });

    it('should not hide or change a factory that has machines in use', async () => {
      const f = await addFactory({ name: 'Busy Factory' });
      const m = await addMachine(f.id, { name: 'Busy Machine' });

      const hide = await call('patch', `/settings/factories/${f.id}`, owner(), {
        isActive: false,
      }).expect(409);
      expect(codeOf(hide)).toBe('FACTORY_HAS_MACHINES');
      await call('patch', `/settings/factories/${f.id}`, owner(), {
        kind: 'cutting',
      }).expect(409);

      await call('patch', `/settings/machines/${m.id}`, owner(), {
        isActive: false,
      }).expect(200);
      await call('patch', `/settings/factories/${f.id}`, owner(), {
        isActive: false,
      }).expect(200);

      const back = await call('patch', `/settings/machines/${m.id}`, owner(), {
        isActive: true,
      }).expect(409);
      expect(codeOf(back)).toBe('FACTORY_INACTIVE');
    });

    it('should list machines without the hidden ones', async () => {
      const list = await get<Machine[]>('/settings/machines');
      expect(list.every((m) => m.isActive)).toBe(true);
    });
  });

  describe('soot sizes, counter widths and expense categories', () => {
    it('should add, rename and hide an item', async () => {
      const created = await call('post', '/settings/soot-sizes', owner(), {
        name: '2 soot',
      }).expect(201);
      const id = (created.body as Item).id;

      const renamed = await call(
        'patch',
        `/settings/soot-sizes/${id}`,
        owner(),
        { name: '2 soot (thin)' },
      ).expect(200);
      expect((renamed.body as Item).name).toBe('2 soot (thin)');

      await call('patch', `/settings/soot-sizes/${id}`, owner(), {
        isActive: false,
      }).expect(200);
      expect(
        (await get<Item[]>('/settings/soot-sizes')).map((i) => i.id),
      ).not.toContain(id);
      expect(
        (await get<Item[]>('/settings/soot-sizes?includeInactive=true')).some(
          (i) => i.id === id,
        ),
      ).toBe(true);
    });

    it('should keep each list separate', async () => {
      // the same name is fine in another list, not in the same one
      await call('post', '/settings/counter-widths', owner(), {
        name: '2 soot (thin)',
      }).expect(201);
      const dup = await call('post', '/settings/counter-widths', owner(), {
        name: '2 INCH',
      }).expect(409);
      expect(codeOf(dup)).toBe('DUPLICATE_NAME');

      const widths = await get<Item[]>('/settings/counter-widths');
      const soot = await get<Item[]>('/settings/soot-sizes');
      await call('patch', `/settings/soot-sizes/${widths[0].id}`, owner(), {
        name: 'Cross list',
      }).expect(404);
      expect(soot.map((i) => i.id)).not.toContain(widths[0].id);
    });

    it('should add an expense category', async () => {
      const c = await call('post', '/settings/expense-categories', owner(), {
        name: 'Insurance',
      }).expect(201);
      expect(c.body).toMatchObject({ name: 'Insurance', isActive: true });
    });

    it('should refuse an unknown list', async () => {
      await call('get', '/settings/nonsense', owner()).expect(404);
      await call('post', '/settings/nonsense', owner(), { name: 'X' }).expect(
        404,
      );
    });
  });

  describe('worker rates', () => {
    it('should add a rate, with decimals, and edit it', async () => {
      const r = await call('post', '/settings/worker-rates', owner(), {
        name: 'Edge Polisher',
        payType: 'perSqft',
        rate: 6.5,
      }).expect(201);
      expect(r.body).toMatchObject({
        name: 'Edge Polisher',
        payType: 'perSqft',
        rate: 6.5,
        isActive: true,
      });

      const id = (r.body as Rate).id;
      const updated = await call(
        'patch',
        `/settings/worker-rates/${id}`,
        owner(),
        { rate: 7, payType: 'perTon' },
      ).expect(200);
      expect(updated.body).toMatchObject({ rate: 7, payType: 'perTon' });
    });

    it('should refuse a zero rate, an unknown pay type and a duplicate name', async () => {
      await call('post', '/settings/worker-rates', owner(), {
        name: 'Zero',
        payType: 'daily',
        rate: 0,
      }).expect(422);
      await call('post', '/settings/worker-rates', owner(), {
        name: 'Odd',
        payType: 'hourly',
        rate: 10,
      }).expect(422);
      const dup = await call('post', '/settings/worker-rates', owner(), {
        name: 'polisher',
        payType: 'perSqft',
        rate: 10,
      }).expect(409);
      expect(codeOf(dup)).toBe('DUPLICATE_NAME');
    });
  });

  describe('keeping companies apart', () => {
    it('should not show or change rows of another company', async () => {
      const mine = await addFactory({ name: 'Only A' });
      const m = await addMachine(mine.id, { name: 'Only A Machine' });

      const bFactories = await get<Factory[]>(
        '/settings/factories',
        B.ownerToken,
      );
      expect(bFactories.map((f) => f.id)).not.toContain(mine.id);
      expect(
        (await get<Machine[]>('/settings/machines', B.ownerToken)).map(
          (x) => x.id,
        ),
      ).not.toContain(m.id);

      await call('patch', `/settings/factories/${mine.id}`, B.ownerToken, {
        name: 'Hijack',
      }).expect(404);
      await call('patch', `/settings/machines/${m.id}`, B.ownerToken, {
        name: 'Hijack',
      }).expect(404);

      // B cannot put a machine into A's factory
      await call('post', '/settings/machines', B.ownerToken, {
        name: 'Sneaky',
        type: 'vertical',
        factoryId: mine.id,
        dayThekadar: 'X',
      }).expect(422);

      // and B has its own defaults, untouched
      expect(
        await get<Item[]>('/settings/soot-sizes', B.ownerToken),
      ).toHaveLength(3);
    });

    it('should allow the same names in two companies', async () => {
      await addFactory({ name: 'Shared Name' });
      await addFactory({ name: 'Shared Name' }, B.ownerToken);
    });

    it('should reject an id that is not a uuid', async () => {
      await call('patch', '/settings/factories/not-a-uuid', owner(), {
        name: 'X',
      }).expect(422);
    });
  });

  describe('the approval switch', () => {
    it('should be on by default and readable by everyone', async () => {
      for (const t of [viewer, munshi, manager, partner]) {
        const res = await call('get', '/company/settings', t.token).expect(200);
        expect(res.body).toEqual({ approvalRequired: true });
      }
    });

    it('should let only people with approvals.configure change it', async () => {
      await call('patch', '/company/settings', manager.token, {
        approvalRequired: false,
      }).expect(403);
      await call('patch', '/company/settings', viewer.token, {
        approvalRequired: false,
      }).expect(403);

      const off = await call('patch', '/company/settings', owner(), {
        approvalRequired: false,
      }).expect(200);
      expect(off.body).toEqual({ approvalRequired: false });
      expect(await get('/company/settings', munshi.token)).toEqual({
        approvalRequired: false,
      });

      await call('patch', '/company/settings', partner.token, {
        approvalRequired: true,
      }).expect(200);
    });

    it('should refuse a value that is not a boolean, and stay per company', async () => {
      await call('patch', '/company/settings', owner(), {
        approvalRequired: 'yes',
      }).expect(422);

      await call('patch', '/company/settings', owner(), {
        approvalRequired: false,
      }).expect(200);
      expect(await get('/company/settings', B.ownerToken)).toEqual({
        approvalRequired: true,
      });
    });
  });
});
