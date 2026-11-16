import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { notFound } from '../engines/errors';
import { AuditService } from '../tenancy/audit.service';
import { TenantContext } from '../tenancy/tenant-context';
import { inCompany } from '../tenancy/tenant-scope';
import { CreateCatalogItemDto, UpdateCatalogItemDto } from './dto/settings.dto';
import { CatalogItemEntity } from './infrastructure/persistence/relational/entities/catalog-item.entity';
import { assertNameFree } from './master-helpers';
import { CatalogItemView, CatalogKind } from './settings.types';

const toView = (row: CatalogItemEntity): CatalogItemView => ({
  id: row.id,
  name: row.name,
  isActive: row.isActive,
});

// Soot sizes, counter widths and expense categories (rules §4c, §4d, §8): plain
// name lists, one table told apart by kind. Never deleted: deactivating hides.
@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(CatalogItemEntity)
    private readonly items: Repository<CatalogItemEntity>,
    private readonly audit: AuditService,
  ) {}

  async list(
    tenant: TenantContext,
    kind: CatalogKind,
    includeInactive = false,
  ): Promise<CatalogItemView[]> {
    const rows = await this.items.find({
      where: {
        ...inCompany(tenant.companyId),
        kind,
        ...(includeInactive ? {} : { isActive: true }),
      },
      order: { createdAt: 'ASC', name: 'ASC' },
    });

    return rows.map(toView);
  }

  async create(
    tenant: TenantContext,
    kind: CatalogKind,
    dto: CreateCatalogItemDto,
  ): Promise<CatalogItemView> {
    await assertNameFree(this.items, tenant.companyId, dto.name, {
      where: 'r."kind" = :kind',
      params: { kind },
    });

    const saved = await this.items.save(
      this.items.create({
        company: { id: tenant.companyId },
        kind,
        name: dto.name,
        isActive: true,
      }),
    );

    await this.record(tenant, 'catalog.create', saved.id, { kind });

    return toView(saved);
  }

  async update(
    tenant: TenantContext,
    kind: CatalogKind,
    id: string,
    dto: UpdateCatalogItemDto,
  ): Promise<CatalogItemView> {
    const current = await this.load(tenant.companyId, kind, id);

    if (dto.name !== undefined) {
      await assertNameFree(this.items, tenant.companyId, dto.name, {
        exceptId: id,
        where: 'r."kind" = :kind',
        params: { kind },
      });
    }

    await this.items.update(
      { id, ...inCompany(tenant.companyId) },
      {
        name: dto.name ?? current.name,
        isActive: dto.isActive ?? current.isActive,
      },
    );

    await this.record(tenant, 'catalog.update', id, {
      kind,
      fields: Object.keys(dto),
    });

    return toView(await this.load(tenant.companyId, kind, id));
  }

  // An id from another company, or from another list, is a plain 404.
  private async load(companyId: string, kind: CatalogKind, id: string) {
    const row = await this.items.findOne({
      where: { id, kind, ...inCompany(companyId) },
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
      targetType: 'catalog_item',
      targetId: id,
      metadata,
    });
  }
}
