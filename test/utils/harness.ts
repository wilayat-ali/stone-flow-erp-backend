// Shared end-to-end harness. Boots the whole app in-process (no running server
// needed), uses the database from .env, creates companies and members through
// the real API with unique "e2e-<run>" data, and removes all of it afterwards.
//
// Ledger, stock and party rows are append-only (a trigger rejects deletes), so
// cleanup runs in a transaction with session_replication_role = replica, which
// skips triggers for that transaction only.
import {
  ClassSerializerInterceptor,
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
import { ResolvePromisesInterceptor } from '../../src/utils/serializer.interceptor';
import validationOptions from '../../src/utils/validation-options';

export const PASSWORD = 'pass1234';

export type Workspace = {
  id: string;
  slug: string;
  ownerToken: string;
  ownerMemberId: string;
};

export type Member = { token: string; memberId: string; userId: number };

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';

export class Harness {
  readonly run = Date.now().toString(36);
  private phoneCounter = 0;
  private readonly phoneBase =
    100000000 + Math.floor(Math.random() * 800000000);
  private readonly phones: string[] = [];
  private readonly adminIds: string[] = [];
  private saToken = '';

  private constructor(
    readonly app: INestApplication,
    readonly db: DataSource,
  ) {}

  static async start(): Promise<Harness> {
    const notifier = {
      isEnabled: () => true,
      sendInvitation: () => Promise.resolve(),
      sendPasswordLink: () => Promise.resolve(),
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(InviteNotifier)
      .useValue(notifier)
      .compile();

    const app = moduleRef.createNestApplication({ logger: false });
    useContainer(app.select(AppModule), { fallbackOnErrors: true });
    app.setGlobalPrefix('api', { exclude: ['/'] });
    app.enableVersioning({ type: VersioningType.URI });
    app.useGlobalPipes(new ValidationPipe(validationOptions));
    app.useGlobalInterceptors(
      new ResolvePromisesInterceptor(),
      new ClassSerializerInterceptor(app.get(Reflector)),
    );
    await app.init();

    const harness = new Harness(app, app.get(DataSource));
    await harness.createSuperAdmin();
    return harness;
  }

  call(method: Method, path: string, token?: string, body?: object) {
    let req = request(this.app.getHttpServer())[method](`/api/v1${path}`);
    if (token) req = req.set('Authorization', `Bearer ${token}`);
    return body ? req.send(body) : req;
  }

  private async createSuperAdmin() {
    const email = `e2e-${this.run}-sa@e2e.test`;
    const hash = await bcrypt.hash(PASSWORD, 10);
    const [row] = (await this.db.query(
      `insert into super_admin(name, email, "passwordHash", role, status) values ($1,$2,$3,'super_admin','active') returning id`,
      ['E2E super admin', email, hash],
    )) as { id: string }[];
    this.adminIds.push(row.id);

    const res = await this.call('post', '/superadmin/auth/login', undefined, {
      email,
      password: PASSWORD,
    }).expect(200);
    this.saToken = (res.body as { token: string }).token;
  }

  private nextPhone() {
    const local =
      '03' + String(this.phoneBase + ++this.phoneCounter).padStart(9, '0');
    this.phones.push('+92' + local.slice(1));
    return local;
  }

  private tokenOf(link: string) {
    return new URL(link, 'http://x').searchParams.get('token')!;
  }

  // A company with its owner, who is already logged in.
  async createCompany(tag: string): Promise<Workspace> {
    const slug = `e2e-${this.run}-${tag}`;
    const created = await this.call(
      'post',
      '/superadmin/companies',
      this.saToken,
      {
        name: `E2E ${tag}`,
        slug,
        platforms: ['factory'],
        owner: { firstName: `Owner${tag}`, phone: this.nextPhone() },
      },
    ).expect(201);
    const body = created.body as {
      company: { id: string };
      invite: { inviteLink: string };
    };

    const accepted = await this.call(
      'post',
      '/auth/invitations/accept',
      undefined,
      {
        token: this.tokenOf(body.invite.inviteLink),
        firstName: `Owner${tag}`,
        password: PASSWORD,
      },
    ).expect(200);
    const token = (accepted.body as { token: string }).token;
    const me = await this.call('get', '/company/me', token).expect(200);

    return {
      id: body.company.id,
      slug,
      ownerToken: token,
      ownerMemberId: (me.body as { me: { memberId: string } }).me.memberId,
    };
  }

  // The owner invites a new person with this role; they accept and are in.
  async addMember(
    ws: Workspace,
    roleKey: string,
    tag: string,
  ): Promise<Member> {
    const invite = await this.call(
      'post',
      '/company/invitations',
      ws.ownerToken,
      {
        phone: this.nextPhone(),
        roleKey,
      },
    ).expect(201);
    const accepted = await this.call(
      'post',
      '/auth/invitations/accept',
      undefined,
      {
        token: this.tokenOf((invite.body as { inviteLink: string }).inviteLink),
        firstName: tag,
        password: PASSWORD,
      },
    ).expect(200);
    const body = accepted.body as { token: string; user: { id: number } };
    const me = await this.call('get', '/company/me', body.token).expect(200);

    return {
      token: body.token,
      memberId: (me.body as { me: { memberId: string } }).me.memberId,
      userId: body.user.id,
    };
  }

  clearThrottle() {
    (
      this.app.get(LoginThrottleService) as unknown as {
        buckets: Map<string, unknown>;
      }
    ).buckets.clear();
  }

  async stop() {
    const companies = (await this.db.query(
      `select id from company where slug like $1`,
      [`e2e-${this.run}-%`],
    )) as { id: string }[];
    const companyIds = companies.map((c) => c.id);
    const users = (await this.db.query(
      `select id from "user" where phone = any($1)`,
      [this.phones],
    )) as { id: number }[];
    const userIds = users.map((u) => u.id);

    await this.db.transaction(async (em) => {
      await em.query(`set local session_replication_role = replica`);
      for (const table of [
        'approval',
        'ledger_entry',
        'party_ledger_entry',
        'stock_movement',
        'supplier_cheque',
        'supplier_payment',
        'purchase',
        'machine',
        'factory',
        'catalog_item',
        'worker_rate',
        'supplier',
        'account',
        'audit_log',
        'company_invitation',
        'company_member',
        'company_role',
        'company_platform',
      ]) {
        await em.query(`delete from "${table}" where "companyId" = any($1)`, [
          companyIds,
        ]);
      }
      await em.query(`delete from session where "userId" = any($1)`, [userIds]);
      await em.query(`delete from company where id = any($1)`, [companyIds]);
      await em.query(`delete from "user" where id = any($1)`, [userIds]);
      await em.query(`delete from super_admin where id = any($1)`, [
        this.adminIds,
      ]);
    });

    await this.app.close();
  }
}
