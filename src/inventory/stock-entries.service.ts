import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ApprovalService } from '../approvals/approval.service';
import { todayAtFactory } from '../engines/calendar-date';
import { query } from '../engines/db';
import { conflict, forbidden, invalid, notFound } from '../engines/errors';
import { assertDate } from '../engines/guards';
import { StockService } from '../stock-movements/stock.service';
import type { StockItemKey } from '../stock-movements/stock.types';
import { AuditService } from '../tenancy/audit.service';
import { TenantContext } from '../tenancy/tenant-context';
import { inCompany } from '../tenancy/tenant-scope';
import { personName } from '../utils/person-name';
import { CreateStockEntryDto, ListEntriesQueryDto } from './dto/inventory.dto';
import { StockEntryEntity } from './infrastructure/persistence/relational/entities/stock-entry.entity';
import {
  AdjustmentReason,
  ENTRY_APPROVER,
  ENTRY_ENTITY,
  ENTRY_SOURCE,
  entryNo,
  EntryStatus,
  EntryType,
  StockEntryView,
} from './inventory.types';
import { StockItemsService } from './stock-items.service';

const RELATIONS = {
  factory: true,
  material: true,
  sootType: true,
  sootSize: true,
  counterWidth: true,
  toFactory: true,
  createdBy: { user: true },
  approvedBy: { user: true },
} as const;

