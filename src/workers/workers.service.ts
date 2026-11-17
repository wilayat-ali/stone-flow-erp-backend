import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, QueryFailedError, Repository } from 'typeorm';
import { todayAtFactory } from '../engines/calendar-date';
import { query, toNumber } from '../engines/db';
import { conflict, invalid, notFound } from '../engines/errors';
import { assertDate } from '../engines/guards';
import { LedgerService } from '../ledger-entries/ledger.service';
import { FactoryEntity } from '../settings/infrastructure/persistence/relational/entities/factory.entity';
import { AuditService } from '../tenancy/audit.service';
import { TenantContext } from '../tenancy/tenant-context';
import { inCompany } from '../tenancy/tenant-scope';
import {
  CreateWorkerDto,
  ListWorkersQueryDto,
  UpdateWorkerDto,
} from './dto/worker.dto';
import { WorkerEntity } from './infrastructure/persistence/relational/entities/worker.entity';
import {
  DEFAULT_TON_RATE,
  PayType,
  WORKER_PARTY,
  WorkerKhataRow,
  WorkerSummary,
  WorkerView,
} from './worker.types';

const PG_UNIQUE_VIOLATION = '23505';

function toView(row: WorkerEntity): WorkerView {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    jobTitle: row.jobTitle,
    factoryId: row.factory.id,
    payType: row.payType as PayType,
    rate: row.rate,
    defaultJob: row.defaultJob,
    openingBalance: row.openingBalance,
    joinedOn: row.joinedOn,
    isActive: row.isActive,
  };
}

// Workers (rules §8): thekadars, section makers, resizers, polishers, daily
// helpers and staff, each with a khata kept in the party ledger. Production
// reads a worker through here; what they earn is posted by WorkEntriesService.
@Injectable()
export class WorkersService {
  constructor(
    @InjectRepository(WorkerEntity)
    private readonly workers: Repository<WorkerEntity>,
    @InjectRepository(FactoryEntity)
    private readonly factories: Repository<FactoryEntity>,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  async list(
    tenant: TenantContext,
    filters: ListWorkersQueryDto,
  ): Promise<WorkerSummary[]> {
    const [rows, balances, month] = await Promise.all([
      this.workers.find({
        where: {
          ...inCompany(tenant.companyId),
          ...(filters.payType ? { payType: filters.payType } : {}),
          ...(filters.factoryId ? { factory: { id: filters.factoryId } } : {}),
        },
        relations: { factory: true },
        order: { createdAt: 'ASC', name: 'ASC' },
      }),
      this.ledger.partyBalances(tenant.companyId, WORKER_PARTY),
      this.monthFigures(tenant.companyId),
    ]);
    const q = filters.q?.trim().toLowerCase();

    return rows
      .filter(
        (row) =>
          !q ||
          row.name.toLowerCase().includes(q) ||
          row.phone.replace(/\D/g, '').includes(q.replace(/\D/g, '') || '\0'),
      )
      .map((row) =>
        this.summarise(row, balances.get(row.id), month.get(row.id)),
      );
  }

  async get(tenant: TenantContext, id: string): Promise<WorkerSummary> {
    const row = await this.load(tenant.companyId, id);
    const [balance, month] = await Promise.all([
      this.ledger.partyBalance(tenant.companyId, WORKER_PARTY, id),
      this.monthFigures(tenant.companyId, id),
    ]);

    return this.summarise(row, balance, month.get(id));
  }

  // The opening balance first, then every ledger row with the running balance.
  // The khata: every row of the worker's party ledger, with what each one is.
  // A month close's salary and instalments and their reopening, and the loans
  // given (shown, not counted), are read back from the close and the loan.
  async khata(tenant: TenantContext, id: string): Promise<WorkerKhataRow[]> {
    const row = await this.load(tenant.companyId, id);
    const em = this.workers.manager;
    const posted = await this.ledger.partyRows(
      tenant.companyId,
      WORKER_PARTY,
      id,
    );
    const idsOf = (...types: string[]) =>
      posted
        .filter((p) => types.includes(p.sourceType) && p.sourceId)
        .map((p) => p.sourceId as string);

    const entries = new Map(
      (idsOf('work_entry').length
        ? await query<{
            id: string;
            job: string;
            unit: 'ton' | 'sqft' | 'day';
            qty: string;
            rate: string;
            auto: boolean;
          }>(
            em,
            `SELECT id, job, unit, qty, rate, auto FROM work_entry WHERE "companyId" = $1 AND id = ANY($2)`,
            [tenant.companyId, idsOf('work_entry')],
          )
        : []
      ).map((e) => [e.id, e]),
    );

    const postings = new Map(
      (idsOf('month_close', 'salary_reversal').length
        ? await query<{
            id: string;
            salary: string;
            absentDays: number;
            cut: string;
          }>(
            em,
            `SELECT id, salary, "absentDays", cut FROM month_close_posting WHERE "companyId" = $1 AND id = ANY($2)`,
            [tenant.companyId, idsOf('month_close', 'salary_reversal')],
          )
        : []
      ).map((p) => [p.id, p]),
    );

    const instalments = new Map(
      (idsOf('month_close', 'instalment_reversal').length
        ? await query<{ id: string; reason: string; month: string }>(
            em,
            `SELECT i.id, l.reason, c.month
             FROM month_close_instalment i
             JOIN month_close_posting p ON p.id = i."postingId"
             JOIN month_close c ON c.id = p."closeId"
             JOIN loan l ON l.id = i."loanId"
             WHERE i."companyId" = $1 AND i.id = ANY($2)`,
            [tenant.companyId, idsOf('month_close', 'instalment_reversal')],
          )
        : []
      ).map((i) => [i.id, i]),
    );

    const loans = await query<{
      id: string;
      date: string;
      amount: string;
      reason: string;
    }>(
      em,
      `SELECT id, date::text AS date, amount, reason FROM loan WHERE "companyId" = $1 AND "workerId" = $2`,
      [tenant.companyId, id],
    );

    const lines: WorkerKhataRow[] = [];

    for (const entry of posted) {
      const kind = entry.charge === null ? 'credit' : 'charge';
      const amount = (kind === 'charge' ? entry.charge : entry.credit) ?? 0;
      lines.push({
        id: entry.id,
        date: entry.date,
        type: 'payment',
        kind,
        amount,
        balance: 0,
        ...rowDetails(
          entry.sourceType,
          entry.sourceId,
          entry.note,
          entries,
          postings,
          instalments,
        ),
      });
    }

    for (const loan of loans) {
      lines.push({
        id: `loan-${loan.id}`,
        date: loan.date,
        type: 'loan',
        kind: 'charge',
        amount: toNumber(loan.amount),
        balance: 0,
        note: loan.reason,
        memo: true,
      });
    }

    lines.sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.kind === b.kind ? 0 : a.kind === 'charge' ? -1 : 1),
    );

