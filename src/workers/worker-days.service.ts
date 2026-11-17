import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { todayAtFactory } from '../engines/calendar-date';
import { query, toNumber } from '../engines/db';
import { conflict, invalid } from '../engines/errors';
import { assertDate } from '../engines/guards';
import { AuditService } from '../tenancy/audit.service';
import { TenantContext } from '../tenancy/tenant-context';
import { assertMonthOpen } from '../month-close/month-lock';
import { WorkEntriesService } from './work-entries.service';
import { WorkerView, PayType } from './worker.types';

export type AttendanceRowView = { worker: WorkerView; present: boolean };
export type AttendanceSheetView = {
  date: string;
  saved: boolean;
  rows: AttendanceRowView[];
};

export type RegisterRowView = {
  workerId: string;
  workerName: string;
  job: string;
  rate: number;
  /** Feet typed in the register for the day. */
  feet: number;
  /** Feet production already credited that day; shown locked. */
  autoFeet: number;
  autoAmount: number;
};
export type RegisterSheetView = { date: string; rows: RegisterRowView[] };

type WorkerRow = {
  id: string;
  name: string;
  phone: string;
  jobTitle: string;
  factoryId: string;
  payType: PayType;
  rate: string;
  defaultJob: string;
  openingBalance: string;
  joinedOn: string;
  isActive: boolean;
};

const MAX_FEET = 1_000_000;

