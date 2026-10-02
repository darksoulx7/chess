import { ChessGame, MAX_PGN_LENGTH } from '@chess/chess-core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../infrastructure/db.js';

const uuid = z.string().uuid();
export const MAX_SAVED_GAMES = 500;

const nameSchema = z.string().trim().min(1).max(100);
const createSchema = z
  .object({
    name: nameSchema,
    pgn: z.string().min(1).max(MAX_PGN_LENGTH).optional(),
    gameId: uuid.optional(),
  })
  .refine((v) => v.pgn !== undefined || v.gameId !== undefined, {
    message: 'Provide a pgn or a gameId.',
  });

interface SavedRow {
  id: string;
  name: string;
  pgn: string;
  initial_fen: string;
  ply_count: number;
  result: string;
  game_id: string | null;
  created_at: Date;
  updated_at: Date;
}

const summary = (r: SavedRow) => ({
  id: r.id,
  name: r.name,
  plyCount: r.ply_count,
  result: r.result,
  gameId: r.game_id,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

/** Result code derivable from the board alone ('*' when the game is simply unfinished or ended off-board). */
function boardResult(game: ChessGame): string {
  const s = game.getStatus();
  return s.state === 'checkmate'
    ? s.winner === 'w'
      ? '1-0'
      : '0-1'
    : s.state === 'draw'
      ? '1/2-1/2'
      : '*';
}

export function registerSavedGameRoutes(app: FastifyInstance, { db }: { db: Db }): void {
  const auth = { preHandler: app.authenticate };
  const idOf = (req: { params: unknown }) => uuid.safeParse((req.params as { id: string }).id);

  app.post('/api/saved-games', { ...auth, bodyLimit: 512 * 1024 }, async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: 'invalid_request', issues: parsed.error.issues.map((i) => i.message) });
    const userId = req.userId as string;

    const count =
      (
        await db.query<{ n: number }>(
          'select count(*)::int as n from saved_games where user_id = $1',
          [userId],
        )
      ).rows[0]?.n ?? 0;
    if (count >= MAX_SAVED_GAMES)
      return reply.code(409).send({ error: 'limit_reached', limit: MAX_SAVED_GAMES });

    let pgn = parsed.data.pgn;
    let gameId: string | null = null;
    if (parsed.data.gameId) {
      const owned = await db.query<{ pgn: string }>(
        'select pgn from games where id = $1 and owner_id = $2',
        [parsed.data.gameId, userId],
      );
      if (!owned.rows[0]) return reply.code(404).send({ error: 'not_found' });
      gameId = parsed.data.gameId;
      pgn ??= owned.rows[0].pgn;
    }
    const loaded = ChessGame.fromPgn(pgn as string);
    if (!loaded.ok)
      return reply.code(400).send({ error: 'invalid_game', message: 'PGN is not a valid game.' });
    const game = loaded.value;

    const r = await db.query<SavedRow>(
      `insert into saved_games (user_id, game_id, name, pgn, initial_fen, ply_count, result) values ($1, $2, $3, $4, $5, $6, $7) returning *`,
      [
        userId,
        gameId,
        parsed.data.name,
        game.getPgn(),
        game.getInitialFen(),
        game.getHistory().length,
        boardResult(game),
      ],
    );
    return reply.code(201).send({ savedGame: summary(r.rows[0] as SavedRow) });
  });

  app.get('/api/saved-games', auth, async (req, reply) => {
    const r = await db.query<SavedRow>(
      'select * from saved_games where user_id = $1 order by updated_at desc, id desc limit $2',
      [req.userId, MAX_SAVED_GAMES],
    );
    return reply.send({ items: r.rows.map(summary) });
  });

  app.get('/api/saved-games/:id', auth, async (req, reply) => {
    const id = idOf(req);
    const r = id.success
      ? await db.query<SavedRow>('select * from saved_games where id = $1 and user_id = $2', [
          id.data,
          req.userId,
        ])
      : null;
    const row = r?.rows[0];
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return reply.send({
      savedGame: { ...summary(row), pgn: row.pgn, initialFen: row.initial_fen },
    });
  });

  app.get('/api/saved-games/:id/pgn', auth, async (req, reply) => {
    const id = idOf(req);
    const r = id.success
      ? await db.query<SavedRow>('select * from saved_games where id = $1 and user_id = $2', [
          id.data,
          req.userId,
        ])
      : null;
    const row = r?.rows[0];
    if (!row) return reply.code(404).send({ error: 'not_found' });
    const safeName = row.name.replace(/[^A-Za-z0-9_. -]/g, '_').slice(0, 60) || 'game';
    return reply
      .header('content-type', 'application/x-chess-pgn; charset=utf-8')
      .header('content-disposition', `attachment; filename="${safeName}.pgn"`)
      .send(row.pgn);
  });

  app.patch('/api/saved-games/:id', auth, async (req, reply) => {
    const id = idOf(req);
    const body = z.object({ name: nameSchema }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_request' });
    const r = id.success
      ? await db.query<SavedRow>(
          'update saved_games set name = $3, updated_at = now() where id = $1 and user_id = $2 returning *',
          [id.data, req.userId, body.data.name],
        )
      : null;
    const row = r?.rows[0];
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return reply.send({ savedGame: summary(row) });
  });

  app.delete('/api/saved-games/:id', auth, async (req, reply) => {
    const id = idOf(req);
    const r = id.success
      ? await db.query('delete from saved_games where id = $1 and user_id = $2', [
          id.data,
          req.userId,
        ])
      : null;
    if (!r || (r.rowCount ?? 0) === 0) return reply.code(404).send({ error: 'not_found' });
    return reply.code(204).send();
  });
}
