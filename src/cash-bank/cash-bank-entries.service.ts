import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { ApprovalService } from '../approvals/approval.service';
import { ApprovalView } from '../approvals/approval.types';
import { query } from '../engines/db';
import { conflict, forbidden, invalid, notFound } from '../engines/errors';
import { assertDate, assertUuid, cleanNote } from '../engines/guards';
import { LedgerService } from '../ledger-entries/ledger.service';
import { LEDGER_SOURCE, LedgerRow } from '../ledger-entries/ledger.types';
import { TenantContext } from '../tenancy/tenant-context';
import { CashBankAccountsService } from './cash-bank-accounts.service';
import {
  CASH_BANK_ENTITY_TYPES,
  CASH_BANK_ROLES,
  CashBankEntityType,
  REVERSIBLE_SOURCES,
  canUseAccount,
} from './cash-bank.policy';
import {
  AccountKind,
  ApprovalListItem,
  CashCountResult,
  EntryResult,
  PendingPayload,
  StatementEntry,
} from './cash-bank.types';
import {
  CashCountDto,
  DepositDto,
  ListApprovalsQueryDto,
  MoneyEntryDto,
  ReverseEntryDto,
  StatementQueryDto,
  TransferDto,
} from './dto/cash-bank.dto';

const has = (roles: readonly string[], role: string) => roles.includes(role);

// "Electricity bill — paid in cash": the ledger has one note column, so the
// reason and the optional extra note share it.
const composeNote = (reason: string | null, note: string | null) =>
  [reason, note].filter(Boolean).join(' — ') || null;

function isPendingPayload(value: unknown): value is PendingPayload {
  const p = value as Partial<PendingPayload> | null;

  return (
    !!p &&
    typeof p === 'object' &&
    (CASH_BANK_ENTITY_TYPES as readonly string[]).includes(p.kind as string) &&
    typeof p.accountId === 'string' &&
    (p.fromAccountId === undefined ||
      p.fromAccountId === null ||
      typeof p.fromAccountId === 'string') &&
    Number.isSafeInteger(p.amount) &&
    typeof p.date === 'string' &&
    (p.reason === null || typeof p.reason === 'string') &&
    (p.note === null || typeof p.note === 'string')
  );
}

