import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { canUseAccount } from '../cash-bank/cash-bank.policy';
import { CUSTOMER_PARTY } from '../customers/customer.types';
import { CustomersService } from '../customers/customers.service';
import { todayAtFactory } from '../engines/calendar-date';
import { query, toNumber } from '../engines/db';
import { conflict, forbidden, invalid, notFound } from '../engines/errors';
import { assertDate } from '../engines/guards';
import { LedgerService } from '../ledger-entries/ledger.service';
import { AuditService } from '../tenancy/audit.service';
import { TenantContext } from '../tenancy/tenant-context';
import { personName } from '../utils/person-name';
import {
  ClearChequeDto,
  BounceChequeDto,
  ListPaymentsQueryDto,
  ReceivePaymentDto,
} from './dto/sales.dto';
import {
  CHEQUE_BOUNCE_SOURCE,
  CHEQUE_CLEAR_SOURCE,
  ChequeView,
  PAYMENT_RETURNED_SOURCE,
  PAYMENT_SOURCE,
  PaymentMethod,
  PaymentView,
  receiptNo,
} from './sales.types';

const PG_UNIQUE_VIOLATION = '23505';

type PaymentRow = {
  id: string;
  receiptSeq: number;
  date: string;
  customerId: string | null;
  customerName: string | null;
  walkinName: string;
  amount: string;
  method: PaymentMethod;
  accountId: string | null;
  accountName: string | null;
  billId: string | null;
  billSeq: number | null;
  orderId: string | null;
  orderSeq: number | null;
  note: string;
  status: 'posted' | 'reversed';
  chequeId: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
};

export type RecordPaymentInput = {
  date: string;
  customerId: string | null;
  walkinName?: string;
  amount: number;
  method: PaymentMethod;
  accountId?: string;
  bankName?: string;
  chequeNo?: string;
  chequeDate?: string;
  note?: string;
  billId?: string | null;
  orderId?: string | null;
  /** The bill or order it is for, for the khata line. */
  reference?: string;
};

const SELECT = `
  SELECT p.id, p."receiptSeq", p."date"::text AS "date", p."customerId", c.name AS "customerName", p."walkinName",
         p.amount, p.method, p."accountId", a.name AS "accountName", p."billId", b."billSeq", p."orderId", o."orderSeq",
         p.note, p.status, ch.id AS "chequeId", u."firstName", u."lastName", u.phone, u.email
  FROM customer_payment p
  LEFT JOIN customer c ON c.id = p."customerId"
  LEFT JOIN account a ON a.id = p."accountId"
  LEFT JOIN bill b ON b.id = p."billId"
  LEFT JOIN sales_order o ON o.id = p."orderId"
  LEFT JOIN customer_cheque ch ON ch."paymentId" = p.id
  JOIN company_member cm ON cm.id = p."createdById"
  JOIN "user" u ON u.id = cm."userId"`;

