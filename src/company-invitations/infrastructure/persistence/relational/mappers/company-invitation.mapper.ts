import { CompanyInvitation } from '../../../../domain/company-invitation';

import { CompanyMemberMapper } from '../../../../../company-members/infrastructure/persistence/relational/mappers/company-member.mapper';

import { UserMapper } from '../../../../../users/infrastructure/persistence/relational/mappers/user.mapper';

import { CompanyRoleMapper } from '../../../../../company-roles/infrastructure/persistence/relational/mappers/company-role.mapper';

import { CompanyMapper } from '../../../../../companies/infrastructure/persistence/relational/mappers/company.mapper';

import { CompanyInvitationEntity } from '../entities/company-invitation.entity';

export class CompanyInvitationMapper {
  static toDomain(raw: CompanyInvitationEntity): CompanyInvitation {
    const domainEntity = new CompanyInvitation();
    domainEntity.acceptedAt = raw.acceptedAt;

    if (raw.invitedByMember) {
      domainEntity.invitedByMember = CompanyMemberMapper.toDomain(
        raw.invitedByMember,
      );
    } else if (raw.invitedByMember === null) {
      domainEntity.invitedByMember = null;
    }

    domainEntity.status = raw.status;

    domainEntity.expiresAt = raw.expiresAt;

    domainEntity.tokenHash = raw.tokenHash;

    if (raw.user) {
      domainEntity.user = UserMapper.toDomain(raw.user);
    } else if (raw.user === null) {
      domainEntity.user = null;
    }

    if (raw.role) {
      domainEntity.role = CompanyRoleMapper.toDomain(raw.role);
    } else if (raw.role === null) {
      domainEntity.role = null;
    }

    domainEntity.email = raw.email;

    domainEntity.phone = raw.phone;

    domainEntity.type = raw.type;

    if (raw.company) {
      domainEntity.company = CompanyMapper.toDomain(raw.company);
    }

    domainEntity.id = raw.id;
    domainEntity.createdAt = raw.createdAt;
    domainEntity.updatedAt = raw.updatedAt;

    return domainEntity;
  }

  static toPersistence(
    domainEntity: CompanyInvitation,
  ): CompanyInvitationEntity {
    const persistenceEntity = new CompanyInvitationEntity();
    persistenceEntity.acceptedAt = domainEntity.acceptedAt;

    if (domainEntity.invitedByMember) {
      persistenceEntity.invitedByMember = CompanyMemberMapper.toPersistence(
        domainEntity.invitedByMember,
      );
    } else if (domainEntity.invitedByMember === null) {
      persistenceEntity.invitedByMember = null;
    }

    persistenceEntity.status = domainEntity.status;

    persistenceEntity.expiresAt = domainEntity.expiresAt;

    persistenceEntity.tokenHash = domainEntity.tokenHash;

    if (domainEntity.user) {
      persistenceEntity.user = UserMapper.toPersistence(domainEntity.user);
    } else if (domainEntity.user === null) {
      persistenceEntity.user = null;
    }

    if (domainEntity.role) {
      persistenceEntity.role = CompanyRoleMapper.toPersistence(
        domainEntity.role,
      );
    } else if (domainEntity.role === null) {
      persistenceEntity.role = null;
    }

    persistenceEntity.email = domainEntity.email;

    persistenceEntity.phone = domainEntity.phone;

    persistenceEntity.type = domainEntity.type;

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
