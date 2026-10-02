import { START_FEN } from '@chess/chess-core';
import {
  EngineError,
  type AnalysisRequest,
  type AnalysisResult,
  type EngineService,
} from '@chess/engine';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createDb } from '../src/infrastructure/db.js';
import { createRedis } from '../src/infrastructure/redis.js';
import { EnginePool } from '../src/modules/analysis/engine-pool.js';
import {
  RedisAnalysisCache,
  analysisCacheKey,
  type AnalysisCache,
} from '../src/modules/analysis/cache.js';
import { StockfishProcess } from '../src/modules/analysis/stockfish-process.js';
import { loadEnv } from '../src/shared/env.js';
import { STOCKFISH_PATH, hasStockfish } from './support.js';

const baseEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://chess:chess@127.0.0.1:5432/chess',
  REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
};
const db = createDb(baseEnv.DATABASE_URL);
const redis = createRedis(baseEnv.REDIS_URL);
afterAll(async () => {
  await Promise.all([db.end(), redis.quit()]);
});

const memoryCache = (): AnalysisCache & { store: Map<string, AnalysisResult> } => {
  const store = new Map<string, AnalysisResult>();
  return {
    store,
    get: async (k) => store.get(k) ?? null,
    set: async (k, v) => void store.set(k, v),
  };
};

