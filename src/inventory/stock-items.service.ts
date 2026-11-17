import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { query } from '../engines/db';
import { invalid } from '../engines/errors';
import { PieceSizesService } from '../settings/piece-sizes.service';
import type {
  NormalizedItemKey,
  StockItemKey,
} from '../stock-movements/stock.types';
import { ItemDto } from './dto/inventory.dto';
import { Finish, ItemNames, StockItemView } from './inventory.types';

type Ids = Pick<
  StockItemKey,
  'factoryId' | 'materialId' | 'sootTypeId' | 'sootSizeId' | 'counterWidthId'
>;

// "14 soot" -> "14", "1.5 inch" -> "1.5": the number a name starts with.
const numberOf = (name: string) => {
  const n = parseFloat(name);

  return Number.isFinite(n) ? n : null;
};

// Turns an item as the screens name it (material "Ziarat White", soot "14",
// size "12x24", width 2) into the ids the stock engine keys on, and back into
// names for lists. A new material or piece size is added the first time someone
// counts stock in it, so nothing has to be set up first.
@Injectable()
export class StockItemsService {
  constructor(private readonly pieceSizes: PieceSizesService) {}

  async resolve(
    em: EntityManager,
    companyId: string,
    item: ItemDto,
  ): Promise<StockItemKey> {
    const [factory] = await query<{ id: string }>(
      em,
      `SELECT id FROM factory WHERE id = $1 AND "companyId" = $2 AND "isActive"`,
      [item.factoryId, companyId],
    );

    if (!factory) {
      throw invalid({ factoryId: 'invalid' });
    }

    const materialId = await this.material(em, companyId, item.material);
    let sootTypeId: string | null = null;
    let sootSizeId: string | null = null;
    let counterWidthId: string | null = null;

    if (item.itemType === 'piece') {
      if (!item.soot) {
        throw invalid({ soot: 'required' });
      }
      if (!item.size) {
        throw invalid({ size: 'required' });
      }

      sootTypeId = await this.sootType(em, companyId, item.soot);
      sootSizeId = await this.pieceSizes.findOrCreate(
        em,
        companyId,
        sootTypeId,
        item.size,
      );
    }

    if (item.itemType === 'counter') {
      if (!item.width) {
        throw invalid({ width: 'required' });
      }

      counterWidthId = await this.counterWidth(em, companyId, item.width);
    }

    return {
      factoryId: item.factoryId,
      itemType: item.itemType,
      materialId,
      sootTypeId,
      sootSizeId,
      counterWidthId,
      finish: item.finish ?? null,
    };
  }

  // Display names (and sizes in inches) for the ids of many rows at once.
  async namesFor(
    companyId: string,
    rows: Ids[],
    em: EntityManager,
  ): Promise<(row: Ids) => ItemNames> {
    const catalogIds = new Set<string>();
    const sizeIds = new Set<string>();
    const factoryIds = new Set<string>();

    for (const row of rows) {
      catalogIds.add(row.materialId);
      factoryIds.add(row.factoryId);
      if (row.sootTypeId) catalogIds.add(row.sootTypeId);
      if (row.counterWidthId) catalogIds.add(row.counterWidthId);
      if (row.sootSizeId) sizeIds.add(row.sootSizeId);
    }

    const [catalog, sizes, factories] = await Promise.all([
      query<{ id: string; name: string }>(
        em,
        `SELECT id, name FROM catalog_item WHERE "companyId" = $1 AND id = ANY($2)`,
        [companyId, [...catalogIds]],
      ),
      query<{
        id: string;
        label: string;
        widthInches: string;
        lengthInches: string;
      }>(
        em,
        `SELECT id, label, "widthInches", "lengthInches" FROM piece_size WHERE "companyId" = $1 AND id = ANY($2)`,
        [companyId, [...sizeIds]],
      ),
      query<{ id: string; name: string }>(
        em,
        `SELECT id, name FROM factory WHERE "companyId" = $1 AND id = ANY($2)`,
        [companyId, [...factoryIds]],
      ),
    ]);

    const catalogName = new Map(catalog.map((c) => [c.id, c.name]));
    const size = new Map(sizes.map((s) => [s.id, s]));
    const factoryName = new Map(factories.map((f) => [f.id, f.name]));

    return (row) => {
      const piece = row.sootSizeId ? size.get(row.sootSizeId) : undefined;
      const widthName = row.counterWidthId
        ? (catalogName.get(row.counterWidthId) ?? null)
        : null;

      return {
        materialName: catalogName.get(row.materialId) ?? '',
        factoryName: factoryName.get(row.factoryId) ?? '',
        sootTypeName: row.sootTypeId
          ? (catalogName.get(row.sootTypeId) ?? null)
          : null,
        sootSizeName: piece?.label ?? null,
        counterWidthName: widthName,
        widthInches: piece
          ? Number(piece.widthInches)
          : widthName
            ? numberOf(widthName)
            : null,
        lengthInches: piece ? Number(piece.lengthInches) : null,
      };
    };
  }

