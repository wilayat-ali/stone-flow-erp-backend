// Everything a company role can be allowed to do. A permission is
// `module.action`. The frontend shows labels for these ids, so adding or
// renaming one is a change to both projects.
export const PERMISSION_CATALOG = {
  dashboard: ['view'],
  suppliers: ['view', 'create', 'manage'],
  purchasing: ['view', 'create', 'approve'],
  production: ['view', 'operate', 'reverse'],
  inventory: ['view', 'viewValue'],
  customers: ['view', 'create', 'edit', 'editOpening'],
  sales: ['view', 'create', 'manage'],
  expenses: ['view', 'create', 'manage'],
  monthEnd: ['close', 'reopen'],
  approvals: ['view', 'configure'],
  settings: ['view'],
  users: ['view', 'manage'],
  roles: ['view', 'manage'],
  branding: ['manage'],
} as const;

type Catalog = typeof PERMISSION_CATALOG;

export type Permission = {
  [M in keyof Catalog]: `${M}.${Catalog[M][number]}`;
}[keyof Catalog];

export const ALL_PERMISSIONS = (
  Object.keys(PERMISSION_CATALOG) as (keyof Catalog)[]
).flatMap((module) =>
  (PERMISSION_CATALOG[module] as readonly string[]).map(
    (action) => `${module}.${action}`,
  ),
) as Permission[];

export const isPermission = (value: string): value is Permission =>
  (ALL_PERMISSIONS as string[]).includes(value);

// The Owner role always holds every permission and cannot be edited.
export const OWNER_ROLE_KEY = 'owner';

const VIEWS: Permission[] = [
  'dashboard.view',
  'suppliers.view',
  'purchasing.view',
  'production.view',
  'inventory.view',
  'customers.view',
  'sales.view',
  'expenses.view',
];

// What the five roles every company starts with are allowed to do.
export const DEFAULT_ROLE_PERMISSIONS: Record<string, Permission[]> = {
  owner: ALL_PERMISSIONS,
  partner: ALL_PERMISSIONS.filter(
    (p) => p !== 'roles.manage' && p !== 'monthEnd.reopen',
  ),
  manager: [
    ...VIEWS,
    'suppliers.create',
    'suppliers.manage',
    'purchasing.create',
    'purchasing.approve',
    'production.operate',
    'customers.create',
    'customers.edit',
    'sales.create',
    'sales.manage',
    'expenses.create',
    'expenses.manage',
    'approvals.view',
    'users.view',
    'roles.view',
  ],
  munshi: [
    ...VIEWS,
    'suppliers.create',
    'purchasing.create',
    'production.operate',
    'customers.create',
    'sales.create',
    'expenses.create',
  ],
  viewer: VIEWS,
};

// Keeps only known permission ids, once each, in catalog order.
export function normalizePermissions(input: readonly string[]): Permission[] {
  const wanted = new Set(input);
  return ALL_PERMISSIONS.filter((p) => wanted.has(p));
}
