import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { todayAtFactory } from '../engines/calendar-date';
import { query, toNumber } from '../engines/db';
import { conflict, forbidden, invalid, notFound } from '../engines/errors';
import { assertDate } from '../engines/guards';
import { LedgerService } from '../ledger-entries/ledger.service';
import { AuditService } from '../tenancy/audit.service';
import { TenantContext } from '../tenancy/tenant-context';
import { personName } from '../utils/person-name';
import { WorkEntriesService } from '../workers/work-entries.service';
import { WorkersService } from '../workers/workers.service';
import {
  CUSTOMER_PARTY,
  CUTTING_JOB_SOURCE,
  CuttingJobView,
  JobStatus,
  jobNo,
} from './customer.types';
import { CustomersService } from './customers.service';
import {
  FinishJobDto,
  ListJobsQueryDto,
  ReceiveJobDto,
  SendJobDto,
} from './dto/customer.dto';

type JobRow = {
  id: string;
  jobSeq: number;
  customerId: string;
  customerName: string;
  customerPhone: string;
  date: string;
  truckNo: string;
  material: string;
  tons: string;
  factoryId: string;
  factoryName: string;
  ratePerSqft: string;
  status: JobStatus;
  machineId: string | null;
  machineName: string | null;
  thekadarId: string | null;
  thekadarName: string | null;
  cutStart: string | null;
  sqft: string | null;
  outputNote: string;
  readyOn: string | null;
  deliveredOn: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
};

const SELECT = `
  SELECT j.id, j."jobSeq", j."customerId", c.name AS "customerName", c.phone AS "customerPhone",
         j."date"::text AS "date", j."truckNo", j.material, j.tons, j."factoryId", f.name AS "factoryName",
         j."ratePerSqft", j.status, j."machineId", m.name AS "machineName", j."thekadarId", w.name AS "thekadarName",
         j."cutStart"::text AS "cutStart", j.sqft, j."outputNote", j."readyOn"::text AS "readyOn",
         j."deliveredOn"::text AS "deliveredOn", u."firstName", u."lastName", u.phone, u.email
  FROM cutting_job j
  JOIN customer c ON c.id = j."customerId"
  JOIN factory f ON f.id = j."factoryId"
  LEFT JOIN machine m ON m.id = j."machineId"
  LEFT JOIN worker w ON w.id = j."thekadarId"
  JOIN company_member cm ON cm.id = j."createdById"
  JOIN "user" u ON u.id = cm."userId"`;

