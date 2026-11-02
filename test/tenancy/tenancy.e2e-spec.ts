// End-to-end tests for multi-tenancy. They boot the whole app in-process (no
// running server needed), use the database from .env, create everything through
// the real API with unique "e2e-<run>" data, and delete it all afterwards.
//
//   npm run test:e2e -- tenancy
import {
  ClassSerializerInterceptor,
  Controller,
  Get,
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import { useContainer } from 'class-validator';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { LoginThrottleService } from '../../src/auth/login-throttle.service';
import { InviteNotifier } from '../../src/notifications/invite.notifier';
import { CompanyAuth } from '../../src/tenancy/decorators/company-auth.decorator';
import { CompanyRoles } from '../../src/tenancy/decorators/company-roles.decorator';
import { Platform } from '../../src/tenancy/decorators/platform.decorator';
import { Tenant, TenantContext } from '../../src/tenancy/tenant-context';
import { ResolvePromisesInterceptor } from '../../src/utils/serializer.interceptor';
import validationOptions from '../../src/utils/validation-options';

// Real guards on throw-away routes, so platform and role checks can be tested
// without shipping test endpoints.
@Controller({ path: 'probe', version: '1' })
class ProbeController {
  @Get('factory')
  @CompanyAuth()
  @Platform('factory')
  factory(@Tenant() tenant: TenantContext) {
    return { companyId: tenant.companyId };
  }

  @Get('owner-only')
  @CompanyAuth()
  @CompanyRoles('owner')
  ownerOnly() {
    return { ok: true };
  }
}

jest.setTimeout(60000);

const RUN = Date.now().toString(36);
const PASSWORD = 'pass1234';

describe('Multi-tenancy (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  const notifier = {
    isEnabled: jest.fn(() => true),
    sendInvitation: jest.fn(() => Promise.resolve()),
    sendPasswordLink: jest.fn(() => Promise.resolve()),
  };

  const phones: string[] = [];
  const emails: string[] = [];
  const adminIds: string[] = [];
  let phoneCounter = 0;
  const phoneBase = 100000000 + Math.floor(Math.random() * 800000000);

  const nextPhone = () => {
    const local = '03' + String(phoneBase + ++phoneCounter).padStart(9, '0');
    phones.push('+92' + local.slice(1));
    return local;
  };
  const e164 = (local: string) => '+92' + local.slice(1);
  const nextEmail = (tag: string) => {
    const email = `e2e-${RUN}-${tag}@e2e.test`;
    emails.push(email);
    return email;
  };

  const http = () => request(app.getHttpServer());
  const call = (
    method: 'get' | 'post' | 'patch' | 'put' | 'delete',
    path: string,
    token?: string,
    body?: object,
  ) => {
    let req = http()[method](`/api/v1${path}`);
    if (token) req = req.set('Authorization', `Bearer ${token}`);
    return body ? req.send(body) : req;
  };
  const tokenOf = (link: string) =>
    new URL(link, 'http://x').searchParams.get('token')!;

  let saToken: string;
  let supportToken: string;

  type Workspace = {
    id: string;
    slug: string;
    ownerPhone: string;
    ownerToken: string;
    ownerMemberId: string;
  };
  let A: Workspace;
  let B: Workspace;

  const login = (slug: string, identifier: string, password = PASSWORD) =>
    call('post', '/auth/workspace/login', undefined, {
      slug,
      identifier,
      password,
    });

  async function createCompany(
    tag: string,
    platforms: string[],
  ): Promise<Workspace> {
    const slug = `e2e-${RUN}-${tag}`;
    const ownerPhone = nextPhone();
    const created = await call('post', '/superadmin/companies', saToken, {
      name: `E2E ${tag}`,
      slug,
      platforms,
      owner: { firstName: `Owner${tag}`, phone: ownerPhone },
    }).expect(201);

    const accepted = await call('post', '/auth/invitations/accept', undefined, {
      token: tokenOf(created.body.invite.inviteLink),
      firstName: `Owner${tag}`,
      password: PASSWORD,
    }).expect(200);

    const me = await call('get', '/company/me', accepted.body.token).expect(
      200,
    );

    return {
      id: created.body.company.id,
      slug,
      ownerPhone,
      ownerToken: accepted.body.token,
      ownerMemberId: me.body.me.memberId,
    };
  }

  // Owner invites a brand-new person; they accept and are logged in.
  async function addNewMember(
    owner: Workspace,
    roleKey: string,
    tag: string,
    by: 'phone' | 'email' = 'phone',
  ) {
    const phone = by === 'phone' ? nextPhone() : undefined;
    const email = by === 'email' ? nextEmail(tag) : undefined;
    const invite = await call(
      'post',
      '/company/invitations',
      owner.ownerToken,
      {
        phone,
        email,
        roleKey,
      },
    ).expect(201);
    const accepted = await call('post', '/auth/invitations/accept', undefined, {
      token: tokenOf(invite.body.inviteLink),
      firstName: tag,
      password: PASSWORD,
    }).expect(200);
    const me = await call('get', '/company/me', accepted.body.token).expect(
      200,
    );

    return {
      phone,
      email,
      token: accepted.body.token as string,
      refreshToken: accepted.body.refreshToken as string,
      memberId: me.body.me.memberId as string,
      userId: accepted.body.user.id as number,
    };
  }

  const clearThrottle = () =>
    (
      app.get(LoginThrottleService) as unknown as {
        buckets: Map<string, unknown>;
      }
    ).buckets.clear();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
    })
      .overrideProvider(InviteNotifier)
      .useValue(notifier)
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    useContainer(app.select(AppModule), { fallbackOnErrors: true });
    app.setGlobalPrefix('api', { exclude: ['/'] });
    app.enableVersioning({ type: VersioningType.URI });
    app.useGlobalPipes(new ValidationPipe(validationOptions));
    app.useGlobalInterceptors(
      new ResolvePromisesInterceptor(),
      new ClassSerializerInterceptor(app.get(Reflector)),
    );
    await app.init();
    db = app.get(DataSource);

    // Two platform admins of our own, so the tests do not depend on seed data.
    const hash = await bcrypt.hash(PASSWORD, 10);
    for (const role of ['super_admin', 'support']) {
      const email = `e2e-${RUN}-${role}@e2e.test`;
      const [row] = await db.query(
        `insert into super_admin(name, email, "passwordHash", role, status) values ($1,$2,$3,$4,'active') returning id`,
        [`E2E ${role}`, email, hash, role],
      );
      adminIds.push(row.id);
      const res = await call('post', '/superadmin/auth/login', undefined, {
        email,
        password: PASSWORD,
      }).expect(200);
      if (role === 'super_admin') saToken = res.body.token;
      else supportToken = res.body.token;
    }

    A = await createCompany('a', ['factory', 'showroom']);
    B = await createCompany('b', ['showroom']);
  }, 120000);

  beforeEach(() => clearThrottle());

  afterAll(async () => {
    const companies: { id: string }[] = await db.query(
      `select id from company where slug like $1`,
      [`e2e-${RUN}-%`],
    );
    const companyIds = companies.map((c) => c.id);
    const users: { id: number }[] = await db.query(
      `select id from "user" where phone = any($1) or email = any($2)`,
      [phones, emails],
    );
    const userIds = users.map((u) => u.id);

    await db.query(`delete from audit_log where "companyId" = any($1)`, [
      companyIds,
    ]);
    await db.query(`delete from session where "userId" = any($1)`, [userIds]);
    await db.query(
      `delete from company_invitation where "companyId" = any($1)`,
      [companyIds],
    );
    await db.query(`delete from company_member where "companyId" = any($1)`, [
      companyIds,
    ]);
    await db.query(`delete from company_role where "companyId" = any($1)`, [
      companyIds,
    ]);
    await db.query(`delete from company_platform where "companyId" = any($1)`, [
      companyIds,
    ]);
    await db.query(`delete from company where id = any($1)`, [companyIds]);
    await db.query(`delete from "user" where id = any($1)`, [userIds]);
    await db.query(`delete from super_admin where id = any($1)`, [adminIds]);
    await app.close();
  }, 60000);

  // ------------------------------------------------------------------ login
  describe('workspace login', () => {
    it('should log in by phone in 03XX and +92 formats as the same user', async () => {
      const a = await login(A.slug, A.ownerPhone).expect(200);
      const b = await login(A.slug, e164(A.ownerPhone)).expect(200);

      expect(a.body.user.id).toBe(b.body.user.id);
      expect(a.body.user.password).toBeUndefined();
    });

    it('should log in by email, case-insensitively', async () => {
      const m = await addNewMember(A, 'manager', 'emailmgr', 'email');

      await login(A.slug, m.email!.toUpperCase()).expect(200);
    });

    it('should return a company-scoped token', async () => {
      const res = await login(A.slug, A.ownerPhone).expect(200);
      const claims = JSON.parse(
        Buffer.from(res.body.token.split('.')[1], 'base64url').toString(),
      );

      expect(claims).toMatchObject({
        typ: 'user',
        companyId: A.id,
        memberId: A.ownerMemberId,
        roleKey: 'owner',
      });
    });

    it('should give the same error for every kind of failure', async () => {
      const munshi = await addNewMember(A, 'munshi', 'failcases');
      await call(
        'post',
        `/company/members/${munshi.memberId}/deactivate`,
        A.ownerToken,
      ).expect(200);

      const suspended = await createCompany('susp', ['factory']);
      await call(
        'patch',
        `/superadmin/companies/${suspended.id}/suspend`,
        saToken,
      ).expect(200);

      const failures = [
        await login(A.slug, A.ownerPhone, 'wrong-password'),
        await login(A.slug, nextPhone()),
        await login(A.slug, B.ownerPhone), // exists, but not a member of A
        await login(A.slug, munshi.phone!), // inactive member
        await login(suspended.slug, suspended.ownerPhone), // suspended company
        await login('e2e-no-such-company', A.ownerPhone),
        await login(A.slug, 'not-a-phone'),
      ];

      const signatures = new Set(
        failures.map((f) => `${f.status} ${JSON.stringify(f.body)}`),
      );

      expect(signatures.size).toBe(1);
      expect(failures[0].status).toBe(401);
    });

    it('should lock an identifier after 5 failures and share it across phone formats', async () => {
      const target = (await addNewMember(A, 'viewer', 'locked')).phone!;

      for (let i = 0; i < 5; i++) {
        await login(A.slug, target, `wrong-${i}`).expect(401);
      }

      await login(A.slug, target).expect(429);
      await login(A.slug, e164(target)).expect(429);
      await login(A.slug, A.ownerPhone).expect(200);
    });
  });

  // ---------------------------------------------------------------- switch
  describe('companies and switching', () => {
    it('should only switch into companies where the user is an active member', async () => {
      const multi = await addNewMember(A, 'munshi', 'multi');

      // B's owner invites the same person; they accept with their own password.
      const invite = await call('post', '/company/invitations', B.ownerToken, {
        phone: multi.phone,
        roleKey: 'manager',
      }).expect(201);
      await call('post', '/auth/invitations/accept-existing', multi.token, {
        token: tokenOf(invite.body.inviteLink),
      }).expect(200);

      const companies = await call(
        'get',
        '/auth/companies',
        multi.token,
      ).expect(200);
      expect(
        companies.body.map((c: { slug: string }) => c.slug).sort(),
      ).toEqual([A.slug, B.slug].sort());

      const switched = await call('post', '/auth/switch-company', multi.token, {
        companyId: B.id,
      }).expect(200);
      const claims = JSON.parse(
        Buffer.from(switched.body.token.split('.')[1], 'base64url').toString(),
      );
      expect(claims).toMatchObject({ companyId: B.id, roleKey: 'manager' });

      const outsider = await createCompany('c', ['factory']);
      await call('post', '/auth/switch-company', multi.token, {
        companyId: outsider.id,
      }).expect(403);

      // deactivated in B: B disappears from the list and switching is refused
      const members = await call(
        'get',
        '/company/members',
        B.ownerToken,
      ).expect(200);
      const inB = members.body.find(
        (m: { phone: string }) => m.phone === e164(multi.phone!),
      );
      await call(
        'post',
        `/company/members/${inB.memberId}/deactivate`,
        B.ownerToken,
      ).expect(200);
      await call('post', '/auth/switch-company', multi.token, {
        companyId: B.id,
      }).expect(403);
      const after = await call('get', '/auth/companies', multi.token).expect(
        200,
      );
      expect(after.body).toHaveLength(1);
    });

    it('should keep the company on refresh and end every company on logout', async () => {
      const m = await addNewMember(A, 'munshi', 'session');
      const refreshed = await call(
        'post',
        '/auth/refresh',
        m.refreshToken,
      ).expect(200);
      const claims = JSON.parse(
        Buffer.from(refreshed.body.token.split('.')[1], 'base64url').toString(),
      );
      expect(claims.companyId).toBe(A.id);

      await call('post', '/auth/logout', refreshed.body.token).expect(204);
      await call('post', '/auth/refresh', refreshed.body.refreshToken).expect(
        401,
      );
    });
  });

  // -------------------------------------------------------- tenant isolation
  describe('tenant isolation', () => {
    it('should list only the caller company members', async () => {
      const a = await call('get', '/company/members', A.ownerToken).expect(200);
      const b = await call('get', '/company/members', B.ownerToken).expect(200);

      const aPhones = a.body.map((m: { phone: string }) => m.phone);
      expect(aPhones).toContain(e164(A.ownerPhone));
      expect(aPhones).not.toContain(e164(B.ownerPhone));
      expect(b.body.map((m: { phone: string }) => m.phone)).not.toContain(
        e164(A.ownerPhone),
      );
    });

    it('should treat another company member id as not found for every write', async () => {
      const bMunshi = await addNewMember(B, 'munshi', 'bvictim');
      const pending = await call('post', '/company/invitations', B.ownerToken, {
        phone: nextPhone(),
        roleKey: 'viewer',
      }).expect(201);

      const base = `/company/members/${bMunshi.memberId}`;
      await call('post', `${base}/deactivate`, A.ownerToken).expect(404);
      await call('post', `${base}/activate`, A.ownerToken).expect(404);
      await call('patch', `${base}/role`, A.ownerToken, {
        roleKey: 'viewer',
      }).expect(404);
      await call('post', `${base}/reset-link`, A.ownerToken).expect(404);
      await call(
        'delete',
        `/company/invitations/${pending.body.invitationId}`,
        A.ownerToken,
      ).expect(404);

      // and B's munshi is untouched
      await login(B.slug, bMunshi.phone!).expect(200);
    });

    it('should ignore a companyId sent in the body', async () => {
      const phone = nextPhone();
      const res = await call('post', '/company/invitations', A.ownerToken, {
        phone,
        roleKey: 'viewer',
        companyId: B.id,
        company: { id: B.id },
      }).expect(201);

      const inA = await call(
        'get',
        '/company/invitations',
        A.ownerToken,
      ).expect(200);
      const inB = await call(
        'get',
        '/company/invitations',
        B.ownerToken,
      ).expect(200);

      expect(inA.body.map((i: { id: string }) => i.id)).toContain(
        res.body.invitationId,
      );
      expect(inB.body.map((i: { id: string }) => i.id)).not.toContain(
        res.body.invitationId,
      );
    });
  });

  // ------------------------------------------------------------- token types
  describe('token types', () => {
    it('should reject a super admin token on company routes and the reverse', async () => {
      await call('get', '/company/me', saToken).expect(401);
      await call('get', '/auth/me', saToken).expect(401);
      await call('get', '/superadmin/companies', A.ownerToken).expect(401);
      await call('get', '/superadmin/companies').expect(401);
    });

    it('should reject a user token that has no company on company routes', async () => {
      const legacy = await call('post', '/auth/email/login', undefined, {
        email: 'admin@example.com',
        password: 'secret',
      }).expect(200);

      await call('get', '/auth/me', legacy.body.token).expect(200);
      await call('get', '/company/me', legacy.body.token).expect(403);
    });
  });

  // ----------------------------------------------------------- roles & guards
  describe('roles', () => {
    it('should return 403 to a munshi on owner and partner routes', async () => {
      const munshi = await addNewMember(A, 'munshi', 'roleguard');

      await call('get', '/company/me', munshi.token).expect(200);
      await call('get', '/company/members', munshi.token).expect(403);
      await call('post', '/company/invitations', munshi.token, {
        phone: nextPhone(),
        roleKey: 'viewer',
      }).expect(403);
      await call('get', '/probe/owner-only', munshi.token).expect(403);
      await call('get', '/probe/owner-only', A.ownerToken).expect(200);
    });

    it('should apply a demotion immediately without logging in again', async () => {
      const manager = await addNewMember(A, 'manager', 'demote');

      await call('get', '/company/members', manager.token).expect(200);
      await call(
        'patch',
        `/company/members/${manager.memberId}/role`,
        A.ownerToken,
        {
          roleKey: 'viewer',
        },
      ).expect(200);
      await call('get', '/company/members', manager.token).expect(403);
    });

    it('should cut access immediately when a member is deactivated or the company suspended', async () => {
      const m = await addNewMember(A, 'munshi', 'cutoff');

      await call(
        'post',
        `/company/members/${m.memberId}/deactivate`,
        A.ownerToken,
      ).expect(200);
      await call('get', '/company/me', m.token).expect(401);

      const temp = await createCompany('temp', ['factory']);
      await call('get', '/company/me', temp.ownerToken).expect(200);
      await call(
        'patch',
        `/superadmin/companies/${temp.id}/suspend`,
        saToken,
      ).expect(200);
      await call('get', '/company/me', temp.ownerToken).expect(401);
      await call(
        'patch',
        `/superadmin/companies/${temp.id}/reactivate`,
        saToken,
      ).expect(200);
      await call('get', '/company/me', temp.ownerToken).expect(200);
    });
  });

  // --------------------------------------------------------- owner protection
  describe('owner protection', () => {
    it('should protect the owner from everyone, including themselves', async () => {
      const partner = await addNewMember(A, 'partner', 'prot-partner');
      const owner = `/company/members/${A.ownerMemberId}`;

      await call('post', `${owner}/deactivate`, A.ownerToken).expect(422); // self
      await call('post', `${owner}/deactivate`, partner.token).expect(403);
      await call('patch', `${owner}/role`, partner.token, {
        roleKey: 'viewer',
      }).expect(403);
      await call('post', `${owner}/reset-link`, partner.token).expect(403);
    });

    it('should never allow inviting or promoting someone to owner', async () => {
      const munshi = await addNewMember(A, 'munshi', 'prot-munshi');

      await call('post', '/company/invitations', A.ownerToken, {
        phone: nextPhone(),
        roleKey: 'owner',
      }).expect(422);
      await call(
        'patch',
        `/company/members/${munshi.memberId}/role`,
        A.ownerToken,
        {
          roleKey: 'owner',
        },
      ).expect(422);
    });

    it('should stop a partner from managing another partner or inviting one', async () => {
      const p1 = await addNewMember(A, 'partner', 'pp1');
      const p2 = await addNewMember(A, 'partner', 'pp2');

      await call(
        'post',
        `/company/members/${p2.memberId}/deactivate`,
        p1.token,
      ).expect(403);
      await call('post', '/company/invitations', p1.token, {
        phone: nextPhone(),
        roleKey: 'partner',
      }).expect(403);
      await call('post', '/company/invitations', p1.token, {
        phone: nextPhone(),
        roleKey: 'munshi',
      }).expect(201);
    });
  });

  // -------------------------------------------------------------- invitations
  describe('invitations', () => {
    it('should link an existing account without changing its password', async () => {
      const person = await addNewMember(A, 'munshi', 'keeppw');

      const invite = await call('post', '/company/invitations', B.ownerToken, {
        phone: person.phone,
        roleKey: 'munshi',
      }).expect(201);
      const token = tokenOf(invite.body.inviteLink);

      // a public accept must not take over an account that has a password
      await call('post', '/auth/invitations/accept', undefined, {
        token,
        firstName: 'Intruder',
        password: 'intruder-pass',
      }).expect(409);

      // someone else logged in cannot use the link
      await call('post', '/auth/invitations/accept-existing', B.ownerToken, {
        token,
      }).expect(403);

      await call('post', '/auth/invitations/accept-existing', person.token, {
        token,
      }).expect(200);

      await login(A.slug, person.phone!).expect(200);
      await login(B.slug, person.phone!).expect(200);
      await login(B.slug, person.phone!, 'intruder-pass').expect(401);
    });

    it('should answer the same whether or not the person already has an account', async () => {
      const known = await addNewMember(A, 'munshi', 'shape');

      const forExisting = await call(
        'post',
        '/company/invitations',
        B.ownerToken,
        {
          phone: known.phone,
          roleKey: 'viewer',
        },
      ).expect(201);
      const forNew = await call('post', '/company/invitations', B.ownerToken, {
        phone: nextPhone(),
        roleKey: 'viewer',
      }).expect(201);

      expect(Object.keys(forExisting.body).sort()).toEqual(
        Object.keys(forNew.body).sort(),
      );
    });

    it('should return a wa.me link and queue email only when an email is given', async () => {
      notifier.sendInvitation.mockClear();

      const byPhone = await call('post', '/company/invitations', A.ownerToken, {
        phone: nextPhone(),
        roleKey: 'viewer',
      }).expect(201);
      expect(byPhone.body.whatsappLink).toMatch(
        /^https:\/\/wa\.me\/92\d+\?text=/,
      );
      expect(byPhone.body.emailQueued).toBe(false);
      expect(notifier.sendInvitation).not.toHaveBeenCalled();

      const byEmail = await call('post', '/company/invitations', A.ownerToken, {
        email: nextEmail('mailed'),
        roleKey: 'viewer',
      }).expect(201);
      expect(byEmail.body.emailQueued).toBe(true);
      expect(notifier.sendInvitation).toHaveBeenCalledTimes(1);
    });

    it('should make links single-use, expiring and revocable', async () => {
      const invite = await call('post', '/company/invitations', A.ownerToken, {
        phone: nextPhone(),
        roleKey: 'munshi',
      }).expect(201);
      const token = tokenOf(invite.body.inviteLink);
      const body = { token, firstName: 'Once', password: PASSWORD };

      await call('get', `/auth/invitations/info?token=${token}`).expect(200);
      await call('post', '/auth/invitations/accept', undefined, body).expect(
        200,
      );
      await call('post', '/auth/invitations/accept', undefined, body).expect(
        404,
      );
      await call('get', `/auth/invitations/info?token=${token}`).expect(404);

      const expired = await call('post', '/company/invitations', A.ownerToken, {
        phone: nextPhone(),
        roleKey: 'munshi',
      }).expect(201);
      await db.query(
        `update company_invitation set "expiresAt" = now() - interval '1 minute' where id = $1`,
        [expired.body.invitationId],
      );
      await call('post', '/auth/invitations/accept', undefined, {
        ...body,
        token: tokenOf(expired.body.inviteLink),
      }).expect(404);

      const revoked = await call('post', '/company/invitations', A.ownerToken, {
        phone: nextPhone(),
        roleKey: 'munshi',
      }).expect(201);
      await call(
        'delete',
        `/company/invitations/${revoked.body.invitationId}`,
        A.ownerToken,
      ).expect(200);
      await call('post', '/auth/invitations/accept', undefined, {
        ...body,
        token: tokenOf(revoked.body.inviteLink),
      }).expect(404);
    });

    it('should refuse to invite someone who is already a member', async () => {
      const m = await addNewMember(A, 'munshi', 'dupe');

      await call('post', '/company/invitations', A.ownerToken, {
        phone: m.phone,
        roleKey: 'viewer',
      }).expect(422);
    });

    it('should replace an older pending invite for the same person', async () => {
      const phone = nextPhone();
      const first = await call('post', '/company/invitations', A.ownerToken, {
        phone,
        roleKey: 'munshi',
      }).expect(201);
      await call('post', '/company/invitations', A.ownerToken, {
        phone,
        roleKey: 'munshi',
      }).expect(201);

      await call('post', '/auth/invitations/accept', undefined, {
        token: tokenOf(first.body.inviteLink),
        firstName: 'Old',
        password: PASSWORD,
      }).expect(404);
    });
  });

  // -------------------------------------------------------------- reset links
  describe('password reset links', () => {
    it('should let the owner reset a munshi, who then sets their own password', async () => {
      const munshi = await addNewMember(A, 'munshi', 'forgot');

      const reset = await call(
        'post',
        `/company/members/${munshi.memberId}/reset-link`,
        A.ownerToken,
      ).expect(200);
      expect(reset.body.whatsappLink).toContain('https://wa.me/');

      await call('post', '/auth/invitations/reset-password', undefined, {
        token: tokenOf(reset.body.resetLink),
        password: 'brand-new-pass',
      }).expect(204);

      await login(A.slug, munshi.phone!, PASSWORD).expect(401);
      await login(A.slug, munshi.phone!, 'brand-new-pass').expect(200);
      // every old session is gone
      await call('post', '/auth/refresh', munshi.refreshToken).expect(401);
      // the link is single-use
      await call('post', '/auth/invitations/reset-password', undefined, {
        token: tokenOf(reset.body.resetLink),
        password: 'another-pass',
      }).expect(404);
    });

    it('should not let a company reset someone who also works in another company', async () => {
      const multi = await addNewMember(A, 'munshi', 'shared');
      const invite = await call('post', '/company/invitations', B.ownerToken, {
        phone: multi.phone,
        roleKey: 'munshi',
      }).expect(201);
      await call('post', '/auth/invitations/accept-existing', multi.token, {
        token: tokenOf(invite.body.inviteLink),
      }).expect(200);

      await call(
        'post',
        `/company/members/${multi.memberId}/reset-link`,
        A.ownerToken,
      ).expect(409);

      // support can, and it is audit-logged
      const reset = await call(
        'post',
        `/superadmin/companies/${A.id}/members/${multi.memberId}/reset-link`,
        supportToken,
      ).expect(200);
      expect(reset.body.resetLink).toContain('/reset-password?token=');

      const logged = await db.query(
        `select "actorType" from audit_log where "companyId" = $1 and action = 'member.reset_link' and "targetId" = $2`,
        [A.id, multi.memberId],
      );
      expect(logged.map((r: { actorType: string }) => r.actorType)).toContain(
        'superadmin',
      );
    });

    it('should let support issue a reset for an owner, but not change data', async () => {
      await call(
        'post',
        `/superadmin/companies/${A.id}/members/${A.ownerMemberId}/reset-link`,
        supportToken,
      ).expect(200);

      await call('post', '/superadmin/companies', supportToken, {}).expect(403);
      await call(
        'patch',
        `/superadmin/companies/${A.id}/suspend`,
        supportToken,
      ).expect(403);
    });
  });

  // -------------------------------------------------------------- platforms
  describe('platforms', () => {
    it('should enforce enabled platforms per company', async () => {
      await call('get', '/probe/factory', A.ownerToken).expect(200);

      const denied = await call('get', '/probe/factory', B.ownerToken).expect(
        403,
      );
      expect(denied.body.reason).toBe('PLATFORM_NOT_ENABLED');

      await call(
        'put',
        `/superadmin/companies/${A.id}/platforms/factory`,
        saToken,
        {
          isEnabled: false,
        },
      ).expect(200);
      await call('get', '/probe/factory', A.ownerToken).expect(403);

      await call(
        'put',
        `/superadmin/companies/${A.id}/platforms/factory`,
        saToken,
        {
          isEnabled: true,
        },
      ).expect(200);
      await call('get', '/probe/factory', A.ownerToken).expect(200);

      await call(
        'put',
        `/superadmin/companies/${A.id}/platforms/spaceship`,
        saToken,
        {
          isEnabled: true,
        },
      ).expect(404);
    });

    it('should report enabled platforms on /company/me', async () => {
      const me = await call('get', '/company/me', A.ownerToken).expect(200);

      expect(me.body.platforms).toEqual({
        factory: true,
        showroom: true,
        mine: false,
      });
    });
  });

  // -------------------------------------------------------- super admin area
  describe('super admin', () => {
    const valid = () => ({
      name: 'Validation Co',
      slug: `e2e-${RUN}-valid`,
      platforms: ['factory'],
      owner: { firstName: 'Val', phone: nextPhone() },
    });

    it('should reject bad company input', async () => {
      const post = (body: object) =>
        call('post', '/superadmin/companies', saToken, body);

      await post({ ...valid(), slug: 'admin' }).expect(422); // reserved
      await post({ ...valid(), slug: 'Bad_Slug' }).expect(422);
      await post({ ...valid(), slug: A.slug }).expect(422); // taken
      await post({ ...valid(), platforms: [] }).expect(422);
      await post({ ...valid(), platforms: ['spaceship'] }).expect(422);
      await post({ ...valid(), owner: { firstName: 'No contact' } }).expect(
        422,
      );
      await post({
        ...valid(),
        owner: { firstName: 'Bad', phone: '12345' },
      }).expect(422);
    });

    it('should seed the five system roles and list the company', async () => {
      const rows = await db.query(
        `select key, "isSystem" from company_role where "companyId" = $1 order by key`,
        [A.id],
      );
      expect(rows.map((r: { key: string }) => r.key)).toEqual([
        'manager',
        'munshi',
        'owner',
        'partner',
        'viewer',
      ]);
      expect(rows.every((r: { isSystem: boolean }) => r.isSystem)).toBe(true);

      const list = await call(
        'get',
        `/superadmin/companies?search=${A.slug}`,
        supportToken,
      ).expect(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0].platforms).toMatchObject({
        factory: true,
        mine: false,
      });
    });

    it('should write audit entries for admin and member actions', async () => {
      const actions = await db.query(
        `select distinct action from audit_log where "companyId" = $1`,
        [A.id],
      );
      const names = actions.map((r: { action: string }) => r.action);

      expect(names).toEqual(
        expect.arrayContaining([
          'company.create',
          'member.invite',
          'invitation.accept',
          'member.deactivate',
          'member.change_role',
          'member.reset_link',
          'company.platform_set',
        ]),
      );
    });

    it('should keep the seeded legacy admin login and block public sign-up', async () => {
      await call('post', '/auth/email/login', undefined, {
        email: 'admin@example.com',
        password: 'secret',
      }).expect(200);

      await call('post', '/auth/email/register', undefined, {
        email: nextEmail('signup'),
        password: PASSWORD,
        firstName: 'Public',
        lastName: 'Signup',
      }).expect(404);
    });
  });
});
