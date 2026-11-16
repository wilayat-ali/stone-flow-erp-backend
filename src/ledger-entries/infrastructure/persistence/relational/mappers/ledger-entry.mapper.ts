import { LedgerEntry } from '../../../../domain/ledger-entry';

import { CompanyMemberMapper } from '../../../../../company-members/infrastructure/persistence/relational/mappers/company-member.mapper';

import { AccountMapper } from '../../../../../accounts/infrastructure/persistence/relational/mappers/account.mapper';

import { CompanyMapper } from '../../../../../companies/infrastructure/persistence/relational/mappers/company.mapper';

import { LedgerEntryEntity } from '../entities/ledger-entry.entity';

export class LedgerEntryMapper {
  static toDomain(raw: LedgerEntryEntity): LedgerEntry {
    const domainEntity = new LedgerEntry();
    if (raw.reversedBy) {
      domainEntity.reversedBy = LedgerEntryMapper.toDomain(raw.reversedBy);
    } else if (raw.reversedBy === null) {
      domainEntity.reversedBy = null;
    }

    if (raw.createdByMember) {
      domainEntity.createdByMember = CompanyMemberMapper.toDomain(
        raw.createdByMember,
      );
    }

    domainEntity.note = raw.note;

    domainEntity.sourceId = raw.sourceId;

    domainEntity.sourceType = raw.sourceType;

    domainEntity.partyId = raw.partyId;

    domainEntity.partyType = raw.partyType;

    domainEntity.amount = raw.amount;

    domainEntity.direction = raw.direction;

    domainEntity.date = raw.date;

    if (raw.account) {
      domainEntity.account = AccountMapper.toDomain(raw.account);
    }

    if (raw.company) {
      domainEntity.company = CompanyMapper.toDomain(raw.company);
    }

    domainEntity.id = raw.id;
    domainEntity.createdAt = raw.createdAt;
    domainEntity.updatedAt = raw.updatedAt;

    return domainEntity;
  }

  static toPersistence(domainEntity: LedgerEntry): LedgerEntryEntity {
    const persistenceEntity = new LedgerEntryEntity();
    if (domainEntity.reversedBy) {
      persistenceEntity.reversedBy = LedgerEntryMapper.toPersistence(
        domainEntity.reversedBy,
      );
    } else if (domainEntity.reversedBy === null) {
      persistenceEntity.reversedBy = null;
    }

    if (domainEntity.createdByMember) {
      persistenceEntity.createdByMember = CompanyMemberMapper.toPersistence(
        domainEntity.createdByMember,
      );
    }

    persistenceEntity.note = domainEntity.note;

    persistenceEntity.sourceId = domainEntity.sourceId;

    persistenceEntity.sourceType = domainEntity.sourceType;

    persistenceEntity.partyId = domainEntity.partyId;

    persistenceEntity.partyType = domainEntity.partyType;

    persistenceEntity.amount = domainEntity.amount;

    persistenceEntity.direction = domainEntity.direction;

    persistenceEntity.date = domainEntity.date;

    if (domainEntity.account) {
      persistenceEntity.account = AccountMapper.toPersistence(
        domainEntity.account,
      );
    }

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
