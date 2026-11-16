import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { notFound } from '../engines/errors';
import { AuditService } from '../tenancy/audit.service';
import { TenantContext } from '../tenancy/tenant-context';
import { inCompany } from '../tenancy/tenant-scope';
import { CreateWorkerRateDto, UpdateWorkerRateDto } from './dto/settings.dto';
import { WorkerRateEntity } from './infrastructure/persistence/relational/entities/worker-rate.entity';
import { assertNameFree } from './master-helpers';
import { WorkerRateView } from './settings.types';

const toView = (row: WorkerRateEntity): WorkerRateView => ({
  id: row.id,
  name: row.name,
  payType: row.payType as WorkerRateView['payType'],
  rate: row.rate,
  isActive: row.isActive,
});

// The rate card (rules §4e): a job or role, how it is paid and the rate.
// Never deleted: deactivating only hides one.
@Injectable()
export class WorkerRatesService {
  constructor(
    @InjectRepository(WorkerRateEntity)
    private readonly rates: Repository<WorkerRateEntity>,
    private readonly audit: AuditService,
  ) {}

  async list(
    tenant: TenantContext,
    includeInactive = false,
  ): Promise<WorkerRateView[]> {
    const rows = await this.rates.find({
      where: {
        ...inCompany(tenant.companyId),
        ...(includeInactive ? {} : { isActive: true }),
      },
      order: { createdAt: 'ASC', name: 'ASC' },
    });

    return rows.map(toView);
  }

  async create(
    tenant: TenantContext,
    dto: CreateWorkerRateDto,
  ): Promise<WorkerRateView> {
    await assertNameFree(this.rates, tenant.companyId, dto.name);

    const saved = await this.rates.save(
      this.rates.create({
        company: { id: tenant.companyId },
        name: dto.name,
        payType: dto.payType,
        rate: dto.rate,
        isActive: true,
      }),
    );

    await this.record(tenant, 'worker_rate.create', saved.id, {
      payType: saved.payType,
    });

    return toView(saved);
  }

  async update(
    tenant: TenantContext,
    id: string,
    dto: UpdateWorkerRateDto,
  ): Promise<WorkerRateView> {
    const current = await this.load(tenant.companyId, id);

    if (dto.name !== undefined) {
      await assertNameFree(this.rates, tenant.companyId, dto.name, {
        exceptId: id,
      });
    }

    await this.rates.update(
      { id, ...inCompany(tenant.companyId) },
      {
        name: dto.name ?? current.name,
        payType: dto.payType ?? current.payType,
        rate: dto.rate ?? current.rate,
        isActive: dto.isActive ?? current.isActive,
      },
    );

    await this.record(tenant, 'worker_rate.update', id, {
      fields: Object.keys(dto),
    });

    return toView(await this.load(tenant.companyId, id));
  }

  private async load(companyId: string, id: string) {
    const row = await this.rates.findOne({
      where: { id, ...inCompany(companyId) },
    });

    if (!row) {
      throw notFound('id');
    }

    return row;
  }

  private record(
    tenant: TenantContext,
    action: string,
    id: string,
    metadata: Record<string, unknown>,
  ) {
    return this.audit.record({
      actorType: 'member',
      actorId: tenant.memberId,
      action,
      companyId: tenant.companyId,
      targetType: 'worker_rate',
      targetId: id,
      metadata,
    });
  }
}
