import {
  ForbiddenException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CompanyMemberEntity } from '../company-members/infrastructure/persistence/relational/entities/company-member.entity';
import { CompanyRoleEntity } from '../company-roles/infrastructure/persistence/relational/entities/company-role.entity';
import { AuditService } from '../tenancy/audit.service';
import { MEMBER_STATUS } from '../tenancy/tenancy.constants';
import { inCompany } from '../tenancy/tenant-scope';
import { TenantContext } from '../tenancy/tenant-context';
import { canAssign, canManageTarget } from './member-policy';

export type MemberView = {
  memberId: string;
  userId: number | string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  roleKey: string;
  roleName: string;
  status: string;
  joinedAt: Date | null;
};

const actorRole = (tenant: TenantContext) => ({
  key: tenant.roleKey,
  permissions: tenant.permissions,
});

function unprocessable(errors: Record<string, unknown>) {
  return new UnprocessableEntityException({
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    errors,
  });
}

@Injectable()
export class MembersService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(CompanyMemberEntity)
    private readonly members: Repository<CompanyMemberEntity>,
    @InjectRepository(CompanyRoleEntity)
    private readonly roles: Repository<CompanyRoleEntity>,
    private readonly audit: AuditService,
  ) {}

  // companyId always comes from the token (tenant) or, for super admin, from
  // a company the super admin chose explicitly.
  async list(companyId: string): Promise<MemberView[]> {
    const rows = await this.members.find({
      where: inCompany(companyId),
      relations: { user: true, role: true },
      order: { createdAt: 'ASC' },
    });

    return rows.map((member) => ({
      memberId: member.id,
      userId: member.user.id,
      firstName: member.user.firstName,
      lastName: member.user.lastName,
      phone: member.user.phone ?? null,
      email: member.user.email,
      roleKey: member.role.key,
      roleName: member.role.name,
      status: member.status,
      joinedAt: member.joinedAt ?? null,
    }));
  }

  async deactivate(tenant: TenantContext, memberId: string) {
    const target = await this.loadManageableTarget(tenant, memberId);

    await this.setStatus(
      tenant,
      target,
      MEMBER_STATUS.inactive,
      'member.deactivate',
    );

    return { memberId, status: MEMBER_STATUS.inactive };
  }

  async activate(tenant: TenantContext, memberId: string) {
    const target = await this.loadManageableTarget(tenant, memberId);

    if (target.status === MEMBER_STATUS.invited) {
      throw unprocessable({ member: 'invitationPending' });
    }

    await this.setStatus(
      tenant,
      target,
      MEMBER_STATUS.active,
      'member.activate',
    );

    return { memberId, status: MEMBER_STATUS.active };
  }

  async changeRole(tenant: TenantContext, memberId: string, roleKey: string) {
    const target = await this.loadManageableTarget(tenant, memberId);

    if (roleKey === 'owner') {
      throw unprocessable({ roleKey: 'cannotAssignOwner' });
    }

    const role = await this.roles.findOne({
      where: { ...inCompany(tenant.companyId), key: roleKey },
    });

    if (!role) {
      throw unprocessable({ roleKey: 'notExists' });
    }

    if (!canAssign(actorRole(tenant), role)) {
      throw new ForbiddenException();
    }

    const previousRoleKey = target.role.key;

    await this.dataSource.transaction(async (em) => {
      await em
        .createQueryBuilder()
        .update(CompanyMemberEntity)
        .set({ role })
        .where('id = :id AND "companyId" = :companyId', {
          id: target.id,
          companyId: tenant.companyId,
        })
        .execute();
      await this.audit.record(
        {
          actorType: 'member',
          actorId: tenant.memberId,
          action: 'member.change_role',
          companyId: tenant.companyId,
          targetType: 'member',
          targetId: target.id,
          metadata: { from: previousRoleKey, to: roleKey },
        },
        em,
      );
    });

    return { memberId, roleKey };
  }

  // A member id from another company matches nothing and is a plain 404.
  private async loadManageableTarget(
    tenant: TenantContext,
    memberId: string,
  ): Promise<CompanyMemberEntity> {
    const target = await this.members.findOne({
      where: { id: memberId, ...inCompany(tenant.companyId) },
      relations: { role: true },
    });

    if (!target) {
      throw new NotFoundException();
    }

    if (target.id === tenant.memberId) {
      throw unprocessable({ member: 'cannotChangeSelf' });
    }

    if (!canManageTarget(actorRole(tenant), target.role)) {
      throw new ForbiddenException(
        target.role.key === 'owner' ? 'ownerProtected' : undefined,
      );
    }

    return target;
  }

  private async setStatus(
    tenant: TenantContext,
    target: CompanyMemberEntity,
    status: string,
    action: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (em) => {
      await em
        .createQueryBuilder()
        .update(CompanyMemberEntity)
        .set({ status })
        .where('id = :id AND "companyId" = :companyId', {
          id: target.id,
          companyId: tenant.companyId,
        })
        .execute();
      await this.audit.record(
        {
          actorType: 'member',
          actorId: tenant.memberId,
          action,
          companyId: tenant.companyId,
          targetType: 'member',
          targetId: target.id,
        },
        em,
      );
    });
  }
}
