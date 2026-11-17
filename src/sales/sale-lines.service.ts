import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { query, toNumber } from '../engines/db';
import { conflict } from '../engines/errors';
import { StockItemsService } from '../inventory/stock-items.service';
import { StockService } from '../stock-movements/stock.service';
import type { StockItemKey } from '../stock-movements/stock.types';
import { SaleLineDto } from './dto/sales.dto';
import { BillLineView } from './sales.types';

export type ResolvedSaleLine = {
  lineNo: number;
  key: StockItemKey;
  qty: number;
  inches: number;
  tons: number;
  rate: number;
  orderLineId: string | null;
  /** The line's price: sq.ft x rate (pieces), inches x rate (counters), tons x rate (slabs). */
  amount: number;
  what: string;
};

type LineRow = {
  id: string;
  parentId: string;
  lineNo: number;
  itemType: StockItemKey['itemType'];
  finish: StockItemKey['finish'];
  materialId: string;
  sootTypeId: string | null;
  sootSizeId: string | null;
  counterWidthId: string | null;
  qty: number;
  inches: number | null;
  tons: string;
  rate: string;
  orderLineId?: string | null;
};

// What a bill or an order is made of: lines of stone named the way the screens
// name them, resolved to the ids the stock engine keys on, priced, and checked
// against stock and against what other bills have already booked.
@Injectable()
export class SaleLinesService {
  constructor(
    private readonly items: StockItemsService,
    private readonly stock: StockService,
  ) {}

  async resolve(
    em: EntityManager,
    companyId: string,
    factoryId: string,
    lines: SaleLineDto[],
  ): Promise<ResolvedSaleLine[]> {
    const keys: StockItemKey[] = [];

    for (const line of lines) {
      keys.push(
        await this.items.resolve(em, companyId, { ...line.item, factoryId }),
      );
    }

    const names = await this.items.namesFor(companyId, keys, em);
    let next = Math.max(0, ...lines.map((l) => l.lineNo ?? 0));

    return lines.map((line, i) => {
      const key = keys[i];
      const n = names(key);
      const inches = line.inches ?? 0;
      const tons = line.tons ?? 0;
      const sqft =
        ((n.widthInches ?? 0) * (n.lengthInches ?? 0) * line.qty) / 144;
      const amount =
        key.itemType === 'piece'
          ? Math.round(sqft * line.rate)
          : key.itemType === 'counter'
            ? Math.round(inches * line.rate)
            : Math.round(tons * line.rate);

      next = line.lineNo ? next : next + 1;

      return {
        lineNo: line.lineNo ?? next,
        key,
        qty: line.qty,
        inches,
        tons,
        rate: line.rate,
        orderLineId: line.orderLineId ?? null,
        amount,
        what:
          key.itemType === 'piece'
            ? `${parseFloat(n.sootTypeName ?? '') || n.sootTypeName} soot ${n.sootSizeName}`
            : key.itemType === 'counter'
              ? `${n.widthInches} in counters`
              : 'slabs',
      };
    });
  }

  // A line needs its own quantity, price and the figures its kind of stone is
  // measured by.
  validate(lines: ResolvedSaleLine[]) {
    const seen = new Set<number>();

    for (const line of lines) {
      if (!(line.qty > 0)) {
        throw conflict('QTY_REQUIRED');
      }
      if (!(line.rate > 0)) {
        throw conflict('RATE_REQUIRED');
      }
      if (line.key.itemType === 'counter' && !(line.inches > 0)) {
        throw conflict('INCHES_REQUIRED');
      }
      if (line.key.itemType === 'slab' && !(line.tons > 0)) {
        throw conflict('TONS_REQUIRED');
      }
      if (seen.has(line.lineNo)) {
        throw conflict('DUPLICATE_LINE');
      }

      seen.add(line.lineNo);
    }
  }

  async insertLines(
    em: EntityManager,
    table: 'bill_line' | 'order_line',
    companyId: string,
    parentId: string,
    lines: ResolvedSaleLine[],
  ): Promise<void> {
    const parent = table === 'bill_line' ? 'billId' : 'orderId';

    for (const line of lines) {
      await em.query(
        `INSERT INTO ${table}
           ("companyId", "${parent}", "lineNo", "itemType", finish, "materialId", "sootTypeId", "sootSizeId", "counterWidthId", qty, inches, tons, rate${table === 'bill_line' ? ', "orderLineId"' : ''})
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13${table === 'bill_line' ? ', $14' : ''})`,
        [
          companyId,
          parentId,
          line.lineNo,
          line.key.itemType,
          line.key.finish ?? null,
          line.key.materialId,
          line.key.sootTypeId ?? null,
          line.key.sootSizeId ?? null,
          line.key.counterWidthId ?? null,
          line.qty,
          line.key.itemType === 'counter' ? line.inches : null,
          line.tons,
          line.rate,
          ...(table === 'bill_line' ? [line.orderLineId] : []),
        ],
      );
    }
  }

