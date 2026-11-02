import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuditLogEntity } from '../audit-logs/infrastructure/persistence/relational/entities/audit-log.entity';
import { CompanyEntity } from '../companies/infrastructure/persistence/relational/entities/company.entity';

export type AuditEntry = {
  actorType: 'superadmin' | 'member' | 'system';
  actorId: string;
  action: string;
  companyId?: string | null;
  targetType?: string;
  targetId?: string;
  // Never put passwords, tokens or links in here.
  metadata?: Record<string, unknown>;
};

// Who did what, when. Pass the transaction's manager so the entry commits or
// rolls back together with the change it describes.
@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly repository: Repository<AuditLogEntity>,
  ) {}

  async record(entry: AuditEntry, manager?: EntityManager): Promise<void> {
    const repository = manager
      ? manager.getRepository(AuditLogEntity)
      : this.repository;

    await repository.save(
      repository.create({
        actorType: entry.actorType,
        actorId: entry.actorId,
        action: entry.action,
        company: entry.companyId
          ? ({ id: entry.companyId } as CompanyEntity)
          : null,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
      }),
    );
  }
}
