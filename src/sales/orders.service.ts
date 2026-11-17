import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { todayAtFactory } from '../engines/calendar-date';
import { query, toNumber } from '../engines/db';
import { conflict, invalid, notFound } from '../engines/errors';
import { assertDate } from '../engines/guards';
import { AuditService } from '../tenancy/audit.service';
import { TenantContext } from '../tenancy/tenant-context';
import { personName } from '../utils/person-name';
import { CustomerPaymentsService } from './customer-payments.service';
import { CreateOrderDto } from './dto/sales.dto';
import { SaleLinesService } from './sale-lines.service';
import { OrderView, orderNo } from './sales.types';

type OrderRow = {
  id: string;
  orderSeq: number;
  date: string;
  customerId: string;
  customerName: string;
  factoryId: string;
  factoryName: string;
  neededBy: string;
  cancelled: boolean;
  note: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
};

const SELECT = `
  SELECT o.id, o."orderSeq", o."date"::text AS "date", o."customerId", c.name AS "customerName", o."factoryId",
         f.name AS "factoryName", o."neededBy"::text AS "neededBy", o.cancelled, o.note,
         u."firstName", u."lastName", u.phone, u.email
  FROM sales_order o
  JOIN customer c ON c.id = o."customerId"
  JOIN factory f ON f.id = o."factoryId"
  JOIN company_member cm ON cm.id = o."createdById"
  JOIN "user" u ON u.id = cm."userId"`;

