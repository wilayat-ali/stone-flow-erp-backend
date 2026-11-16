import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import {
  inTransaction,
  pageBounds,
  query,
  toNumber,
  toNumberOrNull,
} from '../engines/db';
import { conflict, invalid, notFound } from '../engines/errors';
import {
  assertDate,
  assertMemberInCompany,
  assertSourceType,
  assertUuid,
  cleanNote,
} from '../engines/guards';
import {
  LEDGER_DIRECTIONS,
  LEDGER_SOURCE,
  LedgerDirection,
  LedgerPartyType,
  LedgerRow,
  PAIRED_SOURCES,
  PARTY_TYPES,
  PartyBalance,
  PartyRow,
  PartyType,
  PostLedgerInput,
  PostPartyEntryInput,
  PostTransferInput,
  ReverseInput,
  Statement,
  StatementInput,
  StatementRow,
} from './ledger.types';

type RawLedger = Omit<LedgerRow, 'amount'> & { amount: string };

// A post that passed validation, ready to insert.
type CheckedPost = {
  companyId: string;
  accountId: string;
  createdByMemberId: string;
  date: string;
  direction: LedgerDirection;
  amount: number;
  sourceType: string;
  sourceId: string | null;
  partyType: LedgerPartyType | null;
  partyId: string | null;
  note: string | null;
};
type RawStatementRow = RawLedger & { runningBalance: string };

// Selected everywhere so `date` is read as text: the pg driver would turn a
// DATE column into a JS Date in the server's timezone.
const COLS = `id, "companyId", "accountId", "createdByMemberId", "date"::text AS "date",
  direction, amount, "partyType", "partyId", "sourceType", "sourceId", note,
  "reversedById", "createdAt"`;

// Money in adds to a balance, money out subtracts.
const SIGNED = `CASE WHEN direction = 'in' THEN amount ELSE -amount END`;

function toRow(raw: RawLedger): LedgerRow {
  return { ...raw, amount: toNumber(raw.amount) };
}

function assertAmount(amount: unknown): asserts amount is number {
  if (!Number.isSafeInteger(amount) || (amount as number) <= 0) {
    throw invalid({ amount: 'mustBeWholePositive' });
  }
}

// The party fields are all-or-nothing: a real party type needs its id, and
// "no party" must not carry one.
function normalizeParty(
  partyType: LedgerPartyType | null | undefined,
  partyId: string | null | undefined,
): { partyType: LedgerPartyType | null; partyId: string | null } {
  if (partyType === null || partyType === undefined || partyType === 'none') {
    if (partyId) {
      throw invalid({ partyId: 'notAllowedWithoutParty' });
    }
    return { partyType: partyType ?? null, partyId: null };
  }

  if (!PARTY_TYPES.includes(partyType)) {
    throw invalid({ partyType: 'invalid' });
  }

  assertUuid('partyId', partyId);
  return { partyType, partyId };
}

