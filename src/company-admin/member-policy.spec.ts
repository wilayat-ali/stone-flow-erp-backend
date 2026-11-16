import { DEFAULT_ROLE_PERMISSIONS } from '../tenancy/permissions';
import { canAssign, canManageTarget, RoleLike } from './member-policy';

const role = (key: string): RoleLike => ({
  key,
  permissions: DEFAULT_ROLE_PERMISSIONS[key],
});

const owner = role('owner');
const partner = role('partner');
const manager = role('manager');
const munshi = role('munshi');
const viewer = role('viewer');

describe('member policy', () => {
  it('should never assign the owner role', () => {
    expect(canAssign(owner, owner)).toBe(false);
    expect(canAssign(partner, owner)).toBe(false);
  });

  it('should let only the owner assign partner', () => {
    expect(canAssign(owner, partner)).toBe(true);
    expect(canAssign(partner, partner)).toBe(false);
  });

  it('should let a partner assign roles that hold less than a partner', () => {
    expect(canAssign(partner, manager)).toBe(true);
    expect(canAssign(partner, munshi)).toBe(true);
    expect(canAssign(partner, viewer)).toBe(true);
  });

  it('should not let a role assign one that holds more, or the same', () => {
    expect(canAssign(manager, partner)).toBe(false);
    expect(canAssign(manager, manager)).toBe(false);
    expect(canAssign(viewer, munshi)).toBe(false);
  });

  it('should treat a custom role like any other, by what it can do', () => {
    const accountant: RoleLike = {
      key: 'accountant',
      permissions: ['dashboard.view', 'expenses.view', 'users.manage'],
    };
    const bookkeeper: RoleLike = {
      key: 'bookkeeper',
      permissions: ['dashboard.view', 'expenses.view'],
    };
    const outsider: RoleLike = {
      key: 'outsider',
      permissions: ['dashboard.view', 'sales.view'],
    };

    expect(canAssign(accountant, bookkeeper)).toBe(true);
    // Holding less in number is not enough: it must be a subset.
    expect(canAssign(accountant, outsider)).toBe(false);
    expect(canAssign(bookkeeper, accountant)).toBe(false);
  });

  it('should never let anyone manage the owner', () => {
    expect(canManageTarget(owner, owner)).toBe(false);
    expect(canManageTarget(partner, owner)).toBe(false);
  });

  it('should let the owner manage everyone and a partner only roles below partner', () => {
    expect(canManageTarget(owner, partner)).toBe(true);
    expect(canManageTarget(partner, partner)).toBe(false);
    expect(canManageTarget(partner, munshi)).toBe(true);
    expect(canManageTarget(manager, munshi)).toBe(true);
    expect(canManageTarget(munshi, manager)).toBe(false);
  });
});
