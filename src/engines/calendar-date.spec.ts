import { isCalendarDate } from './calendar-date';

describe('isCalendarDate', () => {
  it.each(['2026-11-06', '2024-02-29', '2026-12-31', '2026-01-01'])(
    'accepts %s',
    (value) => {
      expect(isCalendarDate(value)).toBe(true);
    },
  );

  it.each([
    '2026-02-30',
    '2025-02-29',
    '2026-13-01',
    '2026-00-10',
    '2026-11-31',
    '26-11-06',
    '2026/11/06',
    '2026-11-06T10:00:00Z',
    ' 2026-11-06',
    '',
  ])('rejects %p', (value) => {
    expect(isCalendarDate(value)).toBe(false);
  });

  it.each([null, undefined, 20261106, new Date(), {}])(
    'rejects non-string %p',
    (value) => {
      expect(isCalendarDate(value)).toBe(false);
    },
  );
});
