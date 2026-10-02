import {
  AVATAR_IDS,
  preferencesSchema,
  type GameSummary,
  type ProfileStats,
} from '@chess/game-types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../infrastructure/db.js';
import { verifyPassword } from '../auth/passwords.js';
import { USERNAME_RE } from '../auth/routes.js';
import { findUserById, revokeAllSessions, toPublicUser } from '../auth/repository.js';
import { listGames } from '../games/repository.js';

const patchSchema = z
  .object({
    username: z
      .string()
      .trim()
      .regex(USERNAME_RE, 'Username must be 3-20 letters, numbers or underscores.')
      .optional(),
    avatar: z.enum(AVATAR_IDS).optional(),
  })
  .refine((v) => v.username !== undefined || v.avatar !== undefined, {
    message: 'Nothing to update.',
  });

export interface UserRouteDeps {
  db: Db;
}

export function registerUserRoutes(app: FastifyInstance, { db }: UserRouteDeps): void {
  const auth = { preHandler: app.authenticate };

  app.get('/api/me', auth, async (req, reply) => {
    const user = await findUserById(db, req.userId as string);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    return reply.send({ user: toPublicUser(user) });
  });

  app.patch('/api/me', auth, async (req, reply) => {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_request',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    try {
      const r = await db.query(
        `update users set username = coalesce($2, username), avatar = coalesce($3, avatar), updated_at = now() where id = $1 returning *`,
        [req.userId, parsed.data.username ?? null, parsed.data.avatar ?? null],
      );
      if (r.rowCount === 0) return reply.code(401).send({ error: 'unauthorized' });
      return reply.send({ user: toPublicUser(r.rows[0]) });
    } catch (err) {
      if ((err as { code?: string }).code === '23505')
        return reply.code(409).send({ error: 'username_taken' });
      throw err;
    }
  });

  // Account deletion: requires the password (a stolen access token alone cannot erase the account).
  app.delete('/api/me', auth, async (req, reply) => {
    const parsed = z.object({ password: z.string().min(1).max(1024) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    const user = await findUserById(db, req.userId as string);
    if (!user || !(await verifyPassword(user.password_hash, parsed.data.password))) {
      return reply.code(403).send({ error: 'invalid_credentials' });
    }
    await revokeAllSessions(db, user.id);
    // Owned games go with the account (the FK would otherwise only null the owner and keep the data).
    const client = await db.connect();
    try {
      await client.query('begin');
      await client.query('delete from games where owner_id = $1', [user.id]);
      await client.query('delete from users where id = $1', [user.id]);
      await client.query('commit');
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    return reply.code(204).send();
  });

  app.get('/api/me/preferences', auth, async (req, reply) => {
    const r = await db.query<{ data: unknown }>(
      'select data from user_preferences where user_id = $1',
      [req.userId],
    );
    // Re-validate on read so a row written by an older version can never break a client.
    const parsed = preferencesSchema.safeParse(r.rows[0]?.data ?? {});
    return reply.send({ preferences: parsed.success ? parsed.data : {} });
  });

  app.put('/api/me/preferences', auth, async (req, reply) => {
    const parsed = preferencesSchema.safeParse(req.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: 'invalid_request', issues: parsed.error.issues.map((i) => i.message) });
    await db.query(
      `insert into user_preferences (user_id, data) values ($1, $2::jsonb)
       on conflict (user_id) do update set data = excluded.data, updated_at = now()`,
      [req.userId, JSON.stringify(parsed.data)],
    );
    return reply.send({ preferences: parsed.data });
  });

  app.get('/api/me/stats', auth, async (req, reply) => {
    const userId = req.userId as string;
    // LOCAL games are one person playing both sides, so they do not count towards results.
    const totals = await db.query<{ games: number; wins: number; losses: number; draws: number }>(
      `select count(*)::int as games,
              count(*) filter (where (gp.color = 'w' and g.result = '1-0') or (gp.color = 'b' and g.result = '0-1'))::int as wins,
              count(*) filter (where (gp.color = 'w' and g.result = '0-1') or (gp.color = 'b' and g.result = '1-0'))::int as losses,
              count(*) filter (where g.result = '1/2-1/2')::int as draws
         from game_players gp join games g on g.id = gp.game_id
        where gp.user_id = $1 and gp.is_bot = false and g.mode in ('BOT', 'ONLINE') and g.status = 'FINISHED' and g.result <> '*'`,
      [userId],
    );
    const t = totals.rows[0] ?? { games: 0, wins: 0, losses: 0, draws: 0 };
    const openings = await db.query<{ name: string; eco: string | null; count: number }>(
      `select g.opening_name as name, min(g.eco) as eco, count(*)::int as count
         from games g join game_players gp on gp.game_id = g.id
        where gp.user_id = $1 and gp.is_bot = false and g.opening_name is not null
        group by g.opening_name order by count desc, name limit 5`,
      [userId],
    );
    const recent: GameSummary[] = (await listGames(db, userId, { limit: 5 })).items;
    const stats: ProfileStats = {
      gamesPlayed: t.games,
      wins: t.wins,
      losses: t.losses,
      draws: t.draws,
      winRate: t.games > 0 ? t.wins / t.games : 0,
      favoriteOpenings: openings.rows,
      recentGames: recent,
    };
    return reply.send(stats);
  });
}
