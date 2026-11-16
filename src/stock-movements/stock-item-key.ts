import { isUUID } from 'class-validator';
import { invalid } from '../engines/errors';
import {
  NormalizedItemKey,
  STOCK_FINISHES,
  STOCK_ITEM_TYPES,
  StockItemKey,
} from './stock.types';

const isId = (value: unknown): value is string =>
  typeof value === 'string' && isUUID(value);

// Validates a key against the shape its type requires (rules §2.2) and nulls
// out the parts that do not apply, so "the same item" always compares equal.
export function normalizeItemKey(key: StockItemKey): NormalizedItemKey {
  const errors: Record<string, string> = {};

  if (!isId(key.factoryId)) {
    errors.factoryId = 'invalidId';
  }
  if (!isId(key.materialId)) {
    errors.materialId = 'invalidId';
  }
  if (!STOCK_ITEM_TYPES.includes(key.itemType)) {
    errors.itemType = 'invalid';
  }

  const needs = {
    piece: { soot: true, width: false, finish: true },
    counter: { soot: false, width: true, finish: true },
    slab: { soot: false, width: false, finish: false },
  }[key.itemType] ?? { soot: false, width: false, finish: false };

  const part = (
    field: 'sootTypeId' | 'sootSizeId' | 'counterWidthId',
    required: boolean,
  ) => {
    const value = key[field] ?? null;
    if (required && !isId(value)) {
      errors[field] = 'required';
    } else if (!required && value !== null) {
      errors[field] = 'notAllowedForItemType';
    }
    return required ? value : null;
  };

  const sootTypeId = part('sootTypeId', needs.soot);
  const sootSizeId = part('sootSizeId', needs.soot);
  const counterWidthId = part('counterWidthId', needs.width);

  const finish = key.finish ?? null;
  if (needs.finish && (finish === null || !STOCK_FINISHES.includes(finish))) {
    errors.finish = 'required';
  } else if (!needs.finish && finish !== null) {
    errors.finish = 'notAllowedForItemType';
  }

  if (Object.keys(errors).length > 0) {
    throw invalid(errors);
  }

  return {
    factoryId: key.factoryId,
    itemType: key.itemType,
    materialId: key.materialId,
    sootTypeId,
    sootSizeId,
    counterWidthId,
    finish: needs.finish ? finish : null,
  };
}

// Same item = same value in every key column. Null parts use IS NULL so the
// indexes stay usable. Parameters start at $startAt.
export function keyConditions(
  key: NormalizedItemKey,
  startAt: number,
  alias = '',
): { sql: string; params: unknown[] } {
  const prefix = alias ? `${alias}.` : '';
  const columns: [keyof NormalizedItemKey, string | null][] = [
    ['factoryId', key.factoryId],
    ['itemType', key.itemType],
    ['materialId', key.materialId],
    ['sootTypeId', key.sootTypeId],
    ['sootSizeId', key.sootSizeId],
    ['counterWidthId', key.counterWidthId],
    ['finish', key.finish],
  ];

  const parts: string[] = [];
  const params: unknown[] = [];

  for (const [column, value] of columns) {
    if (value === null) {
      parts.push(`${prefix}"${column}" IS NULL`);
    } else {
      params.push(value);
      parts.push(`${prefix}"${column}" = $${startAt + params.length - 1}`);
    }
  }

  return { sql: parts.join(' AND '), params };
}

// One lock name per item, so two people removing the same stock at the same
// time are checked one after the other.
export function itemLockName(companyId: string, key: NormalizedItemKey) {
  return [
    companyId,
    key.factoryId,
    key.itemType,
    key.materialId,
    key.sootTypeId ?? '',
    key.sootSizeId ?? '',
    key.counterWidthId ?? '',
    key.finish ?? '',
  ].join('|');
}
