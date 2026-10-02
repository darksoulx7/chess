import { MAX_PGN_LENGTH } from '@chess/chess-core';
import { GAME_RESULTS, TERMINATIONS } from '@chess/game-types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../infrastructure/db.js';
import { findUserById } from '../auth/repository.js';
import { deleteGame, getGame, insertGame, listGames } from './repository.js';
import { validateSubmittedGame } from './validate.js';

const uuid = z.string().uuid();

const saveSchema = z.object({
  clientId: uuid.optional(),
  mode: z.enum(['BOT', 'LOCAL']),
  pgn: z.string().min(1).max(MAX_PGN_LENGTH),
  result: z.enum(GAME_RESULTS),
  termination: z.enum(TERMINATIONS),
  humanColor: z.enum(['w', 'b']).optional(),
  botRating: z.number().int().min(100).max(2500).optional(),
  clock: z
    .object({
      baseMs: z.number().int().min(1000).max(86_400_000),
      incrementMs: z.number().int().min(0).max(3_600_000),
    })
    .optional(),
});

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(300).optional(),
});

const reviewSchema = z.object({
  depth: z.number().int().min(1).max(30),
  result: z
    .object({
      moves: z.array(z.unknown()).max(1000),
      white: z.unknown(),
      black: z.unknown(),
      whiteEvals: z.array(z.number()).max(1001),
    })
    .passthrough(),
});

export function registerGameRoutes(app: FastifyInstance, { db }: { db: Db }): void {
  const auth = { preHandler: app.authenticate };

  app.post('/api/games', { ...auth, bodyLimit: 512 * 1024 }, async (req, reply) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({
        error: 'invalid_request',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    const checked = validateSubmittedGame(parsed.data);
    if (!checked.ok)
      return reply.code(400).send({ error: 'invalid_game', message: checked.message });
    const user = await findUserById(db, req.userId as string);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    const saved = await insertGame(db, {
      userId: user.id,
      displayName: user.username,
      clientId: parsed.data.clientId,
      submitted: parsed.data,
      validated: checked.value,
      clock: parsed.data.clock,
    });
    return reply.code(saved.duplicate ? 200 : 201).send(saved);
  });

  app.get('/api/games', auth, async (req, reply) => {
    const q = listSchema.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_request' });
    const page = await listGames(db, req.userId as string, {
      limit: q.data.limit,
      cursor: q.data.cursor,
    });
    if (page.invalidCursor) return reply.code(400).send({ error: 'invalid_cursor' });
    return reply.send({ items: page.items, nextCursor: page.nextCursor });
  });

  app.get('/api/games/:id', auth, async (req, reply) => {
    const id = uuid.safeParse((req.params as { id: string }).id);
    const game = id.success ? await getGame(db, req.userId as string, id.data) : null;
    if (!game) return reply.code(404).send({ error: 'not_found' });
    return reply.send({ game });
  });

  app.get('/api/games/:id/pgn', auth, async (req, reply) => {
    const id = uuid.safeParse((req.params as { id: string }).id);
    const game = id.success ? await getGame(db, req.userId as string, id.data) : null;
    if (!game) return reply.code(404).send({ error: 'not_found' });
    return reply
      .header('content-type', 'application/x-chess-pgn; charset=utf-8')
      .header('content-disposition', `attachment; filename="game-${game.id}.pgn"`)
      .send(game.pgn);
  });

  app.delete('/api/games/:id', auth, async (req, reply) => {
    const id = uuid.safeParse((req.params as { id: string }).id);
    if (!id.success || !(await deleteGame(db, req.userId as string, id.data)))
      return reply.code(404).send({ error: 'not_found' });
    return reply.code(204).send();
  });

  // Stored game review (analysis_results): one latest result per game.
  app.put('/api/games/:id/review', { ...auth, bodyLimit: 1024 * 1024 }, async (req, reply) => {
    const id = uuid.safeParse((req.params as { id: string }).id);
    const body = reviewSchema.safeParse(req.body);
    if (!id.success || !(await getGame(db, req.userId as string, id.data)))
      return reply.code(404).send({ error: 'not_found' });
    if (!body.success) return reply.code(400).send({ error: 'invalid_request' });
    await db.query(
      'delete from analysis_results where game_id = $1 and user_id = $2 and kind = $3',
      [id.data, req.userId, 'review'],
    );
    await db.query(
      'insert into analysis_results (user_id, game_id, kind, depth, result) values ($1, $2, $3, $4, $5::jsonb)',
      [req.userId, id.data, 'review', body.data.depth, JSON.stringify(body.data.result)],
    );
    return reply.code(204).send();
  });

  app.get('/api/games/:id/review', auth, async (req, reply) => {
    const id = uuid.safeParse((req.params as { id: string }).id);
    if (!id.success || !(await getGame(db, req.userId as string, id.data)))
      return reply.code(404).send({ error: 'not_found' });
    const r = await db.query<{ depth: number; result: unknown; created_at: Date }>(
      `select depth, result, created_at from analysis_results where game_id = $1 and user_id = $2 and kind = 'review' order by created_at desc limit 1`,
      [id.data, req.userId],
    );
    const row = r.rows[0];
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return reply.send({
      depth: row.depth,
      result: row.result,
      createdAt: row.created_at.toISOString(),
    });
  });
}
