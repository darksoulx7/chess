import { randomUUID } from 'node:crypto';
import type { Db } from '../../infrastructure/db.js';
import type { Env } from '../../shared/env.js';
import type { LoginThrottle } from './login-throttle.js';
import { hashPassword, verifyPassword } from './passwords.js';
import {
  createSession,
  createUser,
  findUserById,
  findUserByLogin,
  revokeFamilyByToken,
  rotateSession,
  toPublicUser,
  type PublicUser,
} from './repository.js';
import { generateRefreshToken, hashToken, signAccessToken } from './tokens.js';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** Access token lifetime in seconds. */
  expiresIn: number;
}

export interface AuthSuccess {
  user: PublicUser;
  tokens: TokenPair;
}

export type RegisterResult =
  ({ ok: true } & AuthSuccess) | { ok: false; error: 'email_taken' | 'username_taken' };
export type LoginResult =
  | ({ ok: true } & AuthSuccess)
  | { ok: false; error: 'invalid_credentials' }
  | { ok: false; error: 'too_many_attempts'; retryAfter: number };
export type RefreshResult =
  ({ ok: true } & AuthSuccess) | { ok: false; error: 'invalid_refresh_token' | 'refresh_conflict' };

const REUSE_GRACE_MS = 30_000;

export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly env: Pick<
      Env,
      'JWT_SECRET' | 'ACCESS_TOKEN_TTL_SECONDS' | 'REFRESH_TOKEN_TTL_DAYS'
    >,
    private readonly throttle: LoginThrottle,
  ) {}

  private refreshExpiry(): Date {
    return new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  }

  private async issue(userId: string, familyId: string, refreshToken: string): Promise<TokenPair> {
    return {
      accessToken: await signAccessToken(
        { userId, familyId },
        this.env.JWT_SECRET,
        this.env.ACCESS_TOKEN_TTL_SECONDS,
      ),
      refreshToken,
      expiresIn: this.env.ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  /** Starts a new session family for a user (login / registration). */
  private async startSession(userId: string, userAgent: string | null): Promise<TokenPair> {
    const familyId = randomUUID();
    const refreshToken = generateRefreshToken();
    await createSession(this.db, {
      userId,
      familyId,
      tokenHash: hashToken(refreshToken),
      expiresAt: this.refreshExpiry(),
      userAgent,
    });
    return this.issue(userId, familyId, refreshToken);
  }

  async register(
    input: { email: string; username: string; password: string },
    userAgent: string | null,
  ): Promise<RegisterResult> {
    const passwordHash = await hashPassword(input.password);
    const created = await createUser(this.db, {
      email: input.email,
      username: input.username,
      passwordHash,
    });
    if (!created.ok)
      return { ok: false, error: created.conflict === 'email' ? 'email_taken' : 'username_taken' };
    return {
      ok: true,
      user: toPublicUser(created.user),
      tokens: await this.startSession(created.user.id, userAgent),
    };
  }

  async login(
    identifier: string,
    password: string,
    userAgent: string | null,
  ): Promise<LoginResult> {
    const wait = await this.throttle.blockedFor(identifier);
    if (wait > 0) return { ok: false, error: 'too_many_attempts', retryAfter: wait };

    const user = await findUserByLogin(this.db, identifier);
    // Always run a verification (against a dummy hash for unknown accounts) so timing does not leak existence.
    const valid = await verifyPassword(user?.password_hash ?? null, password);
    if (!user || !valid) {
      await this.throttle.recordFailure(identifier);
      return { ok: false, error: 'invalid_credentials' };
    }
    await this.throttle.reset(identifier);
    return {
      ok: true,
      user: toPublicUser(user),
      tokens: await this.startSession(user.id, userAgent),
    };
  }

  async refresh(refreshToken: string, userAgent: string | null): Promise<RefreshResult> {
    const next = generateRefreshToken();
    const rotated = await rotateSession(this.db, {
      tokenHash: hashToken(refreshToken),
      newTokenHash: hashToken(next),
      expiresAt: this.refreshExpiry(),
      userAgent,
      graceMs: REUSE_GRACE_MS,
    });
    if (rotated.status === 'conflict') return { ok: false, error: 'refresh_conflict' };
    if (rotated.status !== 'ok') return { ok: false, error: 'invalid_refresh_token' };
    const user = await findUserById(this.db, rotated.userId);
    if (!user) return { ok: false, error: 'invalid_refresh_token' };
    return {
      ok: true,
      user: toPublicUser(user),
      tokens: await this.issue(user.id, rotated.familyId, next),
    };
  }

  async logout(refreshToken: string): Promise<void> {
    await revokeFamilyByToken(this.db, hashToken(refreshToken));
  }
}
