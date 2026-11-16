import { isUUID } from 'class-validator';
import { EntityManager } from 'typeorm';
import { isCalendarDate } from './calendar-date';
import { query } from './db';
import { invalid, notFound } from './errors';

const SOURCE_TYPE = /^[a-z][a-z0-9_]{0,49}$/;

export function assertUuid(
  field: string,
  value: unknown,
): asserts value is string {
  if (typeof value !== 'string' || !isUUID(value)) {
    throw invalid({ [field]: 'invalidId' });
  }
}

export function assertDate(
  field: string,
  value: unknown,
): asserts value is string {
  if (!isCalendarDate(value)) {
    throw invalid({ [field]: 'invalidDate' });
  }
}

// `sourceType` says which module a row came from: any lower_snake_case word.
export function assertSourceType(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !SOURCE_TYPE.test(value)) {
    throw invalid({ sourceType: 'invalid' });
  }
}

export function cleanNote(note: string | null | undefined): string | null {
  const trimmed = note?.trim();
  return trimmed ? trimmed.slice(0, 500) : null;
}

// The acting member must belong to THIS company; another company's member is
// reported exactly like a missing one.
export async function assertMemberInCompany(
  em: EntityManager,
  companyId: string,
  memberId: string,
  field = 'createdByMemberId',
) {
  assertUuid(field, memberId);

  const [member] = await query<{ id: string }>(
    em,
    `SELECT id FROM company_member WHERE id = $1 AND "companyId" = $2`,
    [memberId, companyId],
  );

  if (!member) {
    throw notFound(field);
  }
}
