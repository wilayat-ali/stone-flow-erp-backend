// The schedule of one loan: one instalment per month from the first month until
// the loan is repaid, the last one smaller if it needs to be. A month the owner
// skipped moves everything one month later. A closed month shows what was
// really deducted, whatever the rule says now.

export type InstalmentStatus = 'scheduled' | 'deducted' | 'skipped';

export type InstalmentRowView = {
  month: string;
  amount: number;
  status: InstalmentStatus;
};

export type ScheduleLoan = {
  amount: number;
  priorRepaid: number;
  monthlyInstalment: number;
  firstMonth: string;
};

/** The owner's change for a month not yet closed: another amount, or skipped. */
export type OverrideMap = Map<
  string,
  { amount?: number | null; skip?: boolean }
>;

/** What closing a month posted for this loan: the deduction, or a skip. */
export type Posted = { amount: number; skipped: boolean };

const nextMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number);

  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
};

export function scheduleOf(
  loan: ScheduleLoan,
  overrides: OverrideMap,
  closed: (month: string) => Posted | undefined,
  isClosed: (month: string) => boolean,
): InstalmentRowView[] {
  const rows: InstalmentRowView[] = [];
  let remaining = loan.amount - loan.priorRepaid;
  let month = loan.firstMonth;

  for (
    let i = 0;
    i < 240 && remaining > 0 && loan.monthlyInstalment > 0;
    i++, month = nextMonth(month)
  ) {
    if (isClosed(month)) {
      const posted = closed(month);
      const amount = posted && !posted.skipped ? posted.amount : 0;
      rows.push({
        month,
        amount,
        status: amount > 0 ? 'deducted' : 'skipped',
      });
      remaining -= amount;
      continue;
    }

    const change = overrides.get(month);

    if (change?.skip) {
      rows.push({ month, amount: 0, status: 'skipped' });
      continue;
    }

    const amount = Math.min(
      change?.amount ?? loan.monthlyInstalment,
      remaining,
    );
    rows.push({ month, amount, status: 'scheduled' });
    remaining -= amount;
  }

  return rows;
}
