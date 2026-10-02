import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { EngineService } from '@chess/engine';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Db } from './infrastructure/db.js';
import type { RedisClient } from './infrastructure/redis.js';
import { RedisAnalysisCache, type AnalysisCache } from './modules/analysis/cache.js';
import { registerAnalysisRoutes } from './modules/analysis/routes.js';
import { registerAuthPlugin } from './modules/auth/plugin.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { AuthService } from './modules/auth/service.js';
import { LoginThrottle } from './modules/auth/login-throttle.js';
import { registerGameRoutes } from './modules/games/routes.js';
import { registerSavedGameRoutes } from './modules/games/saved-routes.js';
import { registerUserRoutes } from './modules/users/routes.js';
import { GameHub } from './modules/online/hub.js';
import { registerOnlineRoutes } from './modules/online/routes.js';
import { OnlineService } from './modules/online/service.js';
import { registerOnlineSocket } from './modules/online/ws.js';
import { registerBotRoutes } from './modules/bot/routes.js';
import { registerHealthRoutes } from './modules/health/routes.js';
import type { Env } from './shared/env.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Online games service (exposed for tests and the sweeper). */
    online: OnlineService;
  }
}

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
            redact: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.body.password',
              'req.body.refreshToken',
              'req.body.identifier',
            ],
          },
    genReqId: () => crypto.randomUUID(),
    requestIdHeader: 'x-request-id',
  });

  await app.register(cors, {
    origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : false,
    credentials: true,
    // The default only allows GET/HEAD/POST, which silently blocks every PUT/PATCH/DELETE from a browser.
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type', 'x-request-id'],
    exposedHeaders: ['retry-after', 'x-request-id'],
    maxAge: 600,
  });
  await app.register(helmet, { contentSecurityPolicy: false }); // JSON API; CSP is the web host's concern
  await app.register(websocket, { options: { maxPayload: 16 * 1024 } });
  // Global default; the expensive bot route sets its own, lower limit. /health is exempt (platform probes).
  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    allowList: (req) => req.url.startsWith('/health'),
  });

  registerAuthPlugin(app, env);
  const throttle = new LoginThrottle(redis, env.LOGIN_MAX_FAILURES, 15 * 60, (err) =>
    app.log.warn({ err }, 'login throttle error'),
  );
  const authService = new AuthService(db, env, throttle);
  registerAuthRoutes(app, { service: authService, db, rateLimitMax: env.AUTH_RATE_LIMIT_MAX });

  // Online games: HTTP for create/join/lobby, WebSocket for play. The sweeper ends timed-out games.
  const hub = new GameHub(redis, (err, context) => app.log.warn({ err, context }, 'online hub'));
  await hub.start();
  const online = new OnlineService(db, hub, Date.now, (err, context) =>
    app.log.warn({ err, context }, 'online service'),
  );
  registerOnlineRoutes(app, { service: online, db, rateLimitMax: env.ONLINE_RATE_LIMIT_MAX });
  registerOnlineSocket(app, {
    service: online,
    hub,
    db,
    jwtSecret: env.JWT_SECRET,
    ratePerSecond: env.WS_RATE_PER_SECOND,
    authTimeoutMs: env.WS_AUTH_TIMEOUT_MS,
  });
  app.decorate('online', online);
  if (env.NODE_ENV !== 'test') {
    const sweeper = setInterval(
      () => void online.sweep().catch((err) => app.log.warn({ err }, 'sweep failed')),
      env.ONLINE_SWEEP_MS,
    );
    app.addHook('onClose', async () => clearInterval(sweeper));
  }
  app.addHook('onClose', async () => hub.stop());

  registerUserRoutes(app, { db });
  registerGameRoutes(app, { db });
  registerSavedGameRoutes(app, { db });

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
