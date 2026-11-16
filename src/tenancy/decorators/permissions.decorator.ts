import { SetMetadata } from '@nestjs/common';
import type { Permission } from '../permissions';

export const PERMISSIONS_KEY = 'companyPermissions';

// The caller's role must hold at least one of these permissions. Needs
// @CompanyAuth() on the route. Prefer this to @CompanyRoles(): roles are
// edited by each company, permissions are what a route really needs.
export const Permissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
