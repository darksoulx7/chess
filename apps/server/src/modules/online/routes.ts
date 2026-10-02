import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../infrastructure/db.js';
import { findUserById } from '../auth/repository.js';
import type { OnlineService } from './service.js';

const uuid = z.string().uuid();

const createSchema = z.object({
  clock: z
    .object({
      baseMs: z.number().int().min(15_000).max(10_800_000),
      incrementMs: z.number().int().min(0).max(180_000),
    })
    .nullable()
    .default(null),
  color: z.enum(['w', 'b', 'random']).default('random'),
  public: z.boolean().default(false),
});
const joinByCodeSchema = z.object({ code: z.string().trim().min(4).max(20) });

export function registerOnlineRoutes(
  app: FastifyInstance,
  deps: { service: OnlineService; db: Db; rateLimitMax: number },
): void {
  const auth = { preHandler: app.authenticate };
  const limited = (max: number) => ({
    preHandler: app.authenticate,
    config: { rateLimit: { max, timeWindow: '1 minute' } },
  });

  const username = async (userId: string) =>
    (await findUserById(deps.db, userId))?.username ?? null;
  const joinError = (reply: FastifyReply, error: 'not_found' | 'own_game' | 'not_open') =>
    reply.code(error === 'not_found' ? 404 : 409).send({ error });

  app.post('/api/online/games', limited(deps.rateLimitMax), async (req, reply) => {
    const body = createSchema.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'invalid_request' });
    const name = await username(req.userId as string);
    if (!name) return reply.code(401).send({ error: 'unauthorized' });
    const game = await deps.service.create(req.userId as string, name, {
      color: body.data.color,
      clockConfig: body.data.clock
        ? { initialMs: body.data.clock.baseMs, incrementMs: body.data.clock.incrementMs }
        : null,
      isPublic: body.data.public,
    });
    return reply.code(201).send({ game });
  });

  app.post('/api/online/games/join', limited(deps.rateLimitMax * 2), async (req, reply) => {
    const body = joinByCodeSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_request' });
    const name = await username(req.userId as string);
    if (!name) return reply.code(401).send({ error: 'unauthorized' });
    const r = await deps.service.join(req.userId as string, name, { code: body.data.code });
    return r.ok ? reply.send({ game: r.game }) : joinError(reply, r.error);
  });

  app.post('/api/online/games/:id/join', limited(deps.rateLimitMax * 2), async (req, reply) => {
    const id = uuid.safeParse((req.params as { id: string }).id);
    if (!id.success) return reply.code(404).send({ error: 'not_found' });
    const name = await username(req.userId as string);
    if (!name) return reply.code(401).send({ error: 'unauthorized' });
    const r = await deps.service.join(req.userId as string, name, { gameId: id.data });
    return r.ok ? reply.send({ game: r.game }) : joinError(reply, r.error);
  });

  app.get('/api/online/lobby', auth, async (req, reply) =>
    reply.send({ items: await deps.service.lobby(req.userId as string) }),
  );

  app.get('/api/online/active', auth, async (req, reply) =>
    reply.send({ items: await deps.service.active(req.userId as string) }),
  );

  app.get('/api/online/games/:id', auth, async (req, reply) => {
    const id = uuid.safeParse((req.params as { id: string }).id);
    const game = id.success ? await deps.service.snapshotFor(req.userId as string, id.data) : null;
    if (!game) return reply.code(404).send({ error: 'not_found' });
    return reply.send({ game });
  });

  app.delete('/api/online/games/:id', auth, async (req, reply) => {
    const id = uuid.safeParse((req.params as { id: string }).id);
    if (!id.success || !(await deps.service.cancel(req.userId as string, id.data)))
      return reply.code(404).send({ error: 'not_found' });
    return reply.code(204).send();
  });
}
