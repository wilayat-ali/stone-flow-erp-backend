import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CompanyInvitationEntity } from '../company-invitations/infrastructure/persistence/relational/entities/company-invitation.entity';
import { CompanyMemberEntity } from '../company-members/infrastructure/persistence/relational/entities/company-member.entity';
import { CompanyRoleEntity } from '../company-roles/infrastructure/persistence/relational/entities/company-role.entity';
import { AuditService } from '../tenancy/audit.service';
import {
  ALL_PERMISSIONS,
  isPermission,
  normalizePermissions,
  OWNER_ROLE_KEY,
} from '../tenancy/permissions';
import { INVITATION_STATUS } from '../tenancy/tenancy.constants';
import { TenantContext } from '../tenancy/tenant-context';
import { inCompany } from '../tenancy/tenant-scope';
import { canManageTarget } from './member-policy';
import { RoleInputDto } from './dto/role.dto';

export type RoleView = {
  key: string;
  name: string;
  description: string;
  permissions: string[];
  /** One of the five roles every company starts with. */
  builtin: boolean;
  /** Everyone who has the role (any status) plus pending invitations. */
  memberCount: number;
};

// Same shape as the rest of the API for business rules: a status plus a
// stable `code` the UI turns into a message.
const fail = (status: HttpStatus, code: string) => ({ status, code }) as const;

const NAME_MAX = 60;
const DESCRIPTION_MAX = 300;

const slug = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');

