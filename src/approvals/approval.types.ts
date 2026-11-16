import type { EntityManager } from 'typeorm';
import type { CompanyRoleKey } from '../tenancy/tenancy.constants';

export const APPROVAL_STATUS = {
  pending: 'pending',
  approved: 'approved',
  rejected: 'rejected',
} as const;
export type ApprovalStatus =
  (typeof APPROVAL_STATUS)[keyof typeof APPROVAL_STATUS];

// Who may approve or reject (rules §1): Owner, Partner and Manager. Never the
// person who made the entry, whatever their role.
export const APPROVER_ROLES: readonly CompanyRoleKey[] = [
  'owner',
  'partner',
  'manager',
];

export type ApprovalView = {
  id: string;
  companyId: string;
  /** What is being approved, e.g. 'other_payment', 'purchase', 'stock_entry'. */
  entityType: string;
  /** The record being approved, once it exists. */
  entityId: string | null;
  status: ApprovalStatus;
  requestedByMemberId: string;
  /** Empty while pending, and for entries that were approved automatically. */
  decidedByMemberId: string | null;
  decidedAt: Date | null;
  /** Why it was rejected. Always set when rejected, readable by the requester. */
  reason: string | null;
  /** The request as made. A pending entry lives only here until approved. */
  payload: Record<string, unknown> | null;
  createdAt: Date;
};

export type RequestApprovalInput = {
  companyId: string;
  entityType: string;
  entityId?: string | null;
  requestedByMemberId: string;
  /**
   * The permission that lets someone approve this kind of entry, for modules
   * that follow company roles (e.g. 'purchasing.approve'): whoever holds it is
   * approved at once, everyone else waits. Omit it for the fixed rule: only a
   * Munshi waits, and only Owner, Partner and Manager approve.
   */
  approverPermission?: string;
  payload?: Record<string, unknown> | null;
};

export type RequestApprovalResult = {
  approval: ApprovalView;
  /** False: the entry is already approved and the caller posts it right away. */
  needsApproval: boolean;
};

export type DecideInput = {
  companyId: string;
  approvalId: string;
  decidedByMemberId: string;
  /** Same permission the request used; see RequestApprovalInput. */
  approverPermission?: string;
};

export type RejectInput = DecideInput & { reason: string };

// Runs inside the same transaction as the approval, right after it is marked
// approved. Post the real ledger rows / stock movements here: if that fails
// (for example the stock is no longer there) the approval stays pending.
export type ApplyApproval = (
  approval: ApprovalView,
  manager: EntityManager,
) => Promise<void>;

export type ListApprovalsInput = {
  companyId: string;
  status?: ApprovalStatus;
  entityType?: string;
  /** Any of these entity types (a module that owns several). */
  entityTypes?: readonly string[];
  requestedByMemberId?: string;
  page?: number;
  limit?: number;
};
