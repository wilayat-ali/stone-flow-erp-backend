import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { query, toNumber } from '../engines/db';
import { conflict, invalid, notFound } from '../engines/errors';
import { assertDate, assertUuid } from '../engines/guards';
import { LedgerService } from '../ledger-entries/ledger.service';
import { LEDGER_SOURCE } from '../ledger-entries/ledger.types';
import { TenantContext } from '../tenancy/tenant-context';
import { canSeeBankBalances } from './cash-bank.policy';
import { AccountKind, AccountView } from './cash-bank.types';
import { CreateAccountDto, UpdateAccountDto } from './dto/cash-bank.dto';

type RawAccount = {
  id: string;
  kind: AccountKind;
  name: string;
  last4: string | null;
  openingBalance: string;
  openingDate: string;
  isActive: boolean;
  balance: string;
};

// Balances are never stored: each is the sum of the account's ledger rows.
const SELECT = `
  SELECT a.id, a.kind, a.name, a.last4, a."openingBalance",
         a."openingDate"::text AS "openingDate", a."isActive",
         COALESCE((
           SELECT SUM(CASE WHEN l.direction = 'in' THEN l.amount ELSE -l.amount END)
           FROM ledger_entry l
           WHERE l."companyId" = a."companyId" AND l."accountId" = a.id
         ), 0) AS balance
  FROM account a`;

// A munshi sees the cash in hand and the names of the banks, but no bank
// balance (rules §1 roles).
function toView(raw: RawAccount, tenant: TenantContext): AccountView {
  const visible = raw.kind === 'cash' || canSeeBankBalances(tenant.roleKey);

  return {
    id: raw.id,
    kind: raw.kind,
    name: raw.name,
    last4: raw.last4,
    openingBalance: visible ? toNumber(raw.openingBalance) : null,
    openingDate: raw.openingDate,
    isActive: raw.isActive,
    balance: visible ? toNumber(raw.balance) : null,
  };
}

