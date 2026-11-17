import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { CUSTOMER_PARTY } from '../customers/customer.types';
import { CustomersService } from '../customers/customers.service';
import { todayAtFactory } from '../engines/calendar-date';
import { query, toNumber } from '../engines/db';
import { conflict, forbidden, invalid, notFound } from '../engines/errors';
import { assertDate } from '../engines/guards';
import { LedgerService } from '../ledger-entries/ledger.service';
import { StockService } from '../stock-movements/stock.service';
import type { StockItemKey } from '../stock-movements/stock.types';
import { AuditService } from '../tenancy/audit.service';
import { TenantContext } from '../tenancy/tenant-context';
import { personName } from '../utils/person-name';
import { CustomerPaymentsService } from './customer-payments.service';
import { CreateBillDto, GiveStoneDto, UpdateBillDto } from './dto/sales.dto';
import { SaleLinesService, ResolvedSaleLine } from './sale-lines.service';
import {
  BILL_SOURCE,
  BillView,
  SALE_STOCK_SOURCE,
  billNo,
  collNo,
} from './sales.types';

type BillRow = {
  id: string;
  billSeq: number;
  date: string;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  walkinName: string;
  walkinPhone: string;
  factoryId: string;
  factoryName: string;
  discount: string;
  transport: string;
  total: string;
  status: 'active' | 'cancelled';
  orderId: string | null;
  note: string;
  cancelReason: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
};

const SELECT = `
  SELECT b.id, b."billSeq", b."date"::text AS "date", b."customerId", c.name AS "customerName", c.phone AS "customerPhone",
         b."walkinName", b."walkinPhone", b."factoryId", f.name AS "factoryName", b.discount, b.transport, b.total,
         b.status, b."orderId", b.note, b."cancelReason", u."firstName", u."lastName", u.phone, u.email
  FROM bill b
  LEFT JOIN customer c ON c.id = b."customerId"
  JOIN factory f ON f.id = b."factoryId"
  JOIN company_member cm ON cm.id = b."createdById"
  JOIN "user" u ON u.id = cm."userId"`;

const nameOf = (row: {
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
}) =>
  personName({
    user: {
      firstName: row.firstName,
      lastName: row.lastName,
      phone: row.phone,
      email: row.email,
    },
  }) ?? '';

