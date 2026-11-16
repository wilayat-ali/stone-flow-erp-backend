// End-to-end tests for company roles and permissions. They boot the whole app
// in-process, use the database from .env, create everything through the real
// API with unique "e2e-<run>" data, and delete it all afterwards.
//
//   npm run test:e2e -- roles
import { Harness, Member, Workspace } from '../utils/harness';

jest.setTimeout(120000);

type RoleBody = {
  key: string;
  name: string;
  description: string;
  permissions: string[];
  builtin: boolean;
  memberCount: number;
};

const codeOf = (res: { body: unknown }) => (res.body as { code?: string }).code;

describe('Roles & permissions (e2e)', () => {
  let h: Harness;
  let A: Workspace;
  let B: Workspace;
  let partner: Member;

  const call = (...args: Parameters<Harness['call']>) => h.call(...args);
  const owner = () => A.ownerToken;
  const roles = async (token = owner()) =>
    (await call('get', '/company/roles', token).expect(200)).body as RoleBody[];
  const role = async (key: string, token = owner()) =>
    (await roles(token)).find((r) => r.key === key);
  const create = (token: string, body: object) =>
    call('post', '/company/roles', token, body);

  beforeAll(async () => {
    h = await Harness.start();
    A = await h.createCompany('roles-a');
    B = await h.createCompany('roles-b');
    partner = await h.addMember(A, 'partner', 'PartnerRoles');
  });

  afterAll(async () => {
    await h.stop();
  });

  it('should seed the five roles with their permissions', async () => {
    const list = await roles();

    expect(list.map((r) => r.key).sort()).toEqual([
      'manager',
      'munshi',
      'owner',
      'partner',
      'viewer',
    ]);
    expect(list.every((r) => r.builtin)).toBe(true);
    expect(list.find((r) => r.key === 'owner')!.permissions).toContain(
      'roles.manage',
    );
    expect(list.find((r) => r.key === 'viewer')!.permissions).toEqual(
      expect.arrayContaining(['dashboard.view']),
    );
    expect(list.find((r) => r.key === 'partner')!.permissions).not.toContain(
      'roles.manage',
    );
    expect(list.find((r) => r.key === 'partner')!.memberCount).toBe(1);
  });

  it("should return the caller's permissions with /company/me", async () => {
    const mine = await call('get', '/company/me', owner()).expect(200);
    const theirs = await call('get', '/company/me', partner.token).expect(200);

    const perms = (res: { body: unknown }) =>
      (res.body as { me: { permissions: string[] } }).me.permissions;
    expect(perms(mine)).toContain('roles.manage');
    expect(perms(theirs)).toContain('users.manage');
    expect(perms(theirs)).not.toContain('roles.manage');
  });

  describe('creating a role', () => {
    it('should create a custom role with a key made from its name', async () => {
      const res = await create(owner(), {
        name: 'Accountant',
        description: 'Keeps the books',
        permissions: ['expenses.view', 'dashboard.view', 'expenses.view'],
      }).expect(201);

      expect(res.body).toMatchObject({
        key: 'accountant',
        name: 'Accountant',
        description: 'Keeps the books',
        builtin: false,
        memberCount: 0,
        // known ids only, once each, in catalog order
        permissions: ['dashboard.view', 'expenses.view'],
      });
    });

    it('should refuse a name that is taken, ignoring case', async () => {
      const res = await create(owner(), {
        name: 'ACCOUNTANT',
        permissions: ['dashboard.view'],
      }).expect(409);
      expect(codeOf(res)).toBe('NAME_TAKEN');

      const builtin = await create(owner(), {
        name: 'manager',
        permissions: ['dashboard.view'],
      }).expect(409);
      expect(codeOf(builtin)).toBe('NAME_TAKEN');
    });

    it('should refuse an empty name, no permissions and unknown permissions', async () => {
      expect(
        codeOf(
          await create(owner(), {
            name: '  ',
            permissions: ['dashboard.view'],
          }).expect(400),
        ),
      ).toBe('NAME_REQUIRED');
      expect(
        codeOf(
          await create(owner(), { name: 'Empty', permissions: [] }).expect(400),
        ),
      ).toBe('PERMISSIONS_REQUIRED');
      expect(
        codeOf(
          await create(owner(), {
            name: 'Odd',
            permissions: ['dashboard.view', 'nope.view'],
          }).expect(400),
        ),
      ).toBe('INVALID_PERMISSION');
    });

    it('should keep roles apart between companies', async () => {
      await create(B.ownerToken, {
        name: 'Accountant',
        permissions: ['dashboard.view'],
      }).expect(201);

      expect((await roles(B.ownerToken)).map((r) => r.key)).toContain(
        'accountant',
      );
      await call('patch', '/company/roles/zzz-not-here', B.ownerToken, {
        name: 'X',
        permissions: ['dashboard.view'],
      }).expect(404);
    });

    it('should not let a partner (no roles.manage) create, edit or delete', async () => {
      await create(partner.token, {
        name: 'Sneaky',
        permissions: ['dashboard.view'],
      }).expect(403);
      await call('patch', '/company/roles/accountant', partner.token, {
        name: 'Accountant',
        permissions: ['dashboard.view'],
      }).expect(403);
      await call('delete', '/company/roles/accountant', partner.token).expect(
        403,
      );
      // but the list is readable (the invite sheet needs it)
      await roles(partner.token);
    });
  });

  describe('using a custom role', () => {
    let accountant: Member;

    beforeAll(async () => {
      accountant = await h.addMember(A, 'accountant', 'Accountant1');
    });

    it('should give the person exactly the role permissions', async () => {
      const me = await call('get', '/company/me', accountant.token).expect(200);
      expect(
        (me.body as { me: { roleKey: string; permissions: string[] } }).me,
      ).toMatchObject({
        roleKey: 'accountant',
        permissions: ['dashboard.view', 'expenses.view'],
      });

      await call('get', '/company/members', accountant.token).expect(403);
      await call('get', '/company/roles', accountant.token).expect(403);
    });

    it('should apply an edit at once, with no new login', async () => {
      await call('patch', '/company/roles/accountant', owner(), {
        name: 'Accountant',
        description: 'Keeps the books',
        permissions: ['dashboard.view', 'expenses.view', 'users.view'],
      }).expect(200);

      await call('get', '/company/members', accountant.token).expect(200);
      // view only: still cannot invite
      await call('post', '/company/invitations', accountant.token, {
        phone: '03001234567',
        roleKey: 'viewer',
      }).expect(403);
    });

    it('should list how many people have the role', async () => {
      expect((await role('accountant'))!.memberCount).toBe(1);
    });

    it('should refuse to delete a role that people still have', async () => {
      const res = await call(
        'delete',
        '/company/roles/accountant',
        owner(),
      ).expect(409);
      expect(codeOf(res)).toBe('ROLE_IN_USE');
    });

    it('should delete it once nobody has it', async () => {
      await call(
        'patch',
        `/company/members/${accountant.memberId}/role`,
        owner(),
        { roleKey: 'viewer' },
      ).expect(200);

      await call('delete', '/company/roles/accountant', owner()).expect(204);
      expect(await role('accountant')).toBeUndefined();
      // company B's role of the same name is untouched
      expect(await role('accountant', B.ownerToken)).toBeDefined();
    });
  });

  describe('protecting the owner and limiting power', () => {
    it('should never change or delete the owner role', async () => {
      const edit = await call('patch', '/company/roles/owner', owner(), {
        name: 'Boss',
        permissions: ['dashboard.view'],
      }).expect(403);
      expect(codeOf(edit)).toBe('OWNER_LOCKED');

      const del = await call('delete', '/company/roles/owner', owner()).expect(
        403,
      );
      expect(codeOf(del)).toBe('OWNER_LOCKED');
    });

    it('should let the owner edit and rename a builtin role', async () => {
      const res = await call('patch', '/company/roles/viewer', owner(), {
        name: 'Observer',
        description: 'Looks only',
        permissions: ['dashboard.view', 'sales.view'],
      }).expect(200);

      expect(res.body).toMatchObject({
        key: 'viewer',
        name: 'Observer',
        builtin: true,
        permissions: ['dashboard.view', 'sales.view'],
      });
    });

    it('should not let a role manager grant what they do not hold, or edit their own role', async () => {
      await create(owner(), {
        name: 'Role admin',
        permissions: ['dashboard.view', 'roles.manage', 'roles.view'],
      }).expect(201);
      const admin = await h.addMember(A, 'role-admin', 'RoleAdmin1');

      const grant = await create(admin.token, {
        name: 'Greedy',
        permissions: ['dashboard.view', 'settings.view'],
      }).expect(403);
      expect(codeOf(grant)).toBe('PERMISSION_NOT_HELD');

      const own = await call(
        'patch',
        '/company/roles/role-admin',
        admin.token,
        {
          name: 'Role admin',
          permissions: ['dashboard.view', 'roles.manage', 'roles.view'],
        },
      ).expect(403);
      expect(codeOf(own)).toBe('FORBIDDEN');

      await call('patch', '/company/roles/partner', admin.token, {
        name: 'Partner',
        permissions: ['dashboard.view'],
      }).expect(403);

      // within what they hold, they may create a smaller role
      await create(admin.token, {
        name: 'Glancer',
        permissions: ['dashboard.view'],
      }).expect(201);
    });
  });

  describe('inviting and changing roles', () => {
    it('should accept any company role key, not only the five', async () => {
      await create(owner(), {
        name: 'Cashier',
        permissions: ['dashboard.view', 'expenses.create'],
      }).expect(201);

      await call('post', '/company/invitations', owner(), {
        phone: '03007654321',
        roleKey: 'cashier',
      }).expect(201);
    });

    it('should refuse owner and unknown role keys', async () => {
      await call('post', '/company/invitations', owner(), {
        phone: '03001112222',
        roleKey: 'owner',
      }).expect(422);
      await call('post', '/company/invitations', owner(), {
        phone: '03001112222',
        roleKey: 'nobody-has-this',
      }).expect(422);
    });

    it('should not let a partner assign a role as strong as their own', async () => {
      await call('post', '/company/invitations', partner.token, {
        phone: '03001113333',
        roleKey: 'partner',
      }).expect(403);
      await call('post', '/company/invitations', partner.token, {
        phone: '03001113333',
        roleKey: 'manager',
      }).expect(201);
    });

    it("should not let a company use another company's role", async () => {
      await create(B.ownerToken, {
        name: 'Only in B',
        permissions: ['dashboard.view'],
      }).expect(201);

      await call('post', '/company/invitations', owner(), {
        phone: '03001114444',
        roleKey: 'only-in-b',
      }).expect(422);
    });
  });
});
