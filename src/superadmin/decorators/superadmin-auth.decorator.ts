import {
  applyDecorators,
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { SuperAdminPrincipal } from '../strategies/jwt-superadmin.strategy';
import { SuperAdminRole } from '../../tenancy/tenancy.constants';

const SUPER_ADMIN_ROLES_KEY = 'superAdminRoles';

@Injectable()
export class SuperAdminRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<SuperAdminRole[]>(
      SUPER_ADMIN_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required?.length) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: SuperAdminPrincipal }>();

    if (!request.user || !required.includes(request.user.role)) {
      throw new ForbiddenException();
    }

    return true;
  }
}

// Super admin route. With no roles, any super admin or support user may call
// it; pass roles to restrict it (e.g. 'super_admin' for anything that changes data).
export const SuperAdminAuth = (...roles: SuperAdminRole[]) =>
  applyDecorators(
    ApiBearerAuth(),
    SetMetadata(SUPER_ADMIN_ROLES_KEY, roles),
    UseGuards(AuthGuard('jwt-superadmin'), SuperAdminRolesGuard),
    ApiUnauthorizedResponse({
      description: 'Missing or invalid super admin token',
    }),
    ApiForbiddenResponse({ description: 'Role not allowed' }),
  );

export const CurrentSuperAdmin = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SuperAdminPrincipal =>
    context.switchToHttp().getRequest<Request & { user: SuperAdminPrincipal }>()
      .user,
);
