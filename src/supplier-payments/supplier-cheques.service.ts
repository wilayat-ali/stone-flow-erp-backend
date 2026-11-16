import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { todayAtFactory } from '../engines/calendar-date';
import { query, toNumber } from '../engines/db';
import { conflict, invalid, notFound } from '../engines/errors';
import { assertDate } from '../engines/guards';
import { LedgerService } from '../ledger-entries/ledger.service';
import { AuditService } from '../tenancy/audit.service';
import { TenantContext } from '../tenancy/tenant-context';
import { inCompany } from '../tenancy/tenant-scope';
import { BounceChequeDto } from './dto/supplier-payment.dto';
import { SupplierChequeEntity } from './infrastructure/persistence/relational/entities/supplier-cheque.entity';
import {
  CHEQUE_CHARGE_SOURCE,
  CHEQUE_CLEAR_SOURCE,
  CHEQUE_RETURN_SOURCE,
  ChequeStatus,
  ChequeView,
} from './supplier-payment.types';

type Locked = {
  id: string;
  no: string;
  accountId: string;
  supplierId: string;
  amount: string;
  issuedOn: string;
  status: ChequeStatus;
  paymentStatus: string;
};

function toView(row: SupplierChequeEntity): ChequeView {
  return {
    id: row.id,
    no: row.no,
    accountId: row.account.id,
    accountName: row.account.name,
    supplierId: row.supplier.id,
    supplierName: row.supplier.name,
    amount: row.amount,
    issuedOn: row.issuedOn,
    chequeDate: row.chequeDate,
    status: row.status as ChequeStatus,
    statusDate: row.statusDate ?? null,
    reason: row.reason ?? null,
    charge: row.charge,
    paymentId: row.payment.id,
    replacedByPaymentId: row.replacedByPayment?.id ?? null,
  };
}

