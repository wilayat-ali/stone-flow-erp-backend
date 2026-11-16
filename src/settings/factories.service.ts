import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { conflict, notFound } from '../engines/errors';
import { AuditService } from '../tenancy/audit.service';
import { TenantContext } from '../tenancy/tenant-context';
import { inCompany } from '../tenancy/tenant-scope';
import { CreateFactoryDto, UpdateFactoryDto } from './dto/settings.dto';
import { FactoryEntity } from './infrastructure/persistence/relational/entities/factory.entity';
import { MachineEntity } from './infrastructure/persistence/relational/entities/machine.entity';
import { assertNameFree } from './master-helpers';
import { FactoryView } from './settings.types';

export function toFactoryView(row: FactoryEntity): FactoryView {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as FactoryView['kind'],
    ratePerTon: row.ratePerTon ?? null,
    isActive: row.isActive,
  };
}

// Own factories and the factories cutting is sent to (rules §4a). Never
// deleted: deactivating only hides one.
@Injectable()
export class FactoriesService {
  constructor(
    @InjectRepository(FactoryEntity)
    private readonly factories: Repository<FactoryEntity>,
    @InjectRepository(MachineEntity)
    private readonly machines: Repository<MachineEntity>,
    private readonly audit: AuditService,
  ) {}

  async list(
    tenant: TenantContext,
    includeInactive = false,
  ): Promise<FactoryView[]> {
    const rows = await this.factories.find({
      where: {
        ...inCompany(tenant.companyId),
        ...(includeInactive ? {} : { isActive: true }),
      },
      order: { createdAt: 'ASC', name: 'ASC' },
    });

    return rows.map(toFactoryView);
  }

  async create(
    tenant: TenantContext,
    dto: CreateFactoryDto,
  ): Promise<FactoryView> {
    await assertNameFree(this.factories, tenant.companyId, dto.name);

    const saved = await this.factories.save(
      this.factories.create({
        company: { id: tenant.companyId },
        name: dto.name,
        kind: dto.kind,
        ratePerTon: dto.kind === 'cutting' ? (dto.ratePerTon ?? null) : null,
        isActive: true,
      }),
    );

    await this.record(tenant, 'factory.create', saved.id, { kind: saved.kind });

    return toFactoryView(saved);
  }

  async update(
    tenant: TenantContext,
    id: string,
    dto: UpdateFactoryDto,
  ): Promise<FactoryView> {
    const current = await this.load(tenant.companyId, id);

    const kind = dto.kind ?? current.kind;
    const isActive = dto.isActive ?? current.isActive;

    if (dto.name !== undefined) {
      await assertNameFree(this.factories, tenant.companyId, dto.name, {
        exceptId: id,
      });
    }

    // Machines only belong to an own factory that is in use.
    if (kind !== 'own' || !isActive) {
      const hasMachines = await this.machines.exists({
        where: {
          ...inCompany(tenant.companyId),
          factory: { id },
          isActive: true,
        },
      });

      if (hasMachines) {
        throw conflict('FACTORY_HAS_MACHINES');
      }
    }

    await this.factories.update(
      { id, ...inCompany(tenant.companyId) },
      {
        name: dto.name ?? current.name,
        kind,
        ratePerTon:
          kind === 'cutting'
            ? dto.ratePerTon === undefined
              ? current.ratePerTon
              : dto.ratePerTon
            : null,
        isActive,
      },
    );

    await this.record(tenant, 'factory.update', id, {
      fields: Object.keys(dto),
    });

    return toFactoryView(await this.load(tenant.companyId, id));
  }

  // Another company's factory looks exactly like one that does not exist.
  async load(companyId: string, id: string): Promise<FactoryEntity> {
    const row = await this.factories.findOne({
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
      targetType: 'factory',
      targetId: id,
      metadata,
    });
  }
}