// A customer's own truck (rules §7c): cut on our machines and charged per
// sq.ft. Their stone never enters our stock, so no stock movement is made at
// any step. Finishing posts both sides once: the thekadar's per-ton pay and
// the customer's charge on their khata.
@Injectable()
export class CuttingJobsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly customers: CustomersService,
    private readonly workers: WorkersService,
    private readonly workEntries: WorkEntriesService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  async list(
    tenant: TenantContext,
    filters: ListJobsQueryDto,
  ): Promise<CuttingJobView[]> {
    const rows = await query<JobRow>(
      this.dataSource.manager,
      `${SELECT}
       WHERE j."companyId" = $1 AND ($2::text IS NULL OR j.status = $2) AND ($3::uuid IS NULL OR j."customerId" = $3)
       ORDER BY j."date", j."jobSeq"`,
      [tenant.companyId, filters.status ?? null, filters.customerId ?? null],
    );

    return rows.map((r) => this.view(r));
  }

  async get(tenant: TenantContext, id: string): Promise<CuttingJobView> {
    const [row] = await query<JobRow>(
      this.dataSource.manager,
      `${SELECT} WHERE j.id = $1 AND j."companyId" = $2`,
      [id, tenant.companyId],
    );

    if (!row) {
      throw notFound('id');
    }

    return this.view(row);
  }

  // The customer's truck arrives. A new customer is added from the name and
  // phone, which needs customers.create.
  async receive(
    tenant: TenantContext,
    dto: ReceiveJobDto,
  ): Promise<CuttingJobView> {
    assertDate('date', dto.date);

    if (dto.date > todayAtFactory()) {
      throw conflict('DATE_IN_FUTURE');
    }

    const id = await this.dataSource.transaction(async (em) => {
      let customerId = dto.customerId;

      if (customerId) {
        const [found] = await query<{ id: string }>(
          em,
          `SELECT id FROM customer WHERE id = $1 AND "companyId" = $2 AND "isActive"`,
          [customerId, tenant.companyId],
        );

        if (!found) {
          throw invalid({ customerId: 'invalid' });
        }
      } else {
        if (!dto.name || !dto.phone) {
          throw invalid({ customerId: 'required' });
        }
        if (!tenant.permissions.includes('customers.create')) {
          throw forbidden('CUSTOMER_CREATE_NOT_ALLOWED');
        }

        customerId = await this.customers.insert(em, tenant.companyId, {
          name: dto.name,
          phone: dto.phone,
          type: 'cutting',
        });
      }

      const [factory] = await query<{ id: string }>(
        em,
        `SELECT id FROM factory WHERE id = $1 AND "companyId" = $2 AND "isActive"`,
        [dto.factoryId, tenant.companyId],
      );

      if (!factory) {
        throw invalid({ factoryId: 'invalid' });
      }

      await em.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `cutting_job:${tenant.companyId}`,
      ]);
      const [next] = await query<{ seq: number }>(
        em,
        `SELECT COALESCE(MAX("jobSeq"), 0) + 1 AS seq FROM cutting_job WHERE "companyId" = $1`,
        [tenant.companyId],
      );
      const [row] = await query<{ id: string }>(
        em,
        `INSERT INTO cutting_job ("companyId", "jobSeq", "customerId", "factoryId", date, "truckNo", material, tons, "ratePerSqft", status, "createdById")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'received', $10)
         RETURNING id`,
        [
          tenant.companyId,
          next.seq,
          customerId,
          dto.factoryId,
          dto.date,
          dto.truckNo.toUpperCase(),
          dto.material,
          dto.tons,
          dto.ratePerSqft,
          tenant.memberId,
        ],
      );

      await this.record(em, tenant, 'cutting_job.receive', row.id, {
        jobNo: jobNo(next.seq),
      });

      return row.id;
    });

    return this.get(tenant, id);
  }

  async send(
    tenant: TenantContext,
    id: string,
    dto: SendJobDto,
  ): Promise<CuttingJobView> {
    assertDate('date', dto.date);

    await this.dataSource.transaction(async (em) => {
      const job = await this.lock(em, tenant.companyId, id);

      if (job.status !== 'received') {
        throw conflict('NOT_WAITING');
      }

      const [machine] = await query<{ id: string; factoryId: string }>(
        em,
        `SELECT id, "factoryId" FROM machine WHERE id = $1 AND "companyId" = $2 AND "isActive"`,
        [dto.machineId, tenant.companyId],
      );

      if (!machine || machine.factoryId !== job.factoryId) {
        throw conflict('MACHINE_OTHER_FACTORY');
      }

      this.assertDays(dto.date, job.date);
      const thekadar = await this.workers.thekadarByName(
        em,
        tenant.companyId,
        dto.thekadarName,
        job.factoryId,
      );

      await em.query(
        `UPDATE cutting_job SET status = 'cutting', "machineId" = $1, "thekadarId" = $2, "cutStart" = $3
         WHERE id = $4 AND "companyId" = $5`,
        [machine.id, thekadar.id, dto.date, id, tenant.companyId],
      );
      await this.record(em, tenant, 'cutting_job.send', id, {});
    });

    return this.get(tenant, id);
  }

  async finish(
    tenant: TenantContext,
    id: string,
    dto: FinishJobDto,
  ): Promise<CuttingJobView> {
    assertDate('date', dto.date);

    await this.dataSource.transaction(async (em) => {
      const job = await this.lock(em, tenant.companyId, id);

      if (job.status !== 'cutting' || !job.cutStart) {
        throw conflict('NOT_CUTTING');
      }

      this.assertDays(dto.date, job.cutStart);

      if (!(dto.sqft > 0)) {
        throw conflict('SQFT_REQUIRED');
      }
      if (!(dto.ratePerSqft > 0)) {
        throw conflict('RATE_REQUIRED');
      }

      const tons = toNumber(job.tons);

      if (job.thekadarId && (dto.ratePerTon ?? 0) > 0) {
        await this.workEntries.post(em, {
          companyId: tenant.companyId,
          memberId: tenant.memberId,
          workerId: job.thekadarId,
          date: dto.date,
          job: `${job.machineName ?? ''} cutting · ${job.customerName}`.trim(),
          unit: 'ton',
          qty: tons,
          rate: dto.ratePerTon!,
          amount: Math.round(tons * dto.ratePerTon!),
          sourceType: 'truck_cut',
          sourceId: id,
          auto: true,
        });
      }

      const charge = Math.round(dto.sqft * dto.ratePerSqft);

      if (charge > 0) {
        await this.ledger.postPartyEntry(
          {
            companyId: tenant.companyId,
            date: dto.date,
            partyType: CUSTOMER_PARTY,
            partyId: job.customerId,
            side: 'charge',
            amount: charge,
            sourceType: CUTTING_JOB_SOURCE,
            sourceId: id,
            note: `Cutting ${job.truckNo} · ${dto.sqft} sq.ft × ${dto.ratePerSqft}`,
          },
          em,
        );
      }

      await em.query(
        `UPDATE cutting_job SET status = 'ready', sqft = $1, "ratePerSqft" = $2, "outputNote" = $3, "readyOn" = $4
         WHERE id = $5 AND "companyId" = $6`,
        [
          dto.sqft,
          dto.ratePerSqft,
          dto.outputNote ?? '',
          dto.date,
          id,
          tenant.companyId,
        ],
      );
      await this.record(em, tenant, 'cutting_job.finish', id, { charge });
    });

    return this.get(tenant, id);
  }

  // The customer collects all the output. Whether they still owe is for the
  // screen to warn about.
  async deliver(tenant: TenantContext, id: string): Promise<CuttingJobView> {
    await this.dataSource.transaction(async (em) => {
      const job = await this.lock(em, tenant.companyId, id);

      if (job.status !== 'ready') {
        throw conflict('NOT_READY');
      }

      await em.query(
        `UPDATE cutting_job SET status = 'delivered', "deliveredOn" = $1 WHERE id = $2 AND "companyId" = $3`,
        [todayAtFactory(), id, tenant.companyId],
      );
      await this.record(em, tenant, 'cutting_job.deliver', id, {});
    });

    return this.get(tenant, id);
  }

  // Only while still received: nothing has been charged yet.
  async cancel(tenant: TenantContext, id: string): Promise<CuttingJobView> {
    await this.dataSource.transaction(async (em) => {
      const job = await this.lock(em, tenant.companyId, id);

      if (job.status !== 'received') {
        throw conflict('CANCEL_AFTER_START');
      }

      await em.query(
        `UPDATE cutting_job SET status = 'cancelled' WHERE id = $1 AND "companyId" = $2`,
        [id, tenant.companyId],
      );
      await this.record(em, tenant, 'cutting_job.cancel', id, {});
    });

    return this.get(tenant, id);
  }

  // ------------------------------------------------------------- helpers

  // The job, locked, so two people moving it cannot both succeed. Another
  // company's job looks like one that does not exist.
  private async lock(em: EntityManager, companyId: string, id: string) {
    const [row] = await query<{
      status: JobStatus;
      date: string;
      cutStart: string | null;
      tons: string;
      factoryId: string;
      customerId: string;
      truckNo: string;
      thekadarId: string | null;
      machineName: string | null;
      customerName: string;
    }>(
      em,
      `SELECT j.status, j."date"::text AS "date", j."cutStart"::text AS "cutStart", j.tons, j."factoryId",
              j."customerId", j."truckNo", j."thekadarId", m.name AS "machineName", c.name AS "customerName"
       FROM cutting_job j
       JOIN customer c ON c.id = j."customerId"
       LEFT JOIN machine m ON m.id = j."machineId"
       WHERE j.id = $1 AND j."companyId" = $2
       FOR UPDATE OF j`,
      [id, companyId],
    );

    if (!row) {
      throw notFound('id');
    }

    return row;
  }

  private assertDays(date: string, earliest: string) {
    if (date > todayAtFactory()) {
      throw conflict('DATE_IN_FUTURE');
    }
    if (date < earliest) {
      throw conflict('DATE_BEFORE_START');
    }
  }

  private record(
    em: EntityManager,
    tenant: TenantContext,
    action: string,
    targetId: string,
    metadata: Record<string, unknown>,
  ) {
    return this.audit.record(
      {
        actorType: 'member',
        actorId: tenant.memberId,
        action,
        companyId: tenant.companyId,
        targetType: 'cutting_job',
        targetId,
        metadata,
      },
      em,
    );
  }

  private view(row: JobRow): CuttingJobView {
    return {
      id: row.id,
      jobNo: jobNo(row.jobSeq),
      customerId: row.customerId,
      customerName: row.customerName,
      customerPhone: row.customerPhone,
      date: row.date,
      truckNo: row.truckNo,
      material: row.material,
      tons: toNumber(row.tons),
      factoryId: row.factoryId,
      factoryName: row.factoryName,
      ratePerSqft: toNumber(row.ratePerSqft),
      status: row.status,
      machineId: row.machineId,
      machineName: row.machineName,
      thekadarId: row.thekadarId,
      thekadarName: row.thekadarName,
      cutStart: row.cutStart,
      sqft: row.sqft === null ? null : toNumber(row.sqft),
      outputNote: row.outputNote,
      readyOn: row.readyOn,
      deliveredOn: row.deliveredOn,
      createdBy:
        personName({
          user: {
            firstName: row.firstName,
            lastName: row.lastName,
            phone: row.phone,
            email: row.email,
          },
        }) ?? '',
    };
  }
}
