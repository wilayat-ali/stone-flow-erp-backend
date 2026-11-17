import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { canUseAccount } from '../cash-bank/cash-bank.policy';
import { todayAtFactory } from '../engines/calendar-date';
import { query, toNumber } from '../engines/db';
import { conflict, forbidden, invalid, notFound } from '../engines/errors';
import { assertDate } from '../engines/guards';
import { LedgerService } from '../ledger-entries/ledger.service';
import { isMonthClosed } from '../month-close/month-lock';
import { AuditService } from '../tenancy/audit.service';
import { TenantContext } from '../tenancy/tenant-context';
import { GiveLoanDto, InstalmentChangeDto } from './dto/loan.dto';
import {
  InstalmentRowView,
  OverrideMap,
  Posted,
  scheduleOf,
} from './loan-schedule';

export const LOAN_SOURCE = 'loan';

export type LoanView = {
  id: string;
  workerId: string;
  workerName: string;
  date: string;
  amount: number;
  monthlyInstalment: number;
  firstMonth: string;
  priorRepaid: number;
  accountId: string;
  accountName: string;
  reason: string;
  schedule: InstalmentRowView[];
  deducted: number;
  outstanding: number;
  status: 'active' | 'repaid';
  endMonth: string | null;
};

type LoanRow = {
  id: string;
  workerId: string;
  workerName: string;
  date: string;
  amount: string;
  monthlyInstalment: string;
  firstMonth: string;
  priorRepaid: string;
  accountId: string | null;
  accountName: string | null;
  reason: string;
};

const SELECT = `
  SELECT l.id, l."workerId", w.name AS "workerName", l.date::text AS "date", l.amount, l."monthlyInstalment",
         l."firstMonth", l."priorRepaid", l."accountId", a.name AS "accountName", l.reason
  FROM loan l
  JOIN worker w ON w.id = l."workerId"
  LEFT JOIN account a ON a.id = l."accountId"`;