// The attendance and the work register (rules §8). A daily worker is paid his
// rate for every saved day he was present; a sq.ft worker is paid for the feet
// typed for the day. Each is one work entry per worker per day, so saving a day
// again changes it instead of paying twice.
@Injectable()
export class WorkerDaysService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly workEntries: WorkEntriesService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------- attendance

  // Daily and monthly workers who had joined by that day. Everyone is present
  // unless listed as absent; there are no half-days.
  async attendance(
    tenant: TenantContext,
    date: string,
  ): Promise<AttendanceSheetView> {
    assertDate('date', date);
    const [day] = await query<{ id: string }>(
      this.dataSource.manager,
      `SELECT id FROM attendance_day WHERE "companyId" = $1 AND date = $2`,
      [tenant.companyId, date],
    );
    const absent = new Set<string>();

    if (day) {
      const rows = await query<{ workerId: string }>(
        this.dataSource.manager,
        `SELECT "workerId" FROM attendance_absence WHERE "dayId" = $1`,
        [day.id],
      );
      rows.forEach((r) => absent.add(r.workerId));
    }

    const roll = await this.onRoll(
      this.dataSource.manager,
      tenant.companyId,
      date,
    );

    return {
      date,
      saved: !!day,
      rows: roll.map((worker) => ({ worker, present: !absent.has(worker.id) })),
    };
  }

  // Saving the day is what lets daily workers earn. Saving again replaces the
  // earlier day: a worker newly marked absent loses that day's pay, and one
  // newly present earns it.
  async saveAttendance(
    tenant: TenantContext,
    dto: { date: string; absentIds: string[] },
  ): Promise<AttendanceSheetView> {
    assertDate('date', dto.date);

    if (dto.date > todayAtFactory()) {
      throw conflict('FUTURE_DATE');
    }

    await this.dataSource.transaction(async (em) => {
      await assertMonthOpen(em, tenant.companyId, dto.date);
      const roll = await this.onRoll(em, tenant.companyId, dto.date);
      const onRollIds = new Set(roll.map((w) => w.id));

      for (const id of dto.absentIds) {
        if (!onRollIds.has(id)) {
          throw invalid({ absentIds: 'notOnRoll' });
        }
      }

      await em.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `attendance:${tenant.companyId}:${dto.date}`,
      ]);
      const [day] = await query<{ id: string }>(
        em,
        `INSERT INTO attendance_day ("companyId", date, "savedById")
         VALUES ($1, $2, $3)
         ON CONFLICT ("companyId", date) DO UPDATE SET "savedById" = EXCLUDED."savedById"
         RETURNING id`,
        [tenant.companyId, dto.date, tenant.memberId],
      );

      await em.query(`DELETE FROM attendance_absence WHERE "dayId" = $1`, [
        day.id,
      ]);
      for (const workerId of new Set(dto.absentIds)) {
        await em.query(
          `INSERT INTO attendance_absence ("companyId", "dayId", "workerId") VALUES ($1, $2, $3)`,
          [tenant.companyId, day.id, workerId],
        );
      }

      for (const worker of roll.filter((w) => w.payType === 'day')) {
        const sourceId = `${worker.id}:${dto.date}`;
        const absent = dto.absentIds.includes(worker.id);

        if (absent) {
          await this.workEntries.reverseBySource(em, {
            companyId: tenant.companyId,
            sourceType: 'attendance',
            sourceId,
            date: dto.date,
          });
        } else {
          await this.workEntries.post(em, {
            companyId: tenant.companyId,
            memberId: tenant.memberId,
            workerId: worker.id,
            date: dto.date,
            job: worker.jobTitle || 'Attendance',
            unit: 'day',
            qty: 1,
            rate: worker.rate,
            amount: Math.round(worker.rate),
            sourceType: 'attendance',
            sourceId,
            auto: true,
          });
        }
      }

      await this.audit.record(
        {
          actorType: 'member',
          actorId: tenant.memberId,
          action: 'attendance.save',
          companyId: tenant.companyId,
          targetType: 'attendance_day',
          targetId: day.id,
          metadata: { date: dto.date, absent: dto.absentIds.length },
        },
        em,
      );
    });

    return this.attendance(tenant, dto.date);
  }

  // The days saved in a month, and how many days each worker was absent.
  async attendanceSummary(
    tenant: TenantContext,
    month: string,
  ): Promise<{ savedDays: number; absent: Record<string, number> }> {
    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw invalid({ month: 'invalid' });
    }
    const em = this.dataSource.manager;
    const [days] = await query<{ count: string }>(
      em,
      `SELECT COUNT(*) AS count FROM attendance_day WHERE "companyId" = $1 AND to_char(date, 'YYYY-MM') = $2`,
      [tenant.companyId, month],
    );
    const rows = await query<{ workerId: string; count: string }>(
      em,
      `SELECT a."workerId", COUNT(*) AS count
       FROM attendance_absence a JOIN attendance_day d ON d.id = a."dayId"
       WHERE d."companyId" = $1 AND to_char(d.date, 'YYYY-MM') = $2
       GROUP BY a."workerId"`,
      [tenant.companyId, month],
    );

    return {
      savedDays: toNumber(days.count),
      absent: Object.fromEntries(
        rows.map((r) => [r.workerId, toNumber(r.count)]),
      ),
    };
  }

  // ------------------------------------------------------------- work register

  // The sq.ft workers for a day: what was typed, and what production already
  // credited that day (shown locked).
  async register(
    tenant: TenantContext,
    date: string,
  ): Promise<RegisterSheetView> {
    assertDate('date', date);
    const em = this.dataSource.manager;
    const workers = await query<WorkerRow>(
      em,
      `${WORKER_SELECT} WHERE w."companyId" = $1 AND w."payType" = 'sqft' AND w."isActive" ORDER BY w."createdAt", w.name`,
      [tenant.companyId],
    );
    const sums = await query<{
      workerId: string;
      sourceType: string;
      qty: string;
      amount: string;
    }>(
      em,
      `SELECT "workerId", "sourceType", COALESCE(SUM(qty), 0) AS qty, COALESCE(SUM(amount), 0) AS amount
       FROM work_entry
       WHERE "companyId" = $1 AND date = $2 AND unit = 'sqft' AND "reversedAt" IS NULL
       GROUP BY "workerId", "sourceType"`,
      [tenant.companyId, date],
    );
    const rateCard = await this.rateCard(em, tenant.companyId);

    return {
      date,
      rows: workers.map((w) => {
        const typed = sums.find(
          (s) => s.workerId === w.id && s.sourceType === 'register',
        );
        const auto = sums.filter(
          (s) => s.workerId === w.id && s.sourceType === 'production',
        );

        return {
          workerId: w.id,
          workerName: w.name,
          job: w.defaultJob || w.jobTitle,
          rate: this.effectiveRate(w, rateCard),
          feet: toNumber(typed?.qty),
          autoFeet: auto.reduce((s, a) => s + toNumber(a.qty), 0),
          autoAmount: auto.reduce((s, a) => s + toNumber(a.amount), 0),
        };
      }),
    };
  }

  // One entry per worker for the day: the feet typed (0 takes the day back).
  async saveRegister(
    tenant: TenantContext,
    dto: { date: string; rows: { workerId: string; feet: number }[] },
  ): Promise<RegisterSheetView> {
    assertDate('date', dto.date);

    if (dto.date > todayAtFactory()) {
      throw conflict('FUTURE_DATE');
    }

    await this.dataSource.transaction(async (em) => {
      await assertMonthOpen(em, tenant.companyId, dto.date);
      const workers = await query<WorkerRow>(
        em,
        `${WORKER_SELECT} WHERE w."companyId" = $1 AND w."payType" = 'sqft' AND w."isActive"`,
        [tenant.companyId],
      );
      const rateCard = await this.rateCard(em, tenant.companyId);

      for (const row of dto.rows) {
        const worker = workers.find((w) => w.id === row.workerId);

        if (!worker) {
          throw invalid({ workerId: 'invalid' });
        }
        if (!(row.feet >= 0 && row.feet <= MAX_FEET)) {
          throw invalid({ feet: 'invalid' });
        }

        const sourceId = `${dto.date}:${worker.id}`;

        await this.workEntries.reverseBySource(em, {
          companyId: tenant.companyId,
          sourceType: 'register',
          sourceId,
          date: dto.date,
        });

        if (row.feet > 0) {
          const rate = this.effectiveRate(worker, rateCard);

          await this.workEntries.post(em, {
            companyId: tenant.companyId,
            memberId: tenant.memberId,
            workerId: worker.id,
            date: dto.date,
            job: worker.defaultJob || worker.jobTitle,
            unit: 'sqft',
            qty: row.feet,
            rate,
            amount: Math.round(row.feet * rate),
            sourceType: 'register',
            sourceId,
            auto: false,
          });
        }
      }

      await this.audit.record(
        {
          actorType: 'member',
          actorId: tenant.memberId,
          action: 'work_register.save',
          companyId: tenant.companyId,
          targetType: 'work_register',
          targetId: dto.date,
          metadata: { rows: dto.rows.length },
        },
        em,
      );
    });

    return this.register(tenant, dto.date);
  }

  // ------------------------------------------------------------- helpers

  // Daily and monthly workers who had joined by that day.
  private onRoll(
    em: EntityManager,
    companyId: string,
    date: string,
  ): Promise<WorkerView[]> {
    return query<WorkerRow>(
      em,
      `${WORKER_SELECT} WHERE w."companyId" = $1 AND w."isActive" AND w."payType" IN ('day', 'month')
         AND w."joinedOn" <= $2 ORDER BY w."createdAt", w.name`,
      [companyId, date],
    ).then((rows) => rows.map(toWorker));
  }

  private async rateCard(em: EntityManager, companyId: string) {
    const rows = await query<{ name: string; rate: string }>(
      em,
      `SELECT name, rate FROM worker_rate WHERE "companyId" = $1 AND "isActive"`,
      [companyId],
    );

    return new Map(rows.map((r) => [r.name.toLowerCase(), toNumber(r.rate)]));
  }

  // A sq.ft worker without his own rate is paid by the job rate card.
  private effectiveRate(
    worker: Pick<WorkerRow, 'rate' | 'defaultJob'>,
    rateCard: Map<string, number>,
  ): number {
    const own = toNumber(worker.rate);

    return own > 0 ? own : (rateCard.get(worker.defaultJob.toLowerCase()) ?? 0);
  }
}

const WORKER_SELECT = `SELECT w.id, w.name, w.phone, w."jobTitle", w."factoryId", w."payType", w.rate, w."defaultJob",
  w."openingBalance", w."joinedOn"::text AS "joinedOn", w."isActive"
  FROM worker w`;

const toWorker = (row: WorkerRow): WorkerView => ({
  id: row.id,
  name: row.name,
  phone: row.phone,
  jobTitle: row.jobTitle,
  factoryId: row.factoryId,
  payType: row.payType,
  rate: toNumber(row.rate),
  defaultJob: row.defaultJob,
  openingBalance: toNumber(row.openingBalance),
  joinedOn: row.joinedOn,
  isActive: row.isActive,
});
