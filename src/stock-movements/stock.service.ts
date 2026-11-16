import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { DataSource, EntityManager } from 'typeorm';
import {
  inTransaction,
  pageBounds,
  query,
  toNumber,
  toNumberOrNull,
} from '../engines/db';
import { conflict, invalid } from '../engines/errors';
import {
  assertDate,
  assertMemberInCompany,
  assertSourceType,
  assertUuid,
  cleanNote,
} from '../engines/guards';
import {
  itemLockName,
  keyConditions,
  normalizeItemKey,
} from './stock-item-key';
import {
  NormalizedItemKey,
  OnHand,
  PostStockInput,
  STOCK_FINISHES,
  STOCK_ITEM_TYPES,
  StockFilters,
  StockHistoryInput,
  StockHistoryRow,
  StockItemKey,
  StockListInput,
  StockListRow,
  StockMovementRow,
} from './stock.types';

type RawMovement = {
  id: string;
  companyId: string;
  date: string;
  factoryId: string;
  itemType: NormalizedItemKey['itemType'];
  materialId: string;
  sootTypeId: string | null;
  sootSizeId: string | null;
  counterWidthId: string | null;
  finish: NormalizedItemKey['finish'];
  qty: number | string;
  inches: number | string | null;
  sourceType: string;
  sourceId: string | null;
  note: string | null;
  createdByMemberId: string;
  createdAt: Date;
};

// Selected everywhere so `date` is read as text (see LedgerService).
const COLS = `id, "companyId", "date"::text AS "date", "factoryId", "itemType", "materialId",
  "sootTypeId", "sootSizeId", "counterWidthId", finish, qty, inches,
  "sourceType", "sourceId", note, "createdByMemberId", "createdAt"`;

// Largest value an `integer` column holds.
const MAX_INT = 2_147_483_647;

const wholeNonZero = (value: unknown): value is number =>
  Number.isSafeInteger(value) &&
  value !== 0 &&
  Math.abs(value as number) <= MAX_INT;

function toMovement(raw: RawMovement): StockMovementRow {
  return {
    id: raw.id,
    companyId: raw.companyId,
    date: raw.date,
    key: {
      factoryId: raw.factoryId,
      itemType: raw.itemType,
      materialId: raw.materialId,
      sootTypeId: raw.sootTypeId,
      sootSizeId: raw.sootSizeId,
      counterWidthId: raw.counterWidthId,
      finish: raw.finish,
    },
    qty: toNumber(raw.qty),
    inches: toNumberOrNull(raw.inches),
    sourceType: raw.sourceType,
    sourceId: raw.sourceId,
    note: raw.note,
    createdByMemberId: raw.createdByMemberId,
    createdAt: raw.createdAt,
  };
}

