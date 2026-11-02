import bcrypt from 'bcryptjs';
import crypto from 'crypto';

// Compared against when no account matches, so a login for an unknown user
// takes as long as one with a wrong password.
let dummyHash: Promise<string> | undefined;

export function getDummyPasswordHash(): Promise<string> {
  dummyHash ??= bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10);
  return dummyHash;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt();
  return bcrypt.hash(password, salt);
}
