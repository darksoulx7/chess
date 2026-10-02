import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { EngineService } from '@chess/engine';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Db } from './infrastructure/db.js';
import type { RedisClient } from './infrastructure/redis.js';
import { RedisAnalysisCache, type AnalysisCache } from './modules/analysis/cache.js';
import { registerAnalysisRoutes } from './modules/analysis/routes.js';
import { registerBotRoutes } from './modules/bot/routes.js';
import { registerHealthRoutes } from './modules/health/routes.js';
import type { Env } from './shared/env.js';

export interface AppDeps {
  env: Env;
  db: Db;
  redis: RedisClient;
  engine: EngineService;
  /** Analysis result cache; defaults to Redis. Injectable so tests never share cached results. */
  cache?: AnalysisCache;
}

export async function buildApp({
  env,
  db,
  redis,
  engine,
  cache,
}: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      env.NODE_ENV === 'test'
        ? false
        : {
            level: env.LOG_LEVEL,
            // Never log credentials or tokens.
            redact: ['req.headers.authorization', 'req.headers.cookie', 'req.body.password'],
          },
    genReqId: () => crypto.randomUUID(),
    requestIdHeader: 'x-request-id',
  });

  await app.register(cors, {
    origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : false,
    credentials: true,
  });
  await app.register(websocket);
  // Global default; the expensive bot route sets its own, lower limit. /health is exempt (platform probes).
  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    allowList: (req) => req.url.startsWith('/health'),
  });

  registerHealthRoutes(app, { db, redis });
  registerBotRoutes(app, { engine, rateLimitMax: env.BOT_RATE_LIMIT_MAX });
  registerAnalysisRoutes(app, {
    engine,
    cache:
      cache ??
      new RedisAnalysisCache(redis, 60 * 60 * 24, (err) =>
        app.log.warn({ err }, 'analysis cache error'),
      ),
    rateLimitMax: env.ANALYSIS_RATE_LIMIT_MAX,
    maxSearchMs: env.ANALYSIS_MAX_MS,
  });

  return app;
}
