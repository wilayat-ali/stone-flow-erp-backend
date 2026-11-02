import { normalizePhone } from './phone';

describe('normalizePhone', () => {
  it.each([
    ['03001234567', '+923001234567'],
    ['0300-1234567', '+923001234567'],
    ['0300 123 4567', '+923001234567'],
    ['3001234567', '+923001234567'],
    ['923001234567', '+923001234567'],
    ['+92 300 1234567', '+923001234567'],
    ['0092-300-1234567', '+923001234567'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each([
    '',
    null,
    undefined,
    'abc',
    '0300123',
    '04001234567',
    '+1 202 555 0100',
  ])('rejects %s', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});
