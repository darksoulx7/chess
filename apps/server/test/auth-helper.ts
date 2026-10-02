import { randomUUID } from 'node:crypto';
import type { EngineService } from '@chess/engine';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createRedis } from '../src/infrastructure/redis.js';
import { loadEnv } from '../src/shared/env.js';
import { createTestDb, type TestDb } from './db-helper.js';

const noEngine: EngineService = {
  analyze: async () => ({ lines: [], bestMove: null }),
  dispose: async () => {},
};

export interface Harness {
  app: FastifyInstance;
  t: TestDb;
  redis: ReturnType<typeof createRedis>;
  close(): Promise<void>;
}

export const SECRET = 'test-secret-test-secret-test-secret-0123456789';

export async function createHarness(extraEnv: Record<string, string> = {}): Promise<Harness> {
  const t = await createTestDb();
  const redis = createRedis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://chess:chess@127.0.0.1:5432/chess',
    REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    JWT_SECRET: SECRET,
    // Tests register many users; the limiter itself is covered by a dedicated test that overrides this.
    AUTH_RATE_LIMIT_MAX: '10000',
    ...extraEnv,
  });
  const app = await buildApp({ env, db: t.db, redis, engine: noEngine });
  return {
    app,
    t,
    redis,
    async close() {
      await app.close();
      await redis.quit();
      await t.drop();
    },
  };
}

let counter = 0;
/** Unique valid credentials so tests do not collide in Redis throttle keys or the DB. */
export function newCreds(prefix = 'user') {
  const n = `${prefix}${++counter}${randomUUID().slice(0, 6).replace(/-/g, '')}`.slice(0, 20);
  return { email: `${n}@example.com`, username: n, password: 'correct horse battery staple' };
}

export interface AuthBody {
  user: { id: string; email: string; username: string; avatar: string };
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export async function register(
  app: FastifyInstance,
  creds = newCreds(),
): Promise<AuthBody & { creds: ReturnType<typeof newCreds> }> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: creds });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.statusCode} ${res.body}`);
  return { ...(res.json() as AuthBody), creds };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
