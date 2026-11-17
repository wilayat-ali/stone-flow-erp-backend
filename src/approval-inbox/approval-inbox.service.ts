import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ApprovalService } from '../approvals/approval.service';
import { APPROVAL_STATUS, ApprovalStatus } from '../approvals/approval.types';
import { CashBankEntriesService } from '../cash-bank/cash-bank-entries.service';
import { query, toNumber } from '../engines/db';
import { conflict, invalid, notFound } from '../engines/errors';
import { ExpensesService } from '../expenses/expenses.service';
import { StockEntriesService } from '../inventory/stock-entries.service';
import { PurchasesService } from '../purchases/purchases.service';
import { SupplierPaymentsService } from '../supplier-payments/supplier-payments.service';
import { TenantContext } from '../tenancy/tenant-context';
import { personName } from '../utils/person-name';
import { WorkerPaymentsService } from '../workers/worker-payments.service';

// Every kind of thing waiting for a decision, in one list. The approval record
// says what it is; the module that owns it decides (and keeps its own rules,
// such as which permission approves a purchase).
export const INBOX_TYPES = [
  'purchase',
  'supplier_payment',
  'cash_entry',
  'stock_entry',
  'expense',
  'worker_payment',
] as const;
export type InboxType = (typeof INBOX_TYPES)[number];

export type InboxRow = {
  id: string;
  entityType: InboxType;
  entityId: string | null;
  summary: string;
  amount: number | null;
  status: ApprovalStatus;
  requestedBy: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  reason: string | null;
};

type Item = { summary: string; amount: number | null };

const PERMISSION_TO_SEE_ALL = 'approvals.view' as const;