@Injectable()
export class CashBankAccountsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
  ) {}

  async list(
    tenant: TenantContext,
    includeInactive = false,
  ): Promise<AccountView[]> {
    const rows = await query<RawAccount>(
      this.dataSource.manager,
      `${SELECT}
       WHERE a."companyId" = $1 AND ($2::boolean OR a."isActive")
       ORDER BY (a.kind = 'cash') DESC, a."isActive" DESC, a.name`,
      [tenant.companyId, includeInactive],
    );

    return rows.map((raw) => toView(raw, tenant));
  }

  async get(
    tenant: TenantContext,
    accountId: string,
    manager?: EntityManager,
  ): Promise<AccountView> {
    assertUuid('accountId', accountId);

    const [raw] = await query<RawAccount>(
      manager ?? this.dataSource.manager,
      `${SELECT} WHERE a."companyId" = $1 AND a.id = $2`,
      [tenant.companyId, accountId],
    );

    if (!raw) {
      throw notFound('accountId');
    }

    return toView(raw, tenant);
  }

  // A company may have several cash accounts (cash in hand, the munshi's petty
  // cash, ...). Where a request does not say which one, the default is the
  // oldest active one: normally the main "cash in hand".
  async findDefaultCash(
    companyId: string,
    manager?: EntityManager,
  ): Promise<{ id: string } | null> {
    const [row] = await query<{ id: string }>(
      manager ?? this.dataSource.manager,
      `SELECT id FROM account
       WHERE "companyId" = $1 AND kind = 'cash' AND "isActive"
       ORDER BY "createdAt", id LIMIT 1`,
      [companyId],
    );

    return row ?? null;
  }

  // A cash account of THIS company (any, active or not), or null.
  async findCashById(
    companyId: string,
    accountId: string,
    manager?: EntityManager,
  ): Promise<{ id: string; isActive: boolean } | null> {
    assertUuid('accountId', accountId);

    const [row] = await query<{ id: string; isActive: boolean }>(
      manager ?? this.dataSource.manager,
      `SELECT id, "isActive" FROM account WHERE id = $1 AND "companyId" = $2 AND kind = 'cash'`,
      [accountId, companyId],
    );

    return row ?? null;
  }

  // Creates the account and posts its opening balance as the first ledger row
  // (sourceType 'opening'), in one transaction.
  async create(
    tenant: TenantContext,
    dto: CreateAccountDto,
  ): Promise<AccountView> {
    assertDate('openingDate', dto.openingDate);

    if (dto.kind === 'bank' && !dto.last4) {
      throw invalid({ last4: 'required' });
    }
    if (dto.kind === 'cash' && dto.last4) {
      throw invalid({ last4: 'notAllowedForCash' });
    }

    const accountId = await this.dataSource.transaction(async (em) => {
      const [created] = await query<{ id: string }>(
        em,
        `INSERT INTO account ("companyId", kind, name, last4, "openingBalance", "openingDate")
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          tenant.companyId,
          dto.kind,
          dto.name,
          dto.kind === 'bank' ? dto.last4 : null,
          dto.openingBalance,
          dto.openingDate,
        ],
      );

      if (dto.openingBalance !== 0) {
        await this.ledger.post(
          {
            companyId: tenant.companyId,
            accountId: created.id,
            date: dto.openingDate,
            direction: dto.openingBalance > 0 ? 'in' : 'out',
            amount: Math.abs(dto.openingBalance),
            sourceType: LEDGER_SOURCE.opening,
            createdByMemberId: tenant.memberId,
          },
          em,
        );
      }

      return created.id;
    });

    return this.get(tenant, accountId);
  }

  // Name, last 4 digits and active flag only. The opening balance is ledger
  // history: a wrong figure is fixed with an entry, not by editing it.
  async update(
    tenant: TenantContext,
    accountId: string,
    dto: UpdateAccountDto,
  ): Promise<AccountView> {
    assertUuid('accountId', accountId);

    await this.dataSource.transaction(async (em) => {
      // Lock the row: a posting to this account (which takes a shared lock on
      // it) either finishes before the balance is read, or waits and then
      // finds the account inactive.
      // The company's cash accounts are locked together with this one, in a
      // fixed order, so two people cannot deactivate the last two at once.
      const locks = await query<{
        id: string;
        kind: 'cash' | 'bank';
        isActive: boolean;
      }>(
        em,
        `SELECT id, kind, "isActive" FROM account
         WHERE "companyId" = $1 AND (id = $2 OR kind = 'cash')
         ORDER BY id FOR UPDATE`,
        [tenant.companyId, accountId],
      );

      if (!locks.some((row) => row.id === accountId)) {
        throw notFound('accountId');
      }

      const current = await this.get(tenant, accountId, em);

      if (dto.last4 !== undefined && current.kind === 'cash') {
        throw invalid({ last4: 'notAllowedForCash' });
      }

      if (dto.isActive === false && current.isActive) {
        // Deposits and cash counts need a cash account to work with.
        const otherActiveCash = locks.filter(
          (row) => row.kind === 'cash' && row.isActive && row.id !== accountId,
        );
        if (current.kind === 'cash' && otherActiveCash.length === 0) {
          throw conflict('CASH_ACCOUNT_REQUIRED');
        }
        // Hiding an account that still holds money would hide the money.
        if (current.balance !== 0) {
          throw conflict('ACCOUNT_HAS_BALANCE', { balance: current.balance });
        }
      }

      await em.query(
        `UPDATE account
         SET name = COALESCE($1, name),
             last4 = COALESCE($2, last4),
             "isActive" = COALESCE($3, "isActive")
         WHERE id = $4 AND "companyId" = $5`,
        [
          dto.name ?? null,
          dto.last4 ?? null,
          dto.isActive ?? null,
          accountId,
          tenant.companyId,
        ],
      );
    });

    return this.get(tenant, accountId);
  }
}
