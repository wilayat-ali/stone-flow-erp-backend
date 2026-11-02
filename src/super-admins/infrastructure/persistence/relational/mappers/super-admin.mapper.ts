import { SuperAdmin } from '../../../../domain/super-admin';

import { SuperAdminEntity } from '../entities/super-admin.entity';

export class SuperAdminMapper {
  static toDomain(raw: SuperAdminEntity): SuperAdmin {
    const domainEntity = new SuperAdmin();
    domainEntity.lastLoginAt = raw.lastLoginAt;

    domainEntity.status = raw.status;

    domainEntity.role = raw.role;

    domainEntity.passwordHash = raw.passwordHash;

    domainEntity.email = raw.email;

    domainEntity.name = raw.name;

    domainEntity.id = raw.id;
    domainEntity.createdAt = raw.createdAt;
    domainEntity.updatedAt = raw.updatedAt;

    return domainEntity;
  }

  static toPersistence(domainEntity: SuperAdmin): SuperAdminEntity {
    const persistenceEntity = new SuperAdminEntity();
    persistenceEntity.lastLoginAt = domainEntity.lastLoginAt;

    persistenceEntity.status = domainEntity.status;

    persistenceEntity.role = domainEntity.role;

    persistenceEntity.passwordHash = domainEntity.passwordHash;

    persistenceEntity.email = domainEntity.email;

    persistenceEntity.name = domainEntity.name;

    if (domainEntity.id) {
      persistenceEntity.id = domainEntity.id;
    }
    persistenceEntity.createdAt = domainEntity.createdAt;
    persistenceEntity.updatedAt = domainEntity.updatedAt;

    return persistenceEntity;
  }
}
