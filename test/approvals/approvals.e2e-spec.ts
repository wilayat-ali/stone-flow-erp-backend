// End-to-end tests for the approvals inbox: one list over the modules (what
// is waiting, by whom, for how much), anyone seeing their own requests and an
// approvals.view holder seeing all of them, and approve or reject that hands the
// decision to the module that owns the record. They boot the whole app
// in-process, use the database from .env, create everything through the real
// API with unique "e2e-<run>" data, and delete it all afterwards.
//
//   npm run test:e2e -- approvals
import { Harness, Member, Workspace } from '../utils/harness';

jest.setTimeout(240000);

type Row = {
  id: string;
  entityType: string;
  entityId: string;
  summary: string;
  amount: number | null;
  status: string;
  requestedBy: string;
  decidedBy: string | null;
  reason: string | null;
};
type Paged = { total: number; rows: Row[] };

const codeOf = (res: { body: unknown }) => (res.body as { code?: string }).code;

describe('Approvals inbox (e2e)', () => {
  let h: Harness;
  let A: Workspace;
  let B: Workspace;
  let munshi: Member;
  let otherMunshi: Member;
  let manager: Member;
  let viewer: Member;
  let f1: string;
  let cash: string;
  let supplier: string;
  let phone = 8000000;

  const call = (...args: Parameters<Harness['call']>) => h.call(...args);
  const owner = () => A.ownerToken;

  const inbox = async (token: string, qs = '') =>
    (await call('get', `/approvals${qs}`, token).expect(200)).body as Paged;
  const approvalFor = async (entityType: string, entityId: string) => {
    const page = await inbox(owner(), `?type=${entityType}&limit=200`);
    return page.rows.find((r) => r.entityId === entityId)!;
  };

  const purchase = (token: string) =>
    call('post', '/purchases', token, {
      date: '2026-10-08',
      supplierId: supplier,
      material: 'Ziarat White (rough)',
      purchiNo: String(++phone),
      truckNo: 'TKR-IN',
      tons: 20,
      ratePerTon: 6000,
      discount: 0,
      stones: 3,
      factoryId: f1,
      note: '',
    });

  beforeAll(async () => {
    h = await Harness.start();
    A = await h.createCompany('ap-a');
    B = await h.createCompany('ap-b');
    munshi = await h.addMember(A, 'munshi', 'MunshiAp');
    otherMunshi = await h.addMember(A, 'munshi', 'OtherMunshiAp');
    manager = await h.addMember(A, 'manager', 'MgrAp');
    viewer = await h.addMember(A, 'viewer', 'ViewerAp');
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
        openingBalance: 100000,
        openingDate: '2026-01-01',
      }).expect(201)
    ).body.id as string;
    supplier = (
      await call('post', '/suppliers', owner(), {
        type: 'mine_owner',
        name: 'Haji Inbox',
        phone: `0333-${String(++phone).padStart(7, '0')}`,
        city: 'Ziarat',
        openingDate: '2026-01-01',
      }).expect(201)
    ).body.id as string;
    await call('patch', '/company/settings', owner(), {
      approvalRequired: true,
    }).expect(200);
  });

  afterAll(async () => {
    await h.stop();
  });

  describe('what is waiting', () => {
    it('should list a munshi purchase with its truck, supplier and amount, for the owner', async () => {
      const res = (await purchase(munshi.token).expect(201)).body as {
        id: string;
        status: string;
      };
      expect(res.status).toBe('pending');
      const row = await approvalFor('purchase', res.id);
      expect(row).toMatchObject({
        status: 'pending',
        amount: 120000,
        reason: null,
      });
      expect(row.summary).toMatch(/^Truck .* · Haji Inbox$/);
      expect(row.requestedBy).toBeTruthy();
    });

    it('should let a munshi see only what he asked for, and a viewer nothing', async () => {
      const mine = await inbox(munshi.token);
      expect(mine.rows.length).toBeGreaterThan(0);
      expect(
        mine.rows.every((r) => r.requestedBy === mine.rows[0].requestedBy),
      ).toBe(true);

      const theirs = await inbox(otherMunshi.token);
      expect(theirs.rows.length).toBe(0);
      expect((await inbox(viewer.token)).rows.length).toBe(0);
    });

    it('should filter by status and by kind', async () => {
      const pending = await inbox(owner(), '?status=pending');
      expect(pending.rows.every((r) => r.status === 'pending')).toBe(true);
      const purchases = await inbox(owner(), '?type=purchase');
      expect(purchases.rows.every((r) => r.entityType === 'purchase')).toBe(
        true,
      );
      await call('get', '/approvals?type=nope', owner()).expect(422);
    });

    it('should show a manager (who holds approvals.view) everything the owner sees', async () => {
      const ownerView = await inbox(owner(), '?limit=200');
      const managerView = await inbox(manager.token, '?limit=200');
      expect(managerView.total).toBe(ownerView.total);
    });

    it('should not show another company its requests', async () => {
      expect((await inbox(B.ownerToken)).rows).toEqual([]);
    });
  });

  describe('deciding', () => {
    it('should approve a purchase from the inbox: the truck is in stock and the decision is recorded', async () => {
      const created = (await purchase(munshi.token).expect(201)).body as {
        id: string;
      };
      const row = await approvalFor('purchase', created.id);
      const res = await call(
        'post',
        `/approvals/${row.id}/approve`,
        owner(),
      ).expect(200);
      expect(res.body).toMatchObject({ id: created.id, status: 'in_stock' });
      const after = await approvalFor('purchase', created.id);
      expect(after).toMatchObject({ status: 'approved' });
      expect(after.decidedBy).toBeTruthy();
      expect(
        codeOf(
          await call('post', `/approvals/${row.id}/approve`, owner()).expect(
            409,
          ),
        ),
      ).toBe('ALREADY_DECIDED');
    });

    it('should reject a purchase from the inbox with a reason, and keep the reason', async () => {
      const created = (await purchase(munshi.token).expect(201)).body as {
        id: string;
      };
      const row = await approvalFor('purchase', created.id);
      await call('post', `/approvals/${row.id}/reject`, owner(), {
        reason: '',
      }).expect(422);
      await call('post', `/approvals/${row.id}/reject`, owner(), {
        reason: 'Wrong supplier',
      }).expect(200);
      const after = await approvalFor('purchase', created.id);
      expect(after).toMatchObject({
        status: 'rejected',
        reason: 'Wrong supplier',
      });
    });

    it('should approve an expense and a stock entry, and post them', async () => {
      const exp = (
        await call('post', '/expenses', munshi.token, {
          date: '2026-10-09',
          categoryId: (
            (
              await call('get', '/settings/expense-categories', owner()).expect(
                200,
              )
            ).body as { id: string }[]
          )[0].id,
          description: 'Inbox expense',
          amount: 1500,
          factoryId: f1,
          payMode: 'paid',
          accountId: cash,
        }).expect(201)
      ).body as { id: string; status: string };
      expect(exp.status).toBe('pending');
      await call(
        'post',
        `/approvals/${(await approvalFor('expense', exp.id)).id}/approve`,
        owner(),
      ).expect(200);
      const approved = (
        await call('get', `/expenses/${exp.id}`, owner()).expect(200)
      ).body as { status: string };
      expect(approved.status).toBe('approved');

      const entry = (
        await call('post', '/stock-entries', munshi.token, {
          type: 'adjustment',
          date: '2026-10-09',
          direction: 1,
          reason: 'mismatch',
          item: {
            itemType: 'piece',
            factoryId: f1,
            material: 'Ziarat White',
            soot: '14',
            size: '12x24',
            finish: 'unpolished',
          },
          qty: 4,
        }).expect(201)
      ).body as { id: string; status: string };
      expect(entry.status).toBe('pending');
      await call(
        'post',
        `/approvals/${(await approvalFor('stock_entry', entry.id)).id}/approve`,
        owner(),
      ).expect(200);
      const stock = (
        await call('get', `/stock-entries/${entry.id}`, owner()).expect(200)
      ).body as { status: string };
      expect(stock.status).toBe('approved');
    });

    it('should reject a worker payment from the inbox, and move no money', async () => {
      const worker = (
        await call('post', '/workers', owner(), {
          name: `Inbox worker ${phone}`,
          factoryId: f1,
          payType: 'day',
          rate: 700,
          joinedOn: '2026-09-01',
        }).expect(201)
      ).body as { id: string };
      const before = (
        (await call('get', '/cash-bank/accounts', owner()).expect(200))
          .body as { id: string; balance: number }[]
      ).find((a) => a.id === cash)!.balance;
      const pay = (
        await call('post', '/workers/payments', munshi.token, {
          workerId: worker.id,
          amount: 300,
          date: '2026-10-09',
          accountId: cash,
        }).expect(201)
      ).body as { id: string };
      const row = await approvalFor('worker_payment', pay.id);
      await call('post', `/approvals/${row.id}/reject`, owner(), {
        reason: 'Not agreed',
      }).expect(200);
      const after = (
        (await call('get', '/cash-bank/accounts', owner()).expect(200))
          .body as { id: string; balance: number }[]
      ).find((a) => a.id === cash)!.balance;
      expect(after).toBe(before);
    });

    it('should refuse a munshi deciding, even his own request', async () => {
      const exp = (
        await call('post', '/expenses', munshi.token, {
          date: '2026-10-09',
          categoryId: (
            (
              await call('get', '/settings/expense-categories', owner()).expect(
                200,
              )
            ).body as { id: string }[]
          )[0].id,
          description: 'Mine to approve',
          amount: 200,
          factoryId: f1,
          payMode: 'paid',
          accountId: cash,
        }).expect(201)
      ).body as { id: string };
      const row = await approvalFor('expense', exp.id);
      await call('post', `/approvals/${row.id}/approve`, munshi.token).expect(
        403,
      );
      await call('post', `/approvals/${row.id}/reject`, munshi.token, {
        reason: 'x',
      }).expect(403);
    });

    it("should not reach another company's request, and an unknown one is not found", async () => {
      const exp = (
        await call('post', '/expenses', munshi.token, {
          date: '2026-10-09',
          categoryId: (
            (
              await call('get', '/settings/expense-categories', owner()).expect(
                200,
              )
            ).body as { id: string }[]
          )[0].id,
          description: 'Private',
          amount: 100,
          factoryId: f1,
          payMode: 'paid',
          accountId: cash,
        }).expect(201)
      ).body as { id: string };
      const row = await approvalFor('expense', exp.id);
      await call('post', `/approvals/${row.id}/approve`, B.ownerToken).expect(
        404,
      );
      await call(
        'post',
        '/approvals/00000000-0000-4000-8000-000000000000/approve',
        owner(),
      ).expect(404);
    });
  });
});