// Cash & Bank entries (rules §2.1, §3). Core module, always on. This layer
// holds the rules that are specific to cash and bank (who may touch which
// account, the approval flow, the cash count); the money itself is only ever
// posted through LedgerService.
@Injectable()
export class CashBankEntriesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
    private readonly approvals: ApprovalService,
    private readonly accounts: CashBankAccountsService,
  ) {}

  // ---- statement ----------------------------------------------------------

  async statement(
    tenant: TenantContext,
    accountId: string,
    filters: StatementQueryDto,
  ) {
    const meta = await this.accountMeta(
      this.dataSource.manager,
      tenant.companyId,
      accountId,
    );

    // A munshi may not see bank balances, and a statement shows them.
    if (!canUseAccount(tenant.roleKey, meta.kind)) {
      throw forbidden('BANK_BALANCES_HIDDEN');
    }

    const statement = await this.ledger.accountStatement({
      companyId: tenant.companyId,
      accountId,
      ...filters,
    });
    const mayReverse = has(CASH_BANK_ROLES.reverse, tenant.roleKey);

    return {
      ...statement,
      rows: statement.rows.map(
        (row): StatementEntry => ({
          ...row,
          reversible:
            mayReverse &&
            !row.reversedById &&
            (REVERSIBLE_SOURCES as readonly string[]).includes(row.sourceType),
        }),
      ),
    };
  }

  // ---- entries ------------------------------------------------------------

  // Between any two accounts. Owner, Partner and Manager only, so there is
  // nothing to approve.
  async transfer(
    tenant: TenantContext,
    dto: TransferDto,
  ): Promise<EntryResult> {
    const posted = await this.dataSource.transaction(async (em) => {
      await this.accountMeta(em, tenant.companyId, dto.fromAccountId);
      await this.accountMeta(em, tenant.companyId, dto.toAccountId);

      return this.ledger.postTransfer(
        {
          companyId: tenant.companyId,
          fromAccountId: dto.fromAccountId,
          toAccountId: dto.toAccountId,
          date: dto.date,
          amount: dto.amount,
          sourceType: LEDGER_SOURCE.transfer,
          note: dto.note,
          createdByMemberId: tenant.memberId,
        },
        em,
      );
    });

    return { status: 'posted', entries: [posted.out, posted.in] };
  }

  // Cash to a bank. A munshi's deposit waits for approval.
  async deposit(tenant: TenantContext, dto: DepositDto): Promise<EntryResult> {
    return this.submit(tenant, {
      kind: 'deposit',
      accountId: dto.toAccountId,
      fromAccountId: dto.fromAccountId ?? null,
      amount: dto.amount,
      date: dto.date,
      reason: null,
      note: cleanNote(dto.note),
    });
  }

  async moneyEntry(
    tenant: TenantContext,
    direction: 'in' | 'out',
    dto: MoneyEntryDto,
  ): Promise<EntryResult> {
    return this.submit(tenant, {
      kind: direction === 'out' ? 'other_payment' : 'other_receipt',
      accountId: dto.accountId,
      amount: dto.amount,
      date: dto.date,
      reason: cleanNote(dto.reason),
      note: cleanNote(dto.note),
    });
  }

  // Owner counts the real cash; the difference from the books is posted as a
  // cash_adjustment with the reason (rules §2.1). No difference, no row.
  async cashCount(
    tenant: TenantContext,
    dto: CashCountDto,
  ): Promise<CashCountResult> {
    assertDate('date', dto.date);

    return this.dataSource.transaction(async (em) => {
      let cash: { id: string } | null;

      if (dto.accountId) {
        cash = await this.accounts.findCashById(
          tenant.companyId,
          dto.accountId,
          em,
        );
        if (!cash) {
          // Another company's account, a bank, or a missing id.
          throw notFound('accountId');
        }
      } else {
        cash = await this.accounts.findDefaultCash(tenant.companyId, em);
        if (!cash) {
          throw conflict('CASH_ACCOUNT_MISSING');
        }
      }

      const expected = await this.ledger.accountBalance(
        tenant.companyId,
        cash.id,
        dto.date,
        em,
      );
      const difference = dto.countedAmount - expected;

      if (difference === 0) {
        return {
          expected,
          counted: dto.countedAmount,
          difference,
          entry: null,
        };
      }

      const reason = cleanNote(dto.reason);

      if (!reason) {
        throw invalid({ reason: 'required' });
      }

      const entry = await this.ledger.post(
        {
          companyId: tenant.companyId,
          accountId: cash.id,
          date: dto.date,
          direction: difference > 0 ? 'in' : 'out',
          amount: Math.abs(difference),
          sourceType: LEDGER_SOURCE.cashAdjustment,
          note: reason,
          createdByMemberId: tenant.memberId,
        },
        em,
      );

      return { expected, counted: dto.countedAmount, difference, entry };
    });
  }

  // Cancels an entry made here by posting its opposite. Entries that belong to
  // another module (a purchase payment, an expense) are reversed there.
  async reverse(tenant: TenantContext, entryId: string, dto: ReverseEntryDto) {
    assertUuid('entryId', entryId);

    const [entry] = await query<{ sourceType: string }>(
      this.dataSource.manager,
      `SELECT "sourceType" FROM ledger_entry WHERE id = $1 AND "companyId" = $2`,
      [entryId, tenant.companyId],
    );

    if (!entry) {
      throw notFound('entryId');
    }
    // A reversal row is refused by the ledger itself with a clearer code.
    if (
      entry.sourceType !== LEDGER_SOURCE.reversal &&
      !(REVERSIBLE_SOURCES as readonly string[]).includes(entry.sourceType)
    ) {
      throw conflict('ENTRY_NOT_REVERSIBLE_HERE', {
        sourceType: entry.sourceType,
      });
    }

    return this.ledger.reverse({
      companyId: tenant.companyId,
      entryId,
      date: dto.date,
      reason: dto.reason,
      createdByMemberId: tenant.memberId,
    });
  }

  // ---- approvals ----------------------------------------------------------

  // Owner, Partner and Manager see every request; a munshi sees only their
  // own (with the reasons for any rejection) and nobody else's.
  async listApprovals(
    tenant: TenantContext,
    filters: ListApprovalsQueryDto,
  ): Promise<{ total: number; rows: ApprovalListItem[] }> {
    const mayDecide = has(CASH_BANK_ROLES.decide, tenant.roleKey);

    const result = await this.approvals.list({
      companyId: tenant.companyId,
      entityTypes: CASH_BANK_ENTITY_TYPES,
      status: filters.status,
      requestedByMemberId: mayDecide ? undefined : tenant.memberId,
      page: filters.page,
      limit: filters.limit,
    });

    const names = await this.memberNames(
      tenant.companyId,
      result.rows.map((row) => row.requestedByMemberId),
    );

    return {
      total: result.total,
      rows: result.rows.map((row) => ({
        ...row,
        requestedBy: {
          memberId: row.requestedByMemberId,
          name: names.get(row.requestedByMemberId) ?? '',
        },
      })),
    };
  }

  // Marks it approved and posts the real ledger rows in the same transaction.
  // If posting fails (the account was deactivated meanwhile) it stays pending.
  async approve(tenant: TenantContext, approvalId: string) {
    await this.assertCashBankApproval(tenant.companyId, approvalId);

    return this.approvals.approve(
      {
        companyId: tenant.companyId,
        approvalId,
        decidedByMemberId: tenant.memberId,
      },
      async (approval, em) => {
        if (!isPendingPayload(approval.payload)) {
          throw conflict('APPROVAL_PAYLOAD_INVALID');
        }

        await this.postPayload(
          tenant.companyId,
          approval,
          approval.payload,
          approval.requestedByMemberId,
          em,
        );
      },
    );
  }

  async reject(tenant: TenantContext, approvalId: string, reason: string) {
    await this.assertCashBankApproval(tenant.companyId, approvalId);

    return this.approvals.reject({
      companyId: tenant.companyId,
      approvalId,
      decidedByMemberId: tenant.memberId,
      reason,
    });
  }

  // ---- internals ----------------------------------------------------------

  // Every entry goes through the approval pattern: a munshi's waits (when the
  // company requires it) and nothing is posted; anyone else's is approved at
  // once and posted in the same transaction.
  private async submit(
    tenant: TenantContext,
    payload: PendingPayload,
  ): Promise<EntryResult> {
    assertDate('date', payload.date);

    return this.dataSource.transaction(async (em) => {
      const target = await this.accountMeta(
        em,
        tenant.companyId,
        payload.accountId,
      );

      if (payload.kind === 'deposit') {
        if (target.kind !== 'bank') {
          throw invalid({ toAccountId: 'mustBeBank' });
        }
        if (
          payload.fromAccountId &&
          !(await this.accounts.findCashById(
            tenant.companyId,
            payload.fromAccountId,
            em,
          ))
        ) {
          // Another company's account, a bank, or a missing id.
          throw invalid({ fromAccountId: 'mustBeCash' });
        }
      } else if (!canUseAccount(tenant.roleKey, target.kind)) {
        // A munshi pays from and receives into the cash in hand only.
        throw forbidden('BANK_ACCOUNT_NOT_ALLOWED');
      }

      const { approval, needsApproval } = await this.approvals.request(
        {
          companyId: tenant.companyId,
          entityType: payload.kind,
          requestedByMemberId: tenant.memberId,
          payload: { ...payload },
        },
        em,
      );

      if (needsApproval) {
        return { status: 'pending', approvalId: approval.id } as const;
      }

      const entries = await this.postPayload(
        tenant.companyId,
        approval,
        payload,
        tenant.memberId,
        em,
      );

      return { status: 'posted', entries } as const;
    });
  }

  // Turns an approved request into ledger rows (re-checked now, not when it
  // was asked) and points the approval at what it created.
  private async postPayload(
    companyId: string,
    approval: ApprovalView,
    payload: PendingPayload,
    memberId: string,
    em: EntityManager,
  ): Promise<LedgerRow[]> {
    let entries: LedgerRow[];
    let linkedId: string;

    if (payload.kind === 'deposit') {
      // The cash it leaves was chosen when asked, or is the default one now.
      const cash = payload.fromAccountId
        ? await this.accounts.findCashById(companyId, payload.fromAccountId, em)
        : await this.accounts.findDefaultCash(companyId, em);
      const target = await this.accountMeta(em, companyId, payload.accountId);

      if (!cash) {
        throw conflict('CASH_ACCOUNT_MISSING');
      }
      if (target.kind !== 'bank') {
        throw invalid({ toAccountId: 'mustBeBank' });
      }

      const posted = await this.ledger.postTransfer(
        {
          companyId,
          fromAccountId: cash.id,
          toAccountId: payload.accountId,
          date: payload.date,
          amount: payload.amount,
          sourceType: LEDGER_SOURCE.deposit,
          note: payload.note,
          createdByMemberId: memberId,
        },
        em,
      );
      entries = [posted.out, posted.in];
      linkedId = posted.transferId;
    } else {
      const entry = await this.ledger.post(
        {
          companyId,
          accountId: payload.accountId,
          date: payload.date,
          direction: payload.kind === 'other_payment' ? 'out' : 'in',
          amount: payload.amount,
          sourceType: payload.kind,
          sourceId: approval.id,
          note: composeNote(payload.reason, payload.note),
          createdByMemberId: memberId,
        },
        em,
      );
      entries = [entry];
      linkedId = entry.id;
    }

    await em.query(
      `UPDATE approval SET "entityId" = $1 WHERE id = $2 AND "companyId" = $3`,
      [linkedId, approval.id, companyId],
    );

    return entries;
  }

  // Cash & Bank only handles its own approvals. A purchase approval has the
  // same roles but belongs to Purchasing and looks missing here.
  private async assertCashBankApproval(companyId: string, approvalId: string) {
    const approval = await this.approvals.find(companyId, approvalId);

    if (
      !(CASH_BANK_ENTITY_TYPES as readonly string[]).includes(
        approval.entityType as CashBankEntityType,
      )
    ) {
      throw notFound('approvalId');
    }
  }

  private async accountMeta(
    em: EntityManager,
    companyId: string,
    accountId: string,
  ): Promise<{ id: string; kind: AccountKind; isActive: boolean }> {
    assertUuid('accountId', accountId);

    const [row] = await query<{
      id: string;
      kind: AccountKind;
      isActive: boolean;
    }>(
      em,
      `SELECT id, kind, "isActive" FROM account WHERE id = $1 AND "companyId" = $2`,
      [accountId, companyId],
    );

    if (!row) {
      throw notFound('accountId');
    }

    return row;
  }

  private async memberNames(
    companyId: string,
    memberIds: string[],
  ): Promise<Map<string, string>> {
    if (memberIds.length === 0) {
      return new Map();
    }

    const rows = await query<{
      id: string;
      firstName: string | null;
      lastName: string | null;
      email: string | null;
      phone: string | null;
    }>(
      this.dataSource.manager,
      `SELECT m.id, u."firstName", u."lastName", u.email, u.phone
       FROM company_member m JOIN "user" u ON u.id = m."userId"
       WHERE m."companyId" = $1 AND m.id = ANY($2::uuid[])`,
      [companyId, [...new Set(memberIds)]],
    );

    return new Map(
      rows.map((row) => [
        row.id,
        [row.firstName, row.lastName].filter(Boolean).join(' ') ||
          row.email ||
          row.phone ||
          '',
      ]),
    );
  }
}