// Loans to workers (rules §8). Money given out of an account (or a loan given
// before StoneFlow, with no account) is a receivable: each month's instalment is
// deducted from the worker's pay when that month closes. The schedule is worked
// out from the loan, the owner's changes to a month, and what closing posted.
@Injectable()
export class LoansService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  async list(tenant: TenantContext, workerId?: string): Promise<LoanView[]> {
    return this.views(this.dataSource.manager, tenant.companyId, workerId);
  }

  async give(tenant: TenantContext, dto: GiveLoanDto): Promise<LoanView> {
    assertDate('date', dto.date);
    assertDate('firstMonth', `${dto.firstMonth}-01`);

    if (dto.date > todayAtFactory()) {
      throw conflict('FUTURE_DATE');
    }
    if (dto.priorRepaid >= dto.amount) {
      throw conflict('PRIOR_TOO_HIGH');
    }

    const id = await this.dataSource.transaction(async (em) => {
      if (await isMonthClosed(em, tenant.companyId, dto.firstMonth)) {
        throw conflict('MONTH_CLOSED');
      }

      const [worker] = await query<{ id: string; isActive: boolean }>(
        em,
        `SELECT id, "isActive" FROM worker WHERE id = $1 AND "companyId" = $2`,
        [dto.workerId, tenant.companyId],
      );

      if (!worker || !worker.isActive) {
        throw invalid({ workerId: 'invalid' });
      }

      if (dto.accountId) {
        await this.assertAccount(em, tenant, dto.accountId);
      }

      await em.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `loan:${tenant.companyId}`,
      ]);
      const [next] = await query<{ seq: number }>(
        em,
        `SELECT COALESCE(MAX("loanSeq"), 0) + 1 AS seq FROM loan WHERE "companyId" = $1`,
        [tenant.companyId],
      );
      const [row] = await query<{ id: string }>(
        em,
        `INSERT INTO loan
           ("companyId", "loanSeq", date, amount, "monthlyInstalment", "firstMonth", "priorRepaid", reason, "workerId", "accountId", "createdById")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          tenant.companyId,
          next.seq,
          dto.date,
          dto.amount,
          dto.monthlyInstalment,
          dto.firstMonth,
          dto.priorRepaid,
          dto.reason ?? '',
          dto.workerId,
          dto.accountId ?? null,
          tenant.memberId,
        ],
      );

      // Money leaves the account now, unless the loan was given before StoneFlow.
      if (dto.accountId) {
        const entry = await this.ledger.post(
          {
            companyId: tenant.companyId,
            accountId: dto.accountId,
            date: dto.date,
            direction: 'out',
            amount: dto.amount,
            sourceType: LOAN_SOURCE,
            sourceId: row.id,
            partyType: 'worker',
            partyId: dto.workerId,
            note: dto.reason ?? 'Loan',
            createdByMemberId: tenant.memberId,
          },
          em,
        );

        await em.query(`UPDATE loan SET "ledgerEntryId" = $1 WHERE id = $2`, [
          entry.id,
          row.id,
        ]);
      }

      await this.audit.record(
        {
          actorType: 'member',
          actorId: tenant.memberId,
          action: 'loan.give',
          companyId: tenant.companyId,
          targetType: 'loan',
          targetId: row.id,
          metadata: { amount: dto.amount },
        },
        em,
      );

      return row.id;
    });

    return this.get(tenant, id);
  }

  // The owner's change for one month before it closes: another amount, or skip it.
  async change(
    tenant: TenantContext,
    loanId: string,
    month: string,
    dto: InstalmentChangeDto,
  ): Promise<LoanView> {
    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw invalid({ month: 'invalid' });
    }

    await this.dataSource.transaction(async (em) => {
      await this.lockLoan(em, tenant.companyId, loanId);

      if (await isMonthClosed(em, tenant.companyId, month)) {
        throw conflict('MONTH_CLOSED');
      }

      const skip = dto.skip === true;

      if (!skip && !(dto.amount && dto.amount > 0)) {
        throw conflict('INVALID_AMOUNT');
      }

      await em.query(
        `INSERT INTO loan_override ("companyId", "loanId", month, amount, skip)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT ("loanId", month) DO UPDATE SET amount = EXCLUDED.amount, skip = EXCLUDED.skip`,
        [tenant.companyId, loanId, month, skip ? null : dto.amount, skip],
      );
    });

    return this.get(tenant, loanId);
  }

  // Back to the regular instalment for a month.
  async reset(
    tenant: TenantContext,
    loanId: string,
    month: string,
  ): Promise<LoanView> {
    await this.dataSource.transaction(async (em) => {
      await this.lockLoan(em, tenant.companyId, loanId);

      if (await isMonthClosed(em, tenant.companyId, month)) {
        throw conflict('MONTH_CLOSED');
      }

      await em.query(
        `DELETE FROM loan_override WHERE "loanId" = $1 AND month = $2 AND "companyId" = $3`,
        [loanId, month, tenant.companyId],
      );
    });

    return this.get(tenant, loanId);
  }

  async get(tenant: TenantContext, id: string): Promise<LoanView> {
    const [view] = await this.views(
      this.dataSource.manager,
      tenant.companyId,
      undefined,
      id,
    );

    if (!view) {
      throw notFound('id');
    }

    return view;
  }

  // The instalment each loan has for a month (scheduled, or skipped), for the
  // month-end sheet. Only loans with something due or skipped that month.
  async instalmentsFor(
    em: EntityManager,
    companyId: string,
    month: string,
    workerIds?: string[],
  ): Promise<
    Map<string, { loanId: string; amount: number; skipped: boolean }[]>
  > {
    const views = await this.views(em, companyId);
    const byWorker = new Map<
      string,
      { loanId: string; amount: number; skipped: boolean }[]
    >();

    for (const loan of views) {
      if (workerIds && !workerIds.includes(loan.workerId)) {
        continue;
      }

      for (const row of loan.schedule.filter((r) => r.month === month)) {
        byWorker.set(loan.workerId, [
          ...(byWorker.get(loan.workerId) ?? []),
          {
            loanId: loan.id,
            amount: row.amount,
            skipped: row.status === 'skipped',
          },
        ]);
      }
    }

    return byWorker;
  }

  // ------------------------------------------------------------- helpers

  private async views(
    em: EntityManager,
    companyId: string,
    workerId?: string,
    loanId?: string,
  ): Promise<LoanView[]> {
    const rows = await query<LoanRow>(
      em,
      `${SELECT} WHERE l."companyId" = $1 AND ($2::uuid IS NULL OR l."workerId" = $2) AND ($3::uuid IS NULL OR l.id = $3)
       ORDER BY l.date, l."loanSeq"`,
      [companyId, workerId ?? null, loanId ?? null],
    );

    if (rows.length === 0) {
      return [];
    }

    const ids = rows.map((r) => r.id);
    const overrides = await query<{
      loanId: string;
      month: string;
      amount: string | null;
      skip: boolean;
    }>(
      em,
      `SELECT "loanId", month, amount, skip FROM loan_override WHERE "companyId" = $1 AND "loanId" = ANY($2)`,
      [companyId, ids],
    );
    // What closing posted, for loans in a month that is closed right now.
    const closed = await query<{
      loanId: string;
      month: string;
      amount: string;
      skipped: boolean;
    }>(
      em,
      `SELECT i."loanId", c.month, i.amount, i.skipped
       FROM month_close_instalment i
       JOIN month_close_posting p ON p.id = i."postingId"
       JOIN month_close c ON c.id = p."closeId"
       WHERE i."companyId" = $1 AND i."loanId" = ANY($2) AND c."reopenedAt" IS NULL`,
      [companyId, ids],
    );
    const closedMonths = new Set(
      (
        await query<{ month: string }>(
          em,
          `SELECT month FROM month_close WHERE "companyId" = $1 AND "reopenedAt" IS NULL`,
          [companyId],
        )
      ).map((r) => r.month),
    );

    return rows.map((row) => {
      const overrideMap: OverrideMap = new Map(
        overrides
          .filter((o) => o.loanId === row.id)
          .map((o) => [
            o.month,
            {
              amount: o.amount === null ? null : toNumber(o.amount),
              skip: o.skip,
            },
          ]),
      );
      const postedMap = new Map<string, Posted>(
        closed
          .filter((c) => c.loanId === row.id)
          .map((c) => [
            c.month,
            { amount: toNumber(c.amount), skipped: c.skipped },
          ]),
      );
      const loan = {
        amount: toNumber(row.amount),
        priorRepaid: toNumber(row.priorRepaid),
        monthlyInstalment: toNumber(row.monthlyInstalment),
        firstMonth: row.firstMonth,
      };
      const schedule = scheduleOf(
        loan,
        overrideMap,
        (month) => postedMap.get(month),
        (month) => closedMonths.has(month),
      );
      const deducted = schedule
        .filter((r) => r.status === 'deducted')
        .reduce((s, r) => s + r.amount, 0);
      const outstanding = loan.amount - loan.priorRepaid - deducted;
      const last = [...schedule].reverse().find((r) => r.amount > 0);

      return {
        id: row.id,
        workerId: row.workerId,
        workerName: row.workerName,
        date: row.date,
        amount: loan.amount,
        monthlyInstalment: loan.monthlyInstalment,
        firstMonth: row.firstMonth,
        priorRepaid: loan.priorRepaid,
        accountId: row.accountId ?? '',
        accountName: row.accountName ?? '',
        reason: row.reason,
        schedule,
        deducted,
        outstanding,
        status: outstanding > 0 ? 'active' : 'repaid',
        endMonth: last?.month ?? null,
      };
    });
  }

  private async lockLoan(em: EntityManager, companyId: string, id: string) {
    const [row] = await query<{ id: string }>(
      em,
      `SELECT id FROM loan WHERE id = $1 AND "companyId" = $2 FOR UPDATE`,
      [id, companyId],
    );

    if (!row) {
      throw notFound('id');
    }
  }

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
}
