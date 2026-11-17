import { EntityManager } from 'typeorm';
import { query } from '../engines/db';
import { conflict } from '../engines/errors';

// `YYYY-MM` of a `YYYY-MM-DD` day.
export const monthOf = (date: string) => date.slice(0, 7);

// The last day of a `YYYY-MM` month, as `YYYY-MM-DD`.
export const monthEnd = (month: string) => {
  const [y, m] = month.split('-').map(Number);

  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

// The first day of a `YYYY-MM` month.
export const monthStart = (month: string) => `${month}-01`;

export async function isMonthClosed(
  em: EntityManager,
  companyId: string,
  month: string,
): Promise<boolean> {
  const [row] = await query<{ id: string }>(
    em,
    `SELECT id FROM month_close WHERE "companyId" = $1 AND month = $2 AND "reopenedAt" IS NULL`,
    [companyId, month],
  );

  return !!row;
}

// A closed month takes no new or edited attendance, register feet, worker
// payments or loan changes. Closing it posted what it needed to.
export async function assertMonthOpen(
  em: EntityManager,
  companyId: string,
  date: string,
): Promise<void> {
  if (await isMonthClosed(em, companyId, monthOf(date))) {
    throw conflict('MONTH_CLOSED');
  }
}
