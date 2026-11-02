import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CompanyRoleKey } from '../tenancy.constants';
import { RequestWithTenant } from '../tenant-context';
import { COMPANY_ROLES_KEY } from '../decorators/company-roles.decorator';

@Injectable()
export class CompanyRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<CompanyRoleKey[]>(
      COMPANY_ROLES_KEY,
      [context.getClass(), context.getHandler()],
    );

    if (!required?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithTenant>();

    if (!request.tenant || !required.includes(request.tenant.roleKey)) {
      throw new ForbiddenException();
    }

    return true;
  }
}