// Money received from customers (rules §7d). The customer's khata is credited
// when the money, or the cheque, is received. Cash and bank money reaches the
// account at once; a cheque reaches the bank only when it is cleared (see the
// cheque methods). Anything above what is owed stays as an advance. Taking a
// payment back puts the amount on the khata again as returned money and
// reverses the account row.
@Injectable()
export class CustomerPaymentsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly customers: CustomersService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  // Newest first.
  async list(
    tenant: TenantContext,
    filters: ListPaymentsQueryDto,
  ): Promise<PaymentView[]> {
    const rows = await query<PaymentRow>(
      this.dataSource.manager,
      `${SELECT}
       WHERE p."companyId" = $1 AND ($2::text IS NULL OR p.method = $2)
       ORDER BY p."date" DESC, p."receiptSeq" DESC`,
      [tenant.companyId, filters.method ?? null],
    );
    const q = filters.q?.trim().toLowerCase();
    const cheques = await this.chequeNumbers(tenant.companyId);

    return rows
      .map((r) => this.view(r))
      .filter(
        (p) =>
          !q ||
          [
            p.customerName,
            p.receiptNo,
            p.billNo ?? '',
            p.orderNo ?? '',
            (p.chequeId && cheques.get(p.chequeId)) || '',
          ].some((v) => v.toLowerCase().includes(q)),
      );
  }

  async receive(
    tenant: TenantContext,
    dto: ReceivePaymentDto,
  ): Promise<{ payment: PaymentView; advance: number }> {
    const customer = await this.customers.get(tenant, dto.customerId);
    const owed = Math.max(customer.balance, 0);

    const id = await this.dataSource.transaction(async (em) => {
      await this.assertTargets(em, tenant.companyId, dto);

      return this.record(em, tenant, {
        ...dto,
        customerId: dto.customerId,
        reference: await this.referenceOf(em, tenant.companyId, dto),
      });
    });

    return {
      payment: await this.get(tenant, id),
      advance: Math.max(0, dto.amount - owed),
    };
  }

  async get(tenant: TenantContext, id: string): Promise<PaymentView> {
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

  // Posts the receipt, the account row (cash, bank) and the khata credit, all
  // in the caller's transaction. A bill's payment-now and an order's advance
  // come through here too.
  async record(
    em: EntityManager,
    tenant: TenantContext,
    input: RecordPaymentInput,
  ): Promise<string> {
    assertDate('date', input.date);

    if (input.date > todayAtFactory()) {
      throw conflict('DATE_IN_FUTURE');
    }
    if (!(input.amount > 0)) {
      throw conflict('PAYMENT_AMOUNT');
    }

    const isCheque = input.method === 'cheque';

    if (isCheque) {
      if (!input.customerId) {
        throw invalid({ method: 'chequeNeedsCustomer' });
      }
      if (!input.bankName?.trim()) {
        throw invalid({ bankName: 'required' });
      }
      if (!input.chequeNo?.trim()) {
        throw invalid({ chequeNo: 'required' });
      }

      assertDate('chequeDate', input.chequeDate);
    }

    const account = isCheque
      ? null
      : await this.usableAccount(em, tenant, input.method, input.accountId);

    await em.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `customer_payment:${tenant.companyId}`,
    ]);
    const [next] = await query<{ seq: number }>(
      em,
      `SELECT COALESCE(MAX("receiptSeq"), 0) + 1 AS seq FROM customer_payment WHERE "companyId" = $1`,
      [tenant.companyId],
    );
    const [payment] = await query<{ id: string }>(
      em,
      `INSERT INTO customer_payment
         ("companyId", "receiptSeq", date, "customerId", "walkinName", amount, method, "accountId", "billId", "orderId", note, status, "createdById")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'posted', $12)
       RETURNING id`,
      [
        tenant.companyId,
        next.seq,
        input.date,
        input.customerId,
        input.walkinName ?? '',
        input.amount,
        input.method,
        account?.id ?? null,
        input.billId ?? null,
        input.orderId ?? null,
        input.note ?? '',
        tenant.memberId,
      ],
    );

    let detail: string;

    if (isCheque) {
      detail = `Cheque no. ${input.chequeNo!.trim()} · ${input.bankName!.trim()} · dated ${input.chequeDate}`;

      try {
        await em.query(
          `INSERT INTO customer_cheque
             ("companyId", "paymentId", "customerId", "bankName", "chequeNo", "chequeDate", "receivedOn", amount, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')`,
          [
            tenant.companyId,
            payment.id,
            input.customerId,
            input.bankName!.trim(),
            input.chequeNo!.trim(),
            input.chequeDate,
            input.date,
            input.amount,
          ],
        );
      } catch (error) {
        if (
          error instanceof QueryFailedError &&
          (error.driverError as { code?: string }).code === PG_UNIQUE_VIOLATION
        ) {
          throw conflict('DUPLICATE_CHEQUE');
        }
        throw error;
      }
    } else {
      const row = await this.ledger.post(
        {
          companyId: tenant.companyId,
          accountId: account!.id,
          date: input.date,
          direction: 'in',
          amount: input.amount,
          sourceType: PAYMENT_SOURCE,
          sourceId: payment.id,
          partyType: input.customerId ? CUSTOMER_PARTY : 'none',
          partyId: input.customerId,
          note: `Receipt ${receiptNo(next.seq)}`,
          createdByMemberId: tenant.memberId,
        },
        em,
      );

      await em.query(
        `UPDATE customer_payment SET "ledgerEntryId" = $1 WHERE id = $2`,
        [row.id, payment.id],
      );
      detail = `${input.orderId ? 'Advance received' : 'Payment received'} · ${
        input.method === 'cash' ? 'cash' : `bank · ${account!.name}`
      }${input.reference ? ` · ${input.reference}` : ''}`;
    }

    if (input.customerId) {
      await this.ledger.postPartyEntry(
        {
          companyId: tenant.companyId,
          date: input.date,
          partyType: CUSTOMER_PARTY,
          partyId: input.customerId,
          side: 'credit',
          amount: input.amount,
          sourceType: PAYMENT_SOURCE,
          sourceId: payment.id,
          note: detail,
        },
        em,
      );
    }

    await this.audit.record(
      {
        actorType: 'member',
        actorId: tenant.memberId,
        action: 'customer_payment.receive',
        companyId: tenant.companyId,
        targetType: 'customer_payment',
        targetId: payment.id,
        metadata: { method: input.method, amount: input.amount },
      },
      em,
    );

    return payment.id;
  }

  // Takes the payment back: the amount goes onto the khata again as returned
  // money and the account row (or the cleared cheque's) is reversed. The
  // receipt stays, marked.
  async reverse(tenant: TenantContext, id: string): Promise<PaymentView> {
    await this.dataSource.transaction(async (em) => {
      const [payment] = await query<{
        id: string;
        status: string;
        amount: string;
        customerId: string | null;
        ledgerEntryId: string | null;
        receiptSeq: number;
      }>(
        em,
        `SELECT id, status, amount, "customerId", "ledgerEntryId", "receiptSeq" FROM customer_payment
         WHERE id = $1 AND "companyId" = $2 FOR UPDATE`,
        [id, tenant.companyId],
      );

      if (!payment) {
        throw notFound('id');
      }
      if (payment.status !== 'posted') {
        throw conflict('ALREADY_REVERSED');
      }

      const [cheque] = await query<{
        id: string;
        status: string;
        clearEntryId: string | null;
      }>(
        em,
        `SELECT id, status, "clearEntryId" FROM customer_cheque WHERE "paymentId" = $1 FOR UPDATE`,
        [id],
      );

      if (cheque?.status === 'bounced') {
        throw conflict('ALREADY_RETURNED');
      }

      const today = todayAtFactory();

      for (const entryId of [payment.ledgerEntryId, cheque?.clearEntryId]) {
        if (entryId) {
          await this.ledger.reverse(
            {
              companyId: tenant.companyId,
              entryId,
              date: today,
              reason: `Receipt ${receiptNo(payment.receiptSeq)} reversed`,
              createdByMemberId: tenant.memberId,
            },
            em,
          );
        }
      }

      if (payment.customerId) {
        await this.ledger.postPartyEntry(
          {
            companyId: tenant.companyId,
            date: today,
            partyType: CUSTOMER_PARTY,
            partyId: payment.customerId,
            side: 'charge',
            amount: toNumber(payment.amount),
            sourceType: PAYMENT_RETURNED_SOURCE,
            sourceId: id,
            note: `Payment ${receiptNo(payment.receiptSeq)} reversed`,
          },
          em,
        );
      }

      await em.query(
        `UPDATE customer_payment SET status = 'reversed' WHERE id = $1`,
        [id],
      );
      await this.audit.record(
        {
          actorType: 'member',
          actorId: tenant.memberId,
          action: 'customer_payment.reverse',
          companyId: tenant.companyId,
          targetType: 'customer_payment',
          targetId: id,
          metadata: { amount: toNumber(payment.amount) },
        },
        em,
      );
    });

    return this.get(tenant, id);
  }

  // ------------------------------------------------------------- cheques

  // A reversed payment's cheque is dropped from the list.
  async cheques(tenant: TenantContext): Promise<ChequeView[]> {
    const rows = await query<{
      id: string;
      paymentId: string;
      customerId: string;
      customerName: string;
      bankName: string;
      chequeNo: string;
      chequeDate: string;
      receivedOn: string;
      amount: string;
      status: ChequeView['status'];
      depositAccountId: string | null;
      depositAccountName: string | null;
      clearedOn: string | null;
      bouncedOn: string | null;
      bounceReason: string | null;
    }>(
      this.dataSource.manager,
      `SELECT c.id, c."paymentId", c."customerId", cu.name AS "customerName", c."bankName", c."chequeNo",
              c."chequeDate"::text AS "chequeDate", c."receivedOn"::text AS "receivedOn", c.amount, c.status,
              c."depositAccountId", a.name AS "depositAccountName", c."clearedOn"::text AS "clearedOn",
              c."bouncedOn"::text AS "bouncedOn", c."bounceReason"
       FROM customer_cheque c
       JOIN customer_payment p ON p.id = c."paymentId"
       JOIN customer cu ON cu.id = c."customerId"
       LEFT JOIN account a ON a.id = c."depositAccountId"
       WHERE c."companyId" = $1 AND p.status = 'posted'
       ORDER BY c."chequeDate", c."createdAt"`,
      [tenant.companyId],
    );

    return rows.map((r) => ({ ...r, amount: toNumber(r.amount) }));
  }

  // Deposited: the money reaches the chosen bank on the cleared date.
  async clear(
    tenant: TenantContext,
    id: string,
    dto: ClearChequeDto,
  ): Promise<ChequeView> {
    assertDate('date', dto.date);

    await this.dataSource.transaction(async (em) => {
      const cheque = await this.pending(em, tenant.companyId, id);

      if (dto.date > todayAtFactory()) {
        throw conflict('DATE_IN_FUTURE');
      }
      if (dto.date < cheque.receivedOn) {
        throw conflict('BEFORE_RECEIVED');
      }

      const account = await this.usableAccount(
        em,
        tenant,
        'bank',
        dto.accountId,
      );
      const row = await this.ledger.post(
        {
          companyId: tenant.companyId,
          accountId: account.id,
          date: dto.date,
          direction: 'in',
          amount: toNumber(cheque.amount),
          sourceType: CHEQUE_CLEAR_SOURCE,
          sourceId: id,
          partyType: CUSTOMER_PARTY,
          partyId: cheque.customerId,
          note: `Cheque no. ${cheque.chequeNo} cleared`,
          createdByMemberId: tenant.memberId,
        },
        em,
      );

      await em.query(
        `UPDATE customer_cheque SET status = 'cleared', "depositAccountId" = $1, "clearedOn" = $2, "clearEntryId" = $3 WHERE id = $4`,
        [account.id, dto.date, row.id, id],
      );
      await this.record2(em, tenant, 'customer_cheque.clear', id);
    });

    return this.chequeOf(tenant, id);
  }

  // The customer owes again: the amount goes back on the khata as a charge and
  // the original receipt stays.
  async bounce(
    tenant: TenantContext,
    id: string,
    dto: BounceChequeDto,
  ): Promise<ChequeView> {
    assertDate('date', dto.date);

    await this.dataSource.transaction(async (em) => {
      const cheque = await this.pending(em, tenant.companyId, id);

      if (dto.date > todayAtFactory()) {
        throw conflict('DATE_IN_FUTURE');
      }

      await this.ledger.postPartyEntry(
        {
          companyId: tenant.companyId,
          date: dto.date,
          partyType: CUSTOMER_PARTY,
          partyId: cheque.customerId,
          side: 'charge',
          amount: toNumber(cheque.amount),
          sourceType: CHEQUE_BOUNCE_SOURCE,
          sourceId: cheque.paymentId,
          note: `Cheque #${cheque.chequeNo} bounced`,
        },
        em,
      );
      await em.query(
        `UPDATE customer_cheque SET status = 'bounced', "bouncedOn" = $1, "bounceReason" = $2 WHERE id = $3`,
        [dto.date, dto.reason.slice(0, 500), id],
      );
      await this.record2(em, tenant, 'customer_cheque.bounce', id);
    });

    return this.chequeOf(tenant, id);
  }

  // ------------------------------------------------------------- helpers

  private async chequeOf(
    tenant: TenantContext,
    id: string,
  ): Promise<ChequeView> {
    const found = (await this.cheques(tenant)).find((c) => c.id === id);

    if (!found) {
      throw notFound('id');
    }

    return found;
  }

  private async pending(em: EntityManager, companyId: string, id: string) {
    const [cheque] = await query<{
      id: string;
      customerId: string;
      paymentId: string;
      chequeNo: string;
      amount: string;
      status: string;
      receivedOn: string;
    }>(
      em,
      `SELECT c.id, c."customerId", c."paymentId", c."chequeNo", c.amount, c.status, c."receivedOn"::text AS "receivedOn"
       FROM customer_cheque c JOIN customer_payment p ON p.id = c."paymentId"
       WHERE c.id = $1 AND c."companyId" = $2 AND p.status = 'posted' FOR UPDATE OF c`,
      [id, companyId],
    );

    if (!cheque) {
      throw notFound('id');
    }
    if (cheque.status !== 'pending') {
      throw conflict('ALREADY_DECIDED');
    }

    return cheque;
  }

  private record2(
    em: EntityManager,
    tenant: TenantContext,
    action: string,
    id: string,
  ) {
    return this.audit.record(
      {
        actorType: 'member',
        actorId: tenant.memberId,
        action,
        companyId: tenant.companyId,
        targetType: 'customer_cheque',
        targetId: id,
        metadata: {},
      },
      em,
    );
  }

  // Cash goes into the cash in hand unless an account is named; bank money
  // needs a bank account. A munshi only works with the cash in hand.
  private async usableAccount(
    em: EntityManager,
    tenant: TenantContext,
    method: PaymentMethod,
    accountId?: string,
  ) {
    const kind = method === 'cash' ? 'cash' : 'bank';
    const [account] = await query<{
      id: string;
      name: string;
      kind: 'cash' | 'bank';
      isActive: boolean;
    }>(
      em,
      accountId
        ? `SELECT id, name, kind, "isActive" FROM account WHERE id = $1 AND "companyId" = $2`
        : `SELECT id, name, kind, "isActive" FROM account WHERE $1::uuid IS NULL AND "companyId" = $2 AND kind = 'cash' AND "isActive" ORDER BY "createdAt" LIMIT 1`,
      [accountId ?? null, tenant.companyId],
    );

    if (!account) {
      throw invalid({ accountId: accountId ? 'invalid' : 'required' });
    }
    if (account.kind !== kind) {
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

  private async assertTargets(
    em: EntityManager,
    companyId: string,
    dto: ReceivePaymentDto,
  ) {
    if (dto.billId) {
      const [bill] = await query<{ id: string }>(
        em,
        `SELECT id FROM bill WHERE id = $1 AND "companyId" = $2 AND ("customerId" = $3)`,
        [dto.billId, companyId, dto.customerId],
      );

      if (!bill) {
        throw invalid({ billId: 'invalid' });
      }
    }
    if (dto.orderId) {
      const [order] = await query<{ id: string }>(
        em,
        `SELECT id FROM sales_order WHERE id = $1 AND "companyId" = $2 AND "customerId" = $3`,
        [dto.orderId, companyId, dto.customerId],
      );

      if (!order) {
        throw invalid({ orderId: 'invalid' });
      }
    }
  }

  private async referenceOf(
    em: EntityManager,
    companyId: string,
    dto: ReceivePaymentDto,
  ): Promise<string | undefined> {
    if (dto.billId) {
      const [b] = await query<{ billSeq: number }>(
        em,
        `SELECT "billSeq" FROM bill WHERE id = $1 AND "companyId" = $2`,
        [dto.billId, companyId],
      );

      return b ? `B-${String(b.billSeq).padStart(4, '0')}` : undefined;
    }
    if (dto.orderId) {
      const [o] = await query<{ orderSeq: number }>(
        em,
        `SELECT "orderSeq" FROM sales_order WHERE id = $1 AND "companyId" = $2`,
        [dto.orderId, companyId],
      );

      return o ? `OR-${String(o.orderSeq).padStart(3, '0')}` : undefined;
    }

    return undefined;
  }

  private async chequeNumbers(companyId: string): Promise<Map<string, string>> {
    const rows = await query<{ id: string; chequeNo: string }>(
      this.dataSource.manager,
      `SELECT id, "chequeNo" FROM customer_cheque WHERE "companyId" = $1`,
      [companyId],
    );

    return new Map(rows.map((r) => [r.id, r.chequeNo]));
  }

  private view(row: PaymentRow): PaymentView {
    return {
      id: row.id,
      receiptNo: receiptNo(row.receiptSeq),
      date: row.date,
      customerId: row.customerId,
      customerName: row.customerName ?? row.walkinName,
      amount: toNumber(row.amount),
      method: row.method,
      accountId: row.accountId ?? '',
      accountName: row.accountName ?? '',
      billId: row.billId,
      billNo:
        row.billSeq === null
          ? null
          : `B-${String(row.billSeq).padStart(4, '0')}`,
      orderId: row.orderId,
      orderNo:
        row.orderSeq === null
          ? null
          : `OR-${String(row.orderSeq).padStart(3, '0')}`,
      note: row.note,
      status: row.status,
      chequeId: row.chequeId,
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