    let balance = row.openingBalance;
    const rows: WorkerKhataRow[] =
      row.openingBalance === 0
        ? []
        : [
            {
              id: `opening-${row.id}`,
              date: row.joinedOn,
              type: 'opening',
              kind: row.openingBalance > 0 ? 'charge' : 'credit',
              amount: Math.abs(row.openingBalance),
              balance,
            },
          ];

    for (const line of lines) {
      if (!line.memo) {
        balance += line.kind === 'charge' ? line.amount : -line.amount;
      }
      rows.push({ ...line, balance });
    }

    return rows;
  }

  async create(
    tenant: TenantContext,
    dto: CreateWorkerDto,
  ): Promise<WorkerView> {
    assertDate('joinedOn', dto.joinedOn);
    await this.ownFactory(tenant.companyId, dto.factoryId);

    const saved = await this.save(() =>
      this.workers.save(
        this.workers.create({
          company: { id: tenant.companyId },
          factory: { id: dto.factoryId },
          name: dto.name,
          phone: dto.phone ?? '',
          jobTitle: dto.jobTitle ?? '',
          payType: dto.payType,
          rate: dto.rate,
          defaultJob: dto.payType === 'sqft' ? (dto.defaultJob ?? '') : '',
          openingBalance: dto.openingBalance ?? 0,
          joinedOn: dto.joinedOn,
          isActive: true,
        }),
      ),
    );

    await this.audit.record({
      actorType: 'member',
      actorId: tenant.memberId,
      action: 'worker.create',
      companyId: tenant.companyId,
      targetType: 'worker',
      targetId: saved.id,
      metadata: { payType: saved.payType },
    });

    return toView(await this.load(tenant.companyId, saved.id));
  }

  async update(
    tenant: TenantContext,
    id: string,
    dto: UpdateWorkerDto,
  ): Promise<WorkerView> {
    const current = await this.load(tenant.companyId, id);

    if (dto.joinedOn !== undefined) {
      assertDate('joinedOn', dto.joinedOn);
    }
    if (dto.factoryId !== undefined) {
      await this.ownFactory(tenant.companyId, dto.factoryId);
    }

    const payType = dto.payType ?? (current.payType as PayType);

    await this.save(() =>
      this.workers.update(
        { id, ...inCompany(tenant.companyId) },
        {
          name: dto.name ?? current.name,
          phone: dto.phone ?? current.phone,
          jobTitle: dto.jobTitle ?? current.jobTitle,
          factory: { id: dto.factoryId ?? current.factory.id },
          payType,
          rate: dto.rate ?? current.rate,
          defaultJob:
            payType === 'sqft' ? (dto.defaultJob ?? current.defaultJob) : '',
          openingBalance: dto.openingBalance ?? current.openingBalance,
          joinedOn: dto.joinedOn ?? current.joinedOn,
          isActive: dto.isActive ?? current.isActive,
        },
      ),
    );

    await this.audit.record({
      actorType: 'member',
      actorId: tenant.memberId,
      action: 'worker.update',
      companyId: tenant.companyId,
      targetType: 'worker',
      targetId: id,
      metadata: { fields: Object.keys(dto) },
    });

    return toView(await this.load(tenant.companyId, id));
  }

  // The worker a machine's thekadar name stands for. Settings keeps thekadars
  // as names, so one that has not been seen before is added here, paid per ton
  // at the default rate. Runs inside the caller's transaction.
  async thekadarByName(
    em: EntityManager,
    companyId: string,
    name: string,
    factoryId: string,
  ): Promise<{ id: string; name: string }> {
    const clean = name.trim();

    if (!clean) {
      throw invalid({ thekadarName: 'required' });
    }

    await query(
      em,
      `INSERT INTO worker ("companyId", "factoryId", name, "jobTitle", "payType", rate, "joinedOn")
       VALUES ($1, $2, $3, 'Thekadar', 'ton', $4, $5)
       ON CONFLICT ("companyId", lower(name)) DO NOTHING`,
      [companyId, factoryId, clean, DEFAULT_TON_RATE, todayAtFactory()],
    );
    const [worker] = await query<{ id: string; name: string }>(
      em,
      `SELECT id, name FROM worker WHERE "companyId" = $1 AND lower(name) = lower($2)`,
      [companyId, clean],
    );

    return worker;
  }

  // ------------------------------------------------------------- helpers

  private summarise(
    row: WorkerEntity,
    ledger: { charged: number; credited: number } | undefined,
    month: { earned: number; paid: number } | undefined,
  ): WorkerSummary {
    const earned = ledger?.charged ?? 0;
    const paid = ledger?.credited ?? 0;

    return {
      ...toView(row),
      earned,
      paid,
      monthEarned: month?.earned ?? 0,
      monthPaid: month?.paid ?? 0,
      balance: row.openingBalance + earned - paid,
    };
  }

  // What each worker earned and was paid since the first of this month.
  private async monthFigures(
    companyId: string,
    workerId?: string,
  ): Promise<Map<string, { earned: number; paid: number }>> {
    const rows = await query<{
      partyId: string;
      earned: string;
      paid: string;
    }>(
      this.workers.manager,
      `SELECT "partyId", COALESCE(SUM(charge), 0) AS earned, COALESCE(SUM(credit), 0) AS paid
       FROM party_ledger_entry
       WHERE "companyId" = $1 AND "partyType" = 'worker' AND "date" >= $2
         AND ($3::uuid IS NULL OR "partyId" = $3)
       GROUP BY "partyId"`,
      [companyId, `${todayAtFactory().slice(0, 7)}-01`, workerId ?? null],
    );

    return new Map(
      rows.map((r) => [
        r.partyId,
        { earned: toNumber(r.earned), paid: toNumber(r.paid) },
      ]),
    );
  }

  private async load(companyId: string, id: string): Promise<WorkerEntity> {
    const row = await this.workers.findOne({
      where: { id, ...inCompany(companyId) },
      relations: { factory: true },
    });

    if (!row) {
      throw notFound('id');
    }

    return row;
  }

  private async ownFactory(companyId: string, factoryId: string) {
    const factory = await this.factories.findOne({
      where: { id: factoryId, ...inCompany(companyId), isActive: true },
      select: { id: true },
    });

    if (!factory) {
      throw invalid({ factoryId: 'invalid' });
    }
  }

  // Two people saving the same name at once: the unique index decides.
  private async save<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string }).code === PG_UNIQUE_VIOLATION
      ) {
        throw conflict('DUPLICATE_NAME');
      }
      throw error;
    }
  }
}

