import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { CompanyRoleKey } from './tenancy.constants';

// Who is calling and for which company, as read from the database by
// CompanyGuard (not from the token). Always take companyId from here, never
// from a request body, query or route parameter.
export type TenantContext = {
  companyId: string;
  companyName: string;
  companySlug: string;
  memberId: string;
  userId: number;
  roleId: string;
  roleKey: CompanyRoleKey;
  roleName: string;
};

export type RequestWithTenant = Request & { tenant?: TenantContext };

export const Tenant = createParamDecorator(
  (_data: unknown, context: ExecutionContext): TenantContext => {
    const request = context.switchToHttp().getRequest<RequestWithTenant>();

    if (!request.tenant) {
      // A route that reads the tenant must be behind @CompanyAuth().
      throw new Error(
        'Tenant context missing: add @CompanyAuth() to the route',
      );
    }

    return request.tenant;
  },
);
