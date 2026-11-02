import { CompanyRole } from '../../../../domain/company-role';

import { CompanyMapper } from '../../../../../companies/infrastructure/persistence/relational/mappers/company.mapper';

import { CompanyRoleEntity } from '../entities/company-role.entity';

export class CompanyRoleMapper {
  static toDomain(raw: CompanyRoleEntity): CompanyRole {
    const domainEntity = new CompanyRole();
    domainEntity.isSystem = raw.isSystem;

    domainEntity.key = raw.key;

    domainEntity.name = raw.name;

    if (raw.company) {
      domainEntity.company = CompanyMapper.toDomain(raw.company);
    }

    domainEntity.id = raw.id;
    domainEntity.createdAt = raw.createdAt;
    domainEntity.updatedAt = raw.updatedAt;

    return domainEntity;
  }

  static toPersistence(domainEntity: CompanyRole): CompanyRoleEntity {
    const persistenceEntity = new CompanyRoleEntity();
    persistenceEntity.isSystem = domainEntity.isSystem;

    persistenceEntity.key = domainEntity.key;

    persistenceEntity.name = domainEntity.name;

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
