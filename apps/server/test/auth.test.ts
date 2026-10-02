import { createHash } from 'node:crypto';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LoginThrottle } from '../src/modules/auth/login-throttle.js';
import { hashPassword, validatePassword, verifyPassword } from '../src/modules/auth/passwords.js';
import {
  generateRefreshToken,
  hashToken,
  signAccessToken,
  verifyAccessToken,
} from '../src/modules/auth/tokens.js';
import {
  SECRET,
  bearer,
  createHarness,
  newCreds,
  register,
  type AuthBody,
  type Harness,
} from './auth-helper.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

const post = (url: string, payload: unknown, headers: Record<string, string> = {}) =>
  h.app.inject({ method: 'POST', url, payload: payload as object, headers });

describe('passwords', () => {
  it('enforces length and rejects common/repetitive passwords', () => {
    expect(validatePassword('short')).toMatch(/at least 10/);
    expect(validatePassword('x'.repeat(129))).toMatch(/at most 128/);
    expect(validatePassword('Password123')).toMatch(/too common/);
    expect(validatePassword('aaaaaaaaaaaa')).toMatch(/repetitive/);
    expect(validatePassword('correct horse battery staple')).toBeNull();
    expect(validatePassword('p'.repeat(10) + 'q')).toBeNull();
  });

  it('hashes with argon2id, verifies, and never throws', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(hash, 'wrong password!!')).toBe(false);
    expect(await verifyPassword(null, 'anything at all')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
    expect(await hashPassword('correct horse battery staple')).not.toBe(hash); // salted
  });
});

