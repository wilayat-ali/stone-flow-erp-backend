export const SUPPLIER_TYPES = [
  'mine_owner',
  'cutting_factory',
  'shop',
] as const;
export type SupplierType = (typeof SUPPLIER_TYPES)[number];

// Every supplier, shops included, keeps its khata under this party type.
export const SUPPLIER_PARTY = 'supplier' as const;

export type SupplierView = {
  id: string;
  name: string;
  type: SupplierType;
  business: string;
  phone: string;
  city: string;
  cuttingRatePerTon: number | null;
  openingBalance: number;
  openingDate: string;
  isActive: boolean;
};

// A supplier with its figures, calculated from the opening balance and the
// party ledger on every read.
export type SupplierSummary = SupplierView & {
  charged: number;
  paid: number;
  /** Positive: we owe them. Negative: we paid more than we owed (an advance). */
  balance: number;
  /** Cheques given but not cleared. Filled in once cheques exist (payments). */
  unclearedCheques: number;
};

export type KhataRow = {
  id: string;
  date: string;
  /** 'opening' for the opening row, else the note the posting module wrote. */
  detail: string;
  kind: 'charge' | 'credit';
  amount: number;
  /** Running balance after this row. */
  balance: number;
  unclearedCheque: boolean;
};
