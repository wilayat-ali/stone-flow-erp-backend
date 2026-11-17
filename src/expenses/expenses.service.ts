import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { ApprovalService } from '../approvals/approval.service';
import { canUseAccount } from '../cash-bank/cash-bank.policy';
import { todayAtFactory } from '../engines/calendar-date';
import { query, toNumber } from '../engines/db';
import { conflict, forbidden, invalid, notFound } from '../engines/errors';
import { assertDate } from '../engines/guards';
import { LedgerService } from '../ledger-entries/ledger.service';
import { AuditService } from '../tenancy/audit.service';
import { TenantContext } from '../tenancy/tenant-context';
import { personName } from '../utils/person-name';
import { CreateExpenseDto, ListExpensesQueryDto } from './dto/expense.dto';
import {
  EXPENSE_APPROVER,
  EXPENSE_ENTITY,
  EXPENSE_SOURCE,
  ExpenseView,
  expenseNo,
} from './expense.types';
import { MunshiCashService } from './munshi-cash.service';

const approverName = (row: ExpenseRow) =>
  personName({
    user: {
      firstName: row.approvedFirst,
      lastName: row.approvedLast,
      phone: row.approvedPhone,
      email: row.approvedEmail,
    },
  }) ?? null;

type ExpenseRow = {
  id: string;
  expenseSeq: number;
  date: string;
  categoryId: string;
  categoryName: string;
  description: string;
  amount: string;
  factoryId: string;
  factoryName: string;
  payMode: ExpenseView['payMode'];
  accountId: string | null;
  accountName: string | null;
  dueDate: string | null;
  paidOn: string | null;
  shopId: string | null;
  shopName: string | null;
  photoName: string | null;
  status: ExpenseView['status'];
  reason: string | null;
  approvalId: string | null;
  ledgerEntryId: string | null;
  createdById: string;
  approvedFirst: string | null;
  approvedLast: string | null;
  approvedPhone: string | null;
  approvedEmail: string | null;
  createdFirst: string | null;
  createdLast: string | null;
  createdPhone: string | null;
  createdEmail: string | null;
};

const SELECT = `
  SELECT e.id, e."expenseSeq", e."date"::text AS "date", e."categoryId", cat.name AS "categoryName",
         e.description, e.amount, e."factoryId", f.name AS "factoryName", e."payMode", e."accountId",
         a.name AS "accountName", e."dueDate"::text AS "dueDate", e."paidOn"::text AS "paidOn",
         e."shopId", s.name AS "shopName", e."photoName", e.status, e.reason, e."approvalId",
         e."ledgerEntryId", e."createdById",
         cu."firstName" AS "createdFirst", cu."lastName" AS "createdLast", cu.phone AS "createdPhone", cu.email AS "createdEmail",
         au."firstName" AS "approvedFirst", au."lastName" AS "approvedLast", au.phone AS "approvedPhone", au.email AS "approvedEmail"
  FROM expense e
  JOIN catalog_item cat ON cat.id = e."categoryId"
  JOIN factory f ON f.id = e."factoryId"
  LEFT JOIN account a ON a.id = e."accountId"
  LEFT JOIN supplier s ON s.id = e."shopId"
  JOIN company_member cm ON cm.id = e."createdById"
  JOIN "user" cu ON cu.id = cm."userId"
  LEFT JOIN company_member am ON am.id = e."approvedById"
  LEFT JOIN "user" au ON au.id = am."userId"`;