  // What other bills have booked and not collected yet, for one kind of stone
  // in one factory. Only a bill reserves stone; an order does not.
  async reserved(
    em: EntityManager,
    companyId: string,
    factoryId: string,
    key: StockItemKey,
    exceptBillId?: string,
  ): Promise<{ qty: number; inches: number }> {
    const [row] = await query<{ qty: string; inches: string }>(
      em,
      `SELECT COALESCE(SUM(bl.qty - COALESCE(g.qty, 0)), 0) AS qty,
              COALESCE(SUM(COALESCE(bl.inches, 0) - COALESCE(g.inches, 0)), 0) AS inches
       FROM bill_line bl
       JOIN bill b ON b.id = bl."billId" AND b.status = 'active' AND b."companyId" = $1 AND b."factoryId" = $2
                  AND ($3::uuid IS NULL OR b.id <> $3)
       LEFT JOIN (
         SELECT c."billId", cl."lineNo", SUM(cl.qty) AS qty, SUM(cl.inches) AS inches
         FROM bill_collection c JOIN collection_line cl ON cl."collectionId" = c.id
         WHERE c."companyId" = $1 GROUP BY c."billId", cl."lineNo"
       ) g ON g."billId" = bl."billId" AND g."lineNo" = bl."lineNo"
       WHERE bl."itemType" = $4 AND bl."materialId" = $5
         AND bl."sootTypeId" IS NOT DISTINCT FROM $6::uuid
         AND bl."sootSizeId" IS NOT DISTINCT FROM $7::uuid
         AND bl."counterWidthId" IS NOT DISTINCT FROM $8::uuid
         AND bl.finish IS NOT DISTINCT FROM $9::text`,
      [
        companyId,
        factoryId,
        exceptBillId ?? null,
        key.itemType,
        key.materialId,
        key.sootTypeId ?? null,
        key.sootSizeId ?? null,
        key.counterWidthId ?? null,
        key.finish ?? null,
      ],
    );

    return { qty: toNumber(row.qty), inches: toNumber(row.inches) };
  }

  // Stone that has to be on hand and not booked by another bill. `already` is
  // what a bill being edited has collected, which has already left the yard.
  async assertAvailable(
    em: EntityManager,
    companyId: string,
    factoryId: string,
    lines: ResolvedSaleLine[],
    already: Map<number, { qty: number; inches: number }>,
    exceptBillId?: string,
  ) {
    const need = new Map<
      string,
      { line: ResolvedSaleLine; qty: number; inches: number }
    >();

    for (const line of lines) {
      const got = already.get(line.lineNo) ?? { qty: 0, inches: 0 };
      const k = JSON.stringify([
        line.key.itemType,
        line.key.materialId,
        line.key.sootTypeId,
        line.key.sootSizeId,
        line.key.counterWidthId,
        line.key.finish,
      ]);
      const cur = need.get(k) ?? { line, qty: 0, inches: 0 };

      cur.qty += line.qty - got.qty;
      cur.inches += line.inches - got.inches;
      need.set(k, cur);
    }

    for (const n of need.values()) {
      const [have, booked] = await Promise.all([
        this.stock.onHand(companyId, n.line.key, em),
        this.reserved(em, companyId, factoryId, n.line.key, exceptBillId),
      ]);

      if (n.qty > have.qty - booked.qty) {
        throw conflict('NOT_AVAILABLE', {
          available: Math.max(0, have.qty - booked.qty),
          what: n.line.what,
        });
      }
      if (
        n.line.key.itemType === 'counter' &&
        n.inches > have.inches - booked.inches
      ) {
        throw conflict('NOT_AVAILABLE_INCHES', {
          available: Math.max(0, have.inches - booked.inches),
          what: n.line.what,
        });
      }
    }
  }

  // The lines of many bills (or orders) as the screens name them.
  async views(
    companyId: string,
    table: 'bill_line' | 'order_line',
    parentIds: string[],
    factoryOf: Map<string, string>,
    em: EntityManager,
  ): Promise<Map<string, (BillLineView & { id: string })[]>> {
    const parent = table === 'bill_line' ? 'billId' : 'orderId';
    const rows = await query<LineRow>(
      em,
      `SELECT id, "${parent}" AS "parentId", "lineNo", "itemType", finish, "materialId", "sootTypeId", "sootSizeId",
              "counterWidthId", qty, inches, tons, rate${table === 'bill_line' ? ', "orderLineId"' : ''}
       FROM ${table} WHERE "companyId" = $1 AND "${parent}" = ANY($2) ORDER BY "${parent}", "lineNo"`,
      [companyId, parentIds],
    );
    const keyOf = (r: LineRow): StockItemKey => ({
      factoryId: factoryOf.get(r.parentId) ?? '',
      itemType: r.itemType,
      materialId: r.materialId,
      sootTypeId: r.sootTypeId,
      sootSizeId: r.sootSizeId,
      counterWidthId: r.counterWidthId,
      finish: r.finish,
    });
    const names = await this.items.namesFor(companyId, rows.map(keyOf), em);
    const result = new Map<string, (BillLineView & { id: string })[]>();

    for (const r of rows) {
      const key = keyOf(r);

      result.set(r.parentId, [
        ...(result.get(r.parentId) ?? []),
        {
          id: r.id,
          lineNo: r.lineNo,
          item: this.items.itemView(key, names(key)),
          qty: r.qty,
          inches: r.inches ?? 0,
          tons: toNumber(r.tons),
          rate: toNumber(r.rate),
          orderLineId: r.orderLineId ?? null,
        },
      ]);
    }

    return result;
  }
}
