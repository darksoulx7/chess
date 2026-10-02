import { START_FEN } from '@chess/chess-core';
import type { AnalysisRequest, EngineService } from '@chess/engine';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createDb } from '../src/infrastructure/db.js';
import { createRedis } from '../src/infrastructure/redis.js';
import { loadEnv } from '../src/shared/env.js';

// These tests use a real HTTP socket. inject() cannot reproduce socket-level behaviour such as
// request-body 'close' events or client disconnects (which once cancelled every search).
const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://chess:chess@127.0.0.1:5432/chess',
  REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
});
const db = createDb(env.DATABASE_URL);
const redis = createRedis(env.REDIS_URL);
afterAll(async () => {
  await Promise.all([db.end(), redis.quit()]);
});

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

async function listen(engine: EngineService) {
  const app = await buildApp({ env, db, redis, engine });
  apps.push(app);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return `http://127.0.0.1:${port}`;
}

describe('bot route over a real socket', () => {
  it('a slow search is NOT cancelled while the client is waiting', async () => {
    let aborted = false;
    const engine: EngineService = {
      async analyze(req: AnalysisRequest) {
        req.signal?.addEventListener('abort', () => (aborted = true));
        await new Promise((r) => setTimeout(r, 300));
        return {
          lines: [{ multipv: 1, depth: 1, score: { type: 'cp', value: 0 }, pv: ['e2e4'] }],
          bestMove: 'e2e4',
        };
      },
      dispose: async () => {},
    };
    const base = await listen(engine);
    const res = await fetch(`${base}/api/bot/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fen: START_FEN, targetRating: 1600, seed: 1 }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { move: string }).move).toBe('e2e4');
    expect(aborted).toBe(false);
  });

  it('cancels the search when the client disconnects mid-search', async () => {
    let signal: AbortSignal | undefined;
    const started = new Promise<void>((resolve) => {
      const engine: EngineService = {
        analyze(req: AnalysisRequest) {
          signal = req.signal;
          resolve();
          return new Promise((_, reject) => {
            req.signal?.addEventListener('abort', () =>
              reject(Object.assign(new Error('aborted'), { code: 'aborted' })),
            );
          });
        },
        dispose: async () => {},
      };
      void listen(engine).then(async (base) => {
        const ctl = new AbortController();
        const p = fetch(`${base}/api/bot/move`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ fen: START_FEN, targetRating: 1600 }),
          signal: ctl.signal,
        }).catch(() => undefined);
        await started;
        ctl.abort();
        await p;
      });
    });
    await started;
    await new Promise((r) => setTimeout(r, 300));
    expect(signal?.aborted).toBe(true);
  });
});