// The stock movement engine (rules §2.2). Every stock change is one
// append-only row with a signed quantity; what is on hand is always the sum of
// rows, never a stored number. Rows are never edited or deleted: a mistake is
// fixed with an opposite movement. The database enforces this with a trigger.
//
// Every method takes the companyId from the tenant context and filters by it.
// Pass `manager` to run inside the caller's transaction (for example a
// factory-to-factory transfer is two post() calls in one transaction).
@Injectable()
export class StockService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  // Refuses a movement that would leave the item below zero (pieces/slabs, and
  // for counters also total inches). The check runs under a per-item lock so
  // two simultaneous removals cannot both pass.
  async post(
    input: PostStockInput,
    manager?: EntityManager,
  ): Promise<StockMovementRow> {
    const key = normalizeItemKey(input.key);
    assertDate('date', input.date);
    assertSourceType(input.sourceType);

    if (input.sourceId) {
      assertUuid('sourceId', input.sourceId);
    }
    if (!wholeNonZero(input.qty)) {
      throw invalid({ qty: 'mustBeWholeNonZero' });
    }

    const isCounter = key.itemType === 'counter';
    let inches: number | null = null;

    if (isCounter) {
      if (!wholeNonZero(input.inches)) {
        throw invalid({ inches: 'mustBeWholeNonZero' });
      }
      if (Math.sign(input.inches) !== Math.sign(input.qty)) {
        throw invalid({ inches: 'mustMatchQtyDirection' });
      }
      inches = input.inches;
    } else if (input.inches !== undefined && input.inches !== null) {
      throw invalid({ inches: 'onlyForCounters' });
    }

    return inTransaction(this.dataSource, manager, async (em) => {
      await assertMemberInCompany(em, input.companyId, input.createdByMemberId);

      if (input.qty < 0) {
        await em.query(
          `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
          [itemLockName(input.companyId, key)],
        );

        const onHand = await this.sumOnHand(em, input.companyId, key);
        const tooFew = onHand.qty + input.qty < 0;
        const tooShort = isCounter && onHand.inches + (inches ?? 0) < 0;

        if (tooFew || tooShort) {
          throw conflict('INSUFFICIENT_STOCK', {
            onHand,
            requested: { qty: input.qty, inches },
          });
        }
      }

      const [created] = await query<RawMovement>(
        em,
        `INSERT INTO stock_movement
           ("companyId", "createdByMemberId", "date", "factoryId", "itemType", "materialId",
            "sootTypeId", "sootSizeId", "counterWidthId", finish, qty, inches,
            "sourceType", "sourceId", note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         RETURNING ${COLS}`,
        [
          input.companyId,
          input.createdByMemberId,
          input.date,
          key.factoryId,
          key.itemType,
          key.materialId,
          key.sootTypeId,
          key.sootSizeId,
          key.counterWidthId,
          key.finish,
          input.qty,
          inches,
          input.sourceType,
          input.sourceId ?? null,
          cleanNote(input.note),
        ],
      );

      return toMovement(created);
    });
  }

  async onHand(
    companyId: string,
    key: StockItemKey,
    manager?: EntityManager,
  ): Promise<OnHand> {
    return this.sumOnHand(
      manager ?? this.dataSource.manager,
      companyId,
      normalizeItemKey(key),
    );
  }

  // Stock overview: one row per item with its quantity, filtered. Items at
  // exactly zero are left out unless `includeZero` is set.
  async list(
    input: StockListInput,
    manager?: EntityManager,
  ): Promise<{ total: number; rows: StockListRow[] }> {
    const filters = this.checkFilters(input.filters ?? {});
    const where: string[] = [`"companyId" = $1`];
    const params: unknown[] = [input.companyId];

    for (const [column, value] of Object.entries(filters)) {
      params.push(value);
      where.push(`"${column}" = $${params.length}`);
    }

    const { limit, offset } = pageBounds(input);
    params.push(input.includeZero === true, limit, offset);
    const [zero, lim, off] = [
      params.length - 2,
      params.length - 1,
      params.length,
    ];

    const rows = await query<
      Omit<RawMovement, 'qty' | 'inches'> & {
        qty: string;
        inches: string | null;
        total: string;
      }
    >(
      manager ?? this.dataSource.manager,
      `SELECT "factoryId", "itemType", "materialId", "sootTypeId", "sootSizeId",
              "counterWidthId", finish,
              SUM(qty) AS qty, SUM(inches) AS inches, COUNT(*) OVER () AS total
       FROM stock_movement
       WHERE ${where.join(' AND ')}
       GROUP BY "factoryId", "itemType", "materialId", "sootTypeId", "sootSizeId",
                "counterWidthId", finish
       HAVING $${zero}::boolean OR SUM(qty) <> 0 OR COALESCE(SUM(inches), 0) <> 0
       ORDER BY "itemType", "materialId", "factoryId", "sootTypeId", "sootSizeId",
                "counterWidthId", finish
       LIMIT $${lim} OFFSET $${off}`,
      params,
    );

    return {
      total: rows.length ? toNumber(rows[0].total) : 0,
      rows: rows.map((raw) => ({
        factoryId: raw.factoryId,
        itemType: raw.itemType,
        materialId: raw.materialId,
        sootTypeId: raw.sootTypeId,
        sootSizeId: raw.sootSizeId,
        counterWidthId: raw.counterWidthId,
        finish: raw.finish,
        qty: toNumber(raw.qty),
        inches: toNumber(raw.inches),
      })),
    };
  }

  // Every movement of one item, with the stock on hand after each one. The
  // last running value always equals onHand().
  async history(
    input: StockHistoryInput,
    manager?: EntityManager,
  ): Promise<{ onHand: OnHand; total: number; rows: StockHistoryRow[] }> {
    const em = manager ?? this.dataSource.manager;
    const key = normalizeItemKey(input.key);
    const cond = keyConditions(key, 2, 'm');
    const { limit, offset } = pageBounds(input);
    const dir = input.order === 'asc' ? 'ASC' : 'DESC';

    const onHand = await this.sumOnHand(em, input.companyId, key);

    const rows = await query<
      RawMovement & { runningQty: string; runningInches: string; total: string }
    >(
      em,
      `WITH ordered AS (
         SELECT m.*,
                SUM(m.qty) OVER w AS "runningQty",
                COALESCE(SUM(m.inches) OVER w, 0) AS "runningInches",
                COUNT(*) OVER () AS total
         FROM stock_movement m
         WHERE m."companyId" = $1 AND ${cond.sql}
         WINDOW w AS (ORDER BY m."date", m."createdAt", m.id
                      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
       )
       SELECT ${COLS}, "runningQty", "runningInches", total
       FROM ordered
       ORDER BY "date" ${dir}, "createdAt" ${dir}, id ${dir}
       LIMIT $${cond.params.length + 2} OFFSET $${cond.params.length + 3}`,
      [input.companyId, ...cond.params, limit, offset],
    );

    return {
      onHand,
      total: rows.length ? toNumber(rows[0].total) : 0,
      rows: rows.map((raw) => ({
        ...toMovement(raw),
        runningQty: toNumber(raw.runningQty),
        runningInches: toNumber(raw.runningInches),
      })),
    };
  }

  // ---- internals ----------------------------------------------------------

  private async sumOnHand(
    em: EntityManager,
    companyId: string,
    key: NormalizedItemKey,
  ): Promise<OnHand> {
    const cond = keyConditions(key, 2);
    const [row] = await query<{ qty: string; inches: string }>(
      em,
      `SELECT COALESCE(SUM(qty), 0) AS qty, COALESCE(SUM(inches), 0) AS inches
       FROM stock_movement WHERE "companyId" = $1 AND ${cond.sql}`,
      [companyId, ...cond.params],
    );

    return { qty: toNumber(row.qty), inches: toNumber(row.inches) };
  }

  private checkFilters(filters: StockFilters): Record<string, string> {
    const checked: Record<string, string> = {};
    const errors: Record<string, string> = {};

    for (const field of [
      'factoryId',
      'materialId',
      'sootTypeId',
      'sootSizeId',
      'counterWidthId',
    ] as const) {
      const value = filters[field];
      if (value === undefined) continue;
      if (typeof value === 'string' && isUUID(value)) checked[field] = value;
      else errors[field] = 'invalidId';
    }

    if (filters.itemType !== undefined) {
      if (STOCK_ITEM_TYPES.includes(filters.itemType)) {
        checked.itemType = filters.itemType;
      } else errors.itemType = 'invalid';
    }
    if (filters.finish !== undefined) {
      if (STOCK_FINISHES.includes(filters.finish)) {
        checked.finish = filters.finish;
      } else errors.finish = 'invalid';
    }

    if (Object.keys(errors).length > 0) {
      throw invalid(errors);
    }

    return checked;
  }
}
