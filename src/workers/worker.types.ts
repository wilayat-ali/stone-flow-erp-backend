// Per ton (thekadar), per sq.ft, per day (attendance) or per month (salary).
export const PAY_TYPES = ['ton', 'sqft', 'day', 'month'] as const;
export type PayType = (typeof PAY_TYPES)[number];

// Every worker keeps their khata under this party type.
export const WORKER_PARTY = 'worker' as const;

// What a work entry is for: a truck cut by a thekadar, a production step paid
// per sq.ft, a day in the work register, or a day a daily worker was present.
export const WORK_SOURCES = [
  'truck_cut',
  'production',
  'register',
  'attendance',
] as const;
export type WorkSource = (typeof WORK_SOURCES)[number];

// The party ledger rows a work entry leaves are tied back to it by this source
// type, and carry the work entry's id.
export const WORK_ENTRY_LEDGER_SOURCE = 'work_entry';

// Paid per ton at this rate when a thekadar is seen for the first time.
export const DEFAULT_TON_RATE = 1100;

export type WorkerView = {
  id: string;
  name: string;
  phone: string;
  jobTitle: string;
  factoryId: string;
  payType: PayType;
  rate: number;
  defaultJob: string;
  openingBalance: number;
  joinedOn: string;
  isActive: boolean;
};

// The khata figures are worked out from the party ledger, never stored.
export type WorkerSummary = WorkerView & {
  earned: number;
  paid: number;
  monthEarned: number;
  monthPaid: number;
  /** Positive: we owe them. Negative: they owe us (an advance). */
  balance: number;
};

export type WorkerKhataRow = {
  id: string;
  date: string;
  type:
    | 'opening'
    | 'work'
    | 'attendance'
    | 'payment'
    | 'salary'
    | 'instalment'
    | 'loan';
  kind: 'charge' | 'credit';
  amount: number;
  balance: number;
  job?: string;
  unit?: 'ton' | 'sqft' | 'day';
  qty?: number;
  rate?: number;
  auto?: boolean;
  note?: string;
  /** Salary rows: absent days and the cut. */
  absentDays?: number;
  cut?: number;
  /** A loan given: shown for information, it does not change what is owed. */
  memo?: boolean;
};