// Cheques given to suppliers (rules §6). The supplier was credited when the
// cheque was given. Now one of three things happens:
//  - it clears: the money leaves the bank;
//  - it bounces: the amount is owed again, and the bank's charge (if any)
//    leaves the account;
//  - the supplier returns it unused: the amount is owed again.
// A cheque can only be decided once, and only after its payment was confirmed.
@Injectable()
export class SupplierChequesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(SupplierChequeEntity)
    private readonly cheques: Repository<SupplierChequeEntity>,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  async list(tenant: TenantContext): Promise<ChequeView[]> {
    const rows = await this.cheques.find({
      where: inCompany(tenant.companyId),
      relations: {
        account: true,
        supplier: true,
        payment: true,
        replacedByPayment: true,
      },
      order: { chequeDate: 'ASC', createdAt: 'ASC' },
    });

    return rows.map(toView);
  }

  // The money left the bank.
  async clear(
    tenant: TenantContext,
    id: string,
    date: string,
  ): Promise<ChequeView> {
    assertDate('date', date);

    await this.dataSource.transaction(async (em) => {
      const cheque = await this.lock(em, tenant.companyId, id);
      this.assertDay(date, cheque.issuedOn);

      await this.ledger.post(
        {
          companyId: tenant.companyId,
          accountId: cheque.accountId,
          date,
          direction: 'out',
          amount: toNumber(cheque.amount),
          partyType: 'supplier',
          partyId: cheque.supplierId,
          sourceType: CHEQUE_CLEAR_SOURCE,
          sourceId: cheque.id,
          note: `Cheque no. ${cheque.no} cleared`,
          createdByMemberId: tenant.memberId,
        },
        em,
      );
      await this.setStatus(em, tenant.companyId, id, 'cleared', date);
      await this.record(em, tenant, 'supplier_cheque.clear', id);
    });

    return this.get(tenant, id);
  }

  // The amount is owed again: a charge goes back on the khata (the original
  // payment row stays), and the bank's charge, if any, leaves the account.
  async bounce(
    tenant: TenantContext,
    id: string,
    dto: BounceChequeDto,
  ): Promise<ChequeView> {
    assertDate('date', dto.date);

    await this.dataSource.transaction(async (em) => {
      const cheque = await this.lock(em, tenant.companyId, id);
      this.assertDay(dto.date, cheque.issuedOn);
      const charge = dto.charge ?? 0;

      await this.owedAgain(em, tenant, cheque, dto.date, 'bounced');

      if (charge > 0) {
        await this.ledger.post(
          {
            companyId: tenant.companyId,
            accountId: cheque.accountId,
            date: dto.date,
            direction: 'out',
            amount: charge,
            sourceType: CHEQUE_CHARGE_SOURCE,
            sourceId: cheque.id,
            note: `Bank charge · cheque no. ${cheque.no} bounced`,
            createdByMemberId: tenant.memberId,
          },
          em,
        );
      }

      await this.setStatus(em, tenant.companyId, id, 'bounced', dto.date, {
        reason: dto.reason?.trim() || null,
        charge,
      });
      await this.record(em, tenant, 'supplier_cheque.bounce', id);
    });

    return this.get(tenant, id);
  }

  // The supplier returned it unused.
  async cancel(tenant: TenantContext, id: string): Promise<ChequeView> {
    await this.dataSource.transaction(async (em) => {
      const cheque = await this.lock(em, tenant.companyId, id);
      const today = todayAtFactory();

      await this.owedAgain(em, tenant, cheque, today, 'cancelled');
      await this.setStatus(em, tenant.companyId, id, 'cancelled', today);
      await this.record(em, tenant, 'supplier_cheque.cancel', id);
    });

    return this.get(tenant, id);
  }

  // ------------------------------------------------------------- helpers

  async get(tenant: TenantContext, id: string): Promise<ChequeView> {
    const row = await this.cheques.findOne({
      where: { id, ...inCompany(tenant.companyId) },
      relations: {
        account: true,
        supplier: true,
        payment: true,
        replacedByPayment: true,
      },
    });

    if (!row) {
      throw notFound('id');
    }

    return toView(row);
  }

  // Locked, so two people cannot decide the same cheque at once.
  private async lock(
    em: EntityManager,
    companyId: string,
    id: string,
  ): Promise<Locked> {
    const [cheque] = await query<Locked>(
      em,
      `SELECT c.id, c.no, c."accountId", c."supplierId", c.amount,
              c."issuedOn"::text AS "issuedOn", c.status,
              p.status AS "paymentStatus"
       FROM supplier_cheque c
       JOIN supplier_payment p ON p.id = c."paymentId"
       WHERE c.id = $1 AND c."companyId" = $2
       FOR UPDATE OF c`,
      [id, companyId],
    );

    if (!cheque) {
      throw notFound('id');
    }
    if (cheque.status !== 'issued') {
      throw conflict('ALREADY_DECIDED');
    }
    // Its payment has not counted yet: confirm or reject that first.
    if (cheque.paymentStatus !== 'confirmed') {
      throw conflict('PAYMENT_PENDING');
    }

    return cheque;
  }

  // Not before the day it was handed over, and not in the future.
  private assertDay(date: string, issuedOn: string) {
    if (date > todayAtFactory()) {
      throw invalid({ date: 'futureDate' });
    }
    if (date < issuedOn) {
      throw invalid({ date: 'beforeIssued' });
    }
  }

  private async owedAgain(
    em: EntityManager,
    tenant: TenantContext,
    cheque: Locked,
    date: string,
    what: 'bounced' | 'cancelled',
  ) {
    await this.ledger.postPartyEntry(
      {
        companyId: tenant.companyId,
        date,
        partyType: 'supplier',
        partyId: cheque.supplierId,
        side: 'charge',
        amount: toNumber(cheque.amount),
        sourceType: CHEQUE_RETURN_SOURCE,
        sourceId: cheque.id,
        note: `Cheque no. ${cheque.no} ${what}`,
      },
      em,
    );
  }

  private async setStatus(
    em: EntityManager,
    companyId: string,
    id: string,
    status: ChequeStatus,
    date: string,
    extra: { reason?: string | null; charge?: number } = {},
  ) {
    await em.query(
      `UPDATE supplier_cheque
       SET status = $1, "statusDate" = $2, reason = COALESCE($3, reason),
           charge = COALESCE($4, charge), "updatedAt" = now()
       WHERE id = $5 AND "companyId" = $6`,
      [status, date, extra.reason ?? null, extra.charge ?? null, id, companyId],
    );
  }

  private record(
    em: EntityManager,
    tenant: TenantContext,
    action: string,
    id: string,
  ) {
    return this.audit.record(
      {
        actorType: 'member',
        actorId: tenant.memberId,
        action,
        companyId: tenant.companyId,
        targetType: 'supplier_cheque',
        targetId: id,
      },
      em,
    );
  }
}
