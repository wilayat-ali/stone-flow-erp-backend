import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { query } from '../engines/db';
import { invalid } from '../engines/errors';
import { StockService } from '../stock-movements/stock.service';
import type {
  StockFilters,
  StockItemKey,
  StockListRow,
} from '../stock-movements/stock.types';
import { TenantContext } from '../tenancy/tenant-context';
import { AuditService } from '../tenancy/audit.service';
import { SetAlertDto, StockQueryDto } from './dto/inventory.dto';
import {
  alertKeyOf,
  StockHistoryRowView,
  StockRowView,
} from './inventory.types';
import { StockItemsService } from './stock-items.service';

const PAGE = 25;
const ENGINE_MAX = 200;

// What is on hand, calculated by the stock engine from its movements and shown
// with names, plus each item's "running low" level. Nothing here changes stock.
@Injectable()
export class StockViewService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly stock: StockService,
    private readonly items: StockItemsService,
    private readonly audit: AuditService,
  ) {}

  async list(
    tenant: TenantContext,
    q: StockQueryDto,
  ): Promise<{ total: number; rows: StockRowView[] }> {
    const filters = this.filtersOf(q);
    const limit = q.limit ?? PAGE;
    const page = q.page ?? 1;
    const alerts = await this.alerts(tenant.companyId);

    let engineRows: StockListRow[];
    let total: number;

    if (q.lowOnly) {
      // "Low" depends on the alert levels, so look at every row, then page.
      const all: StockListRow[] = [];

      for (let p = 1; ; p += 1) {
        const batch = await this.stock.list({
          companyId: tenant.companyId,
          filters,
          page: p,
          limit: ENGINE_MAX,
        });
        all.push(...batch.rows);

        if (all.length >= batch.total || batch.rows.length === 0) {
          break;
        }
      }

      const low = all.filter((row) => {
        const min = alerts.get(alertKeyOf(row));
        return min !== undefined && row.qty < min;
      });

      total = low.length;
      engineRows = low.slice((page - 1) * limit, page * limit);
    } else {
      const result = await this.stock.list({
        companyId: tenant.companyId,
        filters,
        page,
        limit,
      });
      total = result.total;
      engineRows = result.rows;
    }

    const names = await this.items.namesFor(
      tenant.companyId,
      engineRows,
      this.dataSource.manager,
    );

    return {
      total,
      rows: engineRows.map((row) => {
        const n = names(row);
        const min = alerts.get(alertKeyOf(row)) ?? null;

        return {
          ...row,
          ...n,
          item: this.items.itemView(row, n),
          minQty: min,
          low: min !== null && row.qty < min,
        };
      }),
    };
  }

  // Every movement of one item, oldest first, with the stock on hand after each.
  async history(
    tenant: TenantContext,
    q: StockQueryDto,
  ): Promise<{
    total: number;
    onHand: { qty: number; inches: number };
    rows: StockHistoryRowView[];
  }> {
    if (!q.type || !q.material || !q.factory) {
      throw invalid({ item: 'required' });
    }

    const key: StockItemKey = {
      factoryId: q.factory,
      itemType: q.type,
      materialId: q.material,
      sootTypeId: q.soot ?? null,
      sootSizeId: q.size ?? null,
      counterWidthId: q.width ?? null,
      finish: q.finish ?? null,
    };

    const result = await this.stock.history({
      companyId: tenant.companyId,
      key,
      order: 'asc',
      page: q.page ?? 1,
      limit: q.limit ?? ENGINE_MAX,
    });

    return {
      total: result.total,
      onHand: result.onHand,
      rows: result.rows.map((row) => ({
        id: row.id,
        date: row.date,
        qty: row.qty,
        inches: row.inches ?? 0,
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        note: row.note,
        balanceQty: row.runningQty,
        balanceInches: row.runningInches,
      })),
    };
  }

  // The level below which an item shows as low. 0 removes the alert.
  async setAlert(
    tenant: TenantContext,
    dto: SetAlertDto,
  ): Promise<{ minQty: number | null }> {
    await this.dataSource.transaction(async (em) => {
      const key = await this.items.resolve(em, tenant.companyId, dto.item);
      const itemKey = alertKeyOf(key);

      if (dto.minQty > 0) {
        await em.query(
          `INSERT INTO stock_alert ("companyId", "itemKey", "minQty")
           VALUES ($1, $2, $3)
           ON CONFLICT ("companyId", "itemKey")
           DO UPDATE SET "minQty" = EXCLUDED."minQty", "updatedAt" = now()`,
          [tenant.companyId, itemKey, dto.minQty],
        );
      } else {
        await em.query(
          `DELETE FROM stock_alert WHERE "companyId" = $1 AND "itemKey" = $2`,
          [tenant.companyId, itemKey],
        );
      }

      await this.audit.record(
        {
          actorType: 'member',
          actorId: tenant.memberId,
          action: 'stock.set_alert',
          companyId: tenant.companyId,
          targetType: 'stock_alert',
          metadata: { itemKey, minQty: dto.minQty },
        },
        em,
      );
    });

    return { minQty: dto.minQty > 0 ? dto.minQty : null };
  }

  // ------------------------------------------------------------- helpers

  private filtersOf(q: StockQueryDto): StockFilters {
    const filters: StockFilters = {
      factoryId: q.factory,
      itemType: q.type,
      materialId: q.material,
      sootTypeId: q.soot,
      sootSizeId: q.size,
      counterWidthId: q.width,
      finish: q.finish,
    };

    return Object.fromEntries(
      Object.entries(filters).filter(([, value]) => value !== undefined),
    ) as StockFilters;
  }

  private async alerts(companyId: string): Promise<Map<string, number>> {
    const rows = await query<{ itemKey: string; minQty: number }>(
      this.dataSource.manager,
      `SELECT "itemKey", "minQty" FROM stock_alert WHERE "companyId" = $1`,
      [companyId],
    );

    return new Map(rows.map((row) => [row.itemKey, row.minQty]));
  }
}