const apps: FastifyInstance[] = [];
async function appWith(
  engine: EngineService,
  cache: AnalysisCache = memoryCache(),
  extra: Record<string, string> = {},
) {
  const app = await buildApp({ env: loadEnv({ ...baseEnv, ...extra }), db, redis, engine, cache });
  apps.push(app);
  return app;
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

const post = (app: FastifyInstance, payload: unknown) =>
  app.inject({ method: 'POST', url: '/api/analysis/position', payload: payload as object });

function countingEngine(result: AnalysisResult) {
  const calls: AnalysisRequest[] = [];
  const engine: EngineService = {
    analyze: async (req) => {
      calls.push(req);
      return result;
    },
    dispose: async () => {},
  };
  return { engine, calls };
}
const CANNED: AnalysisResult = {
  bestMove: 'e2e4',
  lines: [
    { multipv: 1, depth: 12, score: { type: 'cp', value: 31 }, pv: ['e2e4', 'e7e5', 'g1f3'] },
    { multipv: 2, depth: 12, score: { type: 'cp', value: 20 }, pv: ['d2d4', 'd7d5'] },
  ],
};

describe('POST /api/analysis/position validation', () => {
  it.each([
    ['empty body', {}],
    ['missing fen', { depth: 8 }],
    ['depth 0', { fen: START_FEN, depth: 0 }],
    ['depth above the cap', { fen: START_FEN, depth: 23 }],
    ['non-integer depth', { fen: START_FEN, depth: 8.5 }],
    ['multiPv above 5', { fen: START_FEN, multiPv: 6 }],
    ['oversized fen', { fen: 'x'.repeat(200) }],
    ['invalid fen', { fen: 'not a fen' }],
  ])('400 for %s', async (_n, body) => {
    const { engine, calls } = countingEngine(CANNED);
    const res = await post(await appWith(engine), body);
    expect(res.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe('POST /api/analysis/position behaviour', () => {
  it('returns lines with SAN principal variations and applies defaults', async () => {
    const { engine, calls } = countingEngine(CANNED);
    const res = await post(await appWith(engine), { fen: START_FEN });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      bestMove: string;
      lines: Array<{ san: string[]; multipv: number }>;
      cached: boolean;
      depth: number;
    };
    expect(body.bestMove).toBe('e2e4');
    expect(body.lines[0]?.san).toEqual(['e4', 'e5', 'Nf3']);
    expect(body.lines[1]?.san).toEqual(['d4', 'd5']);
    expect(body.cached).toBe(false);
    expect(body.depth).toBe(12);
    expect(calls[0]).toMatchObject({ multiPv: 1, limits: { depth: 12, movetimeMs: 4000 } });
  });

  it('reports finished positions without calling the engine', async () => {
    const { engine, calls } = countingEngine(CANNED);
    const app = await appWith(engine);
    const mate = await post(app, {
      fen: 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3',
    });
    expect(mate.json()).toMatchObject({
      lines: [],
      bestMove: null,
      terminal: { state: 'checkmate', winner: 'b' },
    });
    const stale = await post(app, { fen: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1' });
    expect(stale.json()).toMatchObject({ terminal: { state: 'draw', reason: 'stalemate' } });
    expect(calls).toHaveLength(0);
  });

  it('serves repeated requests from the cache, keyed by fen, depth and multiPv', async () => {
    const { engine, calls } = countingEngine(CANNED);
    const app = await appWith(engine);
    const first = await post(app, { fen: START_FEN, depth: 10 });
    const second = await post(app, { fen: START_FEN, depth: 10 });
    expect(first.json()).toMatchObject({ cached: false });
    expect(second.json()).toMatchObject({ cached: true, bestMove: 'e2e4' });
    expect(calls).toHaveLength(1);
    await post(app, { fen: START_FEN, depth: 11 });
    await post(app, { fen: START_FEN, depth: 10, multiPv: 2 });
    expect(calls).toHaveLength(3);
  });

  it.each([
    ['busy', 503, 'engine_busy'],
    ['timeout', 504, 'engine_timeout'],
    ['crashed', 503, 'engine_unavailable'],
  ] as const)(
    'maps engine error %s to HTTP %i and does not cache failures',
    async (code, status, error) => {
      const cache = memoryCache();
      const engine: EngineService = {
        analyze: async () => {
          throw new EngineError(code);
        },
        dispose: async () => {},
      };
      const res = await post(await appWith(engine, cache), { fen: START_FEN });
      expect(res.statusCode).toBe(status);
      expect(res.json()).toMatchObject({ error });
      expect(cache.store.size).toBe(0);
    },
  );

  it('rate limits the analysis route', async () => {
    const { engine } = countingEngine(CANNED);
    const app = await appWith(engine, memoryCache(), { ANALYSIS_RATE_LIMIT_MAX: '2' });
    const codes: number[] = [];
    for (let i = 0; i < 4; i++)
      codes.push((await post(app, { fen: START_FEN, depth: 5 + i })).statusCode);
    expect(codes).toEqual([200, 200, 429, 429]);
  });
});

describe('RedisAnalysisCache', () => {
  const key = () => `analysis:v1:test-${randomUUID()}`;

  it('round-trips results through Redis with a TTL', async () => {
    const cache = new RedisAnalysisCache(redis, 30);
    const k = key();
    expect(await cache.get(k)).toBeNull();
    await cache.set(k, CANNED);
    expect(await cache.get(k)).toEqual(CANNED);
    const ttl = await redis.ttl(k);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(30);
    await redis.del(k);
  });

  it('never throws: redis errors and corrupt entries read as a miss', async () => {
    const errors: unknown[] = [];
    const broken = {
      get: async () => {
        throw new Error('down');
      },
      set: async () => {
        throw new Error('down');
      },
    } as unknown as typeof redis;
    const cache = new RedisAnalysisCache(broken, 30, (e) => errors.push(e));
    expect(await cache.get('k')).toBeNull();
    await expect(cache.set('k', CANNED)).resolves.toBeUndefined();
    expect(errors).toHaveLength(2);

    const k = key();
    await redis.set(k, '{not json', 'EX', 30);
    const real = new RedisAnalysisCache(redis, 30, (e) => errors.push(e));
    expect(await real.get(k)).toBeNull();
    await redis.del(k);
  });

  it('cache key changes with every input that changes the result', () => {
    const base = { fen: START_FEN, depth: 10, multiPv: 1, maxMs: 4000 };
    const keys = new Set([
      analysisCacheKey(base),
      analysisCacheKey({ ...base, depth: 11 }),
      analysisCacheKey({ ...base, multiPv: 2 }),
      analysisCacheKey({ ...base, maxMs: 5000 }),
      analysisCacheKey({ ...base, fen: START_FEN.replace(' w ', ' b ') }),
    ]);
    expect(keys.size).toBe(5);
    expect(analysisCacheKey(base)).toBe(analysisCacheKey({ ...base }));
  });
});

describe.skipIf(!hasStockfish)('analysis with real Stockfish', () => {
  it('returns ranked lines with SAN, finds mate in one', async () => {
    const pool = new EnginePool([new StockfishProcess({ path: STOCKFISH_PATH })]);
    const app = await appWith(pool);
    const start = await post(app, { fen: START_FEN, depth: 8, multiPv: 3 });
    const body = start.json() as {
      lines: Array<{ multipv: number; san: string[]; score: { type: string } }>;
      bestMove: string;
    };
    expect(body.lines.map((l) => l.multipv)).toEqual([1, 2, 3]);
    expect(body.lines.every((l) => l.san.length > 0)).toBe(true);

    const mate = await post(app, { fen: '6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1', depth: 6 });
    const m = mate.json() as { bestMove: string; lines: Array<{ score: unknown; san: string[] }> };
    expect(m.bestMove).toBe('a1a8');
    expect(m.lines[0]?.score).toEqual({ type: 'mate', value: 1 });
    expect(m.lines[0]?.san[0]).toBe('Ra8#');
    await pool.dispose();
  }, 60_000);
});
