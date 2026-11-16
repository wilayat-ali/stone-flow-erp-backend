import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { assertDate } from '../engines/guards';
import { conflict, invalid, notFound } from '../engines/errors';
import { LedgerService } from '../ledger-entries/ledger.service';
import { AuditService } from '../tenancy/audit.service';
import { TenantContext } from '../tenancy/tenant-context';
import { inCompany } from '../tenancy/tenant-scope';
import {
  CreateSupplierDto,
  ListSuppliersQueryDto,
  UpdateSupplierDto,
} from './dto/supplier.dto';
import { SupplierEntity } from './infrastructure/persistence/relational/entities/supplier.entity';
import {
  KhataRow,
  SUPPLIER_PARTY,
  SupplierSummary,
  SupplierView,
} from './supplier.types';

const digits = (phone: string) => phone.replace(/\D/g, '');

const PG_UNIQUE_VIOLATION = '23505';

function toView(row: SupplierEntity): SupplierView {
  return {
    id: row.id,
    name: row.name,
    type: row.type as SupplierView['type'],
    business: row.business,
    phone: row.phone,
    city: row.city,
    cuttingRatePerTon: row.cuttingRatePerTon ?? null,
    openingBalance: row.openingBalance,
    openingDate: row.openingDate,
    isActive: row.isActive,
  };
}

// What they were owed before StoneFlow counts as charged; an advance we had
// paid counts as paid. The ledger adds everything since.
function summarise(
  row: SupplierEntity,
  ledger: { charged: number; credited: number } | undefined,
  unclearedCheques = 0,
): SupplierSummary {
  const charged = (ledger?.charged ?? 0) + Math.max(row.openingBalance, 0);
  const paid = (ledger?.credited ?? 0) + Math.max(-row.openingBalance, 0);

  return {
    ...toView(row),
    charged,
    paid,
    balance: charged - paid,
    unclearedCheques,
  };
}

