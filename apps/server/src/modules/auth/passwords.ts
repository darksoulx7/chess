import argon2 from 'argon2';

// OWASP argon2id baseline: m=19 MiB, t=2, p=1.
const OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

// A tiny deny-list of the most common passwords; length is the main defence (NIST 800-63B style: no composition rules).
const COMMON = new Set([
  'password12',
  'password123',
  'password1234',
  '1234567890',
  '12345678910',
  'qwertyuiop',
  'qwerty12345',
  'iloveyou123',
  'letmein1234',
  'welcome1234',
  'admin12345',
  'passw0rd123',
  'chess123456',
  'chessmaster',
  '0123456789',
  'abcdefghij',
]);

export function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN)
    return `Password must be at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Password must be at most ${PASSWORD_MAX} characters.`;
  if (COMMON.has(password.toLowerCase())) return 'That password is too common.';
  if (/^(.)\1+$/.test(password)) return 'That password is too repetitive.';
  return null;
}

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, OPTIONS);
}

// Verified against when the account does not exist, so response time does not reveal which accounts exist.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= argon2.hash('dummy-password-for-timing', OPTIONS));

export async function verifyPassword(hash: string | null, password: string): Promise<boolean> {
  try {
    const ok = await argon2.verify(hash ?? (await getDummyHash()), password);
    return hash !== null && ok;
  } catch {
    return false; // malformed hash or argon2 error: never throw out of a login attempt
  }
}
