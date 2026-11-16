import { Account } from '../../../../domain/account';

import { CompanyMapper } from '../../../../../companies/infrastructure/persistence/relational/mappers/company.mapper';

import { AccountEntity } from '../entities/account.entity';

export class AccountMapper {
  static toDomain(raw: AccountEntity): Account {
    const domainEntity = new Account();
    domainEntity.isActive = raw.isActive;

    domainEntity.openingDate = raw.openingDate;

    domainEntity.openingBalance = raw.openingBalance;

    domainEntity.last4 = raw.last4;

    domainEntity.name = raw.name;

    if (raw.company) {
      domainEntity.company = CompanyMapper.toDomain(raw.company);
    }

    domainEntity.kind = raw.kind;

    domainEntity.id = raw.id;
    domainEntity.createdAt = raw.createdAt;
    domainEntity.updatedAt = raw.updatedAt;

    return domainEntity;
  }

  static toPersistence(domainEntity: Account): AccountEntity {
    const persistenceEntity = new AccountEntity();
    persistenceEntity.isActive = domainEntity.isActive;

    persistenceEntity.openingDate = domainEntity.openingDate;

    persistenceEntity.openingBalance = domainEntity.openingBalance;

    persistenceEntity.last4 = domainEntity.last4;

    persistenceEntity.name = domainEntity.name;

    if (domainEntity.company) {
      persistenceEntity.company = CompanyMapper.toPersistence(
        domainEntity.company,
      );
    }

    persistenceEntity.kind = domainEntity.kind;

    if (domainEntity.id) {
      persistenceEntity.id = domainEntity.id;
    }
    persistenceEntity.createdAt = domainEntity.createdAt;
    persistenceEntity.updatedAt = domainEntity.updatedAt;

    return persistenceEntity;
  }
}
