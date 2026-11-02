export const PLATFORM_KEYS = ['factory', 'showroom', 'mine'] as const;
export type PlatformKey = (typeof PLATFORM_KEYS)[number];

export const COMPANY_ROLE_KEYS = [
  'owner',
  'partner',
  'manager',
  'munshi',
  'viewer',
] as const;
export type CompanyRoleKey = (typeof COMPANY_ROLE_KEYS)[number];

// Seeded for every new company. System roles cannot be deleted or renamed.
// Only the role records exist for now; the permission matrix comes later.
export const SYSTEM_ROLES: { key: CompanyRoleKey; name: string }[] = [
  { key: 'owner', name: 'Owner' },
  { key: 'partner', name: 'Partner' },
  { key: 'manager', name: 'Manager' },
  { key: 'munshi', name: 'Munshi' },
  { key: 'viewer', name: 'Viewer' },
];

export const COMPANY_STATUS = {
  active: 'active',
  suspended: 'suspended',
} as const;

export const MEMBER_STATUS = {
  active: 'active',
  inactive: 'inactive',
  invited: 'invited',
} as const;

export const INVITATION_TYPE = {
  invite: 'invite',
  reset: 'reset',
} as const;

export const INVITATION_STATUS = {
  pending: 'pending',
  accepted: 'accepted',
  revoked: 'revoked',
  expired: 'expired',
} as const;

export const SUPER_ADMIN_ROLES = ['super_admin', 'support'] as const;
export type SuperAdminRole = (typeof SUPER_ADMIN_ROLES)[number];

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RESET_TTL_MS = 48 * 60 * 60 * 1000;
