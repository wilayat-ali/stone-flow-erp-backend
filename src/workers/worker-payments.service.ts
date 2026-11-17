import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { ApprovalService } from '../approvals/approval.service';
import { canUseAccount } from '../cash-bank/cash-bank.policy';
import { todayAtFactory } from '../engines/calendar-date';
import { query, toNumber } from '../engines/db';
import { conflict, forbidden, invalid, notFound } from '../engines/errors';
import { assertDate } from '../engines/guards';
import { assertMonthOpen } from '../month-close/month-lock';
import { LedgerService } from '../ledger-entries/ledger.service';
import { AuditService } from '../tenancy/audit.service';
import { TenantContext } from '../tenancy/tenant-context';
import { personName } from '../utils/person-name';
import { CreateWorkerPaymentDto } from './dto/worker-payment.dto';
import { WORKER_PARTY } from './worker.types';

export const WORKER_PAYMENT_SOURCE = 'worker_payment';
export const WORKER_PAYMENT_APPROVER = 'expenses.manage';
export const WORKER_PAYMENT_ENTITY = 'worker_payment';

export type WorkerPaymentView = {
  id: string;
  paymentNo: string;
  date: string;
  workerId: string;
  workerName: string;
  amount: number;
  accountId: string;
  accountName: string;
  note: string;
  status: 'pending' | 'confirmed' | 'rejected';
  reason: string | null;
  createdBy: string;
};

type PaymentRow = {
  id: string;
  paymentSeq: number;
  date: string;
  workerId: string;
  workerName: string;
  amount: string;
  accountId: string;
  accountName: string;
  note: string;
  status: WorkerPaymentView['status'];
  reason: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
};

const SELECT = `
  SELECT p.id, p."paymentSeq", p."date"::text AS "date", p."workerId", w.name AS "workerName", p.amount,
         p."accountId", a.name AS "accountName", p.note, p.status, p.reason,
         u."firstName", u."lastName", u.phone, u.email
  FROM worker_payment p
  JOIN worker w ON w.id = p."workerId"
  JOIN account a ON a.id = p."accountId"
  JOIN company_member cm ON cm.id = p."createdById"
  JOIN "user" u ON u.id = cm."userId"`;

