// Workspace slug: lowercase a-z, 0-9 and hyphen, 3-40 characters, starting and
// ending with a letter or digit. It is used in URLs, so reserved words are blocked.
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export const RESERVED_SLUGS = new Set([
  'admin',
  'administrator',
  'api',
  'app',
  'assets',
  'auth',
  'company',
  'companies',
  'docs',
  'help',
  'login',
  'logout',
  'mail',
  'platform',
  'root',
  'static',
  'superadmin',
  'support',
  'system',
  'workspace',
  'workspaces',
  'www',
]);

export function isValidSlug(slug: unknown): slug is string {
  return (
    typeof slug === 'string' &&
    SLUG_PATTERN.test(slug) &&
    !RESERVED_SLUGS.has(slug)
  );
}
