import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { todayAtFactory } from '../engines/calendar-date';
import { query, toNumber } from '../engines/db';
import { conflict, forbidden, notFound } from '../engines/errors';
import { assertDate } from '../engines/guards';
import { AuditService } from '../tenancy/audit.service';
import { TenantContext } from '../tenancy/tenant-context';
import {
  CreateCustomerDto,
  ListCustomersQueryDto,
  UpdateCustomerDto,
} from './dto/customer.dto';
import {
  CUSTOMER_PARTY,
  CustomerKhataRow,
  CustomerSummary,
  CustomerType,
  CustomerView,
  RETURNED_SOURCES,
} from './customer.types';

const PG_UNIQUE_VIOLATION = '23505';
const OPENING_PERMISSION = 'customers.editOpening';

const digits = (phone: string) => phone.replace(/\D/g, '');

type CustomerRow = {
  id: string;
  name: string;
  type: CustomerType;
  phone: string;
  city: string;
  contactPerson: string;
  openingBalance: string;
  openingDate: string;
  isActive: boolean;
};

export type LedgerRow = {
  id: string;
  partyId: string;
  date: string;
  charge: string | null;
  credit: string | null;
  sourceType: string;
  sourceId: string | null;
  note: string | null;
};

const SELECT = `SELECT id, name, type, phone, city, "contactPerson", "openingBalance", "openingDate"::text AS "openingDate", "isActive" FROM customer`;

function toView(row: CustomerRow): CustomerView {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    type: row.type,
    city: row.city,
    contactPerson: row.contactPerson,
    openingBalance: toNumber(row.openingBalance),
    openingDate: row.openingDate,
    isActive: row.isActive,
  };
}

const refOf = (row: LedgerRow) => `${row.sourceType}:${row.sourceId ?? row.id}`;

const daysSince = (date: string) =>
  Math.max(
    0,
    Math.round(
      (new Date(`${todayAtFactory()}T00:00:00Z`).getTime() -
        new Date(`${date}T00:00:00Z`).getTime()) /
        86_400_000,
    ),
  );

// Payments are applied to the oldest charges first; an advance covers later
// bills by itself. A bill's charge is its charges minus its reversals. Oldest
// first, with how much of each is covered.
export function allocate(
  customer: Pick<CustomerView, 'openingBalance' | 'openingDate'>,
  ledger: LedgerRow[],
): { ref: string; date: string; amount: number; paid: number }[] {
  const charged = new Set(
    ledger.filter((r) => r.charge !== null).map((r) => refOf(r)),
  );
  const items = new Map<string, { date: string; amount: number }>();
  const add = (ref: string, date: string, amount: number) => {
    const cur = items.get(ref);
    items.set(ref, {
      date: cur?.date ?? date,
      amount: (cur?.amount ?? 0) + amount,
    });
  };

  if (customer.openingBalance > 0) {
    add('opening', customer.openingDate, customer.openingBalance);
  }

  let pool = Math.max(-customer.openingBalance, 0);

  for (const r of ledger) {
    if (r.charge !== null) {
      add(refOf(r), r.date, toNumber(r.charge));
    } else if (charged.has(refOf(r))) {
      add(refOf(r), r.date, -toNumber(r.credit));
    } else {
      pool += toNumber(r.credit);
    }
  }

  return [...items.entries()]
    .filter(([, i]) => i.amount > 0)
    .sort((a, b) => a[1].date.localeCompare(b[1].date))
    .map(([ref, item]) => {
      const paid = Math.min(pool, item.amount);
      pool -= paid;
      return { ref, ...item, paid };
    });
}

