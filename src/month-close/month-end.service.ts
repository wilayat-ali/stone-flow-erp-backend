import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { todayAtFactory } from '../engines/calendar-date';
import { query, toNumber } from '../engines/db';
import { conflict, invalid } from '../engines/errors';
import { LoansService } from '../loans/loans.service';
import { LedgerService } from '../ledger-entries/ledger.service';
import { AuditService } from '../tenancy/audit.service';
import { TenantContext } from '../tenancy/tenant-context';
import { personName } from '../utils/person-name';
import { isMonthClosed, monthEnd, monthStart } from './month-lock';

// Days a salary is divided by to cut an absent day.
export const MONTH_DAYS = 30;

export const MONTH_CLOSE_SOURCE = 'month_close';
export const SALARY_REVERSAL_SOURCE = 'salary_reversal';
export const INSTALMENT_REVERSAL_SOURCE = 'instalment_reversal';

type Posting = {
  id: string;
  workerId: string;
  workerName: string;
  salary: number;
  absentDays: number;
  cut: number;
  net: number;
  instalments: {
    id: string;
    loanId: string;
    amount: number;
    skipped: boolean;
  }[];
};

export type MonthCloseView = {
  month: string;
  closedBy: string;
  closedAt: string;
  postings: Omit<Posting, 'id'>[];
  totals: { salaries: number; instalments: number };
};

type OpenClose = Omit<MonthCloseView, 'postings'> & {
  id: string;
  postings: Posting[];
};

export type SheetRowView = {
  workerId: string;
  workerName: string;
  payType: string;
  broughtForward: number;
  earned: number;
  salary: {
    gross: number;
    absentDays: number;
    cut: number;
    net: number;
  } | null;
  instalment: number;
  paid: number;
  balance: number;
};

export type MonthSheetView = {
  month: string;
  closed: MonthCloseView | null;
  inProgress: boolean;
  rows: SheetRowView[];
  totals: {
    broughtForward: number;
    earned: number;
    instalment: number;
    paid: number;
    balance: number;
    salaries: number;
  };
};

type WorkerRow = {
  id: string;
  name: string;
  payType: string;
  rate: string;
  openingBalance: string;
  joinedOn: string;
  isActive: boolean;
};

type LedgerSums = {
  partyId: string;
  bf: string;
  charges: string;
  minus: string;
  instalment: string;
  instalmentBack: string;
  paid: string;
};

// The monthly sheet and the month close (rules §8). A month closes once: the
// salary of each monthly worker, less the absent days, and each loan's
// instalment are posted to the khata of the worker, and the month is locked.
// Reopening posts the opposite rows, so the khata keeps every step.
//
// Every figure is worked out from the khata's ledger rows. The buckets are
// chosen so that brought forward + earned - instalments - paid is always the
// change in the worker's balance.
@Injectable()
export class MonthEndService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly loans: LoansService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  async sheet(tenant: TenantContext, month: string): Promise<MonthSheetView> {
    assertMonth(month);
    const em = this.dataSource.manager;
    const closed = await this.openClose(em, tenant.companyId, month);
    const end = monthEnd(month);
    const start = monthStart(month);
    const workers = await this.workers(em, tenant.companyId, end);
    const sums = await this.sumsOf(em, tenant.companyId, start, end);
    const absent = await this.absentOf(em, tenant.companyId, month);
    const projected: Map<string, { amount: number }[]> = closed
      ? new Map()
      : await this.loans.instalmentsFor(em, tenant.companyId, month);
    const rows: SheetRowView[] = [];

