import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { query } from '../engines/db';
import { LedgerService } from '../ledger-entries/ledger.service';
import {
  WORK_ENTRY_LEDGER_SOURCE,
  WORKER_PARTY,
  WorkSource,
} from './worker.types';

export type PostWorkEntryInput = {
  companyId: string;
  memberId: string;
  workerId: string;
  date: string;
  job: string;
  unit: 'ton' | 'sqft' | 'day';
  qty: number;
  rate: number;
  amount: number;
  sourceType: WorkSource;
  /** The step it pays for (a truck, a production entry). */
  sourceId: string;
  auto: boolean;
};

// What a worker earned, added to their khata (the party ledger). Always called
// inside the caller's transaction, so a step and its pay are saved together or
// not at all. The same step pays once: asking again returns the entry that is
// already there. A step that is taken back keeps its work entry, marked, and
// the khata gets an opposite row.
@Injectable()
export class WorkEntriesService {
  constructor(private readonly ledger: LedgerService) {}

  async post(
    em: EntityManager,
    input: PostWorkEntryInput,
  ): Promise<{ id: string; created: boolean }> {
    const [existing] = await query<{ id: string }>(
      em,
      `SELECT id FROM work_entry
       WHERE "companyId" = $1 AND "sourceType" = $2 AND "sourceId" = $3 AND "reversedAt" IS NULL`,
      [input.companyId, input.sourceType, input.sourceId],
    );

    if (existing) {
      return { id: existing.id, created: false };
    }

    const [row] = await query<{ id: string }>(
      em,
      `INSERT INTO work_entry
         ("companyId", "workerId", "createdById", "date", job, unit, qty, rate, amount, "sourceType", "sourceId", auto)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        input.companyId,
        input.workerId,
        input.memberId,
        input.date,
        input.job,
        input.unit,
        input.qty,
        input.rate,
        input.amount,
        input.sourceType,
        input.sourceId,
        input.auto,
      ],
    );

    if (input.amount > 0) {
      await this.ledger.postPartyEntry(
        {
          companyId: input.companyId,
          date: input.date,
          partyType: WORKER_PARTY,
          partyId: input.workerId,
          side: 'charge',
          amount: input.amount,
          sourceType: WORK_ENTRY_LEDGER_SOURCE,
          sourceId: row.id,
          note: `${input.job} · ${input.qty} ${input.unit} × ${input.rate}`,
        },
        em,
      );
    }

    return { id: row.id, created: true };
  }

  // The step was reversed: its work entries are marked and the worker's
  // khata gets the opposite row. Nothing is deleted.
  async reverseBySource(
    em: EntityManager,
    input: {
      companyId: string;
      sourceType: WorkSource;
      sourceId: string;
      date: string;
    },
  ): Promise<void> {
    const rows = await query<{
      id: string;
      workerId: string;
      amount: string;
      job: string;
    }>(
      em,
      `SELECT id, "workerId", amount, job FROM work_entry
       WHERE "companyId" = $1 AND "sourceType" = $2 AND "sourceId" = $3 AND "reversedAt" IS NULL
       FOR UPDATE`,
      [input.companyId, input.sourceType, input.sourceId],
    );

    for (const row of rows) {
      const amount = Number(row.amount);

      await em.query(
        `UPDATE work_entry SET "reversedAt" = now() WHERE id = $1`,
        [row.id],
      );

      if (amount > 0) {
        await this.ledger.postPartyEntry(
          {
            companyId: input.companyId,
            date: input.date,
            partyType: WORKER_PARTY,
            partyId: row.workerId,
            side: 'credit',
            amount,
            sourceType: WORK_ENTRY_LEDGER_SOURCE,
            sourceId: row.id,
            note: `Reversed · ${row.job}`,
          },
          em,
        );
      }
    }
  }
}