// What the inbox says about each kind of request, read from the owning record.
@Injectable()
export class ApprovalInboxService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly approvals: ApprovalService,
    private readonly purchases: PurchasesService,
    private readonly payments: SupplierPaymentsService,
    private readonly cashEntries: CashBankEntriesService,
    private readonly stockEntries: StockEntriesService,
    private readonly expenses: ExpensesService,
    private readonly workerPayments: WorkerPaymentsService,
  ) {}

  // Everyone with approvals.view sees every request; anyone else sees their own.
  async list(
    tenant: TenantContext,
    filters: {
      status?: ApprovalStatus;
      type?: InboxType;
      page?: number;
      limit?: number;
    },
  ): Promise<{ total: number; rows: InboxRow[] }> {
    if (filters.type && !INBOX_TYPES.includes(filters.type)) {
      throw invalid({ type: 'invalid' });
    }

    const seeAll = tenant.permissions.includes(PERMISSION_TO_SEE_ALL);
    const result = await this.approvals.list({
      companyId: tenant.companyId,
      entityTypes: filters.type ? [filters.type] : [...INBOX_TYPES],
      status: filters.status,
      requestedByMemberId: seeAll ? undefined : tenant.memberId,
      page: filters.page,
      limit: filters.limit,
    });

    const items = await this.itemsOf(tenant.companyId, result.rows);
    const people = await this.namesOf(
      tenant.companyId,
      result.rows
        .flatMap((r) => [r.requestedByMemberId, r.decidedByMemberId])
        .filter(Boolean) as string[],
    );

    return {
      total: result.total,
      rows: result.rows.map((row) => {
        const item = items.get(row.id) ?? { summary: '', amount: null };

        return {
          id: row.id,
          entityType: row.entityType as InboxType,
          entityId: row.entityId,
          summary: item.summary,
          amount: item.amount,
          status: row.status,
          requestedBy: people.get(row.requestedByMemberId) ?? '',
          requestedAt: row.createdAt.toISOString(),
          decidedBy: row.decidedByMemberId
            ? (people.get(row.decidedByMemberId) ?? '')
            : null,
          decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
          reason: row.reason,
        };
      }),
    };
  }

  // The owning module approves it, inside the approval's own transaction.
  async approve(tenant: TenantContext, approvalId: string) {
    const row = await this.find(tenant.companyId, approvalId);

    switch (row.entityType) {
      case 'purchase':
        return this.purchases.approve(tenant, row.entityId!);
      case 'supplier_payment':
        return this.payments.confirm(tenant, row.entityId!);
      case 'cash_entry':
        return this.cashEntries.approve(tenant, approvalId);
      case 'stock_entry':
        return this.stockEntries.approve(tenant, row.entityId!);
      case 'expense':
        return this.expenses.approve(tenant, row.entityId!);
      case 'worker_payment':
        return this.workerPayments.confirm(tenant, row.entityId!);
      default:
        throw notFound('id');
    }
  }

  async reject(tenant: TenantContext, approvalId: string, reason: string) {
    const row = await this.find(tenant.companyId, approvalId);

    switch (row.entityType) {
      case 'purchase':
        return this.purchases.reject(tenant, row.entityId!, reason);
      case 'supplier_payment':
        return this.payments.reject(tenant, row.entityId!, reason);
      case 'cash_entry':
        return this.cashEntries.reject(tenant, approvalId, reason);
      case 'stock_entry':
        return this.stockEntries.reject(tenant, row.entityId!, reason);
      case 'expense':
        return this.expenses.reject(tenant, row.entityId!, reason);
      case 'worker_payment':
        return this.workerPayments.reject(tenant, row.entityId!, reason);
      default:
        throw notFound('id');
    }
  }

  // ------------------------------------------------------------- helpers

  private async find(companyId: string, approvalId: string) {
    const [row] = await query<{
      id: string;
      entityType: string;
      entityId: string | null;
      status: string;
    }>(
      this.dataSource.manager,
      `SELECT id, "entityType", "entityId", status FROM approval WHERE id = $1 AND "companyId" = $2`,
      [approvalId, companyId],
    );

    if (!row) {
      throw notFound('id');
    }
    if (row.status !== APPROVAL_STATUS.pending) {
      throw conflict('ALREADY_DECIDED');
    }

    return { ...row, entityType: row.entityType as InboxType };
  }

  // What each request is about, looked up per kind in one query each.
  private async itemsOf(
    companyId: string,
    rows: {
      id: string;
      entityType: string;
      entityId: string | null;
      payload: Record<string, unknown> | null;
    }[],
  ): Promise<Map<string, Item>> {
    const em = this.dataSource.manager;
    const ids = (type: string) =>
      rows
        .filter((r) => r.entityType === type && r.entityId)
        .map((r) => r.entityId as string);
    const out = new Map<string, Item>();
    const byEntity = new Map<string, Item>();

    const purchaseIds = ids('purchase');
    if (purchaseIds.length) {
      const list = await query<{
        id: string;
        truckNo: string;
        total: string;
        markSeq: number | null;
        stones: number;
        supplier: string;
      }>(
        em,
        `SELECT p.id, p."truckNo", p.total, p."markSeq", p.stones, s.name AS supplier
         FROM purchase p JOIN supplier s ON s.id = p."supplierId"
         WHERE p."companyId" = $1 AND p.id = ANY($2)`,
        [companyId, purchaseIds],
      );
      for (const p of list) {
        const mark = p.markSeq ? `${p.markSeq}/${p.stones}` : p.truckNo;
        byEntity.set(`purchase:${p.id}`, {
          summary: `Truck ${mark} · ${p.supplier}`,
          amount: toNumber(p.total),
        });
      }
    }

    const paymentIds = ids('supplier_payment');
    if (paymentIds.length) {
      const list = await query<{
        id: string;
        voucherSeq: number;
        amount: string;
        supplier: string;
      }>(
        em,
        `SELECT p.id, p."voucherSeq", p.amount, s.name AS supplier
         FROM supplier_payment p JOIN supplier s ON s.id = p."supplierId"
         WHERE p."companyId" = $1 AND p.id = ANY($2)`,
        [companyId, paymentIds],
      );
      for (const p of list) {
        byEntity.set(`supplier_payment:${p.id}`, {
          summary: `Payment to ${p.supplier} · V-${String(p.voucherSeq).padStart(4, '0')}`,
          amount: toNumber(p.amount),
        });
      }
    }

    const stockIds = ids('stock_entry');
    if (stockIds.length) {
      const list = await query<{
        id: string;
        entrySeq: number;
        type: string;
        qty: number;
      }>(
        em,
        `SELECT id, "entrySeq", type, qty FROM stock_entry WHERE "companyId" = $1 AND id = ANY($2)`,
        [companyId, stockIds],
      );
      for (const s of list) {
        byEntity.set(`stock_entry:${s.id}`, {
          summary: `SE-${String(s.entrySeq).padStart(3, '0')} · ${s.type} · ${s.qty} pcs`,
          amount: null,
        });
      }
    }

    const expenseIds = ids('expense');
    if (expenseIds.length) {
      const list = await query<{
        id: string;
        expenseSeq: number;
        description: string;
        amount: string;
      }>(
        em,
        `SELECT id, "expenseSeq", description, amount FROM expense WHERE "companyId" = $1 AND id = ANY($2)`,
        [companyId, expenseIds],
      );
      for (const e of list) {
        byEntity.set(`expense:${e.id}`, {
          summary: `EX-${String(e.expenseSeq).padStart(4, '0')} · ${e.description}`,
          amount: toNumber(e.amount),
        });
      }
    }

    const workerIds = ids('worker_payment');
    if (workerIds.length) {
      const list = await query<{
        id: string;
        paymentSeq: number;
        amount: string;
        worker: string;
      }>(
        em,
        `SELECT p.id, p."paymentSeq", p.amount, w.name AS worker
         FROM worker_payment p JOIN worker w ON w.id = p."workerId"
         WHERE p."companyId" = $1 AND p.id = ANY($2)`,
        [companyId, workerIds],
      );
      for (const p of list) {
        byEntity.set(`worker_payment:${p.id}`, {
          summary: `PAY-${String(p.paymentSeq).padStart(4, '0')} · ${p.worker}`,
          amount: toNumber(p.amount),
        });
      }
    }

    for (const row of rows) {
      if (row.entityType === 'cash_entry') {
        const kind =
          typeof row.payload?.kind === 'string'
            ? row.payload.kind.replace(/_/g, ' ')
            : 'Cash entry';
        const amount =
          typeof row.payload?.amount === 'number' ? row.payload.amount : null;
        out.set(row.id, { summary: kind, amount });
        continue;
      }

      const key = row.entityId ? `${row.entityType}:${row.entityId}` : '';
      const hit = byEntity.get(key);
      out.set(
        row.id,
        hit ?? { summary: row.entityType.replace(/_/g, ' '), amount: null },
      );
    }

    return out;
  }

  private async namesOf(
    companyId: string,
    memberIds: string[],
  ): Promise<Map<string, string>> {
    if (memberIds.length === 0) {
      return new Map();
    }

    const rows = await query<{
      id: string;
      firstName: string | null;
      lastName: string | null;
      phone: string | null;
      email: string | null;
    }>(
      this.dataSource.manager,
      `SELECT cm.id, u."firstName", u."lastName", u.phone, u.email
       FROM company_member cm JOIN "user" u ON u.id = cm."userId"
       WHERE cm."companyId" = $1 AND cm.id = ANY($2)`,
      [companyId, memberIds],
    );

    return new Map(
      rows.map((r) => [
        r.id,
        personName({
          user: {
            firstName: r.firstName,
            lastName: r.lastName,
            phone: r.phone,
            email: r.email,
          },
        }) ?? '',
      ]),
    );
  }
}
