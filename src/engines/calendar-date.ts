// Business dates are calendar days ("2026-11-06"), never timestamps, so a
// factory's day cannot shift with the server's timezone.
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// Today's calendar day at the factory (Pakistan), whatever the server's own
// timezone is: the day must not flip at 5 am for a factory working in the evening.
export function todayAtFactory(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
}

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  const match = CALENDAR_DATE.exec(value);

  if (!match) {
    return false;
  }

  const [year, month, day] = [+match[1], +match[2], +match[3]];
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}
