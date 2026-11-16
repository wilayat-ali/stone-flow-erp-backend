import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  isPermission,
  normalizePermissions,
} from './permissions';
import { COMPANY_ROLE_KEYS } from './tenancy.constants';

describe('permissions', () => {
  it('should list each permission once as module.action', () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
    expect(ALL_PERMISSIONS.every((p) => /^[a-zA-Z]+\.[a-zA-Z]+$/.test(p))).toBe(
      true,
    );
  });

  it('should give every system role a default set of known permissions', () => {
    for (const key of COMPANY_ROLE_KEYS) {
      const defaults = DEFAULT_ROLE_PERMISSIONS[key];
      expect(defaults.length).toBeGreaterThan(0);
      expect(defaults.every(isPermission)).toBe(true);
    }
  });

  it('should give the owner everything and the viewer only views', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.owner).toEqual(ALL_PERMISSIONS);
    expect(
      DEFAULT_ROLE_PERMISSIONS.viewer.every((p) => p.endsWith('.view')),
    ).toBe(true);
  });

  it('should keep the partner below the owner', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.partner).not.toContain('roles.manage');
    expect(DEFAULT_ROLE_PERMISSIONS.partner).not.toContain('monthEnd.reopen');
  });

  it('should drop unknown ids and duplicates when normalizing', () => {
    expect(
      normalizePermissions([
        'sales.view',
        'nope.view',
        'sales.view',
        'dashboard.view',
      ]),
    ).toEqual(['dashboard.view', 'sales.view']);
  });
});