    for (const w of workers) {
      const sum = sums.get(w.id);
      const ledgerBf = toNumber(sum?.bf);
      const broughtForward = toNumber(w.openingBalance) + ledgerBf;
      const inMonth = {
        charges: toNumber(sum?.charges),
        minus: toNumber(sum?.minus),
        instalment: toNumber(sum?.instalment),
        instalmentBack: toNumber(sum?.instalmentBack),
        paid: toNumber(sum?.paid),
      };

      const posted = closed?.postings.find((p) => p.workerId === w.id);
      const projection =
        !closed && this.isMonthlyPaid(w, end)
          ? this.netSalary(w, absent.get(w.id) ?? 0)
          : null;
      const instalment =
        inMonth.instalment -
        inMonth.instalmentBack +
        (projected.get(w.id) ?? []).reduce((s, x) => s + x.amount, 0);
      const earned = inMonth.charges - inMonth.minus + (projection?.net ?? 0);
      const paid = inMonth.paid;
      const salary =
        projection ??
        (posted && posted.salary > 0
          ? {
              gross: posted.salary,
              absentDays: posted.absentDays,
              cut: posted.cut,
              net: posted.net,
            }
          : null);
      const active =
        (inMonth.charges ||
          inMonth.minus ||
          inMonth.instalment ||
          inMonth.instalmentBack ||
          inMonth.paid) !== 0;

      if (!w.isActive && !active) continue;
      if (
        broughtForward === 0 &&
        earned === 0 &&
        instalment === 0 &&
        paid === 0 &&
        !salary
      )
        continue;

      rows.push({
        workerId: w.id,
        workerName: w.name,
        payType: w.payType,
        broughtForward,
        earned,
        salary,
        instalment,
        paid,
        balance: broughtForward + earned - instalment - paid,
      });
    }

    const total = (pick: (r: SheetRowView) => number) =>
      rows.reduce((s, r) => s + pick(r), 0);