@Injectable()
export class RolesAdminService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(CompanyRoleEntity)
    private readonly roles: Repository<CompanyRoleEntity>,
    @InjectRepository(CompanyMemberEntity)
    private readonly members: Repository<CompanyMemberEntity>,
    @InjectRepository(CompanyInvitationEntity)
    private readonly invitations: Repository<CompanyInvitationEntity>,
    private readonly audit: AuditService,
  ) {}

  async list(companyId: string): Promise<RoleView[]> {
    const [roles, memberRows, invitationRows] = await Promise.all([
      this.roles.find({
        where: inCompany(companyId),
        order: { createdAt: 'ASC', name: 'ASC' },
      }),
      this.members
        .createQueryBuilder('m')
        .select('m."roleId"', 'roleId')
        .addSelect('COUNT(*)', 'count')
        .where('m."companyId" = :companyId', { companyId })
        .groupBy('m."roleId"')
        .getRawMany<{ roleId: string; count: string }>(),
      this.invitations
        .createQueryBuilder('i')
        .select('i."roleId"', 'roleId')
        .addSelect('COUNT(*)', 'count')
        .where('i."companyId" = :companyId AND i."status" = :status', {
          companyId,
          status: INVITATION_STATUS.pending,
        })
        .groupBy('i."roleId"')
        .getRawMany<{ roleId: string; count: string }>(),
    ]);

    const counts = new Map<string, number>();
    for (const row of [...memberRows, ...invitationRows]) {
      if (row.roleId) {
        counts.set(
          row.roleId,
          (counts.get(row.roleId) ?? 0) + Number(row.count),
        );
      }
    }

    return roles.map((role) => this.view(role, counts.get(role.id) ?? 0));
  }

  async create(tenant: TenantContext, dto: RoleInputDto): Promise<RoleView> {
    const data = this.validate(dto);
    this.assertHoldsAll(tenant, data.permissions);
    await this.assertNameFree(tenant.companyId, data.name);

    const role = await this.dataSource.transaction(async (em) => {
      const repo = em.getRepository(CompanyRoleEntity);
      const base = slug(data.name) || 'role';
      let key = base;

      for (
        let n = 2;
        await repo.exists({ where: { ...inCompany(tenant.companyId), key } });
        n += 1
      ) {
        key = `${base}-${n}`;
      }

      const saved = await repo.save(
        repo.create({
          company: { id: tenant.companyId },
          key,
          ...data,
          isSystem: false,
        }),
      );

      await this.audit.record(
        {
          actorType: 'member',
          actorId: tenant.memberId,
          action: 'role.create',
          companyId: tenant.companyId,
          targetType: 'role',
          targetId: saved.id,
          metadata: { key, permissions: data.permissions.length },
        },
        em,
      );

      return saved;
    });

    return this.view(role, 0);
  }

  async update(
    tenant: TenantContext,
    key: string,
    dto: RoleInputDto,
  ): Promise<RoleView> {
    const role = await this.load(tenant.companyId, key);
    this.assertEditable(tenant, role);

    const data = this.validate(dto);
    this.assertHoldsAll(tenant, data.permissions);
    await this.assertNameFree(tenant.companyId, data.name, role.id);

    const before = role.permissions;

    await this.dataSource.transaction(async (em) => {
      await em
        .getRepository(CompanyRoleEntity)
        .update({ id: role.id, ...inCompany(tenant.companyId) }, data);
      await this.audit.record(
        {
          actorType: 'member',
          actorId: tenant.memberId,
          action: 'role.update',
          companyId: tenant.companyId,
          targetType: 'role',
          targetId: role.id,
          metadata: {
            key,
            added: data.permissions.filter((p) => !before.includes(p)),
            removed: before.filter((p) => !data.permissions.includes(p)),
          },
        },
        em,
      );
    });

    const [view] = (await this.list(tenant.companyId)).filter(
      (r) => r.key === key,
    );

    return view;
  }

  async remove(tenant: TenantContext, key: string): Promise<void> {
    const role = await this.load(tenant.companyId, key);
    this.assertEditable(tenant, role);

    const inUse = await this.members.exists({
      where: { ...inCompany(tenant.companyId), role: { id: role.id } },
    });
    const pending = await this.invitations.exists({
      where: {
        ...inCompany(tenant.companyId),
        role: { id: role.id },
        status: INVITATION_STATUS.pending,
      },
    });

    if (inUse || pending) {
      throw new ConflictException(fail(HttpStatus.CONFLICT, 'ROLE_IN_USE'));
    }

    await this.dataSource.transaction(async (em) => {
      // Old (accepted, revoked, expired) invitations only keep the role as
      // history; they must not stop it from being deleted.
      await em
        .createQueryBuilder()
        .update(CompanyInvitationEntity)
        .set({ role: null })
        .where('"roleId" = :roleId AND "companyId" = :companyId', {
          roleId: role.id,
          companyId: tenant.companyId,
        })
        .execute();
      await em
        .getRepository(CompanyRoleEntity)
        .delete({ id: role.id, ...inCompany(tenant.companyId) });
      await this.audit.record(
        {
          actorType: 'member',
          actorId: tenant.memberId,
          action: 'role.delete',
          companyId: tenant.companyId,
          targetType: 'role',
          targetId: role.id,
          metadata: { key },
        },
        em,
      );
    });
  }

  // ------------------------------------------------------------- helpers

  private view(role: CompanyRoleEntity, memberCount: number): RoleView {
    return {
      key: role.key,
      name: role.name,
      description: role.description,
      permissions:
        role.key === OWNER_ROLE_KEY
          ? ALL_PERMISSIONS
          : normalizePermissions(role.permissions ?? []),
      builtin: role.isSystem,
      memberCount,
    };
  }

  // Another company's role key looks exactly like one that does not exist.
  private async load(companyId: string, key: string) {
    const role = await this.roles.findOne({
      where: { ...inCompany(companyId), key },
    });

    if (!role) {
      throw new NotFoundException(fail(HttpStatus.NOT_FOUND, 'NOT_FOUND'));
    }

    return role;
  }

  // Owner is fixed. Everyone else may only edit or delete a role that holds
  // strictly fewer permissions than their own (so never their own role).
  private assertEditable(tenant: TenantContext, role: CompanyRoleEntity) {
    if (role.key === OWNER_ROLE_KEY) {
      throw new ForbiddenException(fail(HttpStatus.FORBIDDEN, 'OWNER_LOCKED'));
    }

    if (
      !canManageTarget(
        { key: tenant.roleKey, permissions: tenant.permissions },
        role,
      )
    ) {
      throw new ForbiddenException(fail(HttpStatus.FORBIDDEN, 'FORBIDDEN'));
    }
  }

  // Nobody can hand out a permission they do not hold themselves.
  private assertHoldsAll(tenant: TenantContext, permissions: string[]) {
    if (permissions.some((p) => !tenant.permissions.includes(p as never))) {
      throw new ForbiddenException(
        fail(HttpStatus.FORBIDDEN, 'PERMISSION_NOT_HELD'),
      );
    }
  }

  private validate(dto: RoleInputDto) {
    const name = dto.name.trim();
    const description = (dto.description ?? '').trim();

    if (!name) {
      throw new BadRequestException(
        fail(HttpStatus.BAD_REQUEST, 'NAME_REQUIRED'),
      );
    }

    if (name.length > NAME_MAX || description.length > DESCRIPTION_MAX) {
      throw new BadRequestException(fail(HttpStatus.BAD_REQUEST, 'TOO_LONG'));
    }

    if (dto.permissions.some((p) => !isPermission(p))) {
      throw new BadRequestException(
        fail(HttpStatus.BAD_REQUEST, 'INVALID_PERMISSION'),
      );
    }

    const permissions: string[] = normalizePermissions(dto.permissions);

    if (permissions.length === 0) {
      throw new BadRequestException(
        fail(HttpStatus.BAD_REQUEST, 'PERMISSIONS_REQUIRED'),
      );
    }

    return { name, description, permissions };
  }

  private async assertNameFree(
    companyId: string,
    name: string,
    exceptId?: string,
  ) {
    const taken = await this.roles
      .createQueryBuilder('r')
      .where('r."companyId" = :companyId AND LOWER(r."name") = LOWER(:name)', {
        companyId,
        name,
      })
      .andWhere(exceptId ? 'r.id <> :exceptId' : '1=1', { exceptId })
      .getExists();

    if (taken) {
      throw new ConflictException(fail(HttpStatus.CONFLICT, 'NAME_TAKEN'));
    }
  }
}
