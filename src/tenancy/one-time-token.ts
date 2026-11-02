import crypto from 'crypto';

// Invitation and reset links carry a random token; only its sha256 is stored,
// so a database leak does not expose usable links.
export function generateOneTimeToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString('hex');

  return { token, tokenHash: hashOneTimeToken(token) };
}

export function hashOneTimeToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
