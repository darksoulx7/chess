import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

const ISSUER = 'chess-server';
const AUDIENCE = 'chess-client';

export interface AccessClaims {
  userId: string;
  /** Expiry as epoch seconds (present on verified tokens). */
  exp?: number;
  /** Session family; lets logout / revocation be reflected in audit logs. */
  familyId: string;
}

const key = (secret: string) => new TextEncoder().encode(secret);

export async function signAccessToken(
  claims: AccessClaims,
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  return new SignJWT({ fid: claims.familyId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(key(secret));
}

/** Returns the claims, or null for any invalid/expired/forged token. Only HS256 is accepted. */
export async function verifyAccessToken(
  token: string,
  secret: string,
): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });
    if (typeof payload.sub !== 'string' || typeof payload.fid !== 'string') return null;
    return {
      userId: payload.sub,
      familyId: payload.fid,
      ...(typeof payload.exp === 'number' ? { exp: payload.exp } : {}),
    };
  } catch {
    return null;
  }
}

/** 256 bits from the CSPRNG, URL-safe. Only its SHA-256 is stored server-side. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