  // The item the way the screens name it.
  itemView(
    key: NormalizedItemKey | StockItemKey,
    names: ItemNames,
  ): StockItemView {
    if (key.itemType === 'piece') {
      return {
        itemType: 'piece',
        material: names.materialName,
        factoryId: key.factoryId,
        soot: String(numberOf(names.sootTypeName ?? '') ?? names.sootTypeName),
        size: names.sootSizeName ?? '',
        finish: (key.finish ?? 'unpolished') as Finish,
      };
    }

    if (key.itemType === 'counter') {
      return {
        itemType: 'counter',
        material: names.materialName,
        factoryId: key.factoryId,
        width: names.widthInches ?? 0,
        finish: (key.finish ?? 'unpolished') as Finish,
      };
    }

    return {
      itemType: 'slab',
      material: names.materialName,
      factoryId: key.factoryId,
    };
  }

  // ------------------------------------------------------------- helpers

  // Found by name, ignoring case, or added. The lock makes two people adding
  // the same new material at once end up with one.
  async material(
    em: EntityManager,
    companyId: string,
    name: string,
  ): Promise<string> {
    const clean = name.trim();

    await em.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `material:${companyId}:${clean.toLowerCase()}`,
    ]);

    const [found] = await query<{ id: string }>(
      em,
      `SELECT id FROM catalog_item
       WHERE "companyId" = $1 AND kind = 'material' AND LOWER(name) = LOWER($2)`,
      [companyId, clean],
    );

    if (found) {
      return found.id;
    }

    const [created] = await query<{ id: string }>(
      em,
      `INSERT INTO catalog_item ("companyId", kind, name) VALUES ($1, 'material', $2) RETURNING id`,
      [companyId, clean],
    );

    return created.id;
  }

  private async sootType(
    em: EntityManager,
    companyId: string,
    soot: string,
  ): Promise<string> {
    const items = await query<{ id: string; name: string }>(
      em,
      `SELECT id, name FROM catalog_item WHERE "companyId" = $1 AND kind = 'soot_size'`,
      [companyId],
    );
    const wanted = numberOf(soot);
    const match = items.find(
      (item) =>
        item.name.toLowerCase() === soot.toLowerCase() ||
        (wanted !== null && numberOf(item.name) === wanted),
    );

    if (!match) {
      throw invalid({ soot: 'unknown' });
    }

    return match.id;
  }

  private async counterWidth(
    em: EntityManager,
    companyId: string,
    width: number,
  ): Promise<string> {
    const items = await query<{ id: string; name: string }>(
      em,
      `SELECT id, name FROM catalog_item WHERE "companyId" = $1 AND kind = 'counter_width'`,
      [companyId],
    );
    const match = items.find((item) => numberOf(item.name) === width);

    if (!match) {
      throw invalid({ width: 'unknown' });
    }

    return match.id;
  }
}
