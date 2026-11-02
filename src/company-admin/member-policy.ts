import { CompanyRoleKey } from '../tenancy/tenancy.constants';

// Owner protection and who may manage whom.
//  - Nobody is invited or promoted to Owner (ownership transfer comes later).
//  - The Owner cannot be deactivated, demoted or reset by company members.
//  - A Partner manages managers, munshis and viewers, never the Owner or
//    another Partner.

export function assignableRoles(actor: CompanyRoleKey): CompanyRoleKey[] {
  if (actor === 'owner') return ['partner', 'manager', 'munshi', 'viewer'];
  if (actor === 'partner') return ['manager', 'munshi', 'viewer'];
  return [];
}

export function canManageTarget(
  actor: CompanyRoleKey,
  target: CompanyRoleKey,
): boolean {
  if (target === 'owner') return false;
  if (actor === 'owner') return true;
  if (actor === 'partner') return target !== 'partner';
  return false;
}
