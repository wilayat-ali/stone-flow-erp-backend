import { assignableRoles, canManageTarget } from './member-policy';

describe('member policy', () => {
  it('should never assign the owner role', () => {
    expect(assignableRoles('owner')).not.toContain('owner');
    expect(assignableRoles('partner')).not.toContain('owner');
  });

  it('should let only the owner assign partner', () => {
    expect(assignableRoles('owner')).toContain('partner');
    expect(assignableRoles('partner')).not.toContain('partner');
  });

  it('should let manager, munshi and viewer assign nothing', () => {
    expect(assignableRoles('manager')).toEqual([]);
    expect(assignableRoles('munshi')).toEqual([]);
    expect(assignableRoles('viewer')).toEqual([]);
  });

  it('should never let anyone manage the owner', () => {
    expect(canManageTarget('owner', 'owner')).toBe(false);
    expect(canManageTarget('partner', 'owner')).toBe(false);
  });

  it('should let the owner manage everyone and a partner only roles below partner', () => {
    expect(canManageTarget('owner', 'partner')).toBe(true);
    expect(canManageTarget('partner', 'partner')).toBe(false);
    expect(canManageTarget('partner', 'munshi')).toBe(true);
    expect(canManageTarget('manager', 'munshi')).toBe(false);
  });
});
