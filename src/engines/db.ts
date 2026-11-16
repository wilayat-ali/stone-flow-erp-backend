import { DataSource, EntityManager } from 'typeorm';

// Engines accept an optional manager so a module can post a ledger row, a
// stock movement and an approval in ONE transaction. Without a manager the call
// gets its own transaction. With one, TypeORM opens a SAVEPOINT inside the
// caller's transaction, so a failed engine call is undone completely (no half
// written transfer or half decided approval) even if the caller catches the
// error and carries on.
export function inTransaction<T>(
  dataSource: DataSource,
  manager: EntityManager | undefined,
  work: (em: EntityManager) => Promise<T>,
): Promise<T> {
  return (manager ?? dataSource.manager).transaction(work);
}

// Typed raw query. Every engine query passes the companyId from the tenant
// context as a bound parameter; nothing is ever concatenated into the SQL.
export async function query<T>(
  em: EntityManager,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await em.query(sql, params)) as T[];
}

// bigint / numeric columns come back from Postgres as strings.
export function toNumber(value: string | number | null | undefined): number {
  return value === null || value === undefined ? 0 : Number(value);
}

export function toNumberOrNull(
  value: string | number | null | undefined,
): number | null {
  return value === null || value === undefined ? null : Number(value);
}

export type Page = { page?: number; limit?: number };

export function pageBounds(
  { page, limit }: Page,
  defaultLimit = 25,
  maxLimit = 200,
) {
  const safeLimit = Math.min(
    Math.max(Math.trunc(limit ?? defaultLimit), 1),
    maxLimit,
  );
  const safePage = Math.max(Math.trunc(page ?? 1), 1);
  return { limit: safeLimit, offset: (safePage - 1) * safeLimit };
}