// Money paid to a worker: an advance or a payment on his khata (rules §8).
// It leaves an account and reduces what we owe him when it counts. A munshi's
// payment waits for approval while the company's approval switch is on, and
// has no effect until it is confirmed.
@Injectable()
export class WorkerPaymentsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
    private readonly approvals: ApprovalService,
    private readonly audit: AuditService,
  ) {}

  async list(
    tenant: TenantContext,
    workerId?: string,
  ): Promise<WorkerPaymentView[]> {
    const rows = await query<PaymentRow>(
      this.dataSource.manager,
      `${SELECT} WHERE p."companyId" = $1 AND p.status <> 'rejected' AND ($2::uuid IS NULL OR p."workerId" = $2)
       ORDER BY p."date" DESC, p."paymentSeq" DESC`,
      [tenant.companyId, workerId ?? null],
    );

    return rows.map((r) => this.view(r));
  }

  async create(
    tenant: TenantContext,
    dto: CreateWorkerPaymentDto,
  ): Promise<WorkerPaymentView> {
    assertDate('date', dto.date);

    if (dto.date > todayAtFactory()) {
      throw conflict('FUTURE_DATE');
    }

    const id = await this.dataSource.transaction(async (em) => {
      const [worker] = await query<{ id: string; isActive: boolean }>(
        em,
        `SELECT id, "isActive" FROM worker WHERE id = $1 AND "companyId" = $2`,
        [dto.workerId, tenant.companyId],
      );

      if (!worker || !worker.isActive) {
        throw invalid({ workerId: 'invalid' });
      }

      await assertMonthOpen(em, tenant.companyId, dto.date);
      await this.assertAccount(em, tenant, dto.accountId);

      await em.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `worker_payment:${tenant.companyId}`,
      ]);
      const [next] = await query<{ seq: number }>(
        em,
        `SELECT COALESCE(MAX("paymentSeq"), 0) + 1 AS seq FROM worker_payment WHERE "companyId" = $1`,
        [tenant.companyId],
      );
      const [row] = await query<{ id: string }>(
        em,
        `INSERT INTO worker_payment
           ("companyId", "paymentSeq", date, "workerId", amount, "accountId", note, status, "createdById")
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)
         RETURNING id`,
        [
          tenant.companyId,
          next.seq,
          dto.date,
          dto.workerId,
          dto.amount,
          dto.accountId,
          dto.note ?? '',
          tenant.memberId,
        ],
      );

      const { approval, needsApproval } = await this.approvals.request(
        {
          companyId: tenant.companyId,
          entityType: WORKER_PAYMENT_ENTITY,
          entityId: row.id,
          requestedByMemberId: tenant.memberId,
          approverPermission: WORKER_PAYMENT_APPROVER,
          payload: { amount: dto.amount },
        },
        em,
      );

      await em.query(
        `UPDATE worker_payment SET "approvalId" = $1 WHERE id = $2`,
        [approval.id, row.id],
      );

      if (!needsApproval) {
        await this.post(em, tenant.companyId, row.id, tenant.memberId);
      }

      await this.audit.record(
        {
          actorType: 'member',
          actorId: tenant.memberId,
          action: 'worker_payment.create',
          companyId: tenant.companyId,
          targetType: 'worker_payment',
          targetId: row.id,
          metadata: { amount: dto.amount, pending: needsApproval },
        },
        em,
      );

      return row.id;
    });

    return this.get(tenant, id);
  }

  async confirm(tenant: TenantContext, id: string): Promise<WorkerPaymentView> {
    await this.dataSource.transaction(async (em) => {
      const row = await this.lock(em, tenant.companyId, id);

      if (row.status !== 'pending' || !row.approvalId) {
        throw conflict('ALREADY_DECIDED');
      }

      await this.approvals.approve(
        {
          companyId: tenant.companyId,
          approvalId: row.approvalId,
          decidedByMemberId: tenant.memberId,
          approverPermission: WORKER_PAYMENT_APPROVER,
        },
        async (_approval, manager) => {
          await this.post(manager, tenant.companyId, id, tenant.memberId);
        },
        em,
      );
    });

    return this.get(tenant, id);
  }

  async reject(
    tenant: TenantContext,
    id: string,
    reason: string,
  ): Promise<WorkerPaymentView> {
    await this.dataSource.transaction(async (em) => {
      const row = await this.lock(em, tenant.companyId, id);

      if (row.status !== 'pending' || !row.approvalId) {
        throw conflict('ALREADY_DECIDED');
      }

      await this.approvals.reject(
        {
          companyId: tenant.companyId,
          approvalId: row.approvalId,
          decidedByMemberId: tenant.memberId,
          approverPermission: WORKER_PAYMENT_APPROVER,
          reason,
        },
        em,
      );
      await em.query(
        `UPDATE worker_payment SET status = 'rejected', reason = $1 WHERE id = $2 AND "companyId" = $3`,
        [reason.slice(0, 500), id, tenant.companyId],
      );
    });

    return this.get(tenant, id);
  }

  async get(tenant: TenantContext, id: string): Promise<WorkerPaymentView> {
    const [row] = await query<PaymentRow>(
      this.dataSource.manager,
      `${SELECT} WHERE p.id = $1 AND p."companyId" = $2`,
      [id, tenant.companyId],
    );

    if (!row) {
      throw notFound('id');
    }

    return this.view(row);
  }

  // ------------------------------------------------------------- helpers

  // Money out of the account and off what we owe the worker, in one step.
  private async post(
    em: EntityManager,
    companyId: string,
    id: string,
    memberId: string,
  ) {
    const [row] = await query<{
      workerId: string;
      accountId: string;
      date: string;
      amount: string;
      paymentSeq: number;
    }>(
      em,
      `SELECT "workerId", "accountId", "date"::text AS "date", amount, "paymentSeq"
       FROM worker_payment WHERE id = $1 AND "companyId" = $2`,
      [id, companyId],
    );
    const amount = toNumber(row.amount);
    const entry = await this.ledger.post(
      {
        companyId,
        accountId: row.accountId,
        date: row.date,
        direction: 'out',
        amount,
        sourceType: WORKER_PAYMENT_SOURCE,
        sourceId: id,
        partyType: WORKER_PARTY,
        partyId: row.workerId,
        note: `PAY-${String(row.paymentSeq).padStart(4, '0')}`,
        createdByMemberId: memberId,
      },
      em,
    );

    await this.ledger.postPartyEntry(
      {
        companyId,
        date: row.date,
        partyType: WORKER_PARTY,
        partyId: row.workerId,
        side: 'credit',
        amount,
        sourceType: WORKER_PAYMENT_SOURCE,
        sourceId: id,
        note: 'Payment',
      },
      em,
    );

    await em.query(
      `UPDATE worker_payment SET status = 'confirmed', "ledgerEntryId" = $1, "approvedById" = $2 WHERE id = $3 AND "companyId" = $4`,
      [entry.id, memberId, id, companyId],
    );
  }

  // The account must be active and one the person may use (a munshi has no
  // bank, but his own cash is cash).
  private async assertAccount(
    em: EntityManager,
    tenant: TenantContext,
    accountId: string,
  ) {
    const [account] = await query<{ kind: 'cash' | 'bank'; isActive: boolean }>(
      em,
      `SELECT kind, "isActive" FROM account WHERE id = $1 AND "companyId" = $2`,
      [accountId, tenant.companyId],
    );

    if (!account) {
      throw invalid({ accountId: 'invalid' });
    }
    if (!account.isActive) {
      throw conflict('ACCOUNT_INACTIVE');
    }
    if (!canUseAccount(tenant.roleKey, account.kind)) {
      throw forbidden('BANK_ACCOUNT_NOT_ALLOWED');
    }
  }

  private async lock(em: EntityManager, companyId: string, id: string) {
    const [row] = await query<{
      id: string;
      status: string;
      approvalId: string | null;
    }>(
      em,
      `SELECT id, status, "approvalId" FROM worker_payment WHERE id = $1 AND "companyId" = $2 FOR UPDATE`,
      [id, companyId],
    );

    if (!row) {
      throw notFound('id');
    }

    return row;
  }

  private view(row: PaymentRow): WorkerPaymentView {
    return {
      id: row.id,
      paymentNo: `PAY-${String(row.paymentSeq).padStart(4, '0')}`,
      date: row.date,
      workerId: row.workerId,
      workerName: row.workerName,
      amount: toNumber(row.amount),
      accountId: row.accountId,
      accountName: row.accountName,
      note: row.note,
      status: row.status,
      reason: row.reason,
      createdBy:
        personName({
          user: {
            firstName: row.firstName,
            lastName: row.lastName,
            phone: row.phone,
            email: row.email,
          },
        }) ?? '',
    };
  }
}