// A customer's order for stone that is not ready yet (rules §7c). No stone is
// reserved by an order (only a bill reserves); it records the need and the
// advance, and turns into bills as stone becomes ready. Walk-ins cannot order.
@Injectable()
export class OrdersService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly lines: SaleLinesService,
    private readonly payments: CustomerPaymentsService,
    private readonly audit: AuditService,
  ) {}

  // Soonest needed first.
  async list(tenant: TenantContext): Promise<OrderView[]> {
    const rows = await query<OrderRow>(
      this.dataSource.manager,
      `${SELECT} WHERE o."companyId" = $1 ORDER BY o."neededBy", o."orderSeq"`,
      [tenant.companyId],
    );

    return this.views(tenant.companyId, rows);
  }

  async get(tenant: TenantContext, id: string): Promise<OrderView> {
    const rows = await query<OrderRow>(
      this.dataSource.manager,
      `${SELECT} WHERE o.id = $1 AND o."companyId" = $2`,
      [id, tenant.companyId],
    );

    if (rows.length === 0) {
      throw notFound('id');
    }

    return (await this.views(tenant.companyId, rows))[0];
  }

  async create(tenant: TenantContext, dto: CreateOrderDto): Promise<OrderView> {
    assertDate('date', dto.date);
    assertDate('neededBy', dto.neededBy);

    if (dto.date > todayAtFactory()) {
      throw conflict('DATE_IN_FUTURE');
    }
    if (dto.neededBy < dto.date) {
      throw conflict('NEEDED_BEFORE_ORDER');
    }

    const id = await this.dataSource.transaction(async (em) => {
      const [customer] = await query<{ id: string }>(
        em,
        `SELECT id FROM customer WHERE id = $1 AND "companyId" = $2 AND "isActive"`,
        [dto.customerId, tenant.companyId],
      );

      if (!customer) {
        throw invalid({ customerId: 'invalid' });
      }

      const [factory] = await query<{ id: string }>(
        em,
        `SELECT id FROM factory WHERE id = $1 AND "companyId" = $2 AND "isActive" AND kind = 'own'`,
        [dto.factoryId, tenant.companyId],
      );

      if (!factory) {
        throw invalid({ factoryId: 'invalid' });
      }

      const lines = await this.lines.resolve(
        em,
        tenant.companyId,
        dto.factoryId,
        dto.lines,
      );

      this.lines.validate(lines);

      await em.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `sales_order:${tenant.companyId}`,
      ]);
      const [next] = await query<{ seq: number }>(
        em,
        `SELECT COALESCE(MAX("orderSeq"), 0) + 1 AS seq FROM sales_order WHERE "companyId" = $1`,
        [tenant.companyId],
      );
      const [order] = await query<{ id: string }>(
        em,
        `INSERT INTO sales_order ("companyId", "orderSeq", date, "neededBy", "customerId", "factoryId", note, "createdById")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          tenant.companyId,
          next.seq,
          dto.date,
          dto.neededBy,
          dto.customerId,
          dto.factoryId,
          dto.note ?? '',
          tenant.memberId,
        ],
      );

      await this.lines.insertLines(
        em,
        'order_line',
        tenant.companyId,
        order.id,
        lines,
      );

      // The advance is a credit on the customer's khata, covered against
      // their bills oldest first as they are made.
      if (dto.advance && dto.advance.amount > 0) {
        await this.payments.record(em, tenant, {
          date: dto.date,
          customerId: dto.customerId,
          amount: dto.advance.amount,
          method: dto.advance.method,
          accountId: dto.advance.accountId,
          orderId: order.id,
          reference: orderNo(next.seq),
        });
      }

      await this.audit.record(
        {
          actorType: 'member',
          actorId: tenant.memberId,
          action: 'order.create',
          companyId: tenant.companyId,
          targetType: 'sales_order',
          targetId: order.id,
          metadata: { orderNo: orderNo(next.seq) },
        },
        em,
      );

      return order.id;
    });

    return this.get(tenant, id);
  }

  // Lines already billed stay on their bills and the advance stays in the
  // khata.
  async cancel(tenant: TenantContext, id: string): Promise<OrderView> {
    const result = await this.dataSource.query(
      `UPDATE sales_order SET cancelled = true WHERE id = $1 AND "companyId" = $2`,
      [id, tenant.companyId],
    );

    if (!result[1]) {
      throw notFound('id');
    }

    await this.audit.record({
      actorType: 'member',
      actorId: tenant.memberId,
      action: 'order.cancel',
      companyId: tenant.companyId,
      targetType: 'sales_order',
      targetId: id,
      metadata: {},
    });

    return this.get(tenant, id);
  }

  private async views(
    companyId: string,
    rows: OrderRow[],
  ): Promise<OrderView[]> {
    const em = this.dataSource.manager;
    const ids = rows.map((r) => r.id);
    const [lines, advances] = await Promise.all([
      this.lines.views(
        companyId,
        'order_line',
        ids,
        new Map(rows.map((r) => [r.id, r.factoryId])),
        em,
      ),
      query<{
        id: string;
        orderId: string;
        date: string;
        amount: string;
        method: 'cash' | 'bank';
        accountName: string | null;
      }>(
        em,
        `SELECT p.id, p."orderId", p."date"::text AS "date", p.amount, p.method, a.name AS "accountName"
         FROM customer_payment p LEFT JOIN account a ON a.id = p."accountId"
         WHERE p."companyId" = $1 AND p."orderId" = ANY($2) AND p.status = 'posted' AND p.method <> 'cheque'
         ORDER BY p."receiptSeq"`,
        [companyId, ids],
      ),
    ]);

    return rows.map((row) => ({
      id: row.id,
      orderNo: orderNo(row.orderSeq),
      date: row.date,
      customerId: row.customerId,
      customerName: row.customerName,
      factoryId: row.factoryId,
      factoryName: row.factoryName,
      neededBy: row.neededBy,
      cancelled: row.cancelled,
      note: row.note,
      lines: lines.get(row.id) ?? [],
      advances: advances
        .filter((a) => a.orderId === row.id)
        .map((a) => ({
          id: a.id,
          date: a.date,
          amount: toNumber(a.amount),
          method: a.method,
          accountName: a.accountName ?? '',
        })),
      createdBy:
        personName({
          user: {
            firstName: row.firstName,
            lastName: row.lastName,
            phone: row.phone,
            email: row.email,
          },
        }) ?? '',
    }));
  }
}
