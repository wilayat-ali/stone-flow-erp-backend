import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { inTransaction, pageBounds, query, toNumber } from '../engines/db';
import { conflict, forbidden, invalid, notFound } from '../engines/errors';
import { assertSourceType, assertUuid } from '../engines/guards';
import {
  APPROVAL_STATUS,
  APPROVER_ROLES,
  ApplyApproval,
  ApprovalStatus,
  ApprovalView,
  DecideInput,
  ListApprovalsInput,
  RejectInput,
  RequestApprovalInput,
  RequestApprovalResult,
} from './approval.types';

const COLS = `id, "companyId", "entityType", "entityId", status, "requestedByMemberId",
  "decidedByMemberId", "decidedAt", reason, payload, "createdAt"`;

type Actor = {
  id: string;
  roleKey: string;
  permissions: string[] | null;
  approvalRequired: boolean;
};

// The Owner always holds every permission.
const holds = (
  actor: { roleKey: string; permissions: string[] | null },
  permission: string,
) =>
  actor.roleKey === 'owner' ||
  (Array.isArray(actor.permissions) && actor.permissions.includes(permission));

// The shared approval pattern (rules §1). When the company's approvalRequired
// is on, a munshi's entry waits as pending until an Owner, Partner or Manager
// approves it; everyone else's entries are approved at once. Nobody approves
// or rejects their own entry, and a rejection always keeps a reason.
//
// This service only records the decision. The owning module (cash & bank,
// purchasing, stock entries) keeps the request in `payload` and posts the real
// ledger rows / stock movements in the `apply` callback of approve(), inside
// the same transaction. A pending entry therefore never touches a balance.
@Injectable()
export class ApprovalService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async request(
    input: RequestApprovalInput,
    manager?: EntityManager,
  ): Promise<RequestApprovalResult> {
    assertSourceType(input.entityType);
    assertUuid('requestedByMemberId', input.requestedByMemberId);

    if (input.entityId) {
      assertUuid('entityId', input.entityId);
    }

    return inTransaction(this.dataSource, manager, async (em) => {
      const [actor] = await query<Actor>(
        em,
        `SELECT m.id, r.key AS "roleKey", r.permissions, c."approvalRequired"
         FROM company_member m
         JOIN company_role r ON r.id = m."roleId"
         JOIN company c ON c.id = m."companyId"
         WHERE m.id = $1 AND m."companyId" = $2 AND m.status = 'active'`,
        [input.requestedByMemberId, input.companyId],
      );

      if (!actor) {
        throw notFound('requestedByMemberId');
      }

      const needsApproval =
        actor.approvalRequired &&
        (input.approverPermission
          ? !holds(actor, input.approverPermission)
          : actor.roleKey === 'munshi');

      const [row] = await query<ApprovalView>(
        em,
        `INSERT INTO approval
           ("companyId", "entityType", "entityId", status, "requestedByMemberId", "decidedAt", payload)
         VALUES ($1, $2, $3, $4, $5, CASE WHEN $6::boolean THEN NULL ELSE now() END, $7::jsonb)
         RETURNING ${COLS}`,
        [
          input.companyId,
          input.entityType,
          input.entityId ?? null,
          needsApproval ? APPROVAL_STATUS.pending : APPROVAL_STATUS.approved,
          input.requestedByMemberId,
          needsApproval,
          input.payload ? JSON.stringify(input.payload) : null,
        ],
      );

      return { approval: row, needsApproval };
    });
  }

  async approve(
    input: DecideInput,
    apply?: ApplyApproval,
    manager?: EntityManager,
  ): Promise<ApprovalView> {
    return this.decide(input, APPROVAL_STATUS.approved, null, apply, manager);
  }

  async reject(
    input: RejectInput,
    manager?: EntityManager,
  ): Promise<ApprovalView> {
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';

    if (!reason) {
      throw invalid({ reason: 'required' });
    }

    return this.decide(
      input,
      APPROVAL_STATUS.rejected,
      reason.slice(0, 500),
      undefined,
      manager,
    );
  }

  async find(
    companyId: string,
    approvalId: string,
    manager?: EntityManager,
  ): Promise<ApprovalView> {
    assertUuid('approvalId', approvalId);

    const [row] = await query<ApprovalView>(
      manager ?? this.dataSource.manager,
      `SELECT ${COLS} FROM approval WHERE id = $1 AND "companyId" = $2`,
      [approvalId, companyId],
    );

    if (!row) {
      throw notFound('approvalId');
    }

    return row;
  }

  // Newest first. A munshi's screen passes requestedByMemberId = their own id
  // so they see their entries and the rejection reasons, nobody else's.
  async list(
    input: ListApprovalsInput,
    manager?: EntityManager,
  ): Promise<{ total: number; rows: ApprovalView[] }> {
    const where = [`"companyId" = $1`];
    const params: unknown[] = [input.companyId];

    if (input.status !== undefined) {
      if (!Object.values(APPROVAL_STATUS).includes(input.status)) {
        throw invalid({ status: 'invalid' });
      }
      params.push(input.status);
      where.push(`status = $${params.length}`);
    }
    if (input.entityType !== undefined) {
      assertSourceType(input.entityType);
      params.push(input.entityType);
      where.push(`"entityType" = $${params.length}`);
    }
    if (input.entityTypes !== undefined) {
      input.entityTypes.forEach((type) => assertSourceType(type));
      params.push([...input.entityTypes]);
      where.push(`"entityType" = ANY($${params.length}::text[])`);
    }
    if (input.requestedByMemberId !== undefined) {
      assertUuid('requestedByMemberId', input.requestedByMemberId);
      params.push(input.requestedByMemberId);
      where.push(`"requestedByMemberId" = $${params.length}`);
    }

    const { limit, offset } = pageBounds(input);
    const filterParams = [...params];
    params.push(limit, offset);
    const em = manager ?? this.dataSource.manager;

    const rows = await query<ApprovalView>(
      em,
      `SELECT ${COLS} FROM approval WHERE ${where.join(' AND ')}
       ORDER BY "createdAt" DESC, id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const [count] = await query<{ total: string }>(
      em,
      `SELECT COUNT(*) AS total FROM approval WHERE ${where.join(' AND ')}`,
      filterParams,
    );

    return { total: toNumber(count.total), rows };
  }

  // ---- internals ----------------------------------------------------------

  private async decide(
    input: DecideInput,
    outcome: ApprovalStatus,
    reason: string | null,
    apply: ApplyApproval | undefined,
    manager: EntityManager | undefined,
  ): Promise<ApprovalView> {
    assertUuid('approvalId', input.approvalId);
    assertUuid('decidedByMemberId', input.decidedByMemberId);

    return inTransaction(this.dataSource, manager, async (em) => {
      // Locked so two approvers cannot decide the same entry at once.
      const [current] = await query<ApprovalView>(
        em,
        `SELECT ${COLS} FROM approval WHERE id = $1 AND "companyId" = $2 FOR UPDATE`,
        [input.approvalId, input.companyId],
      );

      if (!current) {
        throw notFound('approvalId');
      }
      if (current.status !== APPROVAL_STATUS.pending) {
        throw conflict('APPROVAL_ALREADY_DECIDED', { status: current.status });
      }

      const [decider] = await query<{
        roleKey: string;
        permissions: string[] | null;
      }>(
        em,
        `SELECT r.key AS "roleKey", r.permissions
         FROM company_member m JOIN company_role r ON r.id = m."roleId"
         WHERE m.id = $1 AND m."companyId" = $2 AND m.status = 'active'`,
        [input.decidedByMemberId, input.companyId],
      );

      if (
        !decider ||
        !(input.approverPermission
          ? holds(decider, input.approverPermission)
          : (APPROVER_ROLES as readonly string[]).includes(decider.roleKey))
      ) {
        throw forbidden('NOT_AN_APPROVER');
      }
      if (input.decidedByMemberId === current.requestedByMemberId) {
        throw forbidden('CANNOT_DECIDE_OWN_ENTRY');
      }

      await em.query(
        `UPDATE approval
         SET status = $1, "decidedByMemberId" = $2, "decidedAt" = now(), reason = $3
         WHERE id = $4 AND "companyId" = $5`,
        [
          outcome,
          input.decidedByMemberId,
          reason,
          input.approvalId,
          input.companyId,
        ],
      );

      const decided = await this.find(input.companyId, input.approvalId, em);

      if (outcome === APPROVAL_STATUS.approved && apply) {
        await apply(decided, em);
      }

      return decided;
    });
  }
}
