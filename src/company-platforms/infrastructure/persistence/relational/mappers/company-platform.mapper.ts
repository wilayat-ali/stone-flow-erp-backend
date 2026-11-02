import { CompanyPlatform } from '../../../../domain/company-platform';

import { CompanyMapper } from '../../../../../companies/infrastructure/persistence/relational/mappers/company.mapper';

import { CompanyPlatformEntity } from '../entities/company-platform.entity';

export class CompanyPlatformMapper {
  static toDomain(raw: CompanyPlatformEntity): CompanyPlatform {
    const domainEntity = new CompanyPlatform();
    domainEntity.isEnabled = raw.isEnabled;

    domainEntity.platformKey = raw.platformKey;

    if (raw.company) {
      domainEntity.company = CompanyMapper.toDomain(raw.company);
    }

    domainEntity.id = raw.id;
    domainEntity.createdAt = raw.createdAt;
    domainEntity.updatedAt = raw.updatedAt;

    return domainEntity;
  }

  static toPersistence(domainEntity: CompanyPlatform): CompanyPlatformEntity {
    const persistenceEntity = new CompanyPlatformEntity();
    persistenceEntity.isEnabled = domainEntity.isEnabled;

    persistenceEntity.platformKey = domainEntity.platformKey;

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