// Expenses (rules §8): what the business spends on, by category and factory.
// A paid expense takes money out of an account when it counts; an unpaid bill
// does so when it is paid; a shop-credit expense goes on the shop's khata. A
// munshi's expense waits for approval while the company's approval switch is on.
// Nothing is edited after it counts: a mistake is cancelled (a reversal).
@Injectable()
export class ExpensesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
    private readonly approvals: ApprovalService,
    private readonly munshi: MunshiCashService,
    private readonly audit: AuditService,
  ) {}

  // Waiting entries first, then newest.
  async list(
    tenant: TenantContext,
    filters: ListExpensesQueryDto,
  ): Promise<ExpenseView[]> {
    const rows = await query<ExpenseRow>(
      this.dataSource.manager,
      `${SELECT}
       WHERE e."companyId" = $1
         AND ($2::uuid IS NULL OR e."categoryId" = $2)
         AND ($3::uuid IS NULL OR e."factoryId" = $3)
         AND ($4::text IS NULL OR e."payMode" = $4)
         AND ($5::text IS NULL OR e.status = $5)
         AND ($6::text IS NULL OR lower(e.description) LIKE '%' || lower($6) || '%'
              OR lower(cat.name) LIKE '%' || lower($6) || '%'
              OR lower(s.name) LIKE '%' || lower($6) || '%'
              OR ('EX-' || lpad(e."expenseSeq"::text, 4, '0')) ILIKE '%' || $6 || '%')
       ORDER BY (e.status = 'pending') DESC, e."date" DESC, e."expenseSeq" DESC`,
      [
        tenant.companyId,
        filters.categoryId ?? null,
        filters.factoryId ?? null,
        filters.payMode ?? null,
        filters.status ?? null,
        filters.q ?? null,
      ],
    );

    return rows.map((row) => this.view(row));
  }

  async get(tenant: TenantContext, id: string): Promise<ExpenseView> {
    return this.view(
      await this.load(this.dataSource.manager, tenant.companyId, id),
    );
  }

  async create(
    tenant: TenantContext,
    dto: CreateExpenseDto,
  ): Promise<ExpenseView> {
    assertDate('date', dto.date);

    if (dto.date > todayAtFactory()) {
      throw conflict('FUTURE_DATE');
    }

    if (dto.payMode === 'paid' && !dto.accountId) {
      throw conflict('ACCOUNT_REQUIRED');
    }
    if (dto.payMode === 'unpaid') {
      if (!dto.dueDate) {
        throw conflict('DUE_DATE_REQUIRED');
      }
      assertDate('dueDate', dto.dueDate);
    }
    if (dto.payMode === 'shop_credit' && !dto.shopId) {
      throw conflict('SHOP_REQUIRED');
    }

    const id = await this.dataSource.transaction(async (em) => {
      await this.assertCategory(em, tenant.companyId, dto.categoryId);
      await this.assertFactory(em, tenant.companyId, dto.factoryId);

      if (dto.payMode === 'paid') {
        await this.assertAccount(em, tenant, dto.accountId!);
      }
      if (dto.payMode === 'shop_credit') {
        await this.assertShop(em, tenant.companyId, dto.shopId!);
      }

      await em.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `expense:${tenant.companyId}`,
      ]);
      const [next] = await query<{ seq: number }>(
        em,
        `SELECT COALESCE(MAX("expenseSeq"), 0) + 1 AS seq FROM expense WHERE "companyId" = $1`,
        [tenant.companyId],
      );

      // A munshi's expense waits while approval is on; anyone holding
      // expenses.manage is approved at once.
      const [row] = await query<{ id: string }>(
        em,
        `INSERT INTO expense
           ("companyId", "expenseSeq", date, "categoryId", description, amount, "factoryId", "payMode",
            "accountId", "dueDate", "shopId", "photoName", status, "createdById")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending', $13)
         RETURNING id`,
        [
          tenant.companyId,
          next.seq,
          dto.date,
          dto.categoryId,
          dto.description,
          dto.amount,
          dto.factoryId,
          dto.payMode,
          dto.payMode === 'paid' ? dto.accountId : null,
          dto.payMode === 'unpaid' ? dto.dueDate : null,
          dto.payMode === 'shop_credit' ? dto.shopId : null,
          dto.photoName ?? null,
          tenant.memberId,
        ],
      );

      const { approval, needsApproval } = await this.approvals.request(
        {
          companyId: tenant.companyId,
          entityType: EXPENSE_ENTITY,
          entityId: row.id,
          requestedByMemberId: tenant.memberId,
          approverPermission: EXPENSE_APPROVER,
          payload: { expNo: expenseNo(next.seq), amount: dto.amount },
        },
        em,
      );

      await em.query(
        `UPDATE expense SET "approvalId" = $1, status = $2 WHERE id = $3`,
        [approval.id, needsApproval ? 'pending' : 'approved', row.id],
      );

      if (!needsApproval) {
        await this.post(em, tenant.companyId, row.id, tenant.memberId);
      }

      await this.record(em, tenant, 'expense.create', row.id, {
        expNo: expenseNo(next.seq),
        pending: needsApproval,
      });

      return row.id;
    });

    return this.get(tenant, id);
  }

  // Approving posts what the expense does: money out of its account or the
  // shop's khata. A failed post leaves it pending.
  async approve(tenant: TenantContext, id: string): Promise<ExpenseView> {
    await this.dataSource.transaction(async (em) => {
      const row = await this.lockRow(em, tenant.companyId, id);

      if (row.status !== 'pending' || !row.approvalId) {
        throw conflict('ALREADY_DECIDED');
      }

      await this.approvals.approve(
        {
          companyId: tenant.companyId,
          approvalId: row.approvalId,
          decidedByMemberId: tenant.memberId,
          approverPermission: EXPENSE_APPROVER,
        },
        async (_approval, manager) => {
          await this.post(manager, tenant.companyId, id, tenant.memberId);
          await manager.query(
            `UPDATE expense SET status = 'approved' WHERE id = $1 AND "companyId" = $2`,
            [id, tenant.companyId],
          );
        },
        em,
      );
      await this.record(em, tenant, 'expense.approve', id, {});
    });

    return this.get(tenant, id);
  }

  async reject(
    tenant: TenantContext,
    id: string,
    reason: string,
  ): Promise<ExpenseView> {
    await this.dataSource.transaction(async (em) => {
      const row = await this.lockRow(em, tenant.companyId, id);

      if (row.status !== 'pending' || !row.approvalId) {
        throw conflict('ALREADY_DECIDED');
      }

      await this.approvals.reject(
        {
          companyId: tenant.companyId,
          approvalId: row.approvalId,
          decidedByMemberId: tenant.memberId,
          approverPermission: EXPENSE_APPROVER,
          reason,
        },
        em,
      );
      // Nothing was posted for a pending expense, so rejecting only records why.
      await em.query(
        `UPDATE expense SET status = 'rejected', reason = $1 WHERE id = $2 AND "companyId" = $3`,
        [reason, id, tenant.companyId],
      );
      await this.record(em, tenant, 'expense.reject', id, {});
    });

    return this.get(tenant, id);
  }

  // Cancelling is a reversal, not an edit: the money comes back to the account
  // and a shop bill comes off the shop's khata.
  async cancel(
    tenant: TenantContext,
    id: string,
    reason: string,
  ): Promise<ExpenseView> {
    await this.dataSource.transaction(async (em) => {
      const row = await this.lockRow(em, tenant.companyId, id);

      if (row.status !== 'approved') {
        throw conflict('ALREADY_DECIDED');
      }

      const today = todayAtFactory();

      if (row.ledgerEntryId) {
        await this.ledger.reverse(
          {
            companyId: tenant.companyId,
            entryId: row.ledgerEntryId,
            date: today,
            reason,
            createdByMemberId: tenant.memberId,
          },
          em,
        );
      }
      if (row.payMode === 'shop_credit' && row.shopId) {
        await this.ledger.postPartyEntry(
          {
            companyId: tenant.companyId,
            date: today,
            partyType: 'supplier',
            partyId: row.shopId,
            side: 'credit',
            amount: toNumber(row.amount),
            sourceType: EXPENSE_SOURCE,
            sourceId: id,
            note: `${expenseNo(row.expenseSeq)} cancelled`,
          },
          em,
        );
      }

      await em.query(
        `UPDATE expense SET status = 'cancelled', reason = $1 WHERE id = $2 AND "companyId" = $3`,
        [reason, id, tenant.companyId],
      );
      await this.record(em, tenant, 'expense.cancel', id, {});
    });

    return this.get(tenant, id);
  }

  // Pays an unpaid bill from an account on a date: only then does money leave.
  async payBill(
    tenant: TenantContext,
    id: string,
    dto: { accountId: string; date: string },
  ): Promise<ExpenseView> {
    assertDate('date', dto.date);

    if (dto.date > todayAtFactory()) {
      throw conflict('FUTURE_DATE');
    }

    await this.dataSource.transaction(async (em) => {
      const row = await this.lockRow(em, tenant.companyId, id);

      if (row.payMode !== 'unpaid' || row.status !== 'approved' || row.paidOn) {
        throw conflict('ALREADY_PAID');
      }
      if (dto.date < row.date) {
        throw conflict('BEFORE_BILL');
      }

      await this.assertAccount(em, tenant, dto.accountId);

      const ledgerId = await this.payFrom(
        em,
        tenant.companyId,
        dto.accountId,
        dto.date,
        row,
        tenant.memberId,
      );

      await em.query(
        `UPDATE expense SET "accountId" = $1, "paidOn" = $2, "ledgerEntryId" = $3 WHERE id = $4 AND "companyId" = $5`,
        [dto.accountId, dto.date, ledgerId, id, tenant.companyId],
      );
      await this.record(em, tenant, 'expense.pay', id, {});
    });

    return this.get(tenant, id);
  }

  // ------------------------------------------------------------- helpers

  // Runs when the expense counts: a paid expense takes money out of its
  // account, a shop credit goes on the shop's khata. Inside the caller's
  // transaction.
  private async post(
    em: EntityManager,
    companyId: string,
    id: string,
    memberId: string,
  ): Promise<void> {
    const row = await this.lockRow(em, companyId, id);
    const amount = toNumber(row.amount);

    if (row.payMode === 'paid') {
      const ledgerId = await this.payFrom(
        em,
        companyId,
        row.accountId!,
        row.date,
        row,
        memberId,
      );

      await em.query(
        `UPDATE expense SET "paidOn" = $1, "ledgerEntryId" = $2, "approvedById" = $3 WHERE id = $4 AND "companyId" = $5`,
        [row.date, ledgerId, memberId, id, companyId],
      );

      return;
    }

    if (row.payMode === 'shop_credit') {
      await this.ledger.postPartyEntry(
        {
          companyId,
          date: row.date,
          partyType: 'supplier',
          partyId: row.shopId!,
          side: 'charge',
          amount,
          sourceType: EXPENSE_SOURCE,
          sourceId: id,
          note: `${expenseNo(row.expenseSeq)} · ${row.description}`,
        },
        em,
      );
    }

    await em.query(
      `UPDATE expense SET "approvedById" = $1 WHERE id = $2 AND "companyId" = $3`,
      [memberId, id, companyId],
    );
  }

  private async payFrom(
    em: EntityManager,
    companyId: string,
    accountId: string,
    date: string,
    row: Pick<ExpenseRow, 'id' | 'expenseSeq' | 'description' | 'amount'>,
    memberId: string,
  ): Promise<string> {
    const entry = await this.ledger.post(
      {
        companyId,
        accountId,
        date,
        direction: 'out',
        amount: toNumber(row.amount),
        sourceType: EXPENSE_SOURCE,
        sourceId: row.id,
        note: `${expenseNo(row.expenseSeq)} · ${row.description}`,
        createdByMemberId: memberId,
      },
      em,
    );

    return entry.id;
  }

  // The account must belong to the company, be active and be one the person
  // may use (a munshi has no bank).
  private async assertAccount(
    em: EntityManager,
    tenant: TenantContext,
    accountId: string,
  ) {
    const [account] = await query<{
      kind: 'cash' | 'bank';
      isActive: boolean;
    }>(
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

  private async assertCategory(
    em: EntityManager,
    companyId: string,
    id: string,
  ) {
    const [row] = await query<{ id: string }>(
      em,
      `SELECT id FROM catalog_item WHERE id = $1 AND "companyId" = $2 AND kind = 'expense_category' AND "isActive"`,
      [id, companyId],
    );

    if (!row) {
      throw invalid({ categoryId: 'invalid' });
    }
  }

  private async assertFactory(
    em: EntityManager,
    companyId: string,
    id: string,
  ) {
    const [row] = await query<{ id: string }>(
      em,
      `SELECT id FROM factory WHERE id = $1 AND "companyId" = $2 AND "isActive"`,
      [id, companyId],
    );

    if (!row) {
      throw invalid({ factoryId: 'invalid' });
    }
  }

  // A shop is a supplier of type shop: its khata takes the credit.
  private async assertShop(em: EntityManager, companyId: string, id: string) {
    const [row] = await query<{ id: string }>(
      em,
      `SELECT id FROM supplier WHERE id = $1 AND "companyId" = $2 AND type = 'shop' AND "isActive"`,
      [id, companyId],
    );

    if (!row) {
      throw invalid({ shopId: 'invalid' });
    }
  }

  private async lockRow(
    em: EntityManager,
    companyId: string,
    id: string,
  ): Promise<ExpenseRow & { date: string }> {
    const [row] = await query<{ id: string }>(
      em,
      `SELECT id FROM expense WHERE id = $1 AND "companyId" = $2 FOR UPDATE`,
      [id, companyId],
    );

    if (!row) {
      throw notFound('id');
    }

    const [full] = await query<ExpenseRow & { date: string }>(
      em,
      `SELECT e.id, e."expenseSeq", e."date"::text AS "date", e.amount, e.description, e."payMode",
              e."accountId", e."shopId", e.status, e."approvalId", e."ledgerEntryId", e."paidOn"::text AS "paidOn",
              e."createdById"
       FROM expense e WHERE e.id = $1`,
      [id],
    );

    return full;
  }

  private async load(
    em: EntityManager,
    companyId: string,
    id: string,
  ): Promise<ExpenseRow> {
    const [row] = await query<ExpenseRow>(
      em,
      `${SELECT} WHERE e.id = $1 AND e."companyId" = $2`,
      [id, companyId],
    );

    if (!row) {
      throw notFound('id');
    }

    return row;
  }

  private record(
    em: EntityManager,
    tenant: TenantContext,
    action: string,
    id: string,
    metadata: Record<string, unknown>,
  ) {
    return this.audit.record(
      {
        actorType: 'member',
        actorId: tenant.memberId,
        action,
        companyId: tenant.companyId,
        targetType: 'expense',
        targetId: id,
        metadata,
      },
      em,
    );
  }

  private view(row: ExpenseRow): ExpenseView {
    return {
      id: row.id,
      expNo: expenseNo(row.expenseSeq),
      date: row.date,
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      description: row.description,
      amount: toNumber(row.amount),
      factoryId: row.factoryId,
      factoryName: row.factoryName,
      payMode: row.payMode,
      accountId: row.accountId,
      accountName: row.accountName ?? '',
      dueDate: row.dueDate,
      paidOn: row.paidOn,
      shopId: row.shopId,
      shopName: row.shopName ?? '',
      photoName: row.photoName,
      status: row.status,
      reason: row.reason,
      createdBy:
        personName({
          user: {
            firstName: row.createdFirst,
            lastName: row.createdLast,
            phone: row.createdPhone,
            email: row.createdEmail,
          },
        }) ?? '',
      approvedBy: approverName(row),
    };
  }
}
