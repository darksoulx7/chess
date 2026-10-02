import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Db } from './infrastructure/db.js';
import type { RedisClient } from './infrastructure/redis.js';
import { registerHealthRoutes } from './modules/health/routes.js';
import type { Env } from './shared/env.js';

export interface AppDeps {
  env: Env;
  db: Db;
  redis: RedisClient;
}

export async function buildApp({ env, db, redis }: AppDeps): Promise<FastifyInstance> {
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

  registerHealthRoutes(app, { db, redis });

  return app;
}
