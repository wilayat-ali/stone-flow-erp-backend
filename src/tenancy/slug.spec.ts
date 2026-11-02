import { isValidSlug } from './slug';

describe('isValidSlug', () => {
  it.each(['lahore-marble', 'abc', 'a1b', 'factory-2', 'x'.repeat(40)])(
    'accepts %s',
    (slug) => {
      expect(isValidSlug(slug)).toBe(true);
    },
  );

  it.each([
    'ab',
    'x'.repeat(41),
    'Lahore-Marble',
    'lahore_marble',
    '-lahore',
    'lahore-',
    'lahore marble',
    'admin',
    'api',
    'www',
    'superadmin',
    'app',
    '',
    null,
    undefined,
    42,
  ])('rejects %s', (slug) => {
    expect(isValidSlug(slug)).toBe(false);
  });
});
