import { Company } from '../../../../domain/company';

import { UserMapper } from '../../../../../users/infrastructure/persistence/relational/mappers/user.mapper';

import { CompanyEntity } from '../entities/company.entity';

export class CompanyMapper {
  static toDomain(raw: CompanyEntity): Company {
    const domainEntity = new Company();
    domainEntity.currency = raw.currency;

    domainEntity.parchiLanguage = raw.parchiLanguage;

    domainEntity.approvalRequired = raw.approvalRequired;

    domainEntity.ntn = raw.ntn;

    domainEntity.address = raw.address;

    domainEntity.phone = raw.phone;

    domainEntity.status = raw.status;

    domainEntity.slug = raw.slug;

    if (raw.ownerUser) {
      domainEntity.ownerUser = UserMapper.toDomain(raw.ownerUser);
    }

    domainEntity.name = raw.name;

    domainEntity.id = raw.id;
    domainEntity.createdAt = raw.createdAt;
    domainEntity.updatedAt = raw.updatedAt;

    return domainEntity;
  }

  static toPersistence(domainEntity: Company): CompanyEntity {
    const persistenceEntity = new CompanyEntity();
    persistenceEntity.currency = domainEntity.currency;

    persistenceEntity.parchiLanguage = domainEntity.parchiLanguage;

    persistenceEntity.approvalRequired = domainEntity.approvalRequired;

    persistenceEntity.ntn = domainEntity.ntn;

    persistenceEntity.address = domainEntity.address;

    persistenceEntity.phone = domainEntity.phone;

    persistenceEntity.status = domainEntity.status;

    persistenceEntity.slug = domainEntity.slug;

    if (domainEntity.ownerUser) {
      persistenceEntity.ownerUser = UserMapper.toPersistence(
        domainEntity.ownerUser,
      );
    }

    persistenceEntity.name = domainEntity.name;

    if (domainEntity.id) {
      persistenceEntity.id = domainEntity.id;
    }
    persistenceEntity.createdAt = domainEntity.createdAt;
    persistenceEntity.updatedAt = domainEntity.updatedAt;

    return persistenceEntity;
  }
}
