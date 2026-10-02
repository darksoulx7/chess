import type { FastifyInstance } from 'fastify';
import type { Db } from '../../infrastructure/db.js';
import type { RedisClient } from '../../infrastructure/redis.js';

export interface HealthDeps {
  db: Db;
  redis: RedisClient;
}

type Check = 'ok' | 'down';

async function probe(fn: () => Promise<unknown>, timeoutMs = 2_000): Promise<Check> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      }),
    ]);
    return 'ok';
  } catch {
    return 'down';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function registerHealthRoutes(app: FastifyInstance, deps: HealthDeps): void {
  // Liveness: process is up. Used by Render's health check.
  app.get('/health', async () => ({ status: 'ok' }));

  // Readiness: dependencies reachable.
  app.get('/health/ready', async (_req, reply) => {
    const [database, redis] = await Promise.all([
      probe(() => deps.db.query('select 1')),
      probe(() => deps.redis.ping()),
    ]);
    const ready = database === 'ok' && redis === 'ok';
    return reply
      .code(ready ? 200 : 503)
      .send({ status: ready ? 'ok' : 'degraded', database, redis });
  });
}
