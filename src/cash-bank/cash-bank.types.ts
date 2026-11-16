import { LedgerRow, StatementRow } from '../ledger-entries/ledger.types';
import { ApprovalView } from '../approvals/approval.types';
import { CashBankEntityType } from './cash-bank.policy';

export type AccountKind = 'cash' | 'bank';

export type AccountView = {
  id: string;
  kind: AccountKind;
  name: string;
  /** Last 4 digits of the bank account number; null for cash. */
  last4: string | null;
  /** Hidden (null) from a munshi for bank accounts. */
  openingBalance: number | null;
  /** YYYY-MM-DD */
  openingDate: string;
  isActive: boolean;
  /** Calculated from the ledger. Null when the caller may not see it. */
  balance: number | null;
};

// An entry either landed in the ledger, or waits for approval and has not
// moved any money yet.
export type EntryResult =
  | { status: 'posted'; entries: LedgerRow[] }
  | { status: 'pending'; approvalId: string };

// What a pending entry is remembered as until someone approves it.
export type PendingPayload = {
  kind: CashBankEntityType;
  /** The account paid from / received into; for a deposit, the bank. */
  accountId: string;
  /** A deposit only: the cash account it leaves. Null means the default one. */
  fromAccountId?: string | null;
  amount: number;
  date: string;
  reason: string | null;
  note: string | null;
};

export type CashCountResult = {
  /** What the books say should be in the drawer on that date. */
  expected: number;
  counted: number;
  /** counted - expected. 0 means nothing was posted. */
  difference: number;
  entry: LedgerRow | null;
};

export type StatementEntry = StatementRow & {
  /** True when this caller may reverse it from here. */
  reversible: boolean;
};

export type ApprovalListItem = ApprovalView & {
  requestedBy: { memberId: string; name: string };
};
