import type { Db } from '../../infrastructure/db.js';

export interface UserRow {
  id: string;
  email: string;
  username: string;
  password_hash: string;
  avatar: string;
  created_at: Date;
}

export interface PublicUser {
  id: string;
  email: string;
  username: string;
  avatar: string;
  createdAt: string;
}

export const toPublicUser = (u: UserRow): PublicUser => ({
  id: u.id,
  email: u.email,
  username: u.username,
  avatar: u.avatar,
  createdAt: u.created_at.toISOString(),
});

export type CreateUserResult =
  { ok: true; user: UserRow } | { ok: false; conflict: 'email' | 'username' };

export async function createUser(
  db: Db,
  input: { email: string; username: string; passwordHash: string },
): Promise<CreateUserResult> {
  try {
    const r = await db.query<UserRow>(
      'insert into users (email, username, password_hash) values ($1, $2, $3) returning *',
      [input.email, input.username, input.passwordHash],
    );
    return { ok: true, user: r.rows[0] as UserRow };
  } catch (err) {
    const e = err as { code?: string; constraint?: string };
    if (e.code === '23505') {
      return {
        ok: false,
        conflict: e.constraint === 'users_username_lower_idx' ? 'username' : 'email',
      };
    }
    throw err;
  }
}

export async function findUserByLogin(db: Db, identifier: string): Promise<UserRow | null> {
  const r = await db.query<UserRow>(
    'select * from users where lower(email) = lower($1) or lower(username) = lower($1) limit 1',
    [identifier],
  );
  return r.rows[0] ?? null;
}

export async function findUserById(db: Db, id: string): Promise<UserRow | null> {
  const r = await db.query<UserRow>('select * from users where id = $1', [id]);
  return r.rows[0] ?? null;
}

export async function createSession(
  db: Pick<Db, 'query'>,
  input: {
    userId: string;
    familyId: string;
    tokenHash: string;
    expiresAt: Date;
    userAgent?: string | null;
  },
): Promise<void> {
  await db.query(
    'insert into sessions (user_id, family_id, token_hash, expires_at, user_agent) values ($1, $2, $3, $4, $5)',
    [
      input.userId,
      input.familyId,
      input.tokenHash,
      input.expiresAt,
      input.userAgent?.slice(0, 300) ?? null,
    ],
  );
}

export type RotateResult =
  | { status: 'ok'; userId: string; familyId: string }
  | { status: 'invalid' } // unknown / expired / revoked
  | { status: 'reuse' } // an old token was replayed: the family has been revoked
  | { status: 'conflict' }; // replay within the grace window (concurrent refresh): nothing revoked

/**
 * Atomically consumes a refresh token and issues its successor in the same family.
 * - Replaying an already-used token outside `graceMs` is treated as theft and revokes the family.
 * - Within `graceMs` it is treated as a concurrent refresh (two tabs) and only rejected.
 */
export async function rotateSession(
  db: Db,
  input: {
    tokenHash: string;
    newTokenHash: string;
    expiresAt: Date;
    userAgent?: string | null;
    graceMs: number;
  },
): Promise<RotateResult> {
  const client = await db.connect();
  try {
    await client.query('begin');
    const found = await client.query<{
      id: string;
      user_id: string;
      family_id: string;
      expires_at: Date;
      used_at: Date | null;
      revoked_at: Date | null;
    }>(
      'select id, user_id, family_id, expires_at, used_at, revoked_at from sessions where token_hash = $1 for update',
      [input.tokenHash],
    );
    const s = found.rows[0];
    if (!s || s.revoked_at || s.expires_at.getTime() <= Date.now()) {
      await client.query('rollback');
      return { status: 'invalid' };
    }
    if (s.used_at) {
      if (Date.now() - s.used_at.getTime() <= input.graceMs) {
        await client.query('rollback');
        return { status: 'conflict' };
      }
      await client.query(
        'update sessions set revoked_at = now() where family_id = $1 and revoked_at is null',
        [s.family_id],
      );
      await client.query('commit');
      return { status: 'reuse' };
    }
    await client.query('update sessions set used_at = now() where id = $1', [s.id]);
    await createSession(client, {
      userId: s.user_id,
      familyId: s.family_id,
      tokenHash: input.newTokenHash,
      expiresAt: input.expiresAt,
      userAgent: input.userAgent ?? null,
    });
    await client.query('commit');
    return { status: 'ok', userId: s.user_id, familyId: s.family_id };
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Revokes the whole family of a refresh token (used or not). Returns false if the token is unknown. */
export async function revokeFamilyByToken(db: Db, tokenHash: string): Promise<boolean> {
  const r = await db.query(
    'update sessions set revoked_at = now() where revoked_at is null and family_id = (select family_id from sessions where token_hash = $1)',
    [tokenHash],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function revokeAllSessions(db: Db, userId: string): Promise<void> {
  await db.query(
    'update sessions set revoked_at = now() where user_id = $1 and revoked_at is null',
    [userId],
  );
}

export async function deleteExpiredSessions(db: Db): Promise<number> {
  const r = await db.query("delete from sessions where expires_at < now() - interval '1 day'");
  return r.rowCount ?? 0;
}
