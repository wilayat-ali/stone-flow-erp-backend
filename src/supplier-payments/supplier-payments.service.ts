import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { ApprovalService } from '../approvals/approval.service';
import { canUseAccount } from '../cash-bank/cash-bank.policy';
import { todayAtFactory } from '../engines/calendar-date';
import { query, toNumber } from '../engines/db';
import { conflict, forbidden, invalid, notFound } from '../engines/errors';
import { assertDate } from '../engines/guards';
import { LedgerService } from '../ledger-entries/ledger.service';
import { SupplierEntity } from '../suppliers/infrastructure/persistence/relational/entities/supplier.entity';
import { AuditService } from '../tenancy/audit.service';
import { TenantContext } from '../tenancy/tenant-context';
import { inCompany } from '../tenancy/tenant-scope';
import { personName } from '../utils/person-name';
import { CreateSupplierPaymentDto } from './dto/supplier-payment.dto';
import { SupplierChequeEntity } from './infrastructure/persistence/relational/entities/supplier-cheque.entity';
import { SupplierPaymentEntity } from './infrastructure/persistence/relational/entities/supplier-payment.entity';
import {
  PAYMENT_APPROVER,
  PAYMENT_ENTITY,
  PAYMENT_SOURCE,
  PaymentMethod,
  PaymentStatus,
  SupplierPaymentView,
  voucherNo,
} from './supplier-payment.types';

const PG_UNIQUE_VIOLATION = '23505';

const RELATIONS = {
  supplier: true,
  account: true,
  createdBy: { user: true },
} as const;

