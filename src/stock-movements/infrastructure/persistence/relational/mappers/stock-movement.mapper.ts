import { StockMovement } from '../../../../domain/stock-movement';
import { CompanyMemberMapper } from '../../../../../company-members/infrastructure/persistence/relational/mappers/company-member.mapper';

import { CompanyMapper } from '../../../../../companies/infrastructure/persistence/relational/mappers/company.mapper';

import { StockMovementEntity } from '../entities/stock-movement.entity';

export class StockMovementMapper {
  static toDomain(raw: StockMovementEntity): StockMovement {
    const domainEntity = new StockMovement();
    if (raw.createdByMember) {
      domainEntity.createdByMember = CompanyMemberMapper.toDomain(
        raw.createdByMember,
      );
    }

    domainEntity.note = raw.note;

    domainEntity.sourceId = raw.sourceId;

    domainEntity.sourceType = raw.sourceType;

    domainEntity.inches = raw.inches;

    domainEntity.qty = raw.qty;

    domainEntity.finish = raw.finish;

    domainEntity.counterWidthId = raw.counterWidthId;

    domainEntity.sootSizeId = raw.sootSizeId;

    domainEntity.sootTypeId = raw.sootTypeId;

    domainEntity.materialId = raw.materialId;

    domainEntity.itemType = raw.itemType;

    domainEntity.factoryId = raw.factoryId;

    domainEntity.date = raw.date;

    if (raw.company) {
      domainEntity.company = CompanyMapper.toDomain(raw.company);
    }

    domainEntity.id = raw.id;
    domainEntity.createdAt = raw.createdAt;
    domainEntity.updatedAt = raw.updatedAt;

    return domainEntity;
  }

  static toPersistence(domainEntity: StockMovement): StockMovementEntity {
    const persistenceEntity = new StockMovementEntity();
    if (domainEntity.createdByMember) {
      persistenceEntity.createdByMember = CompanyMemberMapper.toPersistence(
        domainEntity.createdByMember,
      );
    }

    persistenceEntity.note = domainEntity.note;

    persistenceEntity.sourceId = domainEntity.sourceId;

    persistenceEntity.sourceType = domainEntity.sourceType;

    persistenceEntity.inches = domainEntity.inches;

    persistenceEntity.qty = domainEntity.qty;

    persistenceEntity.finish = domainEntity.finish;

    persistenceEntity.counterWidthId = domainEntity.counterWidthId;

    persistenceEntity.sootSizeId = domainEntity.sootSizeId;

    persistenceEntity.sootTypeId = domainEntity.sootTypeId;

    persistenceEntity.materialId = domainEntity.materialId;

    persistenceEntity.itemType = domainEntity.itemType;

    persistenceEntity.factoryId = domainEntity.factoryId;

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
