import { ChessGame, START_FEN } from '@chess/chess-core';
import { EngineError, type EngineService } from '@chess/engine';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createDb } from '../src/infrastructure/db.js';
import { createRedis } from '../src/infrastructure/redis.js';
import { EnginePool } from '../src/modules/analysis/engine-pool.js';
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

const apps: FastifyInstance[] = [];
async function appWith(engine: EngineService, extra: Record<string, string> = {}) {
  const app = await buildApp({ env: loadEnv({ ...baseEnv, ...extra }), db, redis, engine });
  apps.push(app);
  return app;
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

const cannedEngine = (move = 'e2e4'): EngineService => ({
  analyze: async () => ({
    lines: [{ multipv: 1, depth: 5, score: { type: 'cp', value: 20 }, pv: [move] }],
    bestMove: move,
  }),
  dispose: async () => {},
});

const post = (app: FastifyInstance, payload: unknown) =>
  app.inject({ method: 'POST', url: '/api/bot/move', payload: payload as object });

describe('POST /api/bot/move validation', () => {
  it.each([
    ['missing body fields', {}],
    ['rating out of range', { fen: START_FEN, targetRating: 3000 }],
    ['rating not an integer', { fen: START_FEN, targetRating: 1500.5 }],
    ['rating below minimum', { fen: START_FEN, targetRating: 0 }],
    ['oversized fen', { fen: 'x'.repeat(200), targetRating: 1000 }],
    ['negative seed', { fen: START_FEN, targetRating: 1000, seed: -1 }],
  ])('400 for %s', async (_n, body) => {
    const res = await post(await appWith(cannedEngine()), body);
    expect(res.statusCode).toBe(400);
  });

  it('400 for a syntactically valid but illegal FEN or finished game', async () => {
    const app = await appWith(cannedEngine());
    expect((await post(app, { fen: 'not a fen', targetRating: 1000 })).statusCode).toBe(400);
    expect(
      (await post(app, { fen: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', targetRating: 1000 })).statusCode,
    ).toBe(400);
  });
});

describe('POST /api/bot/move behaviour', () => {
  it('returns a legal move with SAN', async () => {
    const res = await post(await appWith(cannedEngine('e2e4')), {
      fen: START_FEN,
      targetRating: 1600,
      seed: 1,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ move: 'e2e4', san: 'e4' });
  });

  it.each([
    ['busy', 503, 'engine_busy'],
    ['timeout', 504, 'engine_timeout'],
    ['crashed', 503, 'engine_unavailable'],
    ['unavailable', 503, 'engine_unavailable'],
  ] as const)('maps engine error %s to HTTP %i', async (code, status, error) => {
    const failing: EngineService = {
      analyze: async () => {
        throw new EngineError(code);
      },
      dispose: async () => {},
    };
    const res = await post(await appWith(failing), { fen: START_FEN, targetRating: 1200 });
    expect(res.statusCode).toBe(status);
    expect(res.json()).toMatchObject({ error });
    if (code === 'busy') expect(res.headers['retry-after']).toBe('2');
  });

  it('rate limits the bot route per client', async () => {
    const app = await appWith(cannedEngine(), { BOT_RATE_LIMIT_MAX: '3' });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++)
      codes.push((await post(app, { fen: START_FEN, targetRating: 1000 })).statusCode);
    expect(codes).toEqual([200, 200, 200, 429, 429]);
  });

  it('does not rate limit health probes', async () => {
    const app = await appWith(cannedEngine(), { RATE_LIMIT_MAX: '2' });
    for (let i = 0; i < 6; i++)
      expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });
});

describe.skipIf(!hasStockfish)('POST /api/bot/move with real Stockfish', () => {
  it('plays a complete legal game against itself at mixed strengths', async () => {
    const pool = new EnginePool([
      new StockfishProcess({ path: STOCKFISH_PATH }),
      new StockfishProcess({ path: STOCKFISH_PATH }),
    ]);
    const app = await appWith(pool);
    const game = ChessGame.create();
    for (let ply = 0; ply < 40 && !game.isGameOver(); ply++) {
      const rating = ply % 2 === 0 ? 400 : 1600;
      const res = await post(app, { fen: game.getFen(), targetRating: rating, seed: ply });
      expect(res.statusCode).toBe(200);
      const { move } = res.json() as { move: string };
      expect(game.makeMoveUci(move).ok, `ply ${ply}: ${move}`).toBe(true);
    }
    expect(game.getHistory().length).toBeGreaterThanOrEqual(2);
    await pool.dispose();
  }, 120_000);

  it('same seed and position give the same move at a fixed depth', async () => {
    const pool = new EnginePool([new StockfishProcess({ path: STOCKFISH_PATH })]);
    const app = await appWith(pool);
    const body = { fen: START_FEN, targetRating: 900, seed: 7 };
    const a = (await post(app, body)).json() as { move: string };
    const b = (await post(app, body)).json() as { move: string };
    expect(a.move).toBe(b.move);
    await pool.dispose();
  }, 60_000);
});
