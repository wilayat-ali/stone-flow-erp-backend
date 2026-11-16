export const LEDGER_DIRECTIONS = ['in', 'out'] as const;
export type LedgerDirection = (typeof LEDGER_DIRECTIONS)[number];

// Parties that have a khata (rules §2.1). 'none' is only for ledger rows that
// belong to no party (a plain Other Payment).
export const PARTY_TYPES = ['supplier', 'customer', 'worker', 'shop'] as const;
export type PartyType = (typeof PARTY_TYPES)[number];
export type LedgerPartyType = PartyType | 'none';

// sourceType values the engine itself relies on. Other modules add their own
// (purchase_payment, expense, ...): any lower_snake_case word is accepted.
export const LEDGER_SOURCE = {
  opening: 'opening',
  transfer: 'transfer',
  deposit: 'deposit',
  otherPayment: 'other_payment',
  otherReceipt: 'other_receipt',
  cashAdjustment: 'cash_adjustment',
  reversal: 'reversal',
} as const;

// A transfer or deposit is two rows that share a sourceId. They are always
// reversed together.
export const PAIRED_SOURCES: readonly string[] = [
  LEDGER_SOURCE.transfer,
  LEDGER_SOURCE.deposit,
];

export type LedgerRow = {
  id: string;
  companyId: string;
  accountId: string;
  createdByMemberId: string;
  /** Calendar day, YYYY-MM-DD. */
  date: string;
  direction: LedgerDirection;
  /** Whole PKR, always positive. */
  amount: number;
  partyType: LedgerPartyType | null;
  partyId: string | null;
  sourceType: string;
  sourceId: string | null;
  note: string | null;
  /** Set once a reversal row has cancelled this row. */
  reversedById: string | null;
  createdAt: Date;
};

export type PostLedgerInput = {
  companyId: string;
  accountId: string;
  date: string;
  direction: LedgerDirection;
  amount: number;
  sourceType: string;
  sourceId?: string | null;
  partyType?: LedgerPartyType | null;
  partyId?: string | null;
  note?: string | null;
  createdByMemberId: string;
};

export type PostTransferInput = {
  companyId: string;
  fromAccountId: string;
  toAccountId: string;
  date: string;
  amount: number;
  /** 'transfer' between any two accounts, 'deposit' for cash to bank. */
  sourceType: typeof LEDGER_SOURCE.transfer | typeof LEDGER_SOURCE.deposit;
  note?: string | null;
  createdByMemberId: string;
};

export type ReverseInput = {
  companyId: string;
  entryId: string;
  /** Day the correction is posted (the caller's "today"). */
  date: string;
  reason?: string | null;
  createdByMemberId: string;
};

export type StatementInput = {
  companyId: string;
  accountId: string;
  /** Inclusive. Omit for "from the beginning". */
  from?: string;
  /** Inclusive. Omit for "up to now". */
  to?: string;
  order?: 'asc' | 'desc';
  /** Only rows of this kind (e.g. 'other_payment'); `total` counts just these. */
  sourceType?: string;
  /** Only money in or only money out; `total` counts just these. */
  direction?: LedgerDirection;
  page?: number;
  limit?: number;
};

export type StatementRow = LedgerRow & {
  /** Account balance right after this row, in the engine's fixed row order. */
  runningBalance: number;
};

export type Statement = {
  accountId: string;
  from: string | null;
  to: string | null;
  /** Balance at the end of the day before `from`. */
  openingBalance: number;
  totalIn: number;
  totalOut: number;
  closingBalance: number;
  /** Rows in the date range (not just this page). */
  total: number;
  rows: StatementRow[];
};

export type PostPartyEntryInput = {
  companyId: string;
  date: string;
  partyType: PartyType;
  partyId: string;
  /** charge: they owe / we owe more. credit: a payment reduces it. */
  side: 'charge' | 'credit';
  amount: number;
  sourceType: string;
  sourceId?: string | null;
  note?: string | null;
};

// One row of a party's khata, as stored (append-only).
export type PartyRow = {
  id: string;
  /** Calendar day, YYYY-MM-DD. */
  date: string;
  charge: number | null;
  credit: number | null;
  sourceType: string;
  sourceId: string | null;
  note: string | null;
  createdAt: Date;
};

export type PartyBalance = {
  charged: number;
  credited: number;
  /** charged - credited. Negative means an advance. */
  balance: number;
};
