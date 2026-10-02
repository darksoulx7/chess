import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { findUserById, toPublicUser } from './repository.js';
import type { Db } from '../../infrastructure/db.js';
import { validatePassword } from './passwords.js';
import type { AuthService } from './service.js';

export const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  username: z
    .string()
    .trim()
    .regex(USERNAME_RE, 'Username must be 3-20 letters, numbers or underscores.'),
  password: z.string().max(1024),
});
const loginSchema = z.object({
  identifier: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(1024),
});
const tokenSchema = z.object({ refreshToken: z.string().min(20).max(200) });

export interface AuthRouteDeps {
  service: AuthService;
  db: Db;
  rateLimitMax: number;
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDeps): void {
  const limit = { config: { rateLimit: { max: deps.rateLimitMax, timeWindow: '1 minute' } } };
  const ua = (h: string | string[] | undefined) => (typeof h === 'string' ? h : null);

  app.post('/api/auth/register', limit, async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_request',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const weak = validatePassword(parsed.data.password);
    if (weak)
      return reply
        .code(400)
        .send({ error: 'invalid_request', issues: [{ path: 'password', message: weak }] });

    const result = await deps.service.register(parsed.data, ua(req.headers['user-agent']));
    if (!result.ok) return reply.code(409).send({ error: result.error });
    return reply.code(201).send({ user: result.user, ...result.tokens });
  });

  app.post('/api/auth/login', limit, async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    const result = await deps.service.login(
      parsed.data.identifier,
      parsed.data.password,
      ua(req.headers['user-agent']),
    );
    if (!result.ok) {
      if (result.error === 'too_many_attempts') {
        return reply
          .code(429)
          .header('retry-after', String(result.retryAfter))
          .send({ error: result.error });
      }
      return reply.code(401).send({ error: result.error });
    }
    return reply.send({ user: result.user, ...result.tokens });
  });

  app.post('/api/auth/refresh', limit, async (req, reply) => {
    const parsed = tokenSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    const result = await deps.service.refresh(
      parsed.data.refreshToken,
      ua(req.headers['user-agent']),
    );
    if (!result.ok)
      return reply
        .code(result.error === 'refresh_conflict' ? 409 : 401)
        .send({ error: result.error });
    return reply.send({ user: result.user, ...result.tokens });
  });

  // Always 204: never reveal whether a token was valid.
  app.post('/api/auth/logout', limit, async (req, reply) => {
    const parsed = tokenSchema.safeParse(req.body);
    if (parsed.success) await deps.service.logout(parsed.data.refreshToken);
    return reply.code(204).send();
  });

  app.get('/api/auth/session', { preHandler: app.authenticate }, async (req, reply) => {
    const user = req.userId ? await findUserById(deps.db, req.userId) : null;
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    return reply.send({ user: toPublicUser(user) });
  });
}