// Payments to suppliers (rules §6). A payment is a row here; what it does to
// money is posted to the ledgers when it counts:
//  - cash or bank transfer: money out of the account, and a credit in the
//    supplier's khata;
//  - cheque: only the credit (the supplier holds the cheque); the money leaves
//    the bank when the cheque clears (see SupplierChequesService).
// A Munshi's payment waits as 'pending' while approval is on and has no effect.
@Injectable()
export class SupplierPaymentsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(SupplierPaymentEntity)
    private readonly payments: Repository<SupplierPaymentEntity>,
    @InjectRepository(SupplierChequeEntity)
    private readonly cheques: Repository<SupplierChequeEntity>,
    @InjectRepository(SupplierEntity)
    private readonly suppliers: Repository<SupplierEntity>,
    private readonly ledger: LedgerService,
    private readonly approvals: ApprovalService,
    private readonly audit: AuditService,
  ) {}

  // Newest first.
  async list(tenant: TenantContext): Promise<SupplierPaymentView[]> {
    const rows = await this.payments.find({
      where: inCompany(tenant.companyId),
      relations: RELATIONS,
      order: { date: 'DESC', voucherSeq: 'DESC' },
    });
    const chequeIds = await this.chequeIds(tenant.companyId);

    return rows.map((row) => this.view(row, chequeIds.get(row.id) ?? null));
  }

  async get(tenant: TenantContext, id: string): Promise<SupplierPaymentView> {
    const row = await this.load(tenant.companyId, id);
    const chequeIds = await this.chequeIds(tenant.companyId, [id]);

    return this.view(row, chequeIds.get(id) ?? null);
  }

  async create(
    tenant: TenantContext,
    dto: CreateSupplierPaymentDto,
  ): Promise<SupplierPaymentView> {
    assertDate('date', dto.date);

    if (dto.date > todayAtFactory()) {
      throw invalid({ date: 'futureDate' });
    }

    const isCheque = dto.method === 'cheque';

    if (isCheque) {
      if (!dto.chequeNo) {
        throw invalid({ chequeNo: 'required' });
      }
      assertDate('chequeDate', dto.chequeDate);
    }

    await this.activeSupplier(tenant.companyId, dto.supplierId);

    const id = await this.dataSource.transaction(async (em) => {
      const account = await this.usableAccount(
        em,
        tenant,
        dto.accountId,
        dto.method,
      );
      const forPurchaseIds = await this.trucksOf(
        em,
        tenant.companyId,
        dto.supplierId,
        dto.forPurchaseIds ?? [],
      );

      if (isCheque) {
        await this.assertChequeFree(
          em,
          tenant.companyId,
          dto.accountId,
          dto.chequeNo!,
        );
      }
      if (dto.replacesChequeId) {
        await this.assertReplaceable(
          em,
          tenant.companyId,
          dto.replacesChequeId,
          dto.supplierId,
        );
      }

      // Voucher numbers continue per company; the lock makes two payments at
      // once take different numbers.
      await em.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `supplier_payment:${tenant.companyId}`,
      ]);
      const [next] = await query<{ seq: number }>(
        em,
        `SELECT COALESCE(MAX("voucherSeq"), 0) + 1 AS seq FROM supplier_payment WHERE "companyId" = $1`,
        [tenant.companyId],
      );

      const repo = em.getRepository(SupplierPaymentEntity);
      const payment = await this.guard(() =>
        repo.save(
          repo.create({
            company: { id: tenant.companyId },
            voucherSeq: next.seq,
            date: dto.date,
            supplier: { id: dto.supplierId },
            method: dto.method,
            account: { id: dto.accountId },
            amount: dto.amount,
            reference:
              dto.method === 'bank_transfer' ? (dto.reference ?? '') : '',
            forPurchaseIds,
            status: 'pending',
            note: dto.note ?? '',
            createdBy: { id: tenant.memberId },
          }),
        ),
      );

      if (isCheque) {
        await this.guard(() =>
          em.getRepository(SupplierChequeEntity).save(
            em.getRepository(SupplierChequeEntity).create({
              company: { id: tenant.companyId },
              no: dto.chequeNo!,
              account: { id: dto.accountId },
              supplier: { id: dto.supplierId },
              amount: dto.amount,
              issuedOn: dto.date,
              chequeDate: dto.chequeDate!,
              status: 'issued',
              charge: 0,
              payment: { id: payment.id },
            }),
          ),
        );
      }

      if (dto.replacesChequeId) {
        await em.query(
          `UPDATE supplier_cheque SET "replacedByPaymentId" = $1, "updatedAt" = now()
           WHERE id = $2 AND "companyId" = $3`,
          [payment.id, dto.replacesChequeId, tenant.companyId],
        );
      }

      const { approval, needsApproval } = await this.approvals.request(
        {
          companyId: tenant.companyId,
          entityType: PAYMENT_ENTITY,
          entityId: payment.id,
          requestedByMemberId: tenant.memberId,
          approverPermission: PAYMENT_APPROVER,
          payload: {
            voucherNo: voucherNo(next.seq),
            method: dto.method,
            supplierId: dto.supplierId,
            amount: dto.amount,
            account: account.name,
          },
        },
        em,
      );

      await repo.update(
        { id: payment.id, ...inCompany(tenant.companyId) },
        { approvalId: approval.id },
      );

      if (!needsApproval) {
        await this.post(em, tenant.companyId, payment.id, tenant.memberId);
      }

      await this.audit.record(
        {
          actorType: 'member',
          actorId: tenant.memberId,
          action: 'supplier_payment.create',
          companyId: tenant.companyId,
          targetType: 'supplier_payment',
          targetId: payment.id,
          metadata: {
            method: dto.method,
            amount: dto.amount,
            pending: needsApproval,
          },
        },
        em,
      );

      return payment.id;
    });

    return this.get(tenant, id);
  }

  // Confirming makes the payment count: the money leaves the account (cash and
  // transfers) and the supplier is credited, in one transaction with the
  // decision. If posting fails (the account was deactivated) it stays pending.
  async confirm(
    tenant: TenantContext,
    id: string,
  ): Promise<SupplierPaymentView> {
    const row = await this.load(tenant.companyId, id);

    if (row.status !== 'pending' || !row.approvalId) {
      throw conflict('ALREADY_DECIDED');
    }

    await this.dataSource.transaction(async (em) => {
      await this.approvals.approve(
        {
          companyId: tenant.companyId,
          approvalId: row.approvalId!,
          decidedByMemberId: tenant.memberId,
          approverPermission: PAYMENT_APPROVER,
        },
        (_approval, manager) =>
          this.post(manager, tenant.companyId, id, tenant.memberId),
        em,
      );
      await this.audit.record(
        {
          actorType: 'member',
          actorId: tenant.memberId,
          action: 'supplier_payment.confirm',
          companyId: tenant.companyId,
          targetType: 'supplier_payment',
          targetId: id,
        },
        em,
      );
    });

    return this.get(tenant, id);
  }

  // Rejecting reverses a pending payment: nothing was ever posted, and its
  // cheque is cancelled.
  async reject(
    tenant: TenantContext,
    id: string,
    reason?: string,
  ): Promise<SupplierPaymentView> {
    const row = await this.load(tenant.companyId, id);

    if (row.status !== 'pending' || !row.approvalId) {
      throw conflict('ALREADY_DECIDED');
    }

    const cleanReason = reason?.trim() || 'Rejected';

    await this.dataSource.transaction(async (em) => {
      await this.approvals.reject(
        {
          companyId: tenant.companyId,
          approvalId: row.approvalId!,
          decidedByMemberId: tenant.memberId,
          approverPermission: PAYMENT_APPROVER,
          reason: cleanReason,
        },
        em,
      );
      await em
        .getRepository(SupplierPaymentEntity)
        .update(
          { id, ...inCompany(tenant.companyId) },
          { status: 'reversed', approvedBy: { id: tenant.memberId } },
        );
      await em.query(
        `UPDATE supplier_cheque
         SET status = 'cancelled', "statusDate" = $1, reason = $2, "updatedAt" = now()
         WHERE "paymentId" = $3 AND "companyId" = $4`,
        [todayAtFactory(), cleanReason.slice(0, 500), id, tenant.companyId],
      );
      await this.audit.record(
        {
          actorType: 'member',
          actorId: tenant.memberId,
          action: 'supplier_payment.reject',
          companyId: tenant.companyId,
          targetType: 'supplier_payment',
          targetId: id,
        },
        em,
      );
    });

    return this.get(tenant, id);
  }

  // ------------------------------------------------------------- helpers

  // Makes a pending payment count. Runs inside the caller's transaction
  // (creating an auto-approved payment, or confirming a pending one).
  private async post(
    em: EntityManager,
    companyId: string,
    paymentId: string,
    approverMemberId: string,
  ): Promise<void> {
    const [row] = await query<{
      voucherSeq: number;
      date: string;
      supplierId: string;
      method: PaymentMethod;
      accountId: string;
      accountName: string;
      amount: string;
      reference: string;
      status: PaymentStatus;
      createdById: string;
      chequeNo: string | null;
      chequeDate: string | null;
    }>(
      em,
      `SELECT p."voucherSeq", p."date"::text AS "date", p."supplierId", p.method,
              p."accountId", a.name AS "accountName", p.amount, p.reference,
              p.status, p."createdById", c.no AS "chequeNo",
              c."chequeDate"::text AS "chequeDate"
       FROM supplier_payment p
       JOIN account a ON a.id = p."accountId"
       LEFT JOIN supplier_cheque c ON c."paymentId" = p.id
       WHERE p.id = $1 AND p."companyId" = $2
       FOR UPDATE OF p`,
      [paymentId, companyId],
    );

    if (!row) {
      throw notFound('id');
    }
    if (row.status !== 'pending') {
      throw conflict('ALREADY_DECIDED');
    }

    const amount = toNumber(row.amount);
    const voucher = voucherNo(row.voucherSeq);
    const detail =
      row.method === 'cheque'
        ? `Cheque no. ${row.chequeNo} · ${row.accountName} · dated ${row.chequeDate}`
        : row.method === 'cash'
          ? `Cash paid · ${voucher}`
          : `Bank transfer · ${row.accountName}${row.reference ? ` · ${row.reference}` : ''}`;

    // A cheque leaves the bank only when it clears; cash and transfers leave now.
    if (row.method !== 'cheque') {
      await this.ledger.post(
        {
          companyId,
          accountId: row.accountId,
          date: row.date,
          direction: 'out',
          amount,
          partyType: 'supplier',
          partyId: row.supplierId,
          sourceType: PAYMENT_SOURCE,
          sourceId: paymentId,
          note: `${detail} · ${voucher}`,
          createdByMemberId: row.createdById,
        },
        em,
      );
    }

    await this.ledger.postPartyEntry(
      {
        companyId,
        date: row.date,
        partyType: 'supplier',
        partyId: row.supplierId,
        side: 'credit',
        amount,
        sourceType: PAYMENT_SOURCE,
        sourceId: paymentId,
        note: detail,
      },
      em,
    );

    await em.query(
      `UPDATE supplier_payment
       SET status = 'confirmed', "approvedById" = $1, "updatedAt" = now()
       WHERE id = $2 AND "companyId" = $3`,
      [approverMemberId, paymentId, companyId],
    );
  }

  private view(
    row: SupplierPaymentEntity,
    chequeId: string | null,
  ): SupplierPaymentView {
    return {
      id: row.id,
      voucherNo: voucherNo(row.voucherSeq),
      date: row.date,
      supplierId: row.supplier.id,
      supplierName: row.supplier.name,
      method: row.method as PaymentMethod,
      accountId: row.account.id,
      accountName: row.account.name,
      amount: row.amount,
      reference: row.reference,
      chequeId,
      forPurchaseIds: row.forPurchaseIds ?? [],
      status: row.status as PaymentStatus,
      note: row.note,
      createdBy: personName(row.createdBy) ?? '',
    };
  }

  // payment id -> its cheque id
  private async chequeIds(companyId: string, paymentIds?: string[]) {
    const rows = await query<{ paymentId: string; id: string }>(
      this.dataSource.manager,
      `SELECT "paymentId", id FROM supplier_cheque
       WHERE "companyId" = $1 AND ($2::uuid[] IS NULL OR "paymentId" = ANY($2))`,
      [companyId, paymentIds ?? null],
    );

    return new Map(rows.map((row) => [row.paymentId, row.id]));
  }

  // Another company's payment looks exactly like one that does not exist.
  private async load(
    companyId: string,
    id: string,
  ): Promise<SupplierPaymentEntity> {
    const row = await this.payments.findOne({
      where: { id, ...inCompany(companyId) },
      relations: RELATIONS,
    });

    if (!row) {
      throw notFound('id');
    }

    return row;
  }

  private async activeSupplier(companyId: string, id: string) {
    const supplier = await this.suppliers.findOne({
      where: { id, ...inCompany(companyId), isActive: true },
      select: { id: true },
    });

    if (!supplier) {
      throw invalid({ supplierId: 'invalid' });
    }
  }

  // Cash is paid from a cash account; a transfer or cheque leaves a bank
  // account. A Munshi works with cash only, as everywhere in Cash & Bank.
  private async usableAccount(
    em: EntityManager,
    tenant: TenantContext,
    accountId: string,
    method: PaymentMethod,
  ) {
    const [account] = await query<{
      id: string;
      name: string;
      kind: 'cash' | 'bank';
      isActive: boolean;
    }>(
      em,
      `SELECT id, name, kind, "isActive" FROM account WHERE id = $1 AND "companyId" = $2`,
      [accountId, tenant.companyId],
    );

    if (!account) {
      throw invalid({ accountId: 'invalid' });
    }
    if (account.kind !== (method === 'cash' ? 'cash' : 'bank')) {
      throw invalid({ accountId: 'wrongKind' });
    }
    if (!account.isActive) {
      throw conflict('ACCOUNT_INACTIVE');
    }
    if (!canUseAccount(tenant.roleKey, account.kind)) {
      throw forbidden('BANK_ACCOUNT_NOT_ALLOWED');
    }

    return account;
  }

  // Every truck it is for must be this supplier's, in this company.
  private async trucksOf(
    em: EntityManager,
    companyId: string,
    supplierId: string,
    ids: string[],
  ): Promise<string[]> {
    const unique = [...new Set(ids)];

    if (unique.length === 0) {
      return [];
    }

    const found = await query<{ id: string }>(
      em,
      `SELECT id FROM purchase
       WHERE "companyId" = $1 AND "supplierId" = $2 AND id = ANY($3)`,
      [companyId, supplierId, unique],
    );

    if (found.length !== unique.length) {
      throw invalid({ forPurchaseIds: 'invalid' });
    }

    return unique;
  }

  // A cheque number is used once per bank account, unless it was cancelled.
  private async assertChequeFree(
    em: EntityManager,
    companyId: string,
    accountId: string,
    no: string,
  ) {
    const rows = await query<{ id: string }>(
      em,
      `SELECT id FROM supplier_cheque
       WHERE "companyId" = $1 AND "accountId" = $2 AND no = $3 AND status <> 'cancelled'`,
      [companyId, accountId, no],
    );

    if (rows.length > 0) {
      throw conflict('DUPLICATE_CHEQUE');
    }
  }

  // Only a bounced or returned cheque of the same supplier, replaced once.
  private async assertReplaceable(
    em: EntityManager,
    companyId: string,
    chequeId: string,
    supplierId: string,
  ) {
    const [cheque] = await query<{
      status: string;
      supplierId: string;
      replacedByPaymentId: string | null;
    }>(
      em,
      `SELECT status, "supplierId", "replacedByPaymentId" FROM supplier_cheque
       WHERE id = $1 AND "companyId" = $2 FOR UPDATE`,
      [chequeId, companyId],
    );

    if (!cheque) {
      throw invalid({ replacesChequeId: 'invalid' });
    }
    if (
      (cheque.status !== 'bounced' && cheque.status !== 'cancelled') ||
      cheque.supplierId !== supplierId ||
      cheque.replacedByPaymentId
    ) {
      throw conflict('NOT_REPLACEABLE');
    }
  }

  private async guard<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string }).code === PG_UNIQUE_VIOLATION
      ) {
        throw conflict('DUPLICATE_CHEQUE');
      }
      throw error;
    }
  }
}
