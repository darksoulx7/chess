import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createDb } from '../src/infrastructure/db.js';
import { createRedis } from '../src/infrastructure/redis.js';
import { loadEnv } from '../src/shared/env.js';

const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://chess:chess@127.0.0.1:5432/chess',
  REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
});

describe('health', () => {
  const db = createDb(env.DATABASE_URL);
  const redis = createRedis(env.REDIS_URL);
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ env, db, redis });
  });
  afterAll(async () => {
    await app.close();
    await Promise.all([db.end(), redis.quit()]);
  });

  it('GET /health is live', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /health/ready reports postgres and redis up', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.json()).toEqual({ status: 'ok', database: 'ok', redis: 'ok' });
    expect(res.statusCode).toBe(200);
  });
});

describe('env', () => {
  it('rejects missing DATABASE_URL', () => {
    expect(() => loadEnv({ REDIS_URL: 'redis://x' })).toThrow(/DATABASE_URL/);
  });
  it('parses CORS_ORIGINS into a list', () => {
    const e = loadEnv({ DATABASE_URL: 'x', REDIS_URL: 'y', CORS_ORIGINS: 'http://a, http://b' });
    expect(e.CORS_ORIGINS).toEqual(['http://a', 'http://b']);
  });
});
