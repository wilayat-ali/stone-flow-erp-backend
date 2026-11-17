import { HttpException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { todayAtFactory } from '../engines/calendar-date';
import { query, toNumber } from '../engines/db';
import { conflict, invalid, notFound } from '../engines/errors';
import { assertDate } from '../engines/guards';
import { alertKeyOf } from '../inventory/inventory.types';
import { StockItemsService } from '../inventory/stock-items.service';
import { StockService } from '../stock-movements/stock.service';
import type { StockItemKey } from '../stock-movements/stock.types';
import { AuditService } from '../tenancy/audit.service';
import { TenantContext } from '../tenancy/tenant-context';
import { personName } from '../utils/person-name';
import { WorkEntriesService } from '../workers/work-entries.service';
import {
  CreateProductionEntryDto,
  EntryLineDto,
  ListProductionEntriesQueryDto,
} from './dto/production.dto';
import {
  Direction,
  entryNo,
  EntryType,
  PRODUCTION_REVERSAL_SOURCE,
  PRODUCTION_SOURCE,
  ProductionEntryView,
  RATE_CARD_JOB,
  SqftWorkerView,
} from './production.types';

type ResolvedLine = {
  direction: Direction;
  key: StockItemKey;
  qty: number;
  inches: number;
  sqft: number;
  what: string;
};

type EntryRow = {
  id: string;
  entrySeq: number;
  date: string;
  type: EntryType;
  machineType: string | null;
  workerRate: string;
  workerAmount: string;
  wasteSqft: string;
  note: string;
  status: 'posted' | 'reversed';
  purchaseId: string | null;
  workerId: string | null;
  factoryId: string;
  factoryName: string;
  material: string;
  workerName: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
};

type LineRow = {
  entryId: string;
  direction: Direction;
  itemType: StockItemKey['itemType'];
  finish: StockItemKey['finish'];
  qty: number;
  inches: number | null;
  factoryId: string;
  materialId: string;
  sootTypeId: string | null;
  sootSizeId: string | null;
  counterWidthId: string | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

const isCode = (error: unknown, code: string) =>
  error instanceof HttpException &&
  (error.getResponse() as { code?: string }).code === code;

// Production steps after cutting (rules §7): counting a truck's output, then
// section, counter, resize and polish. One entry is one step: its inputs come
// out of stock, its outputs go in (through the stock engine, which refuses
// negative stock) and a worker paid per sq.ft is paid for the output (a work
// entry on their khata). Everything is saved in one transaction, so nothing is
// half-posted. A step is taken back with a reversal, never edited.
@Injectable()
export class ProductionEntriesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly stock: StockService,
    private readonly items: StockItemsService,
    private readonly workEntries: WorkEntriesService,
    private readonly audit: AuditService,
  ) {}

  // Active workers paid per sq.ft, for the "who did it" picker.
  async sqftWorkers(tenant: TenantContext): Promise<SqftWorkerView[]> {
    const rows = await query<{
      id: string;
      name: string;
      defaultJob: string;
      rate: string;
    }>(
      this.dataSource.manager,
      `SELECT id, name, "defaultJob", rate FROM worker
       WHERE "companyId" = $1 AND "payType" = 'sqft' AND "isActive"
       ORDER BY "createdAt", name`,
      [tenant.companyId],
    );

    return rows.map((r) => ({ ...r, rate: toNumber(r.rate) }));
  }

  async list(
    tenant: TenantContext,
    filters: ListProductionEntriesQueryDto,
  ): Promise<ProductionEntryView[]> {
    const rows = await this.entryRows(tenant.companyId, {
      ...filters,
    });

    return this.views(tenant.companyId, rows);
  }

  async get(tenant: TenantContext, id: string): Promise<ProductionEntryView> {
    const rows = await this.entryRows(tenant.companyId, { id });

    if (rows.length === 0) {
      throw notFound('id');
    }

    return (await this.views(tenant.companyId, rows))[0];
  }

  async create(
    tenant: TenantContext,
    dto: CreateProductionEntryDto,
  ): Promise<ProductionEntryView> {
    assertDate('date', dto.date);

    if (dto.date > todayAtFactory()) {
      throw conflict('DATE_IN_FUTURE');
    }

    const wanted = dto.lines.filter((l) => l.qty > 0);
    const outputs = wanted.filter((l) => l.direction === 'out');
    const inputs = wanted.filter((l) => l.direction === 'in');

    if (outputs.length === 0) {
      throw conflict('NO_OUTPUT');
    }
    if (dto.type !== 'cut' && inputs.length === 0) {
      throw conflict('NO_INPUT');
    }
    if (dto.type === 'cut' && inputs.length > 0) {
      throw invalid({ lines: 'cutHasNoInput' });
    }
    if (dto.type === 'cut' && !dto.purchaseId) {
      throw invalid({ purchaseId: 'required' });
    }

    for (const line of wanted) {
      const counter = line.item.itemType === 'counter';

      if (counter && !line.inches) {
        throw invalid({ inches: 'required' });
      }
      if (!counter && line.inches) {
        throw invalid({ inches: 'onlyForCounters' });
      }
    }

    const id = await this.dataSource.transaction(async (em) => {
      const [factory] = await query<{ id: string }>(
        em,
        `SELECT id FROM factory WHERE id = $1 AND "companyId" = $2 AND "isActive"`,
        [dto.factoryId, tenant.companyId],
      );

      if (!factory) {
        throw invalid({ factoryId: 'invalid' });
      }

      const materialId = await this.items.material(
        em,
        tenant.companyId,
        dto.material,
      );

      if (dto.type === 'cut') {
        await this.assertTruckToCount(em, tenant.companyId, dto.purchaseId!);
      }

      const lines = await this.resolve(em, tenant.companyId, wanted);

      // Inputs must be in stock: stock never goes negative. The engine checks
      // again under a lock; this gives the screen the figures to show.
      await this.assertInStock(em, tenant.companyId, lines);

      const inSqft = this.sqft(lines, 'in');
      const outSqft = this.sqft(lines, 'out');

      if (dto.type === 'resize' && outSqft > inSqft + 0.01) {
        throw conflict('OUTPUT_MORE_THAN_INPUT');
      }

      const pay = await this.payFor(
        em,
        tenant.companyId,
        dto.type,
        dto.workerId,
        outSqft,
      );

      await em.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `production_entry:${tenant.companyId}`,
      ]);
      const [next] = await query<{ seq: number }>(
        em,
        `SELECT COALESCE(MAX("entrySeq"), 0) + 1 AS seq FROM production_entry WHERE "companyId" = $1`,
        [tenant.companyId],
      );

      const [entry] = await query<{ id: string }>(
        em,
        `INSERT INTO production_entry
           ("companyId", "entrySeq", date, type, "factoryId", "materialId", "purchaseId", "machineType",
            "workerId", "workerRate", "workerAmount", "wasteSqft", note, status, "createdById")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'posted', $14)
         RETURNING id`,
        [
          tenant.companyId,
          next.seq,
          dto.date,
          dto.type,
          dto.factoryId,
          materialId,
          dto.type === 'cut' ? dto.purchaseId : (dto.purchaseId ?? null),
          dto.machineType ?? null,
          pay?.workerId ?? null,
          pay?.rate ?? 0,
          pay?.amount ?? 0,
          dto.type === 'resize' ? round2(Math.max(0, inSqft - outSqft)) : 0,
          dto.note ?? '',
          tenant.memberId,
        ],
      );

      let lineNo = 0;

      // Inputs first, then outputs, so a step that makes what it also uses
      // reads the same on the history.
      for (const line of [
        ...lines.filter((l) => l.direction === 'in'),
        ...lines.filter((l) => l.direction === 'out'),
      ]) {
        lineNo += 1;
        await em.query(
          `INSERT INTO production_entry_line
             ("companyId", "entryId", "lineNo", direction, "itemType", "factoryId", "materialId",
              "sootTypeId", "sootSizeId", "counterWidthId", finish, qty, inches)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            tenant.companyId,
            entry.id,
            lineNo,
            line.direction,
            line.key.itemType,
            line.key.factoryId,
            line.key.materialId,
            line.key.sootTypeId ?? null,
            line.key.sootSizeId ?? null,
            line.key.counterWidthId ?? null,
            line.key.finish ?? null,
            line.qty,
            line.key.itemType === 'counter' ? line.inches : null,
          ],
        );
        await this.stock.post(
          {
            companyId: tenant.companyId,
            date: dto.date,
            key: line.key,
            qty: line.direction === 'in' ? -line.qty : line.qty,
            inches:
              line.key.itemType === 'counter'
                ? line.direction === 'in'
                  ? -line.inches
                  : line.inches
                : undefined,
            sourceType: PRODUCTION_SOURCE,
            sourceId: entry.id,
            note: entryNo(next.seq),
            createdByMemberId: tenant.memberId,
          },
          em,
        );
      }

      if (pay && pay.amount > 0) {
        await this.workEntries.post(em, {
          companyId: tenant.companyId,
          memberId: tenant.memberId,
          workerId: pay.workerId,
          date: dto.date,
          job: RATE_CARD_JOB[dto.type as Exclude<EntryType, 'cut'>],
          unit: 'sqft',
          qty: round2(outSqft),
          rate: pay.rate,
          amount: pay.amount,
          sourceType: 'production',
          sourceId: entry.id,
          auto: true,
        });
      }

      await this.audit.record(
        {
          actorType: 'member',
          actorId: tenant.memberId,
          action: 'production.post',
          companyId: tenant.companyId,
          targetType: 'production_entry',
          targetId: entry.id,
          metadata: { type: dto.type, entryNo: entryNo(next.seq) },
        },
        em,
      );

      return entry.id;
    });

    return this.get(tenant, id);
  }

  // Takes the step back: its stock moves and its worker pay are undone with
  // opposite rows. Refused when something it made has already been used
  // (taking it back would leave stock below zero).
  async reverse(
    tenant: TenantContext,
    id: string,
  ): Promise<ProductionEntryView> {
    await this.dataSource.transaction(async (em) => {
      const [entry] = await query<{
        id: string;
        status: string;
        entrySeq: number;
      }>(
        em,
        `SELECT id, status, "entrySeq" FROM production_entry
         WHERE id = $1 AND "companyId" = $2 FOR UPDATE`,
        [id, tenant.companyId],
      );

      if (!entry) {
        throw notFound('id');
      }
      if (entry.status !== 'posted') {
        throw conflict('ALREADY_REVERSED');
      }

      const lines = await query<LineRow>(
        em,
        `SELECT "entryId", direction, "itemType", finish, qty, inches, "factoryId", "materialId",
                "sootTypeId", "sootSizeId", "counterWidthId"
         FROM production_entry_line WHERE "entryId" = $1 ORDER BY "lineNo"`,
        [id],
      );
      const today = todayAtFactory();

      try {
        // What the step made comes out first, then what it used goes back.
        for (const line of [
          ...lines.filter((l) => l.direction === 'out'),
          ...lines.filter((l) => l.direction === 'in'),
        ]) {
          const adds = line.direction === 'in';
          const sign = adds ? 1 : -1;

          await this.stock.post(
            {
              companyId: tenant.companyId,
              date: today,
              key: this.keyOf(line),
              qty: sign * line.qty,
              inches:
                line.itemType === 'counter'
                  ? sign * (line.inches ?? 0)
                  : undefined,
              sourceType: PRODUCTION_REVERSAL_SOURCE,
              sourceId: id,
              note: `Reversed ${entryNo(entry.entrySeq)}`,
              createdByMemberId: tenant.memberId,
            },
            em,
          );
        }
      } catch (error) {
        if (isCode(error, 'INSUFFICIENT_STOCK')) {
          const onHand = (
            (error as HttpException).getResponse() as {
              onHand?: { qty: number };
            }
          ).onHand;
          throw conflict('REVERSE_NEGATIVE', {
            available: Math.max(0, onHand?.qty ?? 0),
          });
        }
        throw error;
      }

      await this.workEntries.reverseBySource(em, {
        companyId: tenant.companyId,
        sourceType: 'production',
        sourceId: id,
        date: today,
      });
      await em.query(
        `UPDATE production_entry SET status = 'reversed', "reversedById" = $1
         WHERE id = $2 AND "companyId" = $3`,
        [tenant.memberId, id, tenant.companyId],
      );
      await this.audit.record(
        {
          actorType: 'member',
          actorId: tenant.memberId,
          action: 'production.reverse',
          companyId: tenant.companyId,
          targetType: 'production_entry',
          targetId: id,
          metadata: { entryNo: entryNo(entry.entrySeq) },
        },
        em,
      );
    });

    return this.get(tenant, id);
  }

  // ------------------------------------------------------------- helpers

  // A cutting-output entry counts a truck that is cut and not counted yet.
  private async assertTruckToCount(
    em: EntityManager,
    companyId: string,
    purchaseId: string,
  ) {
    const [truck] = await query<{ status: string }>(
      em,
      `SELECT status FROM purchase WHERE id = $1 AND "companyId" = $2 FOR UPDATE`,
      [purchaseId, companyId],
    );

    if (!truck || truck.status !== 'cut') {
      throw conflict('TRUCK_NOT_CUT');
    }

    const [counted] = await query<{ id: string }>(
      em,
      `SELECT id FROM production_entry
       WHERE "companyId" = $1 AND "purchaseId" = $2 AND type = 'cut' AND status = 'posted'`,
      [companyId, purchaseId],
    );

    if (counted) {
      throw conflict('ALREADY_COUNTED');
    }
  }

  // Item names to ids, plus each line's sq.ft and a name for error messages.
  private async resolve(
    em: EntityManager,
    companyId: string,
    lines: EntryLineDto[],
  ): Promise<ResolvedLine[]> {
    const keys: StockItemKey[] = [];

    for (const line of lines) {
      keys.push(await this.items.resolve(em, companyId, line.item));
    }

    const names = await this.items.namesFor(companyId, keys, em);

    return lines.map((line, i) => {
      const key = keys[i];
      const n = names(key);
      const inches = line.inches ?? 0;
      const sqft =
        key.itemType === 'piece'
          ? ((n.widthInches ?? 0) * (n.lengthInches ?? 0) * line.qty) / 144
          : key.itemType === 'counter'
            ? ((n.widthInches ?? 0) * inches) / 144
            : 0;
      const what =
        key.itemType === 'piece'
          ? `${parseFloat(n.sootTypeName ?? '') || n.sootTypeName} soot ${n.sootSizeName}`
          : key.itemType === 'counter'
            ? `${n.widthInches} in counters`
            : 'slabs';

      return {
        direction: line.direction,
        key,
        qty: line.qty,
        inches,
        sqft,
        what,
      };
    });
  }

  private async assertInStock(
    em: EntityManager,
    companyId: string,
    lines: ResolvedLine[],
  ) {
    const need = new Map<string, ResolvedLine>();

    for (const line of lines.filter((l) => l.direction === 'in')) {
      const k = alertKeyOf(line.key);
      const so = need.get(k);

      need.set(
        k,
        so
          ? { ...so, qty: so.qty + line.qty, inches: so.inches + line.inches }
          : { ...line },
      );
    }

    for (const line of need.values()) {
      const have = await this.stock.onHand(companyId, line.key, em);

      if (line.qty > have.qty) {
        throw conflict('INSUFFICIENT_STOCK', {
          available: have.qty,
          what: line.what,
        });
      }
      if (line.key.itemType === 'counter' && line.inches > have.inches) {
        throw conflict('INSUFFICIENT_INCHES', {
          available: have.inches,
          what: line.what,
        });
      }
    }
  }

  private sqft(lines: ResolvedLine[], direction: Direction) {
    return lines
      .filter((l) => l.direction === direction)
      .reduce((sum, l) => sum + l.sqft, 0);
  }

  // A worker paid per sq.ft: their own rate if they have one, else the job
  // rate card. A cutting count pays nobody.
  private async payFor(
    em: EntityManager,
    companyId: string,
    type: EntryType,
    workerId: string | undefined,
    outSqft: number,
  ): Promise<{ workerId: string; rate: number; amount: number } | null> {
    if (type === 'cut' || !workerId) {
      return null;
    }

    const [worker] = await query<{
      id: string;
      rate: string;
      payType: string;
      isActive: boolean;
    }>(
      em,
      `SELECT id, rate, "payType", "isActive" FROM worker WHERE id = $1 AND "companyId" = $2`,
      [workerId, companyId],
    );

    if (!worker || !worker.isActive || worker.payType !== 'sqft') {
      throw invalid({ workerId: 'invalid' });
    }

    let rate = toNumber(worker.rate);

    if (!(rate > 0)) {
      const [card] = await query<{ rate: string }>(
        em,
        `SELECT rate FROM worker_rate
         WHERE "companyId" = $1 AND lower(name) = lower($2) AND "isActive" LIMIT 1`,
        [companyId, RATE_CARD_JOB[type]],
      );
      rate = toNumber(card?.rate);
    }

    return { workerId: worker.id, rate, amount: Math.round(outSqft * rate) };
  }

  private keyOf(line: LineRow): StockItemKey {
    return {
      factoryId: line.factoryId,
      itemType: line.itemType,
      materialId: line.materialId,
      sootTypeId: line.sootTypeId,
      sootSizeId: line.sootSizeId,
      counterWidthId: line.counterWidthId,
      finish: line.finish,
    };
  }

  private entryRows(
    companyId: string,
    filters: ListProductionEntriesQueryDto & { id?: string },
  ): Promise<EntryRow[]> {
    return query<EntryRow>(
      this.dataSource.manager,
      `SELECT e.id, e."entrySeq", e."date"::text AS "date", e.type, e."machineType",
              e."workerRate", e."workerAmount", e."wasteSqft", e.note, e.status,
              e."purchaseId", e."workerId", e."factoryId", f.name AS "factoryName",
              m.name AS material, w.name AS "workerName",
              u."firstName", u."lastName", u.phone, u.email
       FROM production_entry e
       JOIN factory f ON f.id = e."factoryId"
       JOIN catalog_item m ON m.id = e."materialId"
       LEFT JOIN worker w ON w.id = e."workerId"
       JOIN company_member cm ON cm.id = e."createdById"
       JOIN "user" u ON u.id = cm."userId"
       WHERE e."companyId" = $1
         AND ($2::uuid IS NULL OR e.id = $2)
         AND ($3::text IS NULL OR e.type = $3)
         AND ($4::text IS NULL OR lower(m.name) = lower($4))
         AND ($5::uuid IS NULL OR e."factoryId" = $5)
         AND ($6::date IS NULL OR e."date" >= $6)
         AND ($7::date IS NULL OR e."date" <= $7)
       ORDER BY e."date" DESC, e."entrySeq" DESC`,
      [
        companyId,
        filters.id ?? null,
        filters.type ?? null,
        filters.material ?? null,
        filters.factoryId ?? null,
        filters.from ?? null,
        filters.to ?? null,
      ],
    );
  }

  private async views(
    companyId: string,
    rows: EntryRow[],
  ): Promise<ProductionEntryView[]> {
    if (rows.length === 0) {
      return [];
    }

    const lines = await query<LineRow>(
      this.dataSource.manager,
      `SELECT "entryId", direction, "itemType", finish, qty, inches, "factoryId", "materialId",
              "sootTypeId", "sootSizeId", "counterWidthId"
       FROM production_entry_line
       WHERE "companyId" = $1 AND "entryId" = ANY($2)
       ORDER BY "entryId", "lineNo"`,
      [companyId, rows.map((r) => r.id)],
    );
    const names = await this.items.namesFor(
      companyId,
      lines.map((l) => this.keyOf(l)),
      this.dataSource.manager,
    );
    const byEntry = new Map<string, LineRow[]>();

    for (const line of lines) {
      byEntry.set(line.entryId, [...(byEntry.get(line.entryId) ?? []), line]);
    }

    return rows.map((row) => ({
      id: row.id,
      entryNo: entryNo(row.entrySeq),
      date: row.date,
      type: row.type,
      factoryId: row.factoryId,
      factoryName: row.factoryName,
      material: row.material,
      purchaseId: row.purchaseId,
      machineType: row.machineType,
      workerId: row.workerId,
      workerName: row.workerName,
      workerRate: toNumber(row.workerRate),
      workerAmount: toNumber(row.workerAmount),
      wasteSqft: toNumber(row.wasteSqft),
      note: row.note,
      status: row.status,
      lines: (byEntry.get(row.id) ?? []).map((line) => {
        const key = this.keyOf(line);

        return {
          direction: line.direction,
          item: this.items.itemView(key, names(key)),
          qty: line.qty,
          inches: line.inches ?? 0,
        };
      }),
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
