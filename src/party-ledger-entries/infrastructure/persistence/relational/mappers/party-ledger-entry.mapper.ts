import { PartyLedgerEntry } from '../../../../domain/party-ledger-entry';

import { CompanyMapper } from '../../../../../companies/infrastructure/persistence/relational/mappers/company.mapper';

import { PartyLedgerEntryEntity } from '../entities/party-ledger-entry.entity';

export class PartyLedgerEntryMapper {
  static toDomain(raw: PartyLedgerEntryEntity): PartyLedgerEntry {
    const domainEntity = new PartyLedgerEntry();
    domainEntity.note = raw.note;

    domainEntity.sourceId = raw.sourceId;

    domainEntity.sourceType = raw.sourceType;

    domainEntity.credit = raw.credit;

    domainEntity.charge = raw.charge;

    domainEntity.partyId = raw.partyId;

    domainEntity.partyType = raw.partyType;

    domainEntity.date = raw.date;

    if (raw.company) {
      domainEntity.company = CompanyMapper.toDomain(raw.company);
    }

    domainEntity.id = raw.id;
    domainEntity.createdAt = raw.createdAt;
    domainEntity.updatedAt = raw.updatedAt;

    return domainEntity;
  }

  static toPersistence(domainEntity: PartyLedgerEntry): PartyLedgerEntryEntity {
    const persistenceEntity = new PartyLedgerEntryEntity();
    persistenceEntity.note = domainEntity.note;

    persistenceEntity.sourceId = domainEntity.sourceId;

    persistenceEntity.sourceType = domainEntity.sourceType;

    persistenceEntity.credit = domainEntity.credit;

    persistenceEntity.charge = domainEntity.charge;

    persistenceEntity.partyId = domainEntity.partyId;

    persistenceEntity.partyType = domainEntity.partyType;

    persistenceEntity.date = domainEntity.date;

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