// Customers (rules §7): builders, dealers and cutting customers, each with one
// khata in the party ledger that bills, cutting charges, payments and cheques
// all post to. Every figure is worked out from the ledger rows, never stored.
// A credit that matches a charge (same source) is a reversal; a charge from a
// bounced cheque is "returned".
@Injectable()
export class CustomersService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  // Highest balance first.
  async list(
    tenant: TenantContext,
    filters: ListCustomersQueryDto,
  ): Promise<CustomerSummary[]> {
    const [customers, ledger, uncleared] = await Promise.all([
      query<CustomerRow>(
        this.dataSource.manager,
        `${SELECT} WHERE "companyId" = $1 AND ($2::text IS NULL OR type = $2)`,
        [tenant.companyId, filters.type ?? null],
      ),
      this.ledgerRows(tenant.companyId),
      this.unclearedCheques(tenant.companyId),
    ]);
    const byCustomer = new Map<string, LedgerRow[]>();

    for (const row of ledger) {
      byCustomer.set(row.partyId, [
        ...(byCustomer.get(row.partyId) ?? []),
        row,
      ]);
    }

    return customers
      .map((c) =>
        this.summarise(
          toView(c),
          byCustomer.get(c.id) ?? [],
          uncleared.get(c.id),
        ),
      )
      .filter(
        (c) =>
          !filters.balance ||
          (filters.balance === 'due' && c.balance > 0) ||
          (filters.balance === 'advance' && c.balance < 0) ||
          (filters.balance === 'old30' &&
            (c.oldestUnpaidDays ?? 0) >= 30 &&
            c.balance > 0),
      )
      .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
  }

  async get(tenant: TenantContext, id: string): Promise<CustomerSummary> {
    const row = await this.load(tenant.companyId, id);
    const ledger = await this.ledgerRows(tenant.companyId, id);

    const uncleared = await this.unclearedCheques(tenant.companyId, id);

    return this.summarise(toView(row), ledger, uncleared.get(id));
  }

  // The opening balance first, then every ledger row with the running balance.
  async khata(tenant: TenantContext, id: string): Promise<CustomerKhataRow[]> {
    const customer = toView(await this.load(tenant.companyId, id));
    const ledger = await this.ledgerRows(tenant.companyId, id);
    const charged = new Set(
      ledger.filter((r) => r.charge !== null).map((r) => refOf(r)),
    );

    let balance = customer.openingBalance;
    const rows: CustomerKhataRow[] =
      customer.openingBalance === 0
        ? []
        : [
            {
              id: `opening-${id}`,
              customerId: id,
              date: customer.openingDate,
              kind: customer.openingBalance > 0 ? 'charge' : 'credit',
              amount: Math.abs(customer.openingBalance),
              detail: 'opening',
              sourceId: `opening-${id}`,
              ref: 'opening',
              balance,
            },
          ];

    for (const row of ledger) {
      const kind = row.charge === null ? 'credit' : 'charge';
      const amount = toNumber(kind === 'charge' ? row.charge : row.credit);
      balance += kind === 'charge' ? amount : -amount;
      rows.push({
        id: row.id,
        customerId: id,
        date: row.date,
        kind,
        amount,
        detail: row.note ?? row.sourceType,
        sourceId: row.sourceId ?? row.id,
        ref: refOf(row),
        ...(kind === 'credit' && charged.has(refOf(row))
          ? { reversal: true }
          : {}),
        ...(kind === 'charge' && RETURNED_SOURCES.includes(row.sourceType)
          ? { returned: true }
          : {}),
        balance,
      });
    }

    return rows;
  }

  async create(
    tenant: TenantContext,
    dto: CreateCustomerDto,
  ): Promise<CustomerSummary> {
    if (dto.openingDate) {
      assertDate('openingDate', dto.openingDate);
    }
    if (
      dto.openingBalance &&
      !tenant.permissions.includes(OPENING_PERMISSION)
    ) {
      throw forbidden('OPENING_NOT_ALLOWED');
    }

    const id = await this.dataSource.transaction((em) =>
      this.insert(em, tenant.companyId, dto),
    );

    await this.audit.record({
      actorType: 'member',
      actorId: tenant.memberId,
      action: 'customer.create',
      companyId: tenant.companyId,
      targetType: 'customer',
      targetId: id,
      metadata: { type: dto.type },
    });

    return this.get(tenant, id);
  }

  // Used by Production when a cutting customer's first truck arrives.
  async insert(
    em: EntityManager,
    companyId: string,
    dto: Pick<
      CreateCustomerDto,
      | 'name'
      | 'phone'
      | 'type'
      | 'city'
      | 'contactPerson'
      | 'openingBalance'
      | 'openingDate'
    >,
  ): Promise<string> {
    try {
      const [row] = await query<{ id: string }>(
        em,
        `INSERT INTO customer ("companyId", name, type, phone, "phoneDigits", city, "contactPerson", "openingBalance", "openingDate")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          companyId,
          dto.name,
          dto.type,
          dto.phone,
          digits(dto.phone),
          dto.city ?? '',
          dto.contactPerson ?? '',
          dto.openingBalance ?? 0,
          dto.openingDate ?? todayAtFactory(),
        ],
      );

      return row.id;
    } catch (error) {
      throw this.duplicate(error);
    }
  }

  async update(
    tenant: TenantContext,
    id: string,
    dto: UpdateCustomerDto,
  ): Promise<CustomerView> {
    const current = toView(await this.load(tenant.companyId, id));

    if (dto.openingDate !== undefined) {
      assertDate('openingDate', dto.openingDate);
    }

    const opening =
      (dto.openingBalance !== undefined &&
        dto.openingBalance !== current.openingBalance) ||
      (dto.openingDate !== undefined &&
        dto.openingDate !== current.openingDate);

    if (opening && !tenant.permissions.includes(OPENING_PERMISSION)) {
      throw forbidden('OPENING_NOT_ALLOWED');
    }

    try {
      await this.dataSource.query(
        `UPDATE customer
         SET name = $1, type = $2, phone = $3, "phoneDigits" = $4, city = $5, "contactPerson" = $6,
             "openingBalance" = $7, "openingDate" = $8, "isActive" = $9, "updatedAt" = now()
         WHERE id = $10 AND "companyId" = $11`,
        [
          dto.name ?? current.name,
          dto.type ?? current.type,
          dto.phone ?? current.phone,
          digits(dto.phone ?? current.phone),
          dto.city ?? current.city,
          dto.contactPerson ?? current.contactPerson,
          dto.openingBalance ?? current.openingBalance,
          dto.openingDate ?? current.openingDate,
          dto.isActive ?? current.isActive,
          id,
          tenant.companyId,
        ],
      );
    } catch (error) {
      throw this.duplicate(error);
    }

    await this.audit.record({
      actorType: 'member',
      actorId: tenant.memberId,
      action: 'customer.update',
      companyId: tenant.companyId,
      targetType: 'customer',
      targetId: id,
      metadata: { fields: Object.keys(dto) },
    });

    return toView(await this.load(tenant.companyId, id));
  }

  // ------------------------------------------------------------- helpers

  // How the customers' payments cover each charge, oldest first: a bill's
  // Paid / Partly paid / Udhaar comes from here.
  async allocations(
    companyId: string,
    em?: EntityManager,
  ): Promise<Map<string, ReturnType<typeof allocate>>> {
    const [customers, ledger] = await Promise.all([
      query<CustomerRow>(
        em ?? this.dataSource.manager,
        `${SELECT} WHERE "companyId" = $1`,
        [companyId],
      ),
      this.ledgerRows(companyId, undefined, em),
    ]);
    const result = new Map<string, ReturnType<typeof allocate>>();

    for (const c of customers) {
      result.set(
        c.id,
        allocate(
          toView(c),
          ledger.filter((r) => r.partyId === c.id),
        ),
      );
    }

    return result;
  }

  // Cheques received and not yet cleared: they already lowered the khata, but
  // no money is in the bank.
  private async unclearedCheques(
    companyId: string,
    customerId?: string,
  ): Promise<Map<string, number>> {
    const rows = await query<{ customerId: string; total: string }>(
      this.dataSource.manager,
      `SELECT c."customerId", COALESCE(SUM(c.amount), 0) AS total
       FROM customer_cheque c
       JOIN customer_payment p ON p.id = c."paymentId"
       WHERE c."companyId" = $1 AND c.status = 'pending' AND p.status = 'posted'
         AND ($2::uuid IS NULL OR c."customerId" = $2)
       GROUP BY c."customerId"`,
      [companyId, customerId ?? null],
    );

    return new Map(rows.map((r) => [r.customerId, toNumber(r.total)]));
  }

  private summarise(
    customer: CustomerView,
    ledger: LedgerRow[],
    uncleared = 0,
  ): CustomerSummary {
    const charged = new Set(
      ledger.filter((r) => r.charge !== null).map((r) => refOf(r)),
    );
    const sum = (rows: LedgerRow[], side: 'charge' | 'credit') =>
      rows.reduce((s, r) => s + toNumber(r[side]), 0);

    const charges = ledger.filter((r) => r.charge !== null);
    const credits = ledger.filter((r) => r.credit !== null);
    const returned = charges.filter((r) =>
      RETURNED_SOURCES.includes(r.sourceType),
    );
    const reversals = credits.filter((r) => charged.has(refOf(r)));
    const payments = credits.filter((r) => !charged.has(refOf(r)));

    const oldest =
      allocate(customer, ledger).find((i) => i.paid < i.amount)?.date ?? null;

    const balance =
      customer.openingBalance + sum(charges, 'charge') - sum(credits, 'credit');

    return {
      ...customer,
      totalBusiness:
        sum(charges, 'charge') -
        sum(returned, 'charge') -
        sum(reversals, 'credit'),
      received: sum(payments, 'credit') - sum(returned, 'charge'),
      balance,
      oldestUnpaidDays: oldest ? daysSince(oldest) : null,
      unclearedCheques: uncleared,
      lastActivity:
        [customer.openingDate, ...ledger.map((r) => r.date)].sort().pop() ??
        customer.openingDate,
    };
  }

  private async ledgerRows(
    companyId: string,
    customerId?: string,
    em?: EntityManager,
  ): Promise<LedgerRow[]> {
    return query<LedgerRow>(
      em ?? this.dataSource.manager,
      `SELECT id, "partyId", "date"::text AS "date", charge, credit, "sourceType", "sourceId", note
       FROM party_ledger_entry
       WHERE "companyId" = $1 AND "partyType" = $2 AND ($3::uuid IS NULL OR "partyId" = $3)
       ORDER BY "date", "createdAt", id`,
      [companyId, CUSTOMER_PARTY, customerId ?? null],
    );
  }

  private async load(companyId: string, id: string): Promise<CustomerRow> {
    const [row] = await query<CustomerRow>(
      this.dataSource.manager,
      `${SELECT} WHERE id = $1 AND "companyId" = $2`,
      [id, companyId],
    );

    if (!row) {
      throw notFound('id');
    }

    return row;
  }

  // Two people saving the same number at once: the unique index decides.
  private duplicate(error: unknown) {
    if (
      error instanceof QueryFailedError &&
      (error.driverError as { code?: string }).code === PG_UNIQUE_VIOLATION
    ) {
      return conflict('DUPLICATE_PHONE');
    }

    return error;
  }
}
