import { AuditLog } from '../../../../domain/audit-log';

import { CompanyMapper } from '../../../../../companies/infrastructure/persistence/relational/mappers/company.mapper';

import { AuditLogEntity } from '../entities/audit-log.entity';

export class AuditLogMapper {
  static toDomain(raw: AuditLogEntity): AuditLog {
    const domainEntity = new AuditLog();
    domainEntity.metadata = raw.metadata;

    domainEntity.targetId = raw.targetId;

    domainEntity.targetType = raw.targetType;

    if (raw.company) {
      domainEntity.company = CompanyMapper.toDomain(raw.company);
    } else if (raw.company === null) {
      domainEntity.company = null;
    }

    domainEntity.action = raw.action;

    domainEntity.actorId = raw.actorId;

    domainEntity.actorType = raw.actorType;

    domainEntity.id = raw.id;
    domainEntity.createdAt = raw.createdAt;
    domainEntity.updatedAt = raw.updatedAt;

    return domainEntity;
  }

  static toPersistence(domainEntity: AuditLog): AuditLogEntity {
    const persistenceEntity = new AuditLogEntity();
    persistenceEntity.metadata = domainEntity.metadata;

    persistenceEntity.targetId = domainEntity.targetId;

    persistenceEntity.targetType = domainEntity.targetType;

    if (domainEntity.company) {
      persistenceEntity.company = CompanyMapper.toPersistence(
        domainEntity.company,
      );
    } else if (domainEntity.company === null) {
      persistenceEntity.company = null;
    }

    persistenceEntity.action = domainEntity.action;

    persistenceEntity.actorId = domainEntity.actorId;

    persistenceEntity.actorType = domainEntity.actorType;

    if (domainEntity.id) {
      persistenceEntity.id = domainEntity.id;
    }
    persistenceEntity.createdAt = domainEntity.createdAt;
    persistenceEntity.updatedAt = domainEntity.updatedAt;

    return persistenceEntity;
  }
}
