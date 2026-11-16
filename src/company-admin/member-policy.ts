import { OWNER_ROLE_KEY } from '../tenancy/permissions';

// Owner protection and who may manage whom.
//  - Nobody is invited or promoted to Owner (ownership transfer comes later).
//  - The Owner cannot be deactivated, demoted or reset by company members.
//  - Everyone else may only assign, or act on, a role that holds strictly
//    fewer permissions than their own: nobody can hand out more power than
//    they have, and a Partner cannot manage another Partner.
// The route already requires `users.manage`; these rules decide the target.

export type RoleLike = { key: string; permissions: readonly string[] };

function holdsLess(actor: RoleLike, target: RoleLike): boolean {
  const mine = new Set(actor.permissions);
  return (
    target.permissions.length < mine.size &&
    target.permissions.every((permission) => mine.has(permission))
  );
}

// Whether `actor` may give `target` to someone (invite, change role).
export function canAssign(actor: RoleLike, target: RoleLike): boolean {
  if (target.key === OWNER_ROLE_KEY) return false;
  if (actor.key === OWNER_ROLE_KEY) return true;
  return holdsLess(actor, target);
}

// Whether `actor` may act on a member who currently has the `target` role.
export function canManageTarget(actor: RoleLike, target: RoleLike): boolean {
  return canAssign(actor, target);
}