type Details = Partial<WorkerKhataRow>;

// What a party ledger row is, by where it came from.
function rowDetails(
  sourceType: string,
  sourceId: string | null,
  note: string | null,
  entries: Map<
    string,
    {
      job: string;
      unit: 'ton' | 'sqft' | 'day';
      qty: string;
      rate: string;
      auto: boolean;
    }
  >,
  postings: Map<string, { salary: string; absentDays: number; cut: string }>,
  instalments: Map<string, { reason: string; month: string }>,
): Details {
  const base: Details = note ? { note } : {};

  if (sourceType === 'work_entry' && sourceId) {
    const work = entries.get(sourceId);

    if (work) {
      return {
        ...base,
        type: work.unit === 'day' ? 'attendance' : 'work',
        job: work.job,
        unit: work.unit,
        qty: toNumber(work.qty),
        rate: toNumber(work.rate),
        auto: work.auto,
      };
    }
  }
  if (sourceType === 'month_close' && sourceId) {
    const posting = postings.get(sourceId);

    if (posting) {
      return {
        ...base,
        type: 'salary',
        qty: toNumber(posting.salary),
        absentDays: posting.absentDays,
        cut: toNumber(posting.cut),
      };
    }
    const inst = instalments.get(sourceId);

    return {
      ...base,
      type: 'instalment',
      note: inst ? `${inst.reason || 'Loan'} · ${inst.month}` : base.note,
    };
  }
  if (sourceType === 'salary_reversal') {
    return { ...base, type: 'salary', note: 'Month reopened' };
  }
  if (sourceType === 'instalment_reversal' && sourceId) {
    const inst = instalments.get(sourceId);

    return {
      ...base,
      type: 'instalment',
      note: inst
        ? `${inst.reason || 'Loan'} · ${inst.month} reopened`
        : 'Reopened',
    };
  }

  return base;
}
