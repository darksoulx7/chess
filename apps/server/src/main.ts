import { buildApp } from './app.js';
import { EnginePool } from './modules/analysis/engine-pool.js';
import { StockfishProcess } from './modules/analysis/stockfish-process.js';
import { createDb } from './infrastructure/db.js';
import { createRedis } from './infrastructure/redis.js';
import { loadEnv } from './shared/env.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const db = createDb(env.DATABASE_URL);
  const redis = createRedis(env.REDIS_URL);
  const engine = new EnginePool(
    Array.from(
      { length: env.ENGINE_POOL_SIZE },
      () =>
        new StockfishProcess({
          path: env.STOCKFISH_PATH,
          onLog: (m, extra) => console.warn(m, extra),
        }),
    ),
    env.ENGINE_MAX_QUEUE,
  );
  const app = await buildApp({ env, db, redis, engine });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
      await Promise.all([db.end(), redis.quit(), engine.dispose()]);
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: env.PORT, host: env.HOST });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
