import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { conflict, invalid, notFound } from '../engines/errors';
import { AuditService } from '../tenancy/audit.service';
import { TenantContext } from '../tenancy/tenant-context';
import { inCompany } from '../tenancy/tenant-scope';
import { CreateMachineDto, UpdateMachineDto } from './dto/settings.dto';
import { FactoryEntity } from './infrastructure/persistence/relational/entities/factory.entity';
import { MachineEntity } from './infrastructure/persistence/relational/entities/machine.entity';
import { assertNameFree } from './master-helpers';
import { MachineView } from './settings.types';

function toView(row: MachineEntity): MachineView {
  return {
    id: row.id,
    name: row.name,
    type: row.type as MachineView['type'],
    factoryId: row.factory.id,
    dayThekadar: row.dayThekadar,
    nightThekadar: row.nightThekadar ?? null,
    isActive: row.isActive,
  };
}

// Cutting machines, each in one of the company's own factories (rules §4b).
// Never deleted: deactivating only hides one.
@Injectable()
export class MachinesService {
  constructor(
    @InjectRepository(MachineEntity)
    private readonly machines: Repository<MachineEntity>,
    @InjectRepository(FactoryEntity)
    private readonly factories: Repository<FactoryEntity>,
    private readonly audit: AuditService,
  ) {}

  async list(
    tenant: TenantContext,
    includeInactive = false,
  ): Promise<MachineView[]> {
    const rows = await this.machines.find({
      where: {
        ...inCompany(tenant.companyId),
        ...(includeInactive ? {} : { isActive: true }),
      },
      relations: { factory: true },
      order: { createdAt: 'ASC', name: 'ASC' },
    });

    return rows.map(toView);
  }

  async create(
    tenant: TenantContext,
    dto: CreateMachineDto,
  ): Promise<MachineView> {
    const factory = await this.ownFactory(tenant.companyId, dto.factoryId);
    await assertNameFree(this.machines, tenant.companyId, dto.name);

    const saved = await this.machines.save(
      this.machines.create({
        company: { id: tenant.companyId },
        factory,
        name: dto.name,
        type: dto.type,
        dayThekadar: dto.dayThekadar,
        nightThekadar: dto.nightThekadar?.trim() || null,
        isActive: true,
      }),
    );

    await this.record(tenant, 'machine.create', saved.id, { type: saved.type });

    return toView(saved);
  }

  async update(
    tenant: TenantContext,
    id: string,
    dto: UpdateMachineDto,
  ): Promise<MachineView> {
    const current = await this.load(tenant.companyId, id);

    const factory =
      dto.factoryId && dto.factoryId !== current.factory.id
        ? await this.ownFactory(tenant.companyId, dto.factoryId)
        : current.factory;

    // Bringing a machine back is only possible while its factory is in use.
    if (dto.isActive && !current.isActive && !factory.isActive) {
      throw conflict('FACTORY_INACTIVE');
    }

    if (dto.name !== undefined) {
      await assertNameFree(this.machines, tenant.companyId, dto.name, {
        exceptId: id,
      });
    }

    await this.machines.update(
      { id, ...inCompany(tenant.companyId) },
      {
        factory,
        name: dto.name ?? current.name,
        type: dto.type ?? current.type,
        dayThekadar: dto.dayThekadar ?? current.dayThekadar,
        nightThekadar:
          dto.nightThekadar === undefined
            ? current.nightThekadar
            : dto.nightThekadar?.trim() || null,
        isActive: dto.isActive ?? current.isActive,
      },
    );

    await this.record(tenant, 'machine.update', id, {
      fields: Object.keys(dto),
    });

    return toView(await this.load(tenant.companyId, id));
  }

  // A machine only ever belongs to an own factory of this company that is in use.
  private async ownFactory(companyId: string, factoryId: string) {
    const factory = await this.factories.findOne({
      where: { id: factoryId, ...inCompany(companyId) },
    });

    if (!factory || factory.kind !== 'own' || !factory.isActive) {
      throw invalid({ factoryId: 'invalid' });
    }

    return factory;
  }

  private async load(companyId: string, id: string): Promise<MachineEntity> {
    const row = await this.machines.findOne({
      where: { id, ...inCompany(companyId) },
      relations: { factory: true },
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
      targetType: 'machine',
      targetId: id,
      metadata,
    });
  }
}
