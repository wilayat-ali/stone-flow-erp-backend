// Pakistani mobile numbers, stored as E.164 (+92XXXXXXXXXX).
// Accepts 03XX-XXXXXXX, 3XXXXXXXXX, 92XXXXXXXXXX, 0092XXXXXXXXXX and +92XXXXXXXXXX.
export function normalizePhone(
  input: string | null | undefined,
): string | null {
  if (!input) return null;

  let digits = input.replace(/[\s\-().]/g, '');

  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);

  if (!/^\d+$/.test(digits)) return null;

  if (digits.startsWith('92')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = digits.slice(1);

  return /^3\d{9}$/.test(digits) ? `+92${digits}` : null;
}
