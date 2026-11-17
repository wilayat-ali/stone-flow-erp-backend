import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { conflict, invalid, notFound } from '../engines/errors';
import { AuditService } from '../tenancy/audit.service';
import { TenantContext } from '../tenancy/tenant-context';
import { inCompany } from '../tenancy/tenant-scope';
import { parsePieceSize } from './default-masters';
import { CreatePieceSizeDto, UpdatePieceSizeDto } from './dto/settings.dto';
import { CatalogItemEntity } from './infrastructure/persistence/relational/entities/catalog-item.entity';
import { PieceSizeEntity } from './infrastructure/persistence/relational/entities/piece-size.entity';

export type PieceSizeView = {
  id: string;
  sootTypeId: string;
  sootTypeName: string;
  label: string;
  widthInches: number;
  lengthInches: number;
  isActive: boolean;
};

const toView = (row: PieceSizeEntity): PieceSizeView => ({
  id: row.id,
  sootTypeId: row.sootType.id,
  sootTypeName: row.sootType.name,
  label: row.label,
  widthInches: row.widthInches,
  lengthInches: row.lengthInches,
  isActive: row.isActive,
});

// The sizes each soot type is cut into (rules §4c), e.g. 14 soot: 12x61,
// 12x55 ... Stock of pieces is counted per soot type and size. Never deleted:
// hiding a size only removes it from the pickers.
@Injectable()
export class PieceSizesService {
  constructor(
    @InjectRepository(PieceSizeEntity)
    private readonly sizes: Repository<PieceSizeEntity>,
    @InjectRepository(CatalogItemEntity)
    private readonly catalog: Repository<CatalogItemEntity>,
    private readonly audit: AuditService,
  ) {}

  async list(
    tenant: TenantContext,
    includeInactive = false,
  ): Promise<PieceSizeView[]> {
    const rows = await this.sizes.find({
      where: {
        ...inCompany(tenant.companyId),
        ...(includeInactive ? {} : { isActive: true }),
      },
      relations: { sootType: true },
      order: { createdAt: 'ASC', label: 'ASC' },
    });

    return rows.map(toView);
  }

  async create(
    tenant: TenantContext,
    dto: CreatePieceSizeDto,
  ): Promise<PieceSizeView> {
    const size = parsePieceSize(dto.label);

    if (!size) {
      throw invalid({ label: 'invalidSize' });
    }

    await this.assertSootType(tenant.companyId, dto.sootTypeId);

    const exists = await this.sizes.exists({
      where: {
        ...inCompany(tenant.companyId),
        sootType: { id: dto.sootTypeId },
        label: dto.label,
      },
    });

    if (exists) {
      throw conflict('DUPLICATE_NAME');
    }

    const saved = await this.sizes.save(
      this.sizes.create({
        company: { id: tenant.companyId },
        sootType: { id: dto.sootTypeId },
        label: dto.label,
        ...size,
        isActive: true,
      }),
    );

    await this.record(tenant, 'piece_size.create', saved.id);

    return toView(await this.load(tenant.companyId, saved.id));
  }

  async update(
    tenant: TenantContext,
    id: string,
    dto: UpdatePieceSizeDto,
  ): Promise<PieceSizeView> {
    const current = await this.load(tenant.companyId, id);

    await this.sizes.update(
      { id, ...inCompany(tenant.companyId) },
      { isActive: dto.isActive ?? current.isActive },
    );

    await this.record(tenant, 'piece_size.update', id);

    return toView(await this.load(tenant.companyId, id));
  }

  // Finds the size of a soot type, or adds it the first time someone counts
  // stock in it, so a new size never has to be set up first. Runs inside the
  // caller's transaction.
  async findOrCreate(
    em: EntityManager,
    companyId: string,
    sootTypeId: string,
    label: string,
  ): Promise<string> {
    const size = parsePieceSize(label);

    if (!size) {
      throw invalid({ size: 'invalidSize' });
    }

    const repo = em.getRepository(PieceSizeEntity);
    const found = await repo.findOne({
      where: { ...inCompany(companyId), sootType: { id: sootTypeId }, label },
      select: { id: true },
    });

    if (found) {
      return found.id;
    }

    const saved = await repo.save(
      repo.create({
        company: { id: companyId },
        sootType: { id: sootTypeId },
        label,
        ...size,
        isActive: true,
      }),
    );

    return saved.id;
  }

  private async assertSootType(companyId: string, id: string) {
    const ok = await this.catalog.exists({
      where: { id, ...inCompany(companyId), kind: 'soot_size' },
    });

    if (!ok) {
      throw invalid({ sootTypeId: 'invalid' });
    }
  }

  private async load(companyId: string, id: string): Promise<PieceSizeEntity> {
    const row = await this.sizes.findOne({
      where: { id, ...inCompany(companyId) },
      relations: { sootType: true },
    });

    if (!row) {
      throw notFound('id');
    }

    return row;
  }

  private record(tenant: TenantContext, action: string, id: string) {
    return this.audit.record({
      actorType: 'member',
      actorId: tenant.memberId,
      action,
      companyId: tenant.companyId,
      targetType: 'piece_size',
      targetId: id,
    });
  }
}
