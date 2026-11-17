import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { canUseAccount } from '../cash-bank/cash-bank.policy';
import { todayAtFactory } from '../engines/calendar-date';
import { query, toNumber } from '../engines/db';
import { conflict, forbidden, invalid } from '../engines/errors';
import { assertDate } from '../engines/guards';
import { LedgerService } from '../ledger-entries/ledger.service';
import { LEDGER_SOURCE } from '../ledger-entries/ledger.types';
import { AuditService } from '../tenancy/audit.service';
import { TenantContext } from '../tenancy/tenant-context';
import { personName } from '../utils/person-name';
import { GiveMunshiCashDto } from './dto/expense.dto';
import {
  MUNSHI_ACCOUNT_NAME,
  MunshiGiveView,
  MunshiSummaryView,
} from './expense.types';

type GiveRow = {
  id: string;
  date: string;
  amount: string;
  note: string;
  fromAccountId: string;
  fromAccountName: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
};

// The munshi's petty cash (rules §8). It is a cash account of its own in the
// company, so its balance is the ledger's, like every other account. Giving the
// munshi cash is a transfer into it; what he spends is paid from it by expenses.
// Negative means he spent his own money, and the owner owes it back.
@Injectable()
export class MunshiCashService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  // The munshi's account, created the first time it is needed.
  async accountId(em: EntityManager, companyId: string): Promise<string> {
    await em.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `munshi_account:${companyId}`,
    ]);

    const [found] = await query<{ id: string }>(
      em,
      `SELECT id FROM account WHERE "companyId" = $1 AND kind = 'cash' AND name = $2`,
      [companyId, MUNSHI_ACCOUNT_NAME],
    );

    if (found) {
      return found.id;
    }

    const [created] = await query<{ id: string }>(
      em,
      `INSERT INTO account ("companyId", kind, name, "openingBalance", "openingDate", "isActive")
       VALUES ($1, 'cash', $2, 0, $3, true) RETURNING id`,
      [companyId, MUNSHI_ACCOUNT_NAME, todayAtFactory()],
    );

    return created.id;
  }

  async summary(tenant: TenantContext): Promise<MunshiSummaryView> {
    const em = this.dataSource.manager;
    const accountId = await this.accountId(em, tenant.companyId);
    const [row] = await query<{ balance: string }>(
      em,
      `SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 0) AS balance
       FROM ledger_entry WHERE "companyId" = $1 AND "accountId" = $2`,
      [tenant.companyId, accountId],
    );
    const balance = toNumber(row.balance);
    const recent = await this.gives(tenant.companyId, 5);

    return {
      accountId,
      balance,
      ownerOwes: Math.max(0, -balance),
      recent,
    };
  }

  async give(
    tenant: TenantContext,
    dto: GiveMunshiCashDto,
  ): Promise<MunshiGiveView> {
    assertDate('date', dto.date);

    if (dto.date > todayAtFactory()) {
      throw conflict('FUTURE_DATE');
    }

    const id = await this.dataSource.transaction(async (em) => {
      const [from] = await query<{
        kind: 'cash' | 'bank';
        isActive: boolean;
        name: string;
      }>(
        em,
        `SELECT kind, "isActive", name FROM account WHERE id = $1 AND "companyId" = $2`,
        [dto.fromAccountId, tenant.companyId],
      );

      if (!from) {
        throw invalid({ fromAccountId: 'invalid' });
      }
      if (!from.isActive) {
        throw conflict('ACCOUNT_INACTIVE');
      }
      if (!canUseAccount(tenant.roleKey, from.kind)) {
        throw forbidden('BANK_ACCOUNT_NOT_ALLOWED');
      }

      const toAccountId = await this.accountId(em, tenant.companyId);

      if (toAccountId === dto.fromAccountId) {
        throw invalid({ fromAccountId: 'invalid' });
      }

      const transfer = await this.ledger.postTransfer(
        {
          companyId: tenant.companyId,
          fromAccountId: dto.fromAccountId,
          toAccountId,
          date: dto.date,
          amount: dto.amount,
          sourceType: LEDGER_SOURCE.transfer,
          note: dto.note ?? `Cash to ${MUNSHI_ACCOUNT_NAME}`,
          createdByMemberId: tenant.memberId,
        },
        em,
      );

      const [give] = await query<{ id: string }>(
        em,
        `INSERT INTO munshi_give ("companyId", date, amount, note, "transferId", "fromAccountId", "createdById")
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          tenant.companyId,
          dto.date,
          dto.amount,
          dto.note ?? '',
          transfer.transferId,
          dto.fromAccountId,
          tenant.memberId,
        ],
      );

      await this.audit.record(
        {
          actorType: 'member',
          actorId: tenant.memberId,
          action: 'munshi_cash.give',
          companyId: tenant.companyId,
          targetType: 'munshi_give',
          targetId: give.id,
          metadata: { amount: dto.amount },
        },
        em,
      );

      return give.id;
    });

    const [row] = await this.gives(tenant.companyId, 1, id);

    return row;
  }

  private async gives(
    companyId: string,
    limit: number,
    onlyId?: string,
  ): Promise<MunshiGiveView[]> {
    const rows = await query<GiveRow>(
      this.dataSource.manager,
      `SELECT g.id, g.date::text AS date, g.amount, g.note, g."fromAccountId", a.name AS "fromAccountName",
              u."firstName", u."lastName", u.phone, u.email
       FROM munshi_give g
       JOIN account a ON a.id = g."fromAccountId"
       JOIN company_member cm ON cm.id = g."createdById"
       JOIN "user" u ON u.id = cm."userId"
       WHERE g."companyId" = $1 AND ($3::uuid IS NULL OR g.id = $3)
       ORDER BY g.date DESC, g."createdAt" DESC
       LIMIT $2`,
      [companyId, limit, onlyId ?? null],
    );

    return rows.map((r) => ({
      id: r.id,
      date: r.date,
      fromAccountId: r.fromAccountId,
      fromAccountName: r.fromAccountName,
      amount: toNumber(r.amount),
      note: r.note,
      by:
        personName({
          user: {
            firstName: r.firstName,
            lastName: r.lastName,
            phone: r.phone,
            email: r.email,
          },
        }) ?? '',
    }));
  }
}
