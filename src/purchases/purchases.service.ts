import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  FindOptionsWhere,
  LessThanOrEqual,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { ApprovalService } from '../approvals/approval.service';
import { todayAtFactory } from '../engines/calendar-date';
import { query, toNumber } from '../engines/db';
import { conflict, invalid, notFound } from '../engines/errors';
import { assertDate } from '../engines/guards';
import { LedgerService } from '../ledger-entries/ledger.service';
import { FactoryEntity } from '../settings/infrastructure/persistence/relational/entities/factory.entity';
import { SupplierEntity } from '../suppliers/infrastructure/persistence/relational/entities/supplier.entity';
import { AuditService } from '../tenancy/audit.service';
import { personName } from '../utils/person-name';
import { TenantContext } from '../tenancy/tenant-context';
import { inCompany } from '../tenancy/tenant-scope';
import {
  CreatePurchaseDto,
  ListPurchasesQueryDto,
  UpdatePurchaseDto,
} from './dto/purchase.dto';
import { PurchaseEntity } from './infrastructure/persistence/relational/entities/purchase.entity';
import {
  PURCHASE_APPROVER,
  PURCHASE_ENTITY,
  PURCHASE_SOURCE,
  PurchaseStatus,
  PurchaseView,
} from './purchase.types';

const PG_UNIQUE_VIOLATION = '23505';

export const grossOf = (tons: number, ratePerTon: number) =>
  Math.round(tons * ratePerTon);

export const totalOf = (tons: number, ratePerTon: number, discount: number) =>
  Math.max(0, grossOf(tons, ratePerTon) - discount);

const markOf = (row: { markSeq?: number | null; stones: number }) =>
  row.markSeq ? `${row.markSeq}/${row.stones}` : null;

const RELATIONS = {
  supplier: true,
  factory: true,
  machine: true,
  thekadar: true,
  createdBy: { user: true },
  approvedBy: { user: true },
} as const;

