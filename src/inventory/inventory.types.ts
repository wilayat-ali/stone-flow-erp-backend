import type { StockItemKey } from '../stock-movements/stock.types';

export const ITEM_TYPES = ['piece', 'counter', 'slab'] as const;
export const FINISHES = ['polished', 'unpolished'] as const;
export type Finish = (typeof FINISHES)[number];

export const ENTRY_TYPES = ['opening', 'adjustment', 'transfer'] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

export const ADJUSTMENT_REASONS = ['broken', 'mismatch', 'other'] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export type EntryStatus = 'pending' | 'approved' | 'rejected';

export const ENTRY_SOURCE = 'stock_entry';
export const ENTRY_ENTITY = 'stock_entry';

// The permission that approves a Munshi's stock entry. Anyone holding it is
// approved at once; everyone else waits while the company's approval is on.
export const ENTRY_APPROVER = 'purchasing.approve';

// One kind of stock by name, as the screens show it: a piece has soot, size and
// finish; a counter has a width in inches and a finish; a slab only material
// and factory.
export type StockItemView =
  | {
      itemType: 'piece';
      material: string;
      factoryId: string;
      soot: string;
      size: string;
      finish: Finish;
    }
  | {
      itemType: 'counter';
      material: string;
      factoryId: string;
      width: number;
      finish: Finish;
    }
  | { itemType: 'slab'; material: string; factoryId: string };

export type ItemNames = {
  materialName: string;
  factoryName: string;
  sootTypeName: string | null;
  sootSizeName: string | null;
  counterWidthName: string | null;
  /** Piece width, or a counter's width, in inches. */
  widthInches: number | null;
  /** Piece length in inches. */
  lengthInches: number | null;
};

export type StockRowView = StockItemKey &
  ItemNames & {
    qty: number;
    inches: number;
    /** The item as the screens name it. */
    item: StockItemView;
    minQty: number | null;
    low: boolean;
  };

export type StockHistoryRowView = {
  id: string;
  date: string;
  qty: number;
  inches: number;
  sourceType: string;
  sourceId: string | null;
  note: string | null;
  balanceQty: number;
  balanceInches: number;
};

export type StockEntryView = {
  id: string;
  entryNo: string;
  type: EntryType;
  date: string;
  direction: 1 | -1;
  reason: AdjustmentReason | null;
  note: string;
  item: StockItemView;
  qty: number;
  inches: number;
  factoryName: string;
  toFactoryId: string | null;
  toFactoryName: string | null;
  status: EntryStatus;
  rejectReason: string | null;
  createdBy: string;
  approvedBy: string | null;
};

export const entryNo = (seq: number) => `SE-${String(seq).padStart(3, '0')}`;

// One text value for an item, so an alert can find it whatever parts it has.
export const alertKeyOf = (key: StockItemKey): string =>
  [
    key.itemType,
    key.factoryId,
    key.materialId,
    key.sootTypeId ?? '',
    key.sootSizeId ?? '',
    key.counterWidthId ?? '',
    key.finish ?? '',
  ].join('|');
