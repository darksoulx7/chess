import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Env } from '../../shared/env.js';
import { verifyAccessToken } from './tokens.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `app.authenticate` after a valid access token. */
    userId: string | null;
  }
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/** Registers `app.authenticate`, a preHandler that requires a valid `Authorization: Bearer <access token>`. */
export function registerAuthPlugin(app: FastifyInstance, env: Pick<Env, 'JWT_SECRET'>): void {
  app.decorateRequest('userId', null);
  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization;
    const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null;
    const claims = match ? await verifyAccessToken(match[1] as string, env.JWT_SECRET) : null;
    if (!claims) {
      await reply.code(401).header('www-authenticate', 'Bearer').send({ error: 'unauthorized' });
      return;
    }
    req.userId = claims.userId;
  });
}
