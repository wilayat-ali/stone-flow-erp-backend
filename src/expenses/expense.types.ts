// How an expense is paid. Paid now: money leaves an account the day it is
// posted. Unpaid: a bill with a due date, paid later from an account. Shop
// credit: the shop gave it on credit, so it goes on the shop's khata.
export const PAY_MODES = ['paid', 'unpaid', 'shop_credit'] as const;
export type PayMode = (typeof PAY_MODES)[number];

// A munshi's expense waits as 'pending' while approval is on, and has no
// effect until approved. Cancelling is a reversal of what was posted.
export const EXPENSE_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'cancelled',
] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

// The permission that approves an expense: anyone holding it is approved at
// once, everyone else waits while the company's approval switch is on.
export const EXPENSE_APPROVER = 'expenses.manage';
export const EXPENSE_ENTITY = 'expense';

// Ledger and khata rows an expense leaves are tied back to it by this source.
export const EXPENSE_SOURCE = 'expense';
export const MUNSHI_GIVE_SOURCE = 'transfer';

// The munshi's petty cash: a cash account of its own, created on first use.
export const MUNSHI_ACCOUNT_NAME = 'Munshi cash';

export const expenseNo = (seq: number) => `EX-${String(seq).padStart(4, '0')}`;

export type ExpenseView = {
  id: string;
  expNo: string;
  date: string;
  categoryId: string;
  categoryName: string;
  description: string;
  amount: number;
  factoryId: string;
  factoryName: string;
  payMode: PayMode;
  accountId: string | null;
  accountName: string;
  dueDate: string | null;
  paidOn: string | null;
  shopId: string | null;
  shopName: string;
  photoName: string | null;
  status: ExpenseStatus;
  reason: string | null;
  createdBy: string;
  approvedBy: string | null;
};

export type MunshiGiveView = {
  id: string;
  date: string;
  fromAccountId: string;
  fromAccountName: string;
  amount: number;
  note: string;
  by: string;
};

export type MunshiSummaryView = {
  accountId: string;
  /** What the munshi holds (negative: he spent his own money). */
  balance: number;
  /** What the owner owes the munshi when his cash has gone negative. */
  ownerOwes: number;
  recent: MunshiGiveView[];
};