// Stock entries (rules §6): the only way to change stock outside production and
// sales. A Munshi's entry waits as 'pending' while approval is on and has no
// effect on stock; when it counts, its movement is posted to the stock engine.
// The engine refuses a movement that would take stock below zero, so a removal
// is checked when it is asked and again when it is approved.
@Injectable()
export class StockEntriesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(StockEntryEntity)
    private readonly entries: Repository<StockEntryEntity>,
    private readonly stock: StockService,
    private readonly items: StockItemsService,
    private readonly approvals: ApprovalService,
    private readonly audit: AuditService,
  ) {}

  // Waiting entries first, then newest.
  async list(
    tenant: TenantContext,
    filters: ListEntriesQueryDto,
  ): Promise<StockEntryView[]> {
    const rows = await this.entries.find({
      where: {
        ...inCompany(tenant.companyId),
        ...(filters.type ? { type: filters.type } : {}),
        ...(filters.status ? { status: filters.status } : {}),
      },
      relations: RELATIONS,
      order: { date: 'DESC', entrySeq: 'DESC' },
    });
    const views = await this.views(tenant.companyId, rows);

    return views.sort(
      (a, b) =>
        (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1),
    );
  }

  async get(tenant: TenantContext, id: string): Promise<StockEntryView> {
    const [view] = await this.views(tenant.companyId, [
      await this.load(tenant.companyId, id),
    ]);

    return view;
  }

  async create(
    tenant: TenantContext,
    dto: CreateStockEntryDto,
  ): Promise<StockEntryView> {
    // Opening stock is the owner's alone.
    if (dto.type === 'opening' && tenant.roleKey !== 'owner') {
      throw forbidden('OPENING_OWNER_ONLY');
    }

    assertDate('date', dto.date);

    if (dto.date > todayAtFactory()) {
      throw invalid({ date: 'futureDate' });
    }

    const isCounter = dto.item.itemType === 'counter';

    if (isCounter && !dto.inches) {
      throw invalid({ inches: 'required' });
    }
    if (!isCounter && dto.inches) {
      throw invalid({ inches: 'onlyForCounters' });
    }
    if (dto.type === 'adjustment') {
      if (!dto.reason) {
        throw invalid({ reason: 'required' });
      }
      if (dto.reason === 'other' && !dto.note?.trim()) {
        throw invalid({ note: 'required' });
      }
    }
    if (dto.type === 'transfer') {
      if (!dto.toFactoryId || dto.toFactoryId === dto.item.factoryId) {
        throw invalid({ toFactoryId: 'sameFactory' });
      }
    }

    const direction: 1 | -1 =
      dto.type === 'adjustment' ? (dto.direction ?? -1) : 1;
    const removes =
      dto.type === 'transfer' ||
      (dto.type === 'adjustment' && direction === -1);

    const id = await this.dataSource.transaction(async (em) => {
      const key = await this.items.resolve(em, tenant.companyId, dto.item);

      if (dto.type === 'transfer') {
        await this.ownFactories(em, tenant.companyId, [
          dto.item.factoryId,
          dto.toFactoryId!,
        ]);
      }

      if (removes) {
        await this.assertOnHand(tenant.companyId, key, dto.qty, dto.inches, em);
      }

      // Entry numbers continue per company; the lock makes two entries at once
      // take different numbers.
      await em.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `stock_entry:${tenant.companyId}`,
      ]);
      const [next] = await query<{ seq: number }>(
        em,
        `SELECT COALESCE(MAX("entrySeq"), 0) + 1 AS seq FROM stock_entry WHERE "companyId" = $1`,
        [tenant.companyId],
      );

      const repo = em.getRepository(StockEntryEntity);
      const entry = await repo.save(
        repo.create({
          company: { id: tenant.companyId },
          entrySeq: next.seq,
          type: dto.type,
          date: dto.date,
          direction,
          reason: dto.type === 'adjustment' ? dto.reason : null,
          note: dto.note ?? '',
          factory: { id: key.factoryId },
          itemType: key.itemType,
          material: { id: key.materialId },
          sootType: key.sootTypeId ? { id: key.sootTypeId } : null,
          sootSize: key.sootSizeId ? { id: key.sootSizeId } : null,
          counterWidth: key.counterWidthId ? { id: key.counterWidthId } : null,
          finish: key.finish,
          qty: dto.qty,
          inches: isCounter ? dto.inches : null,
          toFactory: dto.type === 'transfer' ? { id: dto.toFactoryId! } : null,
          status: 'pending',
          createdBy: { id: tenant.memberId },
        }),
      );

      const { approval, needsApproval } = await this.approvals.request(
        {
          companyId: tenant.companyId,
          entityType: ENTRY_ENTITY,
          entityId: entry.id,
          requestedByMemberId: tenant.memberId,
          approverPermission: ENTRY_APPROVER,
          payload: {
            entryNo: entryNo(next.seq),
            type: dto.type,
            qty: dto.qty,
          },
        },
        em,
      );

      await repo.update(
        { id: entry.id, ...inCompany(tenant.companyId) },
        { approvalId: approval.id },
      );

      if (!needsApproval) {
        await this.post(em, tenant.companyId, entry.id, tenant.memberId);
      }

      await this.audit.record(
        {
          actorType: 'member',
          actorId: tenant.memberId,
          action: 'stock_entry.create',
          companyId: tenant.companyId,
          targetType: 'stock_entry',
          targetId: entry.id,
          metadata: { type: dto.type, qty: dto.qty, pending: needsApproval },
        },
        em,
      );

      return entry.id;
    });

    return this.get(tenant, id);
  }

  // Approving checks the stock again: it may have been used since the entry was
  // made. If posting fails the entry stays pending.
  async approve(tenant: TenantContext, id: string): Promise<StockEntryView> {
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
          approverPermission: ENTRY_APPROVER,
        },
        (_approval, manager) =>
          this.post(manager, tenant.companyId, id, tenant.memberId),
        em,
      );
      await this.audit.record(
        {
          actorType: 'member',
          actorId: tenant.memberId,
          action: 'stock_entry.approve',
          companyId: tenant.companyId,
          targetType: 'stock_entry',
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
  ): Promise<StockEntryView> {
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
          approverPermission: ENTRY_APPROVER,
          reason,
        },
        em,
      );
      await em.getRepository(StockEntryEntity).update(
        { id, ...inCompany(tenant.companyId) },
        {
          status: 'rejected',
          rejectReason: reason.trim().slice(0, 500),
          approvedBy: { id: tenant.memberId },
        },
      );
      await this.audit.record(
        {
          actorType: 'member',
          actorId: tenant.memberId,
          action: 'stock_entry.reject',
          companyId: tenant.companyId,
          targetType: 'stock_entry',
          targetId: id,
        },
        em,
      );
    });

    return this.get(tenant, id);
  }

  // ------------------------------------------------------------- helpers

  // Posts the entry's movement(s) to the stock engine and marks it approved.
  // Opening adds, an adjustment adds or removes, a transfer removes at the
  // source and adds at the destination (removal first, so too little stock
  // fails before anything is added). Runs inside the caller's transaction.
  private async post(
    em: EntityManager,
    companyId: string,
    entryId: string,
    approverMemberId: string,
  ): Promise<void> {
    const [e] = await query<{
      entrySeq: number;
      type: EntryType;
      date: string;
      direction: number;
      reason: AdjustmentReason | null;
      note: string;
      factoryId: string;
      itemType: StockItemKey['itemType'];
      materialId: string;
      sootTypeId: string | null;
      sootSizeId: string | null;
      counterWidthId: string | null;
      finish: StockItemKey['finish'];
      qty: number;
      inches: number | null;
      toFactoryId: string | null;
      status: EntryStatus;
      createdById: string;
    }>(
      em,
      `SELECT "entrySeq", type, "date"::text AS "date", direction, reason, note,
              "factoryId", "itemType", "materialId", "sootTypeId", "sootSizeId",
              "counterWidthId", finish, qty, inches, "toFactoryId", status,
              "createdById"
       FROM stock_entry WHERE id = $1 AND "companyId" = $2 FOR UPDATE`,
      [entryId, companyId],
    );

    if (!e) {
      throw notFound('id');
    }
    if (e.status !== 'pending') {
      throw conflict('ALREADY_DECIDED');
    }

    const key: StockItemKey = {
      factoryId: e.factoryId,
      itemType: e.itemType,
      materialId: e.materialId,
      sootTypeId: e.sootTypeId,
      sootSizeId: e.sootSizeId,
      counterWidthId: e.counterWidthId,
      finish: e.finish,
    };
    const sign =
      e.type === 'opening' ? 1 : e.type === 'transfer' ? -1 : e.direction;
    const note = [entryNo(e.entrySeq), e.reason, e.note]
      .filter(Boolean)
      .join(' · ');

    const move = (item: StockItemKey, signed: number) =>
      this.stock.post(
        {
          companyId,
          date: e.date,
          key: item,
          qty: signed * e.qty,
          inches:
            e.itemType === 'counter' ? signed * (e.inches ?? 0) : undefined,
          sourceType: ENTRY_SOURCE,
          sourceId: entryId,
          note,
          createdByMemberId: e.createdById,
        },
        em,
      );

    await move(key, sign);

    if (e.type === 'transfer' && e.toFactoryId) {
      await move({ ...key, factoryId: e.toFactoryId }, 1);
    }

    await em.query(
      `UPDATE stock_entry
       SET status = 'approved', "approvedById" = $1, "updatedAt" = now()
       WHERE id = $2 AND "companyId" = $3`,
      [approverMemberId, entryId, companyId],
    );
  }

  // Removing or transferring more than is on hand is refused.
  private async assertOnHand(
    companyId: string,
    key: StockItemKey,
    qty: number,
    inches: number | undefined,
    em: EntityManager,
  ) {
    const have = await this.stock.onHand(companyId, key, em);

    if (qty > have.qty) {
      throw conflict('INSUFFICIENT_STOCK', { available: have.qty });
    }
    if (key.itemType === 'counter' && (inches ?? 0) > have.inches) {
      throw conflict('INSUFFICIENT_INCHES', { available: have.inches });
    }
  }

  // A transfer moves stock between two of our own factories that are in use.
  private async ownFactories(
    em: EntityManager,
    companyId: string,
    ids: string[],
  ) {
    const rows = await query<{ id: string }>(
      em,
      `SELECT id FROM factory
       WHERE "companyId" = $1 AND id = ANY($2) AND kind = 'own' AND "isActive"`,
      [companyId, ids],
    );

    if (rows.length !== new Set(ids).size) {
      throw invalid({ toFactoryId: 'invalid' });
    }
  }

  // Another company's entry looks exactly like one that does not exist.
  private async load(companyId: string, id: string): Promise<StockEntryEntity> {
    const row = await this.entries.findOne({
      where: { id, ...inCompany(companyId) },
      relations: RELATIONS,
    });

    if (!row) {
      throw notFound('id');
    }

    return row;
  }

  private async views(
    companyId: string,
    rows: StockEntryEntity[],
  ): Promise<StockEntryView[]> {
    if (rows.length === 0) {
      return [];
    }

    const keys = rows.map((row) => ({
      factoryId: row.factory.id,
      materialId: row.material.id,
      sootTypeId: row.sootType?.id ?? null,
      sootSizeId: row.sootSize?.id ?? null,
      counterWidthId: row.counterWidth?.id ?? null,
    }));
    const names = await this.items.namesFor(
      companyId,
      keys,
      this.dataSource.manager,
    );

    return rows.map((row, index) => {
      const n = names(keys[index]);
      const key = {
        ...keys[index],
        itemType: row.itemType,
        finish: row.finish ?? null,
      } as StockItemKey;

      return {
        id: row.id,
        entryNo: entryNo(row.entrySeq),
        type: row.type as EntryType,
        date: row.date,
        direction: row.direction as 1 | -1,
        reason: (row.reason ?? null) as AdjustmentReason | null,
        note: row.note,
        item: this.items.itemView(key, n),
        qty: row.qty,
        inches: row.inches ?? 0,
        factoryName: row.factory.name,
        toFactoryId: row.toFactory?.id ?? null,
        toFactoryName: row.toFactory?.name ?? null,
        status: row.status as EntryStatus,
        rejectReason: row.rejectReason ?? null,
        createdBy: personName(row.createdBy) ?? '',
        approvedBy: personName(row.approvedBy ?? undefined),
      };
    });
  }
}