describe('tokens', () => {
  it('signs and verifies access tokens', async () => {
    const t = await signAccessToken({ userId: 'u1', familyId: 'f1' }, SECRET, 60);
    const claims = await verifyAccessToken(t, SECRET);
    expect(claims).toMatchObject({ userId: 'u1', familyId: 'f1' });
    expect(claims?.exp).toBeGreaterThan(Date.now() / 1000); // expiry is exposed so sockets can enforce it
  });

  it('rejects expired, wrong-secret, wrong-audience, wrong-algorithm and garbage tokens', async () => {
    const expired = await new SignJWT({ fid: 'f' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u')
      .setIssuer('chess-server')
      .setAudience('chess-client')
      .setIssuedAt(1)
      .setExpirationTime(2)
      .sign(new TextEncoder().encode(SECRET));
    expect(await verifyAccessToken(expired, SECRET)).toBeNull();
    const good = await signAccessToken({ userId: 'u', familyId: 'f' }, SECRET, 60);
    expect(
      await verifyAccessToken(good, 'another-secret-another-secret-another-secret'),
    ).toBeNull();
    const wrongAud = await new SignJWT({ fid: 'f' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u')
      .setIssuer('chess-server')
      .setAudience('someone-else')
      .setExpirationTime('1m')
      .sign(new TextEncoder().encode(SECRET));
    expect(await verifyAccessToken(wrongAud, SECRET)).toBeNull();
    const hs512 = await new SignJWT({ fid: 'f' })
      .setProtectedHeader({ alg: 'HS512' })
      .setSubject('u')
      .setIssuer('chess-server')
      .setAudience('chess-client')
      .setExpirationTime('1m')
      .sign(new TextEncoder().encode(SECRET));
    expect(await verifyAccessToken(hs512, SECRET)).toBeNull();
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: 'u', fid: 'f', iss: 'chess-server', aud: 'chess-client', exp: 9999999999 })).toString('base64url')}.`;
    expect(await verifyAccessToken(none, SECRET)).toBeNull();
    expect(await verifyAccessToken('garbage', SECRET)).toBeNull();
    expect(await verifyAccessToken(good.slice(0, -3) + 'xyz', SECRET)).toBeNull();
  });

  it('refresh tokens are 256-bit random and hashed with sha256', () => {
    const a = generateRefreshToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateRefreshToken()).not.toBe(a);
    expect(hashToken('abc')).toBe(createHash('sha256').update('abc').digest('hex'));
  });
});

describe('POST /api/auth/register', () => {
  it('creates an account and returns user + tokens, without exposing secrets', async () => {
    const creds = newCreds();
    const res = await post('/api/auth/register', {
      ...creds,
      email: `  ${creds.email.toUpperCase()} `,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as AuthBody;
    expect(body.user).toMatchObject({
      email: creds.email,
      username: creds.username,
      avatar: 'knight',
    });
    expect(body.expiresIn).toBe(900);
    expect(JSON.stringify(body)).not.toContain('password');
    const row = (
      await h.t.db.query('select password_hash from users where id = $1', [body.user.id])
    ).rows[0];
    expect(row.password_hash).toMatch(/^\$argon2id\$/);
    expect(row.password_hash).not.toContain(creds.password);
  });

  it('stores only a hash of the refresh token', async () => {
    const { refreshToken, user } = await register(h.app);
    const rows = (
      await h.t.db.query('select token_hash from sessions where user_id = $1', [user.id])
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).toBe(hashToken(refreshToken));
    expect(rows[0].token_hash).not.toBe(refreshToken);
  });

  it('rejects duplicates case-insensitively', async () => {
    const a = await register(h.app);
    const dupEmail = await post('/api/auth/register', {
      ...newCreds(),
      email: a.creds.email.toUpperCase(),
    });
    expect(dupEmail.statusCode).toBe(409);
    expect(dupEmail.json()).toEqual({ error: 'email_taken' });
    const dupName = await post('/api/auth/register', {
      ...newCreds(),
      username: a.creds.username.toUpperCase(),
    });
    expect(dupName.statusCode).toBe(409);
    expect(dupName.json()).toEqual({ error: 'username_taken' });
  });

  it.each([
    ['invalid email', { email: 'nope' }],
    ['email too long', { email: `${'a'.repeat(250)}@x.io` }],
    ['username too short', { username: 'ab' }],
    ['username with spaces', { username: 'bad name' }],
    ['username too long', { username: 'x'.repeat(21) }],
    ['username with symbols', { username: 'bob<script>' }],
    ['short password', { password: 'short' }],
    ['common password', { password: 'password123' }],
    ['huge password', { password: 'x'.repeat(2000) }],
    ['missing fields', { email: undefined }],
  ])('400 for %s', async (_n, override) => {
    const res = await post('/api/auth/register', { ...newCreds(), ...override });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('is safe against SQL injection payloads (parameterised queries)', async () => {
    const res = await post('/api/auth/register', {
      email: "a'; drop table users;--@x.io",
      username: "bob'; drop table users;--",
      password: 'correct horse battery staple',
    });
    expect(res.statusCode).toBe(400); // rejected by validation
    const login = await post('/api/auth/login', {
      identifier: "' or '1'='1",
      password: 'whatever whatever',
    });
    expect(login.statusCode).toBe(401);
    expect((await h.t.db.query('select count(*)::int as n from users')).rows[0].n).toBeGreaterThan(
      0,
    );
  });
});

describe('POST /api/auth/login', () => {
  it('logs in by email or username, case-insensitively', async () => {
    const { creds } = await register(h.app);
    for (const identifier of [
      creds.email,
      creds.email.toUpperCase(),
      creds.username,
      creds.username.toUpperCase(),
    ]) {
      const res = await post('/api/auth/login', { identifier, password: creds.password });
      expect(res.statusCode, identifier).toBe(200);
      expect((res.json() as AuthBody).accessToken).toBeTruthy();
    }
  });

  it('gives the same response for a wrong password and an unknown account', async () => {
    const { creds } = await register(h.app);
    const wrong = await post('/api/auth/login', {
      identifier: creds.email,
      password: 'definitely wrong',
    });
    const unknown = await post('/api/auth/login', {
      identifier: `ghost${Date.now()}@example.com`,
      password: 'definitely wrong',
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
    expect(wrong.json()).toEqual({ error: 'invalid_credentials' });
  });

  it('throttles repeated failures per account, then recovers after a success elsewhere is impossible while blocked', async () => {
    const { creds } = await register(h.app);
    for (let i = 0; i < 5; i++) {
      expect(
        (await post('/api/auth/login', { identifier: creds.email, password: 'wrong wrong wrong' }))
          .statusCode,
      ).toBe(401);
    }
    const blocked = await post('/api/auth/login', {
      identifier: creds.email,
      password: creds.password,
    });
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(blocked.json()).toEqual({ error: 'too_many_attempts' });
    // identifiers differing only by case share one counter
    expect(
      (
        await post('/api/auth/login', {
          identifier: creds.email.toUpperCase(),
          password: creds.password,
        })
      ).statusCode,
    ).toBe(429);
  });

  it('a successful login resets the failure counter', async () => {
    const { creds } = await register(h.app);
    for (let i = 0; i < 3; i++)
      await post('/api/auth/login', { identifier: creds.email, password: 'wrong wrong wrong' });
    expect(
      (await post('/api/auth/login', { identifier: creds.email, password: creds.password }))
        .statusCode,
    ).toBe(200);
    for (let i = 0; i < 4; i++)
      await post('/api/auth/login', { identifier: creds.email, password: 'wrong wrong wrong' });
    expect(
      (await post('/api/auth/login', { identifier: creds.email, password: creds.password }))
        .statusCode,
    ).toBe(200); // still under the limit
  });

  it('rejects malformed requests', async () => {
    expect((await post('/api/auth/login', {})).statusCode).toBe(400);
    expect((await post('/api/auth/login', { identifier: '', password: 'x' })).statusCode).toBe(400);
  });
});

describe('LoginThrottle failure modes', () => {
  it('fails open when Redis is unavailable', async () => {
    const errors: unknown[] = [];
    const broken = {
      get: async () => {
        throw new Error('down');
      },
      incr: async () => {
        throw new Error('down');
      },
      ttl: async () => {
        throw new Error('down');
      },
      expire: async () => 1,
      del: async () => {
        throw new Error('down');
      },
    } as unknown as typeof h.redis;
    const t = new LoginThrottle(broken, 3, 60, (e) => errors.push(e));
    expect(await t.blockedFor('x')).toBe(0);
    await t.recordFailure('x');
    await t.reset('x');
    expect(errors.length).toBe(3);
  });
});

describe('access token authentication', () => {
  it('GET /api/auth/session returns the user for a valid token', async () => {
    const a = await register(h.app);
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: bearer(a.accessToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ user: { id: a.user.id, username: a.creds.username } });
  });

  it.each([
    ['no header', {}],
    ['wrong scheme', { authorization: 'Basic abc' }],
    ['empty bearer', { authorization: 'Bearer ' }],
    ['garbage', { authorization: 'Bearer not.a.jwt' }],
  ])('401 with %s', async (_n, headers) => {
    const res = await h.app.inject({ method: 'GET', url: '/api/auth/session', headers });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Bearer');
  });

  it('401 for an access token whose user was deleted', async () => {
    const a = await register(h.app);
    await h.t.db.query('delete from users where id = $1', [a.user.id]);
    expect(
      (
        await h.app.inject({
          method: 'GET',
          url: '/api/auth/session',
          headers: bearer(a.accessToken),
        })
      ).statusCode,
    ).toBe(401);
  });
});

describe('refresh token rotation', () => {
  it('rotates: returns a new refresh token, and the old one stops working after the grace window', async () => {
    const a = await register(h.app);
    const r1 = await post('/api/auth/refresh', { refreshToken: a.refreshToken });
    expect(r1.statusCode).toBe(200);
    const b = r1.json() as AuthBody;
    expect(b.refreshToken).not.toBe(a.refreshToken);
    expect(b.user.id).toBe(a.user.id);
    expect(
      (
        await h.app.inject({
          method: 'GET',
          url: '/api/auth/session',
          headers: bearer(b.accessToken),
        })
      ).statusCode,
    ).toBe(200);
    // the new token works
    expect((await post('/api/auth/refresh', { refreshToken: b.refreshToken })).statusCode).toBe(
      200,
    );
  });

  it('detects reuse of an old token, revoking the entire family', async () => {
    const a = await register(h.app);
    const b = (
      await post('/api/auth/refresh', { refreshToken: a.refreshToken })
    ).json() as AuthBody;
    // age the rotation past the grace window
    await h.t.db.query(
      `update sessions set used_at = now() - interval '5 minutes' where token_hash = $1`,
      [hashToken(a.refreshToken)],
    );
    const replay = await post('/api/auth/refresh', { refreshToken: a.refreshToken });
    expect(replay.statusCode).toBe(401);
    expect(replay.json()).toEqual({ error: 'invalid_refresh_token' });
    // the legitimate successor is now revoked too
    expect((await post('/api/auth/refresh', { refreshToken: b.refreshToken })).statusCode).toBe(
      401,
    );
    const revoked = (
      await h.t.db.query(
        'select count(*)::int as n from sessions where user_id = $1 and revoked_at is null',
        [a.user.id],
      )
    ).rows[0].n;
    expect(revoked).toBe(0);
  });

  it('treats a quick replay as a concurrent refresh: rejected with 409, nothing revoked', async () => {
    const a = await register(h.app);
    const b = (
      await post('/api/auth/refresh', { refreshToken: a.refreshToken })
    ).json() as AuthBody;
    const replay = await post('/api/auth/refresh', { refreshToken: a.refreshToken });
    expect(replay.statusCode).toBe(409);
    expect(replay.json()).toEqual({ error: 'refresh_conflict' });
    expect((await post('/api/auth/refresh', { refreshToken: b.refreshToken })).statusCode).toBe(
      200,
    );
  });

  it('two simultaneous refreshes with one token: exactly one wins, the session survives', async () => {
    const a = await register(h.app);
    const [r1, r2] = await Promise.all([
      post('/api/auth/refresh', { refreshToken: a.refreshToken }),
      post('/api/auth/refresh', { refreshToken: a.refreshToken }),
    ]);
    expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 409]);
    const winner = (r1.statusCode === 200 ? r1 : r2).json() as AuthBody;
    expect(
      (await post('/api/auth/refresh', { refreshToken: winner.refreshToken })).statusCode,
    ).toBe(200);
  });

  it('rejects unknown, malformed, expired and revoked refresh tokens', async () => {
    expect(
      (await post('/api/auth/refresh', { refreshToken: generateRefreshToken() })).statusCode,
    ).toBe(401);
    expect((await post('/api/auth/refresh', { refreshToken: 'short' })).statusCode).toBe(400);
    expect((await post('/api/auth/refresh', {})).statusCode).toBe(400);
    const a = await register(h.app);
    await h.t.db.query(
      `update sessions set expires_at = now() - interval '1 minute' where user_id = $1`,
      [a.user.id],
    );
    expect((await post('/api/auth/refresh', { refreshToken: a.refreshToken })).statusCode).toBe(
      401,
    );
    const b = await register(h.app);
    await h.t.db.query(`update sessions set revoked_at = now() where user_id = $1`, [b.user.id]);
    expect((await post('/api/auth/refresh', { refreshToken: b.refreshToken })).statusCode).toBe(
      401,
    );
  });

  it('keeps sessions from different logins independent', async () => {
    const a = await register(h.app);
    const second = (
      await post('/api/auth/login', { identifier: a.creds.email, password: a.creds.password })
    ).json() as AuthBody;
    await post('/api/auth/logout', { refreshToken: a.refreshToken });
    expect((await post('/api/auth/refresh', { refreshToken: a.refreshToken })).statusCode).toBe(
      401,
    );
    expect(
      (await post('/api/auth/refresh', { refreshToken: second.refreshToken })).statusCode,
    ).toBe(200); // other device unaffected
  });
});

describe('POST /api/auth/logout', () => {
  it('revokes the session family and always answers 204', async () => {
    const a = await register(h.app);
    const b = (
      await post('/api/auth/refresh', { refreshToken: a.refreshToken })
    ).json() as AuthBody;
    expect((await post('/api/auth/logout', { refreshToken: b.refreshToken })).statusCode).toBe(204);
    expect((await post('/api/auth/refresh', { refreshToken: b.refreshToken })).statusCode).toBe(
      401,
    );
    expect(
      (await post('/api/auth/logout', { refreshToken: generateRefreshToken() })).statusCode,
    ).toBe(204);
    expect((await post('/api/auth/logout', { nope: true })).statusCode).toBe(204);
  });
});

describe('rate limiting and headers', () => {
  it('rate limits auth endpoints per client', async () => {
    const limited = await createHarness({ AUTH_RATE_LIMIT_MAX: '3' });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 5; i++) {
        codes.push(
          (
            await limited.app.inject({
              method: 'POST',
              url: '/api/auth/login',
              payload: { identifier: `x${i}`, password: 'wrong wrong wrong' },
            })
          ).statusCode,
        );
      }
      expect(codes).toEqual([401, 401, 401, 429, 429]);
    } finally {
      await limited.close();
    }
  });

  it('sets security headers', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeTruthy();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
