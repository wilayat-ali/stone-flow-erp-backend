import { CompanyRoleKey } from '../tenancy/tenancy.constants';

// Who may do what in Cash & Bank (rules §1 roles, §2.1, §3). The controller
// uses the same lists for its @CompanyRoles() so there is one source of truth.
export const CASH_BANK_ROLES = {
  /** Open account setup, edit and deactivate. */
  manageAccounts: ['owner', 'partner'],
  /** Count the cash in hand and post the difference. */
  countCash: ['owner', 'partner'],
  /** Cancel a posted entry with a reversal. */
  reverse: ['owner', 'partner'],
  /** Move money between any two accounts. */
  transfer: ['owner', 'partner', 'manager'],
  /** Other payment, other receipt, deposit. Munshi's go through approval. */
  postEntries: ['owner', 'partner', 'manager', 'munshi'],
  /** Approve or reject pending entries. */
  decide: ['owner', 'partner', 'manager'],
} as const satisfies Record<string, readonly CompanyRoleKey[]>;

// Munshi works with the cash in hand only: no bank balances, statements or
// bank payments (rules §1 roles). Everyone else sees all accounts.
export function canSeeBankBalances(role: CompanyRoleKey): boolean {
  return role !== 'munshi';
}

export function canUseAccount(
  role: CompanyRoleKey,
  accountKind: 'cash' | 'bank',
): boolean {
  return accountKind === 'cash' || canSeeBankBalances(role);
}

// Only entries this module created can be reversed here; a purchase payment
// or an expense belongs to its own module, which keeps its records in step.
export const REVERSIBLE_SOURCES = [
  'transfer',
  'deposit',
  'other_payment',
  'other_receipt',
  'cash_adjustment',
] as const;

export const CASH_BANK_ENTITY_TYPES = [
  'other_payment',
  'other_receipt',
  'deposit',
] as const;
export type CashBankEntityType = (typeof CASH_BANK_ENTITY_TYPES)[number];