    return {
      month,
      closed: closed ? this.viewOf(closed) : null,
      inProgress: end >= todayAtFactory(),
      rows,
      totals: {
        broughtForward: total((r) => r.broughtForward),
        earned: total((r) => r.earned),
        instalment: total((r) => r.instalment),
        paid: total((r) => r.paid),
        balance: total((r) => r.balance),
        salaries: total((r) => r.salary?.net ?? 0),
      },
    };
  }

  // What closing would post, for the confirmation.
  async preview(
    tenant: TenantContext,
    month: string,
  ): Promise<{ salaries: number; instalments: number; absentCut: number }> {
    assertMonth(month);
    const postings = await this.postingsOf(
      this.dataSource.manager,
      tenant.companyId,
      month,
    );

    return {
      salaries: postings.reduce((s, p) => s + p.net, 0),
      instalments: postings.reduce(
        (s, p) => s + p.instalments.reduce((a, i) => a + i.amount, 0),
        0,
      ),
      absentCut: postings.reduce((s, p) => s + p.cut, 0),
    };
  }

  // Posts salary charges and loan instalments once, then locks the month.
  async close(tenant: TenantContext, month: string): Promise<MonthCloseView> {
    assertMonth(month);

    const id = await this.dataSource.transaction(async (em) => {
      if (await isMonthClosed(em, tenant.companyId, month)) {
        throw conflict('ALREADY_CLOSED');
      }

      const postings = await this.postingsOf(em, tenant.companyId, month);
      const [close] = await query<{ id: string }>(
        em,
        `INSERT INTO month_close ("companyId", month, salaries, instalments, "closedById")
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [
          tenant.companyId,
          month,
          postings.reduce((s, p) => s + p.net, 0),
          postings.reduce(
            (s, p) => s + p.instalments.reduce((a, i) => a + i.amount, 0),
            0,
          ),
          tenant.memberId,
        ],
      );
      const date = monthEnd(month);

      for (const p of postings) {
        const [posting] = await query<{ id: string }>(
          em,
          `INSERT INTO month_close_posting ("companyId", "closeId", "workerId", salary, "absentDays", cut, net)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [
            tenant.companyId,
            close.id,
            p.workerId,
            p.salary,
            p.absentDays,
            p.cut,
            p.net,
          ],
        );

        if (p.net > 0) {
          await this.ledger.postPartyEntry(
            {
              companyId: tenant.companyId,
              date,
              partyType: 'worker',
              partyId: p.workerId,
              side: 'charge',
              amount: p.net,
              sourceType: MONTH_CLOSE_SOURCE,
              sourceId: posting.id,
              note: `Salary ${month}`,
            },
            em,
          );
        }

        for (const i of p.instalments) {
          const [row] = await query<{ id: string }>(
            em,
            `INSERT INTO month_close_instalment ("companyId", "postingId", "loanId", amount, skipped)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [tenant.companyId, posting.id, i.loanId, i.amount, i.skipped],
          );

          if (i.amount > 0) {
            await this.ledger.postPartyEntry(
              {
                companyId: tenant.companyId,
                date,
                partyType: 'worker',
                partyId: p.workerId,
                side: 'credit',
                amount: i.amount,
                sourceType: MONTH_CLOSE_SOURCE,
                sourceId: row.id,
                note: `Loan instalment ${month}`,
              },
              em,
            );
          }
        }
      }

      await this.record(em, tenant, month, 'closed');
      await this.audit.record(
        {
          actorType: 'member',
          actorId: tenant.memberId,
          action: 'month.close',
          companyId: tenant.companyId,
          targetType: 'month_close',
          targetId: close.id,
          metadata: { month, postings: postings.length },
        },
        em,
      );

      return close.id;
    });

    const closed = await this.openClose(
      this.dataSource.manager,
      tenant.companyId,
      month,
    );

    if (!closed || closed.id !== id) {
      throw conflict('ALREADY_CLOSED');
    }

    return this.viewOf(closed);
  }

  // Taking the month back puts every posting back with an opposite row, and
  // unlocks the month. It is logged.
  async reopen(tenant: TenantContext, month: string): Promise<void> {
    assertMonth(month);

    await this.dataSource.transaction(async (em) => {
      const closed = await this.openClose(em, tenant.companyId, month);

      if (!closed) {
        throw conflict('NOT_CLOSED');
      }

      for (const p of closed.postings) {
        if (p.net > 0) {
          await this.ledger.postPartyEntry(
            {
              companyId: tenant.companyId,
              date: monthEnd(month),
              partyType: 'worker',
              partyId: p.workerId,
              side: 'credit',
              amount: p.net,
              sourceType: SALARY_REVERSAL_SOURCE,
              sourceId: p.id,
              note: `Salary ${month} reopened`,
            },
            em,
          );
        }
        for (const i of p.instalments) {
          if (i.amount > 0) {
            await this.ledger.postPartyEntry(
              {
                companyId: tenant.companyId,
                date: monthEnd(month),
                partyType: 'worker',
                partyId: p.workerId,
                side: 'charge',
                amount: i.amount,
                sourceType: INSTALMENT_REVERSAL_SOURCE,
                sourceId: i.id,
                note: `Loan instalment ${month} reopened`,
              },
              em,
            );
          }
        }
      }

      await em.query(
        `UPDATE month_close SET "reopenedAt" = now(), "reopenedById" = $1 WHERE id = $2 AND "companyId" = $3`,
        [tenant.memberId, closed.id, tenant.companyId],
      );
      await this.record(em, tenant, month, 'reopened');
      await this.audit.record(
        {
          actorType: 'member',
          actorId: tenant.memberId,
          action: 'month.reopen',
          companyId: tenant.companyId,
          targetType: 'month_close',
          targetId: closed.id,
          metadata: { month },
        },
        em,
      );
    });
  }

  async log(
    tenant: TenantContext,
  ): Promise<{ month: string; action: string; by: string; at: string }[]> {
    const rows = await query<{
      month: string;
      action: string;
      at: string;
      firstName: string | null;
      lastName: string | null;
      phone: string | null;
      email: string | null;
    }>(
      this.dataSource.manager,
      `SELECT l.month, l.action, l."at"::text AS "at", u."firstName", u."lastName", u.phone, u.email
       FROM month_log l
       JOIN company_member cm ON cm.id = l."byId"
       JOIN "user" u ON u.id = cm."userId"
       WHERE l."companyId" = $1 ORDER BY l."at" DESC`,
      [tenant.companyId],
    );

    return rows.map((r) => ({
      month: r.month,
      action: r.action,
      at: new Date(r.at).toISOString(),
      by:
        personName({
          user: {
            firstName: r.firstName,
            lastName: r.lastName,
            phone: r.phone,
            email: r.email,
          },
        }) ?? '',
    }));
  }

  // ------------------------------------------------------------- helpers

  private async record(
    em: EntityManager,
    tenant: TenantContext,
    month: string,
    action: 'closed' | 'reopened',
  ) {
    await em.query(
      `INSERT INTO month_log ("companyId", month, action, "byId") VALUES ($1, $2, $3, $4)`,
      [tenant.companyId, month, action, tenant.memberId],
    );
  }

  // Each monthly worker's salary less the absent days, and each loan's
  // instalment for the month; only those with something to post.
  private async postingsOf(
    em: EntityManager,
    companyId: string,
    month: string,
  ): Promise<Posting[]> {
    const end = monthEnd(month);
    const workers = await this.workers(em, companyId, end, true);
    const absent = await this.absentOf(em, companyId, month);
    const instalments = await this.loans.instalmentsFor(em, companyId, month);
    const postings: Posting[] = [];

    for (const w of workers) {
      const salary = this.isMonthlyPaid(w, end)
        ? this.netSalary(w, absent.get(w.id) ?? 0)
        : { gross: 0, absentDays: 0, cut: 0, net: 0 };
      const rows = (instalments.get(w.id) ?? []).map((i) => ({
        id: '',
        loanId: i.loanId,
        amount: i.amount,
        skipped: i.skipped,
      }));

      if (salary.net > 0 || rows.some((i) => i.amount > 0 || i.skipped)) {
        postings.push({
          id: '',
          workerId: w.id,
          workerName: w.name,
          salary: salary.gross,
          absentDays: salary.absentDays,
          cut: salary.cut,
          net: salary.net,
          instalments: rows,
        });
      }
    }

    return postings;
  }

  // Active, or joined by the month's end. A monthly worker who joined later is
  // not paid for that month.
  private workers(
    em: EntityManager,
    companyId: string,
    end: string,
    activeOnly = false,
  ): Promise<WorkerRow[]> {
    return query<WorkerRow>(
      em,
      `SELECT id, name, "payType", rate, "openingBalance", "joinedOn"::text AS "joinedOn", "isActive"
       FROM worker WHERE "companyId" = $1 AND "joinedOn" <= $2 AND ($3::boolean = false OR "isActive")
       ORDER BY "createdAt", name`,
      [companyId, end, activeOnly],
    );
  }

  private isMonthlyPaid(w: WorkerRow, end: string) {
    return w.payType === 'month' && w.isActive && w.joinedOn <= end;
  }

  // Net salary: the salary less each absent day at salary ÷ month days.
  private netSalary(w: WorkerRow, absentDays: number) {
    const gross = toNumber(w.rate);
    const cut = Math.min(gross, Math.round(absentDays * (gross / MONTH_DAYS)));

    return { gross, absentDays, cut, net: gross - cut };
  }

  // Days each worker was absent in the month (saved days only).
  private async absentOf(
    em: EntityManager,
    companyId: string,
    month: string,
  ): Promise<Map<string, number>> {
    const rows = await query<{ workerId: string; count: string }>(
      em,
      `SELECT a."workerId", COUNT(*) AS count
       FROM attendance_absence a JOIN attendance_day d ON d.id = a."dayId"
       WHERE d."companyId" = $1 AND to_char(d.date, 'YYYY-MM') = $2
       GROUP BY a."workerId"`,
      [companyId, month],
    );

    return new Map(rows.map((r) => [r.workerId, toNumber(r.count)]));
  }

  // The ledger, split into the buckets the sheet shows.
  private async sumsOf(
    em: EntityManager,
    companyId: string,
    start: string,
    end: string,
  ): Promise<Map<string, LedgerSums>> {
    const rows = await query<LedgerSums>(
      em,
      `SELECT "partyId",
         COALESCE(SUM(CASE WHEN date < $2 THEN COALESCE(charge, 0) - COALESCE(credit, 0) ELSE 0 END), 0) AS bf,
         COALESCE(SUM(CASE WHEN date >= $2 AND charge IS NOT NULL AND "sourceType" <> $4 THEN charge ELSE 0 END), 0) AS charges,
         COALESCE(SUM(CASE WHEN date >= $2 AND credit IS NOT NULL AND "sourceType" IN ('work_entry', $5) THEN credit ELSE 0 END), 0) AS minus,
         COALESCE(SUM(CASE WHEN date >= $2 AND credit IS NOT NULL AND "sourceType" = $3 THEN credit ELSE 0 END), 0) AS instalment,
         COALESCE(SUM(CASE WHEN date >= $2 AND charge IS NOT NULL AND "sourceType" = $4 THEN charge ELSE 0 END), 0) AS "instalmentBack",
         COALESCE(SUM(CASE WHEN date >= $2 AND credit IS NOT NULL AND "sourceType" = 'worker_payment' THEN credit ELSE 0 END), 0) AS paid
       FROM party_ledger_entry
       WHERE "companyId" = $1 AND "partyType" = 'worker' AND date <= $6
       GROUP BY "partyId"`,
      [
        companyId,
        start,
        MONTH_CLOSE_SOURCE,
        INSTALMENT_REVERSAL_SOURCE,
        SALARY_REVERSAL_SOURCE,
        end,
      ],
    );

    return new Map(rows.map((r) => [r.partyId, r]));
  }

  private async openClose(
    em: EntityManager,
    companyId: string,
    month: string,
  ): Promise<OpenClose | null> {
    const [close] = await query<{
      id: string;
      closedAt: string;
      closedBy: string;
      firstName: string | null;
      lastName: string | null;
      phone: string | null;
      email: string | null;
    }>(
      em,
      `SELECT c.id, c."closedAt"::text AS "closedAt", c."closedById" AS "closedBy", u."firstName", u."lastName", u.phone, u.email
       FROM month_close c
       JOIN company_member cm ON cm.id = c."closedById"
       JOIN "user" u ON u.id = cm."userId"
       WHERE c."companyId" = $1 AND c.month = $2 AND c."reopenedAt" IS NULL`,
      [companyId, month],
    );

    if (!close) {
      return null;
    }

    const postings = await query<{
      id: string;
      workerId: string;
      workerName: string;
      salary: string;
      absentDays: number;
      cut: string;
      net: string;
    }>(
      em,
      `SELECT p.id, p."workerId", w.name AS "workerName", p.salary, p."absentDays", p.cut, p.net
       FROM month_close_posting p JOIN worker w ON w.id = p."workerId"
       WHERE p."closeId" = $1 ORDER BY w."createdAt", w.name`,
      [close.id],
    );
    const instalments = await query<{
      id: string;
      postingId: string;
      loanId: string;
      amount: string;
      skipped: boolean;
    }>(
      em,
      `SELECT i.id, i."postingId", i."loanId", i.amount, i.skipped
       FROM month_close_instalment i JOIN month_close_posting p ON p.id = i."postingId"
       WHERE p."closeId" = $1`,
      [close.id],
    );
    const list = postings.map((p) => ({
      id: p.id,
      workerId: p.workerId,
      workerName: p.workerName,
      salary: toNumber(p.salary),
      absentDays: p.absentDays,
      cut: toNumber(p.cut),
      net: toNumber(p.net),
      instalments: instalments
        .filter((i) => i.postingId === p.id)
        .map((i) => ({
          id: i.id,
          loanId: i.loanId,
          amount: toNumber(i.amount),
          skipped: i.skipped,
        })),
    }));

    return {
      id: close.id,
      month,
      closedBy:
        personName({
          user: {
            firstName: close.firstName,
            lastName: close.lastName,
            phone: close.phone,
            email: close.email,
          },
        }) ?? '',
      closedAt: new Date(close.closedAt).toISOString(),
      postings: list,
      totals: {
        salaries: list.reduce((s, p) => s + p.net, 0),
        instalments: list.reduce(
          (s, p) => s + p.instalments.reduce((a, i) => a + i.amount, 0),
          0,
        ),
      },
    };
  }

  private viewOf(close: OpenClose): MonthCloseView {
    return {
      month: close.month,
      closedBy: close.closedBy,
      closedAt: close.closedAt,
      postings: close.postings.map((p) => ({
        workerId: p.workerId,
        workerName: p.workerName,
        salary: p.salary,
        absentDays: p.absentDays,
        cut: p.cut,
        net: p.net,
        instalments: p.instalments,
      })),
      totals: close.totals,
    };
  }
}

function assertMonth(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw invalid({ month: 'invalid' });
  }
}