// Sales bills (rules §7b). A bill is the price agreed with one customer for
// lines of stone; a customer bill charges their khata and a walk-in (no khata)
// pays in full now. Stone does not leave the yard when the bill is made but
// when it is collected: each collection is one stock movement, and what is
// booked on bills not yet collected cannot be sold twice. An edit takes the
// old charge back and posts the new one; a bill with stone already collected
// cannot be cancelled. Payments are received separately and covered oldest
// bill first.
@Injectable()
export class BillsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly lines: SaleLinesService,
    private readonly payments: CustomerPaymentsService,
    private readonly customers: CustomersService,
    private readonly ledger: LedgerService,
    private readonly stock: StockService,
    private readonly audit: AuditService,
  ) {}

  // Newest first.
  async list(tenant: TenantContext): Promise<BillView[]> {
    const rows = await query<BillRow>(
      this.dataSource.manager,
      `${SELECT} WHERE b."companyId" = $1 ORDER BY b."date" DESC, b."billSeq" DESC`,
      [tenant.companyId],
    );

    return this.views(tenant.companyId, rows);
  }

  async get(tenant: TenantContext, id: string): Promise<BillView> {
    const rows = await query<BillRow>(
      this.dataSource.manager,
      `${SELECT} WHERE b.id = $1 AND b."companyId" = $2`,
      [id, tenant.companyId],
    );

    if (rows.length === 0) {
      throw notFound('id');
    }

    return (await this.views(tenant.companyId, rows))[0];
  }

  async create(tenant: TenantContext, dto: CreateBillDto): Promise<BillView> {
    assertDate('date', dto.date);

    if (dto.date > todayAtFactory()) {
      throw conflict('DATE_IN_FUTURE');
    }

    const walkin = !!dto.walkin;

    if (!walkin && !dto.customerId && !(dto.name && dto.phone)) {
      throw invalid({ customerId: 'required' });
    }

    const id = await this.dataSource.transaction(async (em) => {
      const factoryId = await this.ownFactory(
        em,
        tenant.companyId,
        dto.factoryId,
      );
      const lines = await this.lines.resolve(
        em,
        tenant.companyId,
        factoryId,
        dto.lines,
      );

      this.lines.validate(lines);
      await this.assertOrderLines(em, tenant.companyId, lines);
      await this.lines.assertAvailable(
        em,
        tenant.companyId,
        factoryId,
        lines,
        new Map(),
      );

      const total = this.totalOf(lines, dto.discount ?? 0, dto.transport ?? 0);

      if (!(total > 0)) {
        throw conflict('TOTAL_REQUIRED');
      }

      const paid = dto.payment?.amount ?? 0;

      // A walk-in has no khata to owe into, so the whole bill is paid now.
      if (walkin && paid < total) {
        throw conflict('WALKIN_FULL_PAYMENT');
      }

      let customerId: string | null = null;

      if (!walkin) {
        customerId = await this.customerFor(em, tenant, dto);
      }
      if (dto.orderId) {
        const [order] = await query<{ id: string }>(
          em,
          `SELECT id FROM sales_order WHERE id = $1 AND "companyId" = $2 AND "customerId" = $3 AND NOT cancelled`,
          [dto.orderId, tenant.companyId, customerId],
        );

        if (!order) {
          throw invalid({ orderId: 'invalid' });
        }
      }

      await em.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `bill:${tenant.companyId}`,
      ]);
      const [next] = await query<{ seq: number }>(
        em,
        `SELECT COALESCE(MAX("billSeq"), 0) + 1 AS seq FROM bill WHERE "companyId" = $1`,
        [tenant.companyId],
      );
      const [bill] = await query<{ id: string }>(
        em,
        `INSERT INTO bill ("companyId", "billSeq", date, "customerId", "walkinName", "walkinPhone", "factoryId",
                           discount, transport, total, status, "orderId", note, "createdById")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', $11, $12, $13)
         RETURNING id`,
        [
          tenant.companyId,
          next.seq,
          dto.date,
          customerId,
          walkin ? (dto.name ?? '') : '',
          walkin ? (dto.phone ?? '') : '',
          factoryId,
          dto.discount ?? 0,
          dto.transport ?? 0,
          total,
          dto.orderId ?? null,
          dto.note ?? '',
          tenant.memberId,
        ],
      );

      await this.lines.insertLines(
        em,
        'bill_line',
        tenant.companyId,
        bill.id,
        lines,
      );
      await this.log(em, tenant, bill.id, dto.date, 'Bill made');

      if (customerId) {
        await this.charge(
          em,
          tenant.companyId,
          customerId,
          bill.id,
          dto.date,
          total,
          `Bill ${billNo(next.seq)}`,
        );
      }
      if (dto.payment && paid > 0) {
        await this.payments.record(em, tenant, {
          date: dto.date,
          customerId,
          walkinName: walkin ? (dto.name ?? '') : '',
          amount: paid,
          method: dto.payment.method,
          accountId: dto.payment.accountId,
          billId: bill.id,
          reference: billNo(next.seq),
        });
      }
      if (dto.takeAll) {
        await this.giveIn(em, tenant, bill.id, {
          date: dto.date,
          lines: lines.map((l) => ({
            lineNo: l.lineNo,
            qty: l.qty,
            inches: l.inches,
          })),
        });
      }

      await this.record(em, tenant, 'bill.create', bill.id, { total });

      return bill.id;
    });

    return this.get(tenant, id);
  }

  // Changes lines, rates, discount and transport. The old charge is taken
  // back and the new one posted.
  async update(
    tenant: TenantContext,
    id: string,
    dto: UpdateBillDto,
  ): Promise<BillView> {
    assertDate('date', dto.date);

    if (dto.date > todayAtFactory()) {
      throw conflict('DATE_IN_FUTURE');
    }

    await this.dataSource.transaction(async (em) => {
      const bill = await this.lock(em, tenant.companyId, id);

      if (bill.status !== 'active') {
        throw conflict('BILL_CANCELLED');
      }

      const lines = await this.lines.resolve(
        em,
        tenant.companyId,
        bill.factoryId,
        dto.lines,
      );

      this.lines.validate(lines);
      await this.assertOrderLines(em, tenant.companyId, lines, id);

      const collected = await this.collected(em, tenant.companyId, id);

      // A collected line cannot be removed or cut below what has left.
      for (const [lineNo, got] of collected) {
        const line = lines.find((l) => l.lineNo === lineNo);

        if (
          (!line && (got.qty > 0 || got.inches > 0)) ||
          (line &&
            (line.qty < got.qty ||
              (line.key.itemType === 'counter' && line.inches < got.inches)))
        ) {
          throw conflict('BELOW_COLLECTED', { collected: got.qty });
        }
      }

      await this.lines.assertAvailable(
        em,
        tenant.companyId,
        bill.factoryId,
        lines,
        collected,
        id,
      );

      const total = this.totalOf(lines, dto.discount ?? 0, dto.transport ?? 0);

      if (!(total > 0)) {
        throw conflict('TOTAL_REQUIRED');
      }

      if (bill.customerId) {
        await this.reverseCharge(
          em,
          tenant.companyId,
          bill.customerId,
          id,
          toNumber(bill.total),
          `Bill ${billNo(bill.billSeq)} edited · old charge taken back`,
          bill.date,
        );
        await this.charge(
          em,
          tenant.companyId,
          bill.customerId,
          id,
          dto.date,
          total,
          `Bill ${billNo(bill.billSeq)} · edited`,
        );
      }

      await em.query(`DELETE FROM bill_line WHERE "billId" = $1`, [id]);
      await this.lines.insertLines(
        em,
        'bill_line',
        tenant.companyId,
        id,
        lines,
      );
      await em.query(
        `UPDATE bill SET date = $1, discount = $2, transport = $3, note = $4, total = $5 WHERE id = $6 AND "companyId" = $7`,
        [
          dto.date,
          dto.discount ?? 0,
          dto.transport ?? 0,
          dto.note ?? '',
          total,
          id,
          tenant.companyId,
        ],
      );
      await this.log(
        em,
        tenant,
        id,
        todayAtFactory(),
        `Edited · new total ${total}`,
      );
      await this.record(em, tenant, 'bill.update', id, { total });
    });

    return this.get(tenant, id);
  }

  // Only if nothing was collected. Payments stay as the customer's advance.
  async cancel(
    tenant: TenantContext,
    id: string,
    reason: string,
  ): Promise<BillView> {
    await this.dataSource.transaction(async (em) => {
      const bill = await this.lock(em, tenant.companyId, id);

      if (bill.status !== 'active') {
        throw conflict('BILL_CANCELLED');
      }

      const [{ count }] = await query<{ count: string }>(
        em,
        `SELECT COUNT(*) AS count FROM bill_collection WHERE "billId" = $1`,
        [id],
      );

      if (toNumber(count) > 0) {
        throw conflict('HAS_COLLECTIONS');
      }

      if (bill.customerId) {
        await this.reverseCharge(
          em,
          tenant.companyId,
          bill.customerId,
          id,
          toNumber(bill.total),
          `Bill ${billNo(bill.billSeq)} cancelled`,
        );
      }

      await em.query(
        `UPDATE bill SET status = 'cancelled', "cancelReason" = $1 WHERE id = $2 AND "companyId" = $3`,
        [reason.slice(0, 500), id, tenant.companyId],
      );
      await this.log(em, tenant, id, todayAtFactory(), `Cancelled · ${reason}`);
      await this.record(em, tenant, 'bill.cancel', id, {});
    });

    return this.get(tenant, id);
  }

  // Gives stone now: the date, the vehicle, and how much of each line leaves
  // the yard.
  async give(
    tenant: TenantContext,
    id: string,
    dto: GiveStoneDto,
  ): Promise<BillView> {
    assertDate('date', dto.date);

    await this.dataSource.transaction((em) => this.giveIn(em, tenant, id, dto));

    return this.get(tenant, id);
  }

  // ------------------------------------------------------------- helpers

  private async giveIn(
    em: EntityManager,
    tenant: TenantContext,
    id: string,
    dto: Pick<GiveStoneDto, 'date' | 'vehicle' | 'receivedBy'> & {
      lines: { lineNo: number; qty: number; inches?: number }[];
    },
  ): Promise<void> {
    const bill = await this.lock(em, tenant.companyId, id);

    if (bill.status !== 'active') {
      throw conflict('BILL_CANCELLED');
    }
    if (dto.date > todayAtFactory()) {
      throw conflict('DATE_IN_FUTURE');
    }
    if (dto.date < bill.date) {
      throw conflict('DATE_BEFORE_BILL');
    }

    const give = dto.lines.filter((l) => l.qty > 0 || (l.inches ?? 0) > 0);

    if (give.length === 0) {
      throw conflict('NOTHING_TO_GIVE');
    }

    const stored = await query<{
      lineNo: number;
      itemType: StockItemKey['itemType'];
      finish: StockItemKey['finish'];
      materialId: string;
      sootTypeId: string | null;
      sootSizeId: string | null;
      counterWidthId: string | null;
      qty: number;
      inches: number | null;
    }>(
      em,
      `SELECT "lineNo", "itemType", finish, "materialId", "sootTypeId", "sootSizeId", "counterWidthId", qty, inches
       FROM bill_line WHERE "billId" = $1`,
      [id],
    );
    const collected = await this.collected(em, tenant.companyId, id);
    const keyOf = (l: (typeof stored)[number]): StockItemKey => ({
      factoryId: bill.factoryId,
      itemType: l.itemType,
      materialId: l.materialId,
      sootTypeId: l.sootTypeId,
      sootSizeId: l.sootSizeId,
      counterWidthId: l.counterWidthId,
      finish: l.finish,
    });

    for (const g of give) {
      const line = stored.find((l) => l.lineNo === g.lineNo);

      if (!line) {
        throw notFound('lineNo');
      }

      const got = collected.get(g.lineNo) ?? { qty: 0, inches: 0 };
      const remaining = line.qty - got.qty;
      const remainingInches =
        line.itemType === 'counter' ? (line.inches ?? 0) - got.inches : 0;

      if (g.qty > remaining || (g.inches ?? 0) > remainingInches) {
        throw conflict('MORE_THAN_REMAINING', { remaining });
      }

      const have = await this.stock.onHand(tenant.companyId, keyOf(line), em);

      if (g.qty > have.qty) {
        throw conflict('INSUFFICIENT_STOCK', { available: have.qty });
      }
      if (line.itemType === 'counter' && (g.inches ?? 0) > have.inches) {
        throw conflict('INSUFFICIENT_INCHES', { available: have.inches });
      }
    }

    await em.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `collection:${tenant.companyId}`,
    ]);
    const [next] = await query<{ seq: number }>(
      em,
      `SELECT COALESCE(MAX("collSeq"), 0) + 1 AS seq FROM bill_collection WHERE "companyId" = $1`,
      [tenant.companyId],
    );
    const [collection] = await query<{ id: string }>(
      em,
      `INSERT INTO bill_collection ("companyId", "billId", "collSeq", date, vehicle, "receivedBy", "createdById")
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        tenant.companyId,
        id,
        next.seq,
        dto.date,
        dto.vehicle ?? '',
        dto.receivedBy ?? '',
        tenant.memberId,
      ],
    );

    for (const g of give) {
      const line = stored.find((l) => l.lineNo === g.lineNo)!;
      const counter = line.itemType === 'counter';

      await em.query(
        `INSERT INTO collection_line ("companyId", "collectionId", "lineNo", qty, inches) VALUES ($1, $2, $3, $4, $5)`,
        [
          tenant.companyId,
          collection.id,
          g.lineNo,
          g.qty,
          counter ? (g.inches ?? 0) : 0,
        ],
      );
      // Stone leaves the yard only now, as one stock movement per line.
      await this.stock.post(
        {
          companyId: tenant.companyId,
          date: dto.date,
          key: keyOf(line),
          qty: -g.qty,
          inches: counter ? -(g.inches ?? 0) : undefined,
          sourceType: SALE_STOCK_SOURCE,
          sourceId: collection.id,
          note: collNo(next.seq),
          createdByMemberId: tenant.memberId,
        },
        em,
      );
    }

    const after = await this.remaining(em, id);

    await this.log(
      em,
      tenant,
      id,
      dto.date,
      `${after ? 'Part collected' : 'All stone collected'}${dto.vehicle ? ` · ${dto.vehicle}` : ''}`,
    );
    await this.record(em, tenant, 'bill.give', id, {
      collNo: collNo(next.seq),
    });
  }

  // Whether any stone is still to collect on the bill.
  private async remaining(em: EntityManager, billId: string): Promise<boolean> {
    const [row] = await query<{ left: string }>(
      em,
      `SELECT COALESCE(SUM(GREATEST(bl.qty - COALESCE(g.qty, 0), 0)
                       + GREATEST(COALESCE(bl.inches, 0) - COALESCE(g.inches, 0), 0)), 0) AS "left"
       FROM bill_line bl
       LEFT JOIN (
         SELECT cl."lineNo", SUM(cl.qty) AS qty, SUM(cl.inches) AS inches
         FROM bill_collection c JOIN collection_line cl ON cl."collectionId" = c.id
         WHERE c."billId" = $1 GROUP BY cl."lineNo"
       ) g ON g."lineNo" = bl."lineNo"
       WHERE bl."billId" = $1`,
      [billId],
    );

    return toNumber(row.left) > 0;
  }

  private async collected(
    em: EntityManager,
    companyId: string,
    billId: string,
  ): Promise<Map<number, { qty: number; inches: number }>> {
    const rows = await query<{ lineNo: number; qty: string; inches: string }>(
      em,
      `SELECT cl."lineNo", SUM(cl.qty) AS qty, SUM(cl.inches) AS inches
       FROM bill_collection c JOIN collection_line cl ON cl."collectionId" = c.id
       WHERE c."companyId" = $1 AND c."billId" = $2 GROUP BY cl."lineNo"`,
      [companyId, billId],
    );

    return new Map(
      rows.map((r) => [
        r.lineNo,
        { qty: toNumber(r.qty), inches: toNumber(r.inches) },
      ]),
    );
  }

  private totalOf(
    lines: ResolvedSaleLine[],
    discount: number,
    transport: number,
  ) {
    return lines.reduce((s, l) => s + l.amount, 0) - discount + transport;
  }

  // A bill line that fills an order line cannot go above what remains on it.
  private async assertOrderLines(
    em: EntityManager,
    companyId: string,
    lines: ResolvedSaleLine[],
    exceptBillId?: string,
  ) {
    for (const line of lines) {
      if (!line.orderLineId) {
        continue;
      }

      const [target] = await query<{ qty: number }>(
        em,
        `SELECT qty FROM order_line WHERE id = $1 AND "companyId" = $2`,
        [line.orderLineId, companyId],
      );

      if (!target) {
        throw invalid({ orderLineId: 'invalid' });
      }

      const [billed] = await query<{ qty: string }>(
        em,
        `SELECT COALESCE(SUM(bl.qty), 0) AS qty FROM bill_line bl JOIN bill b ON b.id = bl."billId"
         WHERE bl."orderLineId" = $1 AND b.status = 'active' AND ($2::uuid IS NULL OR b.id <> $2)`,
        [line.orderLineId, exceptBillId ?? null],
      );
      const remaining = Math.max(0, target.qty - toNumber(billed.qty));

      if (line.qty > remaining) {
        throw conflict('MORE_THAN_ORDER_REMAINING', { remaining });
      }
    }
  }

  private async customerFor(
    em: EntityManager,
    tenant: TenantContext,
    dto: CreateBillDto,
  ): Promise<string> {
    if (dto.customerId) {
      const [found] = await query<{ id: string }>(
        em,
        `SELECT id FROM customer WHERE id = $1 AND "companyId" = $2 AND "isActive"`,
        [dto.customerId, tenant.companyId],
      );

      if (!found) {
        throw invalid({ customerId: 'invalid' });
      }

      return found.id;
    }
    if (!tenant.permissions.includes('customers.create')) {
      throw forbidden('CUSTOMER_CREATE_NOT_ALLOWED');
    }

    return this.customers.insert(em, tenant.companyId, {
      name: dto.name!,
      phone: dto.phone!,
      type: dto.customerType ?? 'builder',
    });
  }

  private async ownFactory(
    em: EntityManager,
    companyId: string,
    factoryId: string,
  ): Promise<string> {
    const [factory] = await query<{ id: string }>(
      em,
      `SELECT id FROM factory WHERE id = $1 AND "companyId" = $2 AND "isActive" AND kind = 'own'`,
      [factoryId, companyId],
    );

    if (!factory) {
      throw invalid({ factoryId: 'invalid' });
    }

    return factory.id;
  }

  private charge(
    em: EntityManager,
    companyId: string,
    customerId: string,
    billId: string,
    date: string,
    amount: number,
    note: string,
  ) {
    return this.ledger.postPartyEntry(
      {
        companyId,
        date,
        partyType: CUSTOMER_PARTY,
        partyId: customerId,
        side: 'charge',
        amount,
        sourceType: BILL_SOURCE,
        sourceId: billId,
        note,
      },
      em,
    );
  }

  // The credit shares the charge's source, which the khata reads as a reversal.
  private reverseCharge(
    em: EntityManager,
    companyId: string,
    customerId: string,
    billId: string,
    amount: number,
    note: string,
    date = todayAtFactory(),
  ) {
    return this.ledger.postPartyEntry(
      {
        companyId,
        date,
        partyType: CUSTOMER_PARTY,
        partyId: customerId,
        side: 'credit',
        amount,
        sourceType: BILL_SOURCE,
        sourceId: billId,
        note,
      },
      em,
    );
  }

  private async lock(em: EntityManager, companyId: string, id: string) {
    const [row] = await query<{
      id: string;
      billSeq: number;
      date: string;
      status: 'active' | 'cancelled';
      customerId: string | null;
      factoryId: string;
      total: string;
    }>(
      em,
      `SELECT id, "billSeq", "date"::text AS "date", status, "customerId", "factoryId", total
       FROM bill WHERE id = $1 AND "companyId" = $2 FOR UPDATE`,
      [id, companyId],
    );

    if (!row) {
      throw notFound('id');
    }

    return row;
  }

  private async log(
    em: EntityManager,
    tenant: TenantContext,
    billId: string,
    date: string,
    text: string,
  ) {
    const [who] = await query<{
      firstName: string | null;
      lastName: string | null;
      phone: string | null;
      email: string | null;
    }>(
      em,
      `SELECT u."firstName", u."lastName", u.phone, u.email FROM company_member cm JOIN "user" u ON u.id = cm."userId" WHERE cm.id = $1`,
      [tenant.memberId],
    );

    await em.query(
      `INSERT INTO bill_log ("companyId", "billId", date, text, "byName") VALUES ($1, $2, $3, $4, $5)`,
      [tenant.companyId, billId, date, text, nameOf(who)],
    );
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
        targetType: 'bill',
        targetId: id,
        metadata,
      },
      em,
    );
  }

  private async views(companyId: string, rows: BillRow[]): Promise<BillView[]> {
    const em = this.dataSource.manager;
    const ids = rows.map((r) => r.id);
    const factoryOf = new Map(rows.map((r) => [r.id, r.factoryId]));
    const [lines, collections, payments, logs, allocations] = await Promise.all(
      [
        this.lines.views(companyId, 'bill_line', ids, factoryOf, em),
        query<{
          id: string;
          billId: string;
          collSeq: number;
          date: string;
          vehicle: string;
          receivedBy: string;
          firstName: string | null;
          lastName: string | null;
          phone: string | null;
          email: string | null;
        }>(
          em,
          `SELECT c.id, c."billId", c."collSeq", c."date"::text AS "date", c.vehicle, c."receivedBy",
                u."firstName", u."lastName", u.phone, u.email
         FROM bill_collection c JOIN company_member cm ON cm.id = c."createdById" JOIN "user" u ON u.id = cm."userId"
         WHERE c."companyId" = $1 AND c."billId" = ANY($2) ORDER BY c."collSeq"`,
          [companyId, ids],
        ),
        query<{
          id: string;
          billId: string;
          date: string;
          amount: string;
          method: 'cash' | 'bank';
          accountName: string | null;
        }>(
          em,
          `SELECT p.id, p."billId", p."date"::text AS "date", p.amount, p.method, a.name AS "accountName"
         FROM customer_payment p LEFT JOIN account a ON a.id = p."accountId"
         WHERE p."companyId" = $1 AND p."billId" = ANY($2) AND p.status = 'posted' AND p.method <> 'cheque'
         ORDER BY p."receiptSeq"`,
          [companyId, ids],
        ),
        query<{ billId: string; date: string; text: string; byName: string }>(
          em,
          `SELECT "billId", "date"::text AS "date", text, "byName" FROM bill_log
         WHERE "companyId" = $1 AND "billId" = ANY($2) ORDER BY "createdAt"`,
          [companyId, ids],
        ),
        this.customers.allocations(companyId, em),
      ],
    );
    const collectionLines = await query<{
      collectionId: string;
      lineNo: number;
      qty: number;
      inches: number;
    }>(
      em,
      `SELECT "collectionId", "lineNo", qty, inches FROM collection_line
       WHERE "companyId" = $1 AND "collectionId" = ANY($2) ORDER BY "lineNo"`,
      [companyId, collections.map((c) => c.id)],
    );

    return rows.map((row) => {
      const mine = payments.filter((p) => p.billId === row.id);
      const covered = row.customerId
        ? (allocations
            .get(row.customerId)
            ?.find((a) => a.ref === `${BILL_SOURCE}:${row.id}`)?.paid ?? 0)
        : mine.reduce((s, p) => s + toNumber(p.amount), 0);

      return {
        id: row.id,
        billNo: billNo(row.billSeq),
        date: row.date,
        customerId: row.customerId,
        customerName: row.customerName ?? row.walkinName,
        customerPhone: row.customerPhone ?? row.walkinPhone,
        factoryId: row.factoryId,
        factoryName: row.factoryName,
        lines: (lines.get(row.id) ?? []).map((line) => ({
          lineNo: line.lineNo,
          item: line.item,
          qty: line.qty,
          inches: line.inches,
          tons: line.tons,
          rate: line.rate,
          orderLineId: line.orderLineId,
        })),
        discount: toNumber(row.discount),
        transport: toNumber(row.transport),
        total: toNumber(row.total),
        status: row.status,
        orderId: row.orderId,
        note: row.note,
        cancelReason: row.cancelReason,
        collections: collections
          .filter((c) => c.billId === row.id)
          .map((c) => ({
            id: c.id,
            collNo: collNo(c.collSeq),
            date: c.date,
            vehicle: c.vehicle,
            receivedBy: c.receivedBy,
            lines: collectionLines
              .filter((l) => l.collectionId === c.id)
              .map((l) => ({ lineNo: l.lineNo, qty: l.qty, inches: l.inches })),
            createdBy: nameOf(c),
          })),
        payments: mine.map((p) => ({
          id: p.id,
          date: p.date,
          amount: toNumber(p.amount),
          method: p.method,
          accountName: p.accountName ?? '',
        })),
        log: logs
          .filter((l) => l.billId === row.id)
          .map((l) => ({ date: l.date, text: l.text, by: l.byName })),
        createdBy: nameOf(row),
        paid: covered,
      };
    });
  }
}
