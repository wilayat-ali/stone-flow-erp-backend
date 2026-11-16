import { Approval } from '../../../../domain/approval';

import { CompanyMemberMapper } from '../../../../../company-members/infrastructure/persistence/relational/mappers/company-member.mapper';

import { CompanyMapper } from '../../../../../companies/infrastructure/persistence/relational/mappers/company.mapper';

import { ApprovalEntity } from '../entities/approval.entity';

export class ApprovalMapper {
  static toDomain(raw: ApprovalEntity): Approval {
    const domainEntity = new Approval();
    domainEntity.payload = raw.payload;

    domainEntity.reason = raw.reason;

    domainEntity.decidedAt = raw.decidedAt;

    if (raw.decidedByMember) {
      domainEntity.decidedByMember = CompanyMemberMapper.toDomain(
        raw.decidedByMember,
      );
    } else if (raw.decidedByMember === null) {
      domainEntity.decidedByMember = null;
    }

    if (raw.requestedByMember) {
      domainEntity.requestedByMember = CompanyMemberMapper.toDomain(
        raw.requestedByMember,
      );
    }

    domainEntity.status = raw.status;

    domainEntity.entityId = raw.entityId;

    domainEntity.entityType = raw.entityType;

    if (raw.company) {
      domainEntity.company = CompanyMapper.toDomain(raw.company);
    }

    domainEntity.id = raw.id;
    domainEntity.createdAt = raw.createdAt;
    domainEntity.updatedAt = raw.updatedAt;

    return domainEntity;
  }

  static toPersistence(domainEntity: Approval): ApprovalEntity {
    const persistenceEntity = new ApprovalEntity();
    persistenceEntity.payload = domainEntity.payload;

    persistenceEntity.reason = domainEntity.reason;

    persistenceEntity.decidedAt = domainEntity.decidedAt;

    if (domainEntity.decidedByMember) {
      persistenceEntity.decidedByMember = CompanyMemberMapper.toPersistence(
        domainEntity.decidedByMember,
      );
    } else if (domainEntity.decidedByMember === null) {
      persistenceEntity.decidedByMember = null;
    }

    if (domainEntity.requestedByMember) {
      persistenceEntity.requestedByMember = CompanyMemberMapper.toPersistence(
        domainEntity.requestedByMember,
      );
    }

    persistenceEntity.status = domainEntity.status;

    persistenceEntity.entityId = domainEntity.entityId;

    persistenceEntity.entityType = domainEntity.entityType;

    if (domainEntity.company) {
      persistenceEntity.company = CompanyMapper.toPersistence(
        domainEntity.company,
      );
    }

    if (domainEntity.id) {
      persistenceEntity.id = domainEntity.id;
    }
    persistenceEntity.createdAt = domainEntity.createdAt;
    persistenceEntity.updatedAt = domainEntity.updatedAt;

    return persistenceEntity;
  }
}