// Truck purchases (rules §5). A truck is a row here; what it does to money is
// a charge in the supplier's khata (the party ledger), posted when the truck is
// approved. A Munshi's truck waits as 'pending' while approval is on: no
// charge, no mark. A factory's marks (20/3 = the 20th truck, cut in 3 stones)
// are taken from the factory's own counter at approval, so a rejected truck
// wastes none. Corrections are opposite ledger rows, never edits.
@Injectable()
export class PurchasesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(PurchaseEntity)
    private readonly purchases: Repository<PurchaseEntity>,
    @InjectRepository(SupplierEntity)
    private readonly suppliers: Repository<SupplierEntity>,
    @InjectRepository(FactoryEntity)
    private readonly factories: Repository<FactoryEntity>,
    private readonly ledger: LedgerService,
    private readonly approvals: ApprovalService,
    private readonly audit: AuditService,
  ) {}

  // Newest first; oldest first when looking at trucks waiting in the yard.
  async list(
    tenant: TenantContext,
    filters: ListPurchasesQueryDto,
  ): Promise<PurchaseView[]> {
    const where: FindOptionsWhere<PurchaseEntity> = {
      ...inCompany(tenant.companyId),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.supplierId ? { supplier: { id: filters.supplierId } } : {}),
      ...(filters.factoryId ? { factory: { id: filters.factoryId } } : {}),
    };

    if (filters.ageDays) {
      const cutoff = new Date(`${todayAtFactory()}T00:00:00Z`);
      cutoff.setUTCDate(cutoff.getUTCDate() - filters.ageDays);
      where.status = 'in_stock';
      where.date = LessThanOrEqual(cutoff.toISOString().slice(0, 10));
    }

    const oldestFirst = filters.status === 'in_stock' || !!filters.ageDays;
    const direction = oldestFirst ? 'ASC' : 'DESC';

    const rows = await this.purchases.find({
      where,
      relations: RELATIONS,
      order: { date: direction, createdAt: direction, id: direction },
    });

    return rows.map((row) => this.view(row));
  }

  async get(tenant: TenantContext, id: string): Promise<PurchaseView> {
    return this.view(await this.load(tenant.companyId, id));
  }

  // The truck is saved as pending, then the approval engine decides: if the
  // caller needs no approval it is approved in the same transaction.
  async create(
    tenant: TenantContext,
    dto: CreatePurchaseDto,
  ): Promise<PurchaseView> {
    this.assertDate(dto.date);
    await this.activeSupplier(tenant.companyId, dto.supplierId);
    await this.activeFactory(tenant.companyId, dto.factoryId);

    const discount = dto.discount ?? 0;
    const total = totalOf(dto.tons, dto.ratePerTon, discount);

    const id = await this.dataSource.transaction(async (em) => {
      await this.assertNotDuplicate(
        em,
        tenant.companyId,
        dto.supplierId,
        dto.purchiNo,
      );

      const repo = em.getRepository(PurchaseEntity);
      const row = await this.guard(() =>
        repo.save(
          repo.create({
            company: { id: tenant.companyId },
            supplier: { id: dto.supplierId },
            factory: { id: dto.factoryId },
            date: dto.date,
            material: dto.material,
            purchiNo: dto.purchiNo,
            truckNo: dto.truckNo,
            tons: dto.tons,
            ratePerTon: dto.ratePerTon,
            discount,
            total,
            stones: dto.stones,
            status: 'pending',
            note: dto.note ?? '',
            createdBy: { id: tenant.memberId },
          }),
        ),
      );

      const { approval, needsApproval } = await this.approvals.request(
        {
          companyId: tenant.companyId,
          entityType: PURCHASE_ENTITY,
          entityId: row.id,
          requestedByMemberId: tenant.memberId,
          approverPermission: PURCHASE_APPROVER,
          payload: {
            purchiNo: dto.purchiNo,
            truckNo: dto.truckNo,
            supplierId: dto.supplierId,
            total,
          },
        },
        em,
      );

      await repo.update(
        { id: row.id, ...inCompany(tenant.companyId) },
        { approvalId: approval.id },
      );

      if (!needsApproval) {
        await this.post(em, tenant.companyId, row.id, tenant.memberId);
      }

      await this.audit.record(
        {
          actorType: 'member',
          actorId: tenant.memberId,
          action: 'purchase.create',
          companyId: tenant.companyId,
          targetType: 'purchase',
          targetId: row.id,
          metadata: { total, pending: needsApproval },
        },
        em,
      );

      return row.id;
    });

    return this.get(tenant, id);
  }

  // Only while pending or in stock. A stock truck's charge is corrected with a
  // reversal row plus a new charge, never by editing the old row.
  async update(
    tenant: TenantContext,
    id: string,
    dto: UpdatePurchaseDto,
  ): Promise<PurchaseView> {
    const current = await this.load(tenant.companyId, id);

    if (current.status !== 'pending' && current.status !== 'in_stock') {
      throw conflict('NOT_EDITABLE');
    }

    // Anyone who enters trucks may fix a pending one; after approval it is
    // the approvers' to change.
    if (
      current.status === 'in_stock' &&
      !tenant.permissions.includes(PURCHASE_APPROVER)
    ) {
      throw new ForbiddenException();
    }

    const date = dto.date ?? current.date;
    this.assertDate(date);

    const supplierId = dto.supplierId ?? current.supplier.id;
    if (supplierId !== current.supplier.id) {
      await this.activeSupplier(tenant.companyId, supplierId);
    }

    // A mark belongs to the factory that gave it.
    const factoryId = dto.factoryId ?? current.factory.id;
    if (factoryId !== current.factory.id) {
      if (current.markSeq) {
        throw conflict('FACTORY_LOCKED');
      }
      await this.activeFactory(tenant.companyId, factoryId);
    }

    const tons = dto.tons ?? current.tons;
    const ratePerTon = dto.ratePerTon ?? current.ratePerTon;
    const discount = dto.discount ?? current.discount;
    const stones = dto.stones ?? current.stones;
    const purchiNo = dto.purchiNo ?? current.purchiNo;
    const total = totalOf(tons, ratePerTon, discount);

    await this.dataSource.transaction(async (em) => {
      await this.assertNotDuplicate(
        em,
        tenant.companyId,
        supplierId,
        purchiNo,
        id,
      );

      await this.guard(() =>
        em.getRepository(PurchaseEntity).update(
          { id, ...inCompany(tenant.companyId) },
          {
            supplier: { id: supplierId },
            factory: { id: factoryId },
            date,
            material: dto.material ?? current.material,
            purchiNo,
            truckNo: dto.truckNo ?? current.truckNo,
            tons,
            ratePerTon,
            discount,
            total,
            stones,
            note: dto.note ?? current.note,
          },
        ),
      );

      const moneyChanged =
        supplierId !== current.supplier.id ||
        date !== current.date ||
        total !== current.total;

      if (current.status === 'in_stock' && moneyChanged) {
        const mark = markOf({
          markSeq: current.markSeq,
          stones: current.stones,
        });

        if (current.total > 0) {
          await this.ledger.postPartyEntry(
            {
              companyId: tenant.companyId,
              date: todayAtFactory(),
              partyType: 'supplier',
              partyId: current.supplier.id,
              side: 'credit',
              amount: current.total,
              sourceType: PURCHASE_SOURCE,
              sourceId: id,
              note: `Reversal · truck ${mark} · purchi ${current.purchiNo}`,
            },
            em,
          );
        }
        if (total > 0) {
          await this.ledger.postPartyEntry(
            {
              companyId: tenant.companyId,
              date,
              partyType: 'supplier',
              partyId: supplierId,
              side: 'charge',
              amount: total,
              sourceType: PURCHASE_SOURCE,
              sourceId: id,
              note: `Truck ${markOf({ markSeq: current.markSeq, stones })} · purchi ${purchiNo}`,
            },
            em,
          );
        }
      }

      await this.audit.record(
        {
          actorType: 'member',
          actorId: tenant.memberId,
          action: 'purchase.update',
          companyId: tenant.companyId,
          targetType: 'purchase',
          targetId: id,
          metadata: { fields: Object.keys(dto), total },
        },
        em,
      );
    });

    return this.get(tenant, id);
  }

  // Approving takes the next mark and posts the supplier charge, in one
  // transaction with the decision: if posting fails the truck stays pending.
  async approve(tenant: TenantContext, id: string): Promise<PurchaseView> {
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
          approverPermission: PURCHASE_APPROVER,
        },
        (_approval, manager) =>
          this.post(manager, tenant.companyId, id, tenant.memberId),
        em,
      );
      await this.audit.record(
        {
          actorType: 'member',
          actorId: tenant.memberId,
          action: 'purchase.approve',
          companyId: tenant.companyId,
          targetType: 'purchase',
          targetId: id,
        },
        em,
      );
    });

    return this.get(tenant, id);
  }

  async reject(
    tenant: TenantContext,
    id: string,
    reason: string,
  ): Promise<PurchaseView> {
    const row = await this.load(tenant.companyId, id);

    if (row.status !== 'pending' || !row.approvalId) {
      throw conflict('ALREADY_DECIDED');
    }

    await this.dataSource.transaction(async (em) => {
      await this.approvals.reject(
        {
          companyId: tenant.companyId,
          approvalId: row.approvalId!,
          decidedByMemberId: tenant.memberId,
          approverPermission: PURCHASE_APPROVER,
          reason,
        },
        em,
      );
      await em.getRepository(PurchaseEntity).update(
        { id, ...inCompany(tenant.companyId) },
        {
          status: 'rejected',
          reason: reason.trim().slice(0, 500),
          approvedBy: { id: tenant.memberId },
        },
      );
      await this.audit.record(
        {
          actorType: 'member',
          actorId: tenant.memberId,
          action: 'purchase.reject',
          companyId: tenant.companyId,
          targetType: 'purchase',
          targetId: id,
        },
        em,
      );
    });

    return this.get(tenant, id);
  }

  // Only before cutting starts. The charge comes off the khata as a reversal.
  async cancel(
    tenant: TenantContext,
    id: string,
    reason: string,
  ): Promise<PurchaseView> {
    const current = await this.load(tenant.companyId, id);

    if (current.status !== 'in_stock') {
      throw conflict('CANCEL_AFTER_CUTTING');
    }

    const cleanReason = reason.trim();

    if (!cleanReason) {
      throw invalid({ reason: 'required' });
    }

    await this.dataSource.transaction(async (em) => {
      if (current.total > 0) {
        await this.ledger.postPartyEntry(
          {
            companyId: tenant.companyId,
            date: todayAtFactory(),
            partyType: 'supplier',
            partyId: current.supplier.id,
            side: 'credit',
            amount: current.total,
            sourceType: PURCHASE_SOURCE,
            sourceId: id,
            note: `Cancelled · truck ${markOf(current)} · purchi ${current.purchiNo}`,
          },
          em,
        );
      }

      await em
        .getRepository(PurchaseEntity)
        .update(
          { id, ...inCompany(tenant.companyId) },
          { status: 'cancelled', reason: cleanReason.slice(0, 500) },
        );
      await this.audit.record(
        {
          actorType: 'member',
          actorId: tenant.memberId,
          action: 'purchase.cancel',
          companyId: tenant.companyId,
          targetType: 'purchase',
          targetId: id,
          metadata: { total: current.total },
        },
        em,
      );
    });

    return this.get(tenant, id);
  }

  // ------------------------------------------------------------- helpers

  // Takes the factory's next mark, posts the charge to the supplier's khata and
  // puts the truck in stock. Runs inside the caller's transaction (creating an
  // auto-approved truck, or approving a pending one).
  private async post(
    em: EntityManager,
    companyId: string,
    purchaseId: string,
    approverMemberId: string,
  ): Promise<void> {
    const [row] = await query<{
      id: string;
      supplierId: string;
      factoryId: string;
      date: string;
      purchiNo: string;
      total: string;
      stones: number;
      status: string;
    }>(
      em,
      `SELECT id, "supplierId", "factoryId", "date"::text AS "date", "purchiNo",
              total, stones, status
       FROM purchase WHERE id = $1 AND "companyId" = $2 FOR UPDATE`,
      [purchaseId, companyId],
    );

    if (!row) {
      throw notFound('id');
    }
    if (row.status !== 'pending') {
      throw conflict('ALREADY_DECIDED');
    }

    // Locked, so two trucks approved at once never get the same mark.
    const [factory] = await query<{ markCounter: number }>(
      em,
      `SELECT "markCounter" FROM factory WHERE id = $1 AND "companyId" = $2 FOR UPDATE`,
      [row.factoryId, companyId],
    );
    const seq = factory.markCounter + 1;

    await em.query(
      `UPDATE factory SET "markCounter" = $1 WHERE id = $2 AND "companyId" = $3`,
      [seq, row.factoryId, companyId],
    );

    const total = toNumber(row.total);

    if (total > 0) {
      await this.ledger.postPartyEntry(
        {
          companyId,
          date: row.date,
          partyType: 'supplier',
          partyId: row.supplierId,
          side: 'charge',
          amount: total,
          sourceType: PURCHASE_SOURCE,
          sourceId: row.id,
          note: `Truck ${seq}/${row.stones} · purchi ${row.purchiNo}`,
        },
        em,
      );
    }

    await em.query(
      `UPDATE purchase
       SET "markSeq" = $1, status = 'in_stock', "approvedById" = $2, "updatedAt" = now()
       WHERE id = $3 AND "companyId" = $4`,
      [seq, approverMemberId, purchaseId, companyId],
    );
  }

  private view(row: PurchaseEntity): PurchaseView {
    return {
      id: row.id,
      date: row.date,
      supplierId: row.supplier.id,
      supplierName: row.supplier.name,
      material: row.material,
      purchiNo: row.purchiNo,
      truckNo: row.truckNo,
      tons: row.tons,
      ratePerTon: row.ratePerTon,
      discount: row.discount,
      total: row.total,
      stones: row.stones,
      factoryId: row.factory.id,
      factoryName: row.factory.name,
      markSeq: row.markSeq ?? null,
      mark: markOf(row),
      status: row.status as PurchaseStatus,
      note: row.note,
      reason: row.reason ?? null,
      createdBy: personName(row.createdBy) ?? '',
      approvedBy: personName(row.approvedBy ?? undefined),
      createdAt: row.createdAt.toISOString(),
      machineId: row.machine?.id ?? null,
      machineName: row.machine?.name ?? null,
      thekadarId: row.thekadar?.id ?? null,
      thekadarName: row.thekadar?.name ?? null,
      thekadarRate: row.thekadar?.rate ?? null,
      cutStart: row.cutStart ?? null,
      cutEnd: row.cutEnd ?? null,
      cutRatePerTon: row.cutRatePerTon ?? null,
    };
  }

  // Another company's truck looks exactly like one that does not exist.
  private async load(companyId: string, id: string): Promise<PurchaseEntity> {
    const row = await this.purchases.findOne({
      where: { id, ...inCompany(companyId) },
      relations: RELATIONS,
    });

    if (!row) {
      throw notFound('id');
    }

    return row;
  }

  private assertDate(date: string) {
    assertDate('date', date);

    if (date > todayAtFactory()) {
      throw invalid({ date: 'futureDate' });
    }
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

  private async activeFactory(companyId: string, id: string) {
    const factory = await this.factories.findOne({
      where: { id, ...inCompany(companyId), isActive: true },
      select: { id: true },
    });

    if (!factory) {
      throw invalid({ factoryId: 'invalid' });
    }
  }

  // The same purchi from the same supplier is entered once, unless that entry
  // was rejected or cancelled. The unique index backs this up under a race.
  private async assertNotDuplicate(
    em: EntityManager,
    companyId: string,
    supplierId: string,
    purchiNo: string,
    exceptId?: string,
  ) {
    const rows = await query<{ id: string }>(
      em,
      `SELECT id FROM purchase
       WHERE "companyId" = $1 AND "supplierId" = $2 AND "purchiNo" = $3
         AND status NOT IN ('rejected', 'cancelled')
         AND ($4::uuid IS NULL OR id <> $4)`,
      [companyId, supplierId, purchiNo, exceptId ?? null],
    );

    if (rows.length > 0) {
      throw conflict('DUPLICATE_PURCHI');
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
        throw conflict('DUPLICATE_PURCHI');
      }
      throw error;
    }
  }
}
