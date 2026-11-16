export const STOCK_ITEM_TYPES = ['piece', 'counter', 'slab'] as const;
export type StockItemType = (typeof STOCK_ITEM_TYPES)[number];

export const STOCK_FINISHES = ['polished', 'unpolished'] as const;
export type StockFinish = (typeof STOCK_FINISHES)[number];

// Item key = type | material | factory | soot | size | width | finish (rules §2.2).
//   piece:   soot type + soot size + finish
//   counter: width + finish (tracked in pieces AND total inches)
//   slab:    material + factory only
export type StockItemKey = {
  factoryId: string;
  itemType: StockItemType;
  materialId: string;
  sootTypeId?: string | null;
  sootSizeId?: string | null;
  counterWidthId?: string | null;
  finish?: StockFinish | null;
};

// A key that passed validation: parts that do not apply to the type are null.
export type NormalizedItemKey = {
  factoryId: string;
  itemType: StockItemType;
  materialId: string;
  sootTypeId: string | null;
  sootSizeId: string | null;
  counterWidthId: string | null;
  finish: StockFinish | null;
};

export type PostStockInput = {
  companyId: string;
  date: string;
  key: StockItemKey;
  /** Signed: pieces, counter pieces or slabs. Never 0. */
  qty: number;
  /** Signed total inches, counters only (same sign as qty). */
  inches?: number | null;
  sourceType: string;
  sourceId?: string | null;
  note?: string | null;
  createdByMemberId: string;
};

export type StockMovementRow = {
  id: string;
  companyId: string;
  date: string;
  key: NormalizedItemKey;
  qty: number;
  inches: number | null;
  sourceType: string;
  sourceId: string | null;
  note: string | null;
  createdByMemberId: string;
  createdAt: Date;
};

export type OnHand = {
  qty: number;
  /** Total inches of length: counters only, 0 for pieces and slabs. */
  inches: number;
};

export type StockFilters = {
  factoryId?: string;
  itemType?: StockItemType;
  materialId?: string;
  sootTypeId?: string;
  sootSizeId?: string;
  counterWidthId?: string;
  finish?: StockFinish;
};

export type StockListInput = {
  companyId: string;
  filters?: StockFilters;
  /** Also return items whose stock is exactly 0. Default false. */
  includeZero?: boolean;
  page?: number;
  limit?: number;
};

export type StockListRow = NormalizedItemKey & OnHand;

export type StockHistoryInput = {
  companyId: string;
  key: StockItemKey;
  order?: 'asc' | 'desc';
  page?: number;
  limit?: number;
};

export type StockHistoryRow = StockMovementRow & {
  /** Stock on hand right after this movement. */
  runningQty: number;
  runningInches: number;
};
