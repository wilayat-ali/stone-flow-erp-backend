import { SetMetadata } from '@nestjs/common';
import { CompanyRoleKey } from '../tenancy.constants';

export const COMPANY_ROLES_KEY = 'companyRoles';

// Allowed company roles for a route. Needs @CompanyAuth() on the route.
export const CompanyRoles = (...roles: CompanyRoleKey[]) =>
  SetMetadata(COMPANY_ROLES_KEY, roles);