// The money ledger engine (rules §2.1). Every cash or bank movement is one
// append-only row; a balance is always the sum of rows, never stored. Rows are
// never edited or deleted: a mistake is fixed with reverse(). The database
// enforces this with a trigger, this service just never tries.
//
// Every method takes the companyId from the tenant context and filters by it.
// Pass `manager` to run inside the caller's transaction.
@Injectable()
export class LedgerService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async post(
    input: PostLedgerInput,
    manager?: EntityManager,
  ): Promise<LedgerRow> {
    const checked = this.checkPost(input);

    return inTransaction(this.dataSource, manager, async (em) => {
      await this.assertAccount(em, input.companyId, input.accountId, true);
      await assertMemberInCompany(em, input.companyId, input.createdByMemberId);
      return this.insert(em, checked);
    });
  }

  // Moves money between two accounts as two rows (out of one, into the other)
  // sharing one sourceId, all or nothing.
  async postTransfer(
    input: PostTransferInput,
    manager?: EntityManager,
  ): Promise<{ transferId: string; out: LedgerRow; in: LedgerRow }> {
    assertUuid('fromAccountId', input.fromAccountId);
    assertUuid('toAccountId', input.toAccountId);

    if (input.fromAccountId === input.toAccountId) {
      throw invalid({ toAccountId: 'mustDifferFromSource' });
    }

    const transferId = randomUUID();
    const shared = {
      companyId: input.companyId,
      date: input.date,
      amount: input.amount,
      sourceType: input.sourceType,
      sourceId: transferId,
      note: input.note,
      createdByMemberId: input.createdByMemberId,
    };
    const outRow = this.checkPost({
      ...shared,
      accountId: input.fromAccountId,
      direction: 'out',
    });
    const inRow = this.checkPost({
      ...shared,
      accountId: input.toAccountId,
      direction: 'in',
    });

    return inTransaction(this.dataSource, manager, async (em) => {
      await this.assertAccount(em, input.companyId, input.fromAccountId, true);
      await this.assertAccount(em, input.companyId, input.toAccountId, true);
      await assertMemberInCompany(em, input.companyId, input.createdByMemberId);

      return {
        transferId,
        out: await this.insert(em, outRow),
        in: await this.insert(em, inRow),
      };
    });
  }

  // Cancels a row by posting its opposite and marking the original as
  // reversed. A transfer or deposit is reversed as a pair. A reversal cannot
  // itself be reversed (post the entry again instead), and a row is reversed
  // at most once. Reversing is allowed even if the account is deactivated.
  async reverse(
    input: ReverseInput,
    manager?: EntityManager,
  ): Promise<{ reversals: LedgerRow[] }> {
    assertUuid('entryId', input.entryId);
    assertDate('date', input.date);

    return inTransaction(this.dataSource, manager, async (em) => {
      await assertMemberInCompany(em, input.companyId, input.createdByMemberId);

      // Lock the row(s) so two people cannot reverse the same entry at once.
      const [target] = await query<RawLedger>(
        em,
        `SELECT ${COLS} FROM ledger_entry WHERE id = $1 AND "companyId" = $2 FOR UPDATE`,
        [input.entryId, input.companyId],
      );

      if (!target) {
        throw notFound('entryId');
      }

      if (target.sourceType === LEDGER_SOURCE.reversal) {
        throw conflict('ENTRY_IS_A_REVERSAL');
      }

      const group =
        target.sourceId && PAIRED_SOURCES.includes(target.sourceType)
          ? await query<RawLedger>(
              em,
              `SELECT ${COLS} FROM ledger_entry
               WHERE "companyId" = $1 AND "sourceType" = $2 AND "sourceId" = $3
               ORDER BY id FOR UPDATE`,
              [input.companyId, target.sourceType, target.sourceId],
            )
          : [target];

      if (group.some((row) => row.reversedById)) {
        throw conflict('ENTRY_ALREADY_REVERSED');
      }

      const reversals: LedgerRow[] = [];

      for (const original of group) {
        const reversal = await this.insert(em, {
          companyId: input.companyId,
          accountId: original.accountId,
          createdByMemberId: input.createdByMemberId,
          date: input.date,
          direction: original.direction === 'in' ? 'out' : 'in',
          amount: toNumber(original.amount),
          partyType: original.partyType,
          partyId: original.partyId,
          sourceType: LEDGER_SOURCE.reversal,
          sourceId: original.id,
          note: cleanNote(input.reason) ?? 'Reversal',
        });

        // The one change the append-only trigger allows: set reversedById once.
        await em.query(
          `UPDATE ledger_entry SET "reversedById" = $1 WHERE id = $2 AND "companyId" = $3`,
          [reversal.id, original.id, input.companyId],
        );
        reversals.push(reversal);
      }

      return { reversals };
    });
  }

  // Balance = sum of the account's rows up to and including `asOf` (all rows
  // if omitted). Reversal rows are ordinary rows, so a reversed entry nets to 0.
  async accountBalance(
    companyId: string,
    accountId: string,
    asOf?: string,
    manager?: EntityManager,
  ): Promise<number> {
    const em = manager ?? this.dataSource.manager;
    await this.assertAccount(em, companyId, accountId, false);

    if (asOf !== undefined) {
      assertDate('asOf', asOf);
    }

    const [row] = await query<{ balance: string }>(
      em,
      `SELECT COALESCE(SUM(${SIGNED}), 0) AS balance FROM ledger_entry
       WHERE "companyId" = $1 AND "accountId" = $2
         AND ($3::date IS NULL OR "date" <= $3::date)`,
      [companyId, accountId, asOf ?? null],
    );

    return toNumber(row.balance);
  }

  // Statement with a running balance. Rows are ordered by date, then money in
  // before money out (rules §2.1), then by when they were posted. The running
  // balance is computed over the account's whole history in that order, so
  // every page and every filter shows the true balance after that row.
  async accountStatement(
    input: StatementInput,
    manager?: EntityManager,
  ): Promise<Statement> {
    const em = manager ?? this.dataSource.manager;
    const { companyId, accountId } = input;
    await this.assertAccount(em, companyId, accountId, false);

    if (input.from !== undefined) {
      assertDate('from', input.from);
    }
    if (input.to !== undefined) {
      assertDate('to', input.to);
    }
    if (input.from && input.to && input.from > input.to) {
      throw invalid({ to: 'mustNotBeBeforeFrom' });
    }

    const from = input.from ?? null;
    const to = input.to ?? null;
    const { limit, offset } = pageBounds(input, 25, 500);
    const dir = input.order === 'asc' ? 'ASC' : 'DESC';
    const sourceType = input.sourceType ?? null;
    const direction = input.direction ?? null;

    if (sourceType !== null) {
      assertSourceType(sourceType);
    }
    if (direction !== null && !LEDGER_DIRECTIONS.includes(direction)) {
      throw invalid({ direction: 'invalid' });
    }

    const [opening] = await query<{ balance: string }>(
      em,
      `SELECT COALESCE(SUM(${SIGNED}), 0) AS balance FROM ledger_entry
       WHERE "companyId" = $1 AND "accountId" = $2
         AND $3::date IS NOT NULL AND "date" < $3::date`,
      [companyId, accountId, from],
    );

    const [totals] = await query<{
      total_in: string;
      total_out: string;
      total: string;
    }>(
      em,
      `SELECT COALESCE(SUM(amount) FILTER (WHERE direction = 'in'), 0) AS total_in,
              COALESCE(SUM(amount) FILTER (WHERE direction = 'out'), 0) AS total_out,
              COUNT(*) FILTER (WHERE ($5::text IS NULL OR "sourceType" = $5)
                                 AND ($6::text IS NULL OR direction = $6)) AS total
       FROM ledger_entry
       WHERE "companyId" = $1 AND "accountId" = $2
         AND ($3::date IS NULL OR "date" >= $3::date)
         AND ($4::date IS NULL OR "date" <= $4::date)`,
      [companyId, accountId, from, to, sourceType, direction],
    );

    const rows = await query<RawStatementRow>(
      em,
      `WITH ordered AS (
         SELECT e.*,
                SUM(CASE WHEN e.direction = 'in' THEN e.amount ELSE -e.amount END)
                  OVER (ORDER BY e."date", (e.direction = 'out'), e."createdAt", e.id
                        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS "runningBalance"
         FROM ledger_entry e
         WHERE e."companyId" = $1 AND e."accountId" = $2
       )
       SELECT id, "companyId", "accountId", "createdByMemberId", "date"::text AS "date",
              direction, amount, "partyType", "partyId", "sourceType", "sourceId", note,
              "reversedById", "createdAt", "runningBalance"
       FROM ordered
       WHERE ($3::date IS NULL OR "date" >= $3::date)
         AND ($4::date IS NULL OR "date" <= $4::date)
         AND ($7::text IS NULL OR "sourceType" = $7)
         AND ($8::text IS NULL OR direction = $8)
       ORDER BY "date" ${dir}, (direction = 'out') ${dir}, "createdAt" ${dir}, id ${dir}
       LIMIT $5 OFFSET $6`,
      [companyId, accountId, from, to, limit, offset, sourceType, direction],
    );

    const openingBalance = toNumber(opening?.balance);
    const totalIn = toNumber(totals.total_in);
    const totalOut = toNumber(totals.total_out);

    return {
      accountId,
      from,
      to,
      openingBalance,
      totalIn,
      totalOut,
      closingBalance: openingBalance + totalIn - totalOut,
      total: toNumber(totals.total),
      rows: rows.map(
        (raw): StatementRow => ({
          ...toRow(raw),
          runningBalance: toNumber(raw.runningBalance),
        }),
      ),
    };
  }

  // Party khata (supplier, customer, worker, shop). Used by later modules.
  async postPartyEntry(
    input: PostPartyEntryInput,
    manager?: EntityManager,
  ): Promise<{ id: string }> {
    assertDate('date', input.date);
    assertAmount(input.amount);
    assertSourceType(input.sourceType);
    assertUuid('partyId', input.partyId);

    if (!PARTY_TYPES.includes(input.partyType)) {
      throw invalid({ partyType: 'invalid' });
    }
    if (input.side !== 'charge' && input.side !== 'credit') {
      throw invalid({ side: 'invalid' });
    }
    if (input.sourceId) {
      assertUuid('sourceId', input.sourceId);
    }

    return inTransaction(this.dataSource, manager, async (em) => {
      const [row] = await query<{ id: string }>(
        em,
        `INSERT INTO party_ledger_entry
           ("companyId", "date", "partyType", "partyId", charge, credit, "sourceType", "sourceId", note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          input.companyId,
          input.date,
          input.partyType,
          input.partyId,
          input.side === 'charge' ? input.amount : null,
          input.side === 'credit' ? input.amount : null,
          input.sourceType,
          input.sourceId ?? null,
          cleanNote(input.note),
        ],
      );
      return row;
    });
  }

  async partyBalance(
    companyId: string,
    partyType: PartyType,
    partyId: string,
    manager?: EntityManager,
  ): Promise<PartyBalance> {
    assertUuid('partyId', partyId);

    if (!PARTY_TYPES.includes(partyType)) {
      throw invalid({ partyType: 'invalid' });
    }

    const [row] = await query<{ charged: string; credited: string }>(
      manager ?? this.dataSource.manager,
      `SELECT COALESCE(SUM(charge), 0) AS charged, COALESCE(SUM(credit), 0) AS credited
       FROM party_ledger_entry
       WHERE "companyId" = $1 AND "partyType" = $2 AND "partyId" = $3`,
      [companyId, partyType, partyId],
    );

    const charged = toNumber(row.charged);
    const credited = toNumber(row.credited);
    return { charged, credited, balance: charged - credited };
  }

  // ---- internals ----------------------------------------------------------

  private checkPost(input: PostLedgerInput): CheckedPost {
    assertUuid('accountId', input.accountId);
    assertDate('date', input.date);
    assertAmount(input.amount);
    assertSourceType(input.sourceType);

    if (!LEDGER_DIRECTIONS.includes(input.direction)) {
      throw invalid({ direction: 'invalid' });
    }
    if (input.sourceId) {
      assertUuid('sourceId', input.sourceId);
    }

    return {
      companyId: input.companyId,
      accountId: input.accountId,
      createdByMemberId: input.createdByMemberId,
      date: input.date,
      direction: input.direction as LedgerDirection,
      amount: input.amount,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      ...normalizeParty(input.partyType, input.partyId),
      note: cleanNote(input.note),
    };
  }

  // Balances of many parties of one type in one query (a supplier list).
  // Parties with no rows are simply absent from the map.
  async partyBalances(
    companyId: string,
    partyType: PartyType,
    manager?: EntityManager,
  ): Promise<Map<string, PartyBalance>> {
    if (!PARTY_TYPES.includes(partyType)) {
      throw invalid({ partyType: 'invalid' });
    }

    const rows = await query<{
      partyId: string;
      charged: string;
      credited: string;
    }>(
      manager ?? this.dataSource.manager,
      `SELECT "partyId", COALESCE(SUM(charge), 0) AS charged, COALESCE(SUM(credit), 0) AS credited
       FROM party_ledger_entry
       WHERE "companyId" = $1 AND "partyType" = $2
       GROUP BY "partyId"`,
      [companyId, partyType],
    );

    return new Map(
      rows.map((row) => {
        const charged = toNumber(row.charged);
        const credited = toNumber(row.credited);
        return [
          row.partyId,
          { charged, credited, balance: charged - credited },
        ];
      }),
    );
  }

  // Every row of one party's khata, oldest first (same day: in posting order).
  async partyRows(
    companyId: string,
    partyType: PartyType,
    partyId: string,
    manager?: EntityManager,
  ): Promise<PartyRow[]> {
    assertUuid('partyId', partyId);

    if (!PARTY_TYPES.includes(partyType)) {
      throw invalid({ partyType: 'invalid' });
    }

    const rows = await query<
      Omit<PartyRow, 'charge' | 'credit'> & {
        charge: string | null;
        credit: string | null;
      }
    >(
      manager ?? this.dataSource.manager,
      `SELECT id, "date"::text AS "date", charge, credit, "sourceType", "sourceId", note, "createdAt"
       FROM party_ledger_entry
       WHERE "companyId" = $1 AND "partyType" = $2 AND "partyId" = $3
       ORDER BY "date", "createdAt", id`,
      [companyId, partyType, partyId],
    );

    return rows.map((row) => ({
      ...row,
      charge: toNumberOrNull(row.charge),
      credit: toNumberOrNull(row.credit),
    }));
  }

  private async insert(
    em: EntityManager,
    row: CheckedPost,
  ): Promise<LedgerRow> {
    const [created] = await query<RawLedger>(
      em,
      `INSERT INTO ledger_entry
         ("companyId", "accountId", "createdByMemberId", "date", direction, amount,
          "partyType", "partyId", "sourceType", "sourceId", note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING ${COLS}`,
      [
        row.companyId,
        row.accountId,
        row.createdByMemberId,
        row.date,
        row.direction,
        row.amount,
        row.partyType,
        row.partyId,
        row.sourceType,
        row.sourceId,
        row.note,
      ],
    );

    return toRow(created);
  }

  // The account must belong to THIS company; another company's id is reported
  // exactly like a missing one.
  private async assertAccount(
    em: EntityManager,
    companyId: string,
    accountId: string,
    requireActive: boolean,
  ) {
    assertUuid('accountId', accountId);

    // Shared lock while posting, so an account cannot be deactivated (which
    // takes the exclusive lock) in the middle of a posting to it.
    const [account] = await query<{ isActive: boolean }>(
      em,
      `SELECT "isActive" FROM account WHERE id = $1 AND "companyId" = $2${
        requireActive ? ' FOR SHARE' : ''
      }`,
      [accountId, companyId],
    );

    if (!account) {
      throw notFound('accountId');
    }
    if (requireActive && !account.isActive) {
      throw conflict('ACCOUNT_INACTIVE');
    }
  }
}
