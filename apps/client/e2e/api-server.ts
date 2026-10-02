import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';

export const API_PORT = 4100;
export const API_URL = `http://localhost:${API_PORT}`;

export interface ApiServer {
  stop(): Promise<void>;
}

/** Starts the built server (apps/server/dist) with real Stockfish. Requires Postgres/Redis env like production. */
export async function startApiServer(origins: string[]): Promise<ApiServer> {
  const proc: ChildProcess = spawn('node', [resolve(__dirname, '../../server/dist/main.js')], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(API_PORT),
      HOST: '127.0.0.1',
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://chess:chess@127.0.0.1:5432/chess',
      REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
      CORS_ORIGINS: origins.join(','),
      STOCKFISH_PATH: process.env.STOCKFISH_PATH ?? '/usr/games/stockfish',
      ENGINE_POOL_SIZE: '2',
      JWT_SECRET: process.env.JWT_SECRET ?? 'e2e-secret-e2e-secret-e2e-secret-0123456789',
      // Short-lived access tokens let the e2e suite exercise silent refresh.
      ACCESS_TOKEN_TTL_SECONDS: process.env.ACCESS_TOKEN_TTL_SECONDS ?? '30',
      AUTH_RATE_LIMIT_MAX: '1000',
      LOG_LEVEL: 'warn',
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const exited = new Promise<void>((r) => proc.once('exit', () => r()));

  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${API_URL}/health`);
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
    if (i === 59) {
      proc.kill('SIGKILL');
      throw new Error('API server did not start');
    }
  }
  return {
    async stop() {
      proc.kill('SIGTERM');
      const t = setTimeout(() => proc.kill('SIGKILL'), 3000);
      await exited;
      clearTimeout(t);
    },
  };
}
