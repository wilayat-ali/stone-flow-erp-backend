import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { todayAtFactory } from '../engines/calendar-date';
import { query, toNumber } from '../engines/db';
import { conflict, notFound } from '../engines/errors';
import { assertDate } from '../engines/guards';
import { LedgerService } from '../ledger-entries/ledger.service';
import { PurchaseView } from '../purchases/purchase.types';
import { PurchasesService } from '../purchases/purchases.service';
import { AuditService } from '../tenancy/audit.service';
import { TenantContext } from '../tenancy/tenant-context';
import { WorkEntriesService } from '../workers/work-entries.service';
import { WorkersService } from '../workers/workers.service';
import {
  FinishCuttingDto,
  SendToMachineDto,
  StartCuttingDto,
} from './dto/production.dto';
import { CUTTING_CHARGE_SOURCE, FinishResult } from './production.types';

type TruckRow = {
  id: string;
  status: string;
  date: string;
  tons: string;
  factoryId: string;
  factoryKind: string;
  factoryName: string;
  factoryRate: string | null;
  mark: string | null;
  cutStart: string | null;
  machineName: string | null;
  thekadarId: string | null;
};

// Cutting a truck (rules §7): our own approved truck waits in the yard, is sent
// to a machine of its factory (or started at another cutting factory) and is
// finished once. Finishing posts what is owed for the cut exactly once: the
// thekadar earns tons x rate on their khata, or the cutting factory's supplier
// khata is charged tons x its rate.
@Injectable()
export class CuttingService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly purchases: PurchasesService,
    private readonly workers: WorkersService,
    private readonly workEntries: WorkEntriesService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  // Several trucks can be on one machine; the same thekadar completes the
  // whole truck.
  async send(
    tenant: TenantContext,
    purchaseId: string,
    dto: SendToMachineDto,
  ): Promise<PurchaseView> {
    assertDate('date', dto.date);

    await this.dataSource.transaction(async (em) => {
      const truck = await this.lockTruck(em, tenant.companyId, purchaseId);

      if (truck.status !== 'in_stock') {
        throw conflict('NOT_WAITING');
      }

      const [machine] = await query<{
        id: string;
        factoryId: string;
        name: string;
      }>(
        em,
        `SELECT id, "factoryId", name FROM machine
         WHERE id = $1 AND "companyId" = $2 AND "isActive"`,
        [dto.machineId, tenant.companyId],
      );

      if (!machine || machine.factoryId !== truck.factoryId) {
        throw conflict('MACHINE_OTHER_FACTORY');
      }

      this.assertDays(dto.date, truck.date);
      const thekadar = await this.workers.thekadarByName(
        em,
        tenant.companyId,
        dto.thekadarName,
        truck.factoryId,
      );

      await em.query(
        `UPDATE purchase
         SET status = 'cutting', "machineId" = $1, "thekadarId" = $2, "cutStart" = $3, "updatedAt" = now()
         WHERE id = $4 AND "companyId" = $5`,
        [machine.id, thekadar.id, dto.date, purchaseId, tenant.companyId],
      );
      await this.record(em, tenant, 'truck.send', purchaseId, {
        machine: machine.name,
        thekadar: thekadar.name,
      });
    });

    return this.purchases.get(tenant, purchaseId);
  }

  // At another cutting factory there is no machine: starting only sets
  // 'cutting'.
  async start(
    tenant: TenantContext,
    purchaseId: string,
    dto: StartCuttingDto,
  ): Promise<PurchaseView> {
    assertDate('date', dto.date);

    await this.dataSource.transaction(async (em) => {
      const truck = await this.lockTruck(em, tenant.companyId, purchaseId);

      if (truck.status !== 'in_stock') {
        throw conflict('NOT_WAITING');
      }
      if (truck.factoryKind !== 'cutting') {
        throw conflict('NOT_OTHER_FACTORY');
      }

      this.assertDays(dto.date, truck.date);
      await em.query(
        `UPDATE purchase SET status = 'cutting', "cutStart" = $1, "updatedAt" = now()
         WHERE id = $2 AND "companyId" = $3`,
        [dto.date, purchaseId, tenant.companyId],
      );
      await this.record(em, tenant, 'truck.start', purchaseId, {});
    });

    return this.purchases.get(tenant, purchaseId);
  }

  async finish(
    tenant: TenantContext,
    purchaseId: string,
    dto: FinishCuttingDto,
  ): Promise<FinishResult<PurchaseView>> {
    assertDate('date', dto.date);

    const paid = await this.dataSource.transaction(async (em) => {
      const truck = await this.lockTruck(em, tenant.companyId, purchaseId);

      if (truck.status !== 'cutting' || !truck.cutStart) {
        throw conflict('NOT_CUTTING');
      }

      this.assertDays(dto.date, truck.cutStart);
      const tons = toNumber(truck.tons);

      let result: FinishResult<PurchaseView>['paid'];
      let rate: number;

      if (truck.factoryKind !== 'cutting') {
        // Our own factory: the thekadar earns tons x rate.
        if (!truck.thekadarId) {
          throw conflict('NO_THEKADAR');
        }

        rate = dto.ratePerTon ?? 0;

        if (!(rate > 0)) {
          throw conflict('RATE_REQUIRED');
        }

        const amount = Math.round(tons * rate);
        const [worker] = await query<{ name: string }>(
          em,
          `SELECT name FROM worker WHERE id = $1 AND "companyId" = $2`,
          [truck.thekadarId, tenant.companyId],
        );

        await this.workEntries.post(em, {
          companyId: tenant.companyId,
          memberId: tenant.memberId,
          workerId: truck.thekadarId,
          date: dto.date,
          job: `${truck.machineName ?? ''} cutting`.trim(),
          unit: 'ton',
          qty: tons,
          rate,
          amount,
          sourceType: 'truck_cut',
          sourceId: purchaseId,
          auto: true,
        });
        result = { to: worker.name, amount, kind: 'thekadar' };
      } else {
        // Another cutting factory: its supplier khata is charged.
        const [supplier] = await query<{
          id: string;
          name: string;
          cuttingRatePerTon: string | null;
        }>(
          em,
          `SELECT id, name, "cuttingRatePerTon" FROM supplier
           WHERE "companyId" = $1 AND type = 'cutting_factory' AND "isActive"
             AND lower(trim(name)) = lower(trim($2))`,
          [tenant.companyId, truck.factoryName],
        );

        if (!supplier) {
          throw conflict('NO_CUTTING_SUPPLIER');
        }

        rate = toNumber(truck.factoryRate ?? supplier.cuttingRatePerTon);

        if (!(rate > 0)) {
          throw conflict('RATE_REQUIRED');
        }

        const amount = Math.round(tons * rate);

        await this.ledger.postPartyEntry(
          {
            companyId: tenant.companyId,
            date: dto.date,
            partyType: 'supplier',
            partyId: supplier.id,
            side: 'charge',
            amount,
            sourceType: CUTTING_CHARGE_SOURCE,
            sourceId: purchaseId,
            note: `Cutting · truck ${truck.mark ?? ''} · ${tons} t × ${rate}`,
          },
          em,
        );
        result = { to: supplier.name, amount, kind: 'cutting_factory' };
      }

      await em.query(
        `UPDATE purchase SET status = 'cut', "cutEnd" = $1, "cutRatePerTon" = $2, "updatedAt" = now()
         WHERE id = $3 AND "companyId" = $4`,
        [dto.date, rate, purchaseId, tenant.companyId],
      );
      await this.record(em, tenant, 'truck.finish', purchaseId, {
        amount: result.amount,
        kind: result.kind,
      });

      return result;
    });

    return { purchase: await this.purchases.get(tenant, purchaseId), paid };
  }

  // ------------------------------------------------------------- helpers

  // The truck row, locked, so two people moving the same truck cannot both
  // succeed. Another company's truck looks like one that does not exist.
  private async lockTruck(
    em: EntityManager,
    companyId: string,
    purchaseId: string,
  ): Promise<TruckRow> {
    const [row] = await query<TruckRow>(
      em,
      `SELECT p.id, p.status, p."date"::text AS "date", p.tons, p."factoryId",
              f.kind AS "factoryKind", f.name AS "factoryName", f."ratePerTon" AS "factoryRate",
              CASE WHEN p."markSeq" IS NULL THEN NULL ELSE p."markSeq" || '/' || p.stones END AS mark,
              p."cutStart"::text AS "cutStart", m.name AS "machineName", p."thekadarId"
       FROM purchase p
       JOIN factory f ON f.id = p."factoryId"
       LEFT JOIN machine m ON m.id = p."machineId"
       WHERE p.id = $1 AND p."companyId" = $2
       FOR UPDATE OF p`,
      [purchaseId, companyId],
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
        targetType: 'purchase',
        targetId,
        metadata,
      },
      em,
    );
  }
}