// Suppliers (rules §3): mine owners, cutting factories and shops, each with a
// khata kept in the party ledger. Every method is scoped to the company in the
// caller's token.
@Injectable()
export class SuppliersService {
  constructor(
    @InjectRepository(SupplierEntity)
    private readonly suppliers: Repository<SupplierEntity>,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  async list(
    tenant: TenantContext,
    query: ListSuppliersQueryDto,
  ): Promise<SupplierSummary[]> {
    const [rows, balances, uncleared] = await Promise.all([
      this.suppliers.find({
        where: {
          ...inCompany(tenant.companyId),
          ...(query.type ? { type: query.type } : {}),
        },
        order: { createdAt: 'ASC', name: 'ASC' },
      }),
      this.ledger.partyBalances(tenant.companyId, SUPPLIER_PARTY),
      this.unclearedBySupplier(tenant.companyId),
    ]);

    return rows
      .map((row) => summarise(row, balances.get(row.id), uncleared.get(row.id)))
      .filter(
        (s) =>
          !query.balance ||
          (query.balance === 'owe' ? s.balance > 0 : s.balance < 0),
      );
  }

  async get(tenant: TenantContext, id: string): Promise<SupplierSummary> {
    const row = await this.load(tenant.companyId, id);
    const balance = await this.ledger.partyBalance(
      tenant.companyId,
      SUPPLIER_PARTY,
      id,
    );

    const uncleared = await this.unclearedBySupplier(tenant.companyId, id);

    return summarise(row, balance, uncleared.get(id));
  }

  // The opening balance first, then every ledger row with the running balance.
  async khata(tenant: TenantContext, id: string): Promise<KhataRow[]> {
    const row = await this.load(tenant.companyId, id);
    const posted = await this.ledger.partyRows(
      tenant.companyId,
      SUPPLIER_PARTY,
      id,
    );

    // Payments whose cheque has not cleared yet: their khata row says so.
    const unclearedPayments = await this.unclearedPaymentIds(
      tenant.companyId,
      id,
    );

    let balance = row.openingBalance;
    const rows: KhataRow[] =
      row.openingBalance === 0
        ? []
        : [
            {
              id: `opening-${row.id}`,
              date: row.openingDate,
              detail: 'opening',
              kind: row.openingBalance > 0 ? 'charge' : 'credit',
              amount: Math.abs(row.openingBalance),
              balance,
              unclearedCheque: false,
            },
          ];

    for (const entry of posted) {
      const kind = entry.charge === null ? 'credit' : 'charge';
      const amount = (kind === 'charge' ? entry.charge : entry.credit) ?? 0;
      balance += kind === 'charge' ? amount : -amount;
      rows.push({
        id: entry.id,
        date: entry.date,
        detail: entry.note ?? entry.sourceType,
        kind,
        amount,
        balance,
        unclearedCheque:
          kind === 'credit' &&
          entry.sourceType === 'supplier_payment' &&
          !!entry.sourceId &&
          unclearedPayments.has(entry.sourceId),
      });
    }

    return rows;
  }

  async create(
    tenant: TenantContext,
    dto: CreateSupplierDto,
  ): Promise<SupplierView> {
    assertDate('openingDate', dto.openingDate);
    const cuttingRatePerTon = this.cuttingRate(dto.type, dto.cuttingRatePerTon);
    await this.assertPhoneFree(tenant.companyId, dto.phone);

    const saved = await this.save(() =>
      this.suppliers.save(
        this.suppliers.create({
          company: { id: tenant.companyId },
          name: dto.name,
          type: dto.type,
          business: dto.business ?? '',
          phone: dto.phone,
          phoneDigits: digits(dto.phone),
          city: dto.city,
          cuttingRatePerTon,
          openingBalance: dto.openingBalance ?? 0,
          openingDate: dto.openingDate,
          isActive: true,
        }),
      ),
    );

    await this.audit.record({
      actorType: 'member',
      actorId: tenant.memberId,
      action: 'supplier.create',
      companyId: tenant.companyId,
      targetType: 'supplier',
      targetId: saved.id,
      metadata: { type: saved.type },
    });

    return toView(saved);
  }

  async update(
    tenant: TenantContext,
    id: string,
    dto: UpdateSupplierDto,
  ): Promise<SupplierView> {
    const current = await this.load(tenant.companyId, id);

    if (dto.openingDate !== undefined) {
      assertDate('openingDate', dto.openingDate);
    }
    if (dto.phone !== undefined) {
      await this.assertPhoneFree(tenant.companyId, dto.phone, id);
    }

    const type = dto.type ?? (current.type as SupplierView['type']);
    // Changing the type away from a cutting factory drops the rate.
    const cuttingRatePerTon = this.cuttingRate(
      type,
      dto.cuttingRatePerTon === undefined
        ? current.cuttingRatePerTon
        : dto.cuttingRatePerTon,
    );

    const next: Partial<SupplierEntity> = {
      name: dto.name ?? current.name,
      type,
      business: dto.business ?? current.business,
      phone: dto.phone ?? current.phone,
      phoneDigits: dto.phone ? digits(dto.phone) : current.phoneDigits,
      city: dto.city ?? current.city,
      cuttingRatePerTon,
      openingBalance: dto.openingBalance ?? current.openingBalance,
      openingDate: dto.openingDate ?? current.openingDate,
      isActive: dto.isActive ?? current.isActive,
    };

    await this.save(() =>
      this.suppliers.update({ id, ...inCompany(tenant.companyId) }, next),
    );

    await this.audit.record({
      actorType: 'member',
      actorId: tenant.memberId,
      action: 'supplier.update',
      companyId: tenant.companyId,
      targetType: 'supplier',
      targetId: id,
      metadata: { fields: Object.keys(dto) },
    });

    return toView(await this.load(tenant.companyId, id));
  }

  // ------------------------------------------------------------- helpers

  // Cheques given and not cleared yet, per supplier: the supplier was credited,
  // but the money is still in our bank. Only cheques whose payment counts.
  private async unclearedBySupplier(
    companyId: string,
    supplierId?: string,
  ): Promise<Map<string, number>> {
    const rows = (await this.suppliers.query(
      `SELECT c."supplierId", COALESCE(SUM(c.amount), 0) AS total
       FROM supplier_cheque c
       JOIN supplier_payment p ON p.id = c."paymentId"
       WHERE c."companyId" = $1 AND c.status = 'issued' AND p.status = 'confirmed'
         AND ($2::uuid IS NULL OR c."supplierId" = $2)
       GROUP BY c."supplierId"`,
      [companyId, supplierId ?? null],
    )) as { supplierId: string; total: string }[];

    return new Map(rows.map((r) => [r.supplierId, Number(r.total)]));
  }

  private async unclearedPaymentIds(
    companyId: string,
    supplierId: string,
  ): Promise<Set<string>> {
    const rows = (await this.suppliers.query(
      `SELECT p.id
       FROM supplier_payment p
       JOIN supplier_cheque c ON c."paymentId" = p.id
       WHERE p."companyId" = $1 AND p."supplierId" = $2
         AND p.status = 'confirmed' AND c.status = 'issued'`,
      [companyId, supplierId],
    )) as { id: string }[];

    return new Set(rows.map((r) => r.id));
  }

  // Another company's supplier looks exactly like one that does not exist.
  private async load(companyId: string, id: string): Promise<SupplierEntity> {
    const row = await this.suppliers.findOne({
      where: { id, ...inCompany(companyId) },
    });

    if (!row) {
      throw notFound('id');
    }

    return row;
  }

  // Only a cutting factory has a rate, and it must have one.
  private cuttingRate(
    type: string,
    rate: number | null | undefined,
  ): number | null {
    if (type !== 'cutting_factory') {
      return null;
    }

    if (!rate || rate <= 0) {
      throw invalid({ cuttingRatePerTon: 'required' });
    }

    return rate;
  }

  private async assertPhoneFree(
    companyId: string,
    phone: string,
    exceptId?: string,
  ) {
    const same = await this.suppliers.findOne({
      where: { ...inCompany(companyId), phoneDigits: digits(phone) },
      select: { id: true },
    });

    if (same && same.id !== exceptId) {
      throw conflict('DUPLICATE_PHONE');
    }
  }

  // Two people saving the same number at once: the unique index decides.
  private async save<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string }).code === PG_UNIQUE_VIOLATION
      ) {
        throw conflict('DUPLICATE_PHONE');
      }
      throw error;
    }
  }
}
