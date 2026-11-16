import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CompanyMemberEntity } from '../../company-members/infrastructure/persistence/relational/entities/company-member.entity';
import { StatusEnum } from '../../statuses/statuses.enum';
import type { JwtPayloadType } from '../../auth/strategies/types/jwt-payload.type';
import {
  COMPANY_STATUS,
  CompanyRoleKey,
  MEMBER_STATUS,
} from '../tenancy.constants';
import {
  ALL_PERMISSIONS,
  normalizePermissions,
  OWNER_ROLE_KEY,
} from '../permissions';
import { RequestWithTenant } from '../tenant-context';

// Runs after AuthGuard('jwt'). Loads the member on every request, so removing
// a member, demoting them, blocking the user or suspending the company takes
// effect immediately and not when the token expires. The role used by the
// role guard comes from here; roleKey in the token is for the UI only.
@Injectable()
export class CompanyGuard implements CanActivate {
  constructor(
    @InjectRepository(CompanyMemberEntity)
    private readonly members: Repository<CompanyMemberEntity>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithTenant>();
    const payload = request.user as JwtPayloadType | undefined;

    if (!payload?.companyId || !payload.memberId) {
      throw new ForbiddenException('companyTokenRequired');
    }

    const member = await this.members.findOne({
      where: {
        id: payload.memberId,
        status: MEMBER_STATUS.active,
        user: {
          id: Number(payload.id),
          status: { id: StatusEnum.active },
        },
        company: { id: payload.companyId, status: COMPANY_STATUS.active },
      },
      relations: { company: true, role: true },
    });

    if (!member) {
      throw new UnauthorizedException('membershipInactive');
    }

    request.tenant = {
      companyId: member.company.id,
      companyName: member.company.name,
      companySlug: member.company.slug,
      memberId: member.id,
      userId: Number(payload.id),
      roleId: member.role.id,
      roleKey: member.role.key as CompanyRoleKey,
      roleName: member.role.name,
      permissions:
        member.role.key === OWNER_ROLE_KEY
          ? ALL_PERMISSIONS
          : normalizePermissions(member.role.permissions ?? []),
    };

    return true;
  }
}
