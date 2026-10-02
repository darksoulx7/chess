import type { GamePlayerSummary, GameSummary } from '@chess/game-types';
import type { Db } from '../../infrastructure/db.js';
import type { ValidatedGame, SubmittedGame } from './validate.js';

interface GameRow {
  id: string;
  mode: GameSummary['mode'];
  result: GameSummary['result'];
  termination: GameSummary['termination'];
  ended_at: Date | null;
  ply_count: number;
  bot_rating: number | null;
  opening_name: string | null;
  eco: string | null;
  time_base_ms: number | null;
  time_increment_ms: number | null;
  players: Array<{
    color: 'w' | 'b';
    name: string;
    is_bot: boolean;
    bot_rating: number | null;
    user_id: string | null;
  }>;
}

const SELECT = `
  select g.id, g.mode, g.result, g.termination, g.ended_at, g.ply_count, g.bot_rating, g.opening_name, g.eco,
         g.time_base_ms, g.time_increment_ms,
         coalesce((select json_agg(json_build_object('color', p.color, 'name', p.display_name, 'is_bot', p.is_bot, 'bot_rating', p.bot_rating, 'user_id', p.user_id) order by p.color desc)
                     from game_players p where p.game_id = g.id), '[]'::json) as players
    from games g`;

function toSummary(row: GameRow, userId: string): GameSummary {
  const players: GamePlayerSummary[] = row.players.map((p) => ({
    color: p.color,
    name: p.name,
    isBot: p.is_bot,
    botRating: p.bot_rating,
  }));
  // In LOCAL games the same account fills both seats; "my colour" is then undefined.
  const mine = row.players.filter((p) => p.user_id === userId);
  return {
    id: row.id,
    mode: row.mode,
    result: row.result,
    termination: row.termination,
    endedAt: row.ended_at ? row.ended_at.toISOString() : null,
    plyCount: row.ply_count,
    botRating: row.bot_rating,
    openingName: row.opening_name,
    eco: row.eco,
    timeBaseMs: row.time_base_ms,
    timeIncrementMs: row.time_increment_ms,
    myColor: mine.length === 1 ? (mine[0] as { color: 'w' | 'b' }).color : null,
    players,
  };
}

const encodeCursor = (endedAt: Date, id: string) =>
  Buffer.from(JSON.stringify({ t: endedAt.toISOString(), id })).toString('base64url');
function decodeCursor(cursor: string): { t: string; id: string } | null {
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      t?: unknown;
      id?: unknown;
    };
    if (
      typeof v.t !== 'string' ||
      typeof v.id !== 'string' ||
      Number.isNaN(Date.parse(v.t)) ||
      !/^[0-9a-f-]{36}$/i.test(v.id)
    )
      return null;
    return { t: v.t, id: v.id };
  } catch {
    return null;
  }
}

/** A user's games, newest first, with keyset pagination on (ended_at, id). */
export async function listGames(
  db: Db,
  userId: string,
  opts: { limit: number; cursor?: string | undefined },
): Promise<{ items: GameSummary[]; nextCursor: string | null; invalidCursor?: boolean }> {
  const limit = Math.max(1, Math.min(opts.limit, 100));
  const cursor = opts.cursor ? decodeCursor(opts.cursor) : null;
  if (opts.cursor && !cursor) return { items: [], nextCursor: null, invalidCursor: true };
  const r = await db.query<GameRow>(
    `${SELECT}
      where g.status = 'FINISHED' and g.ended_at is not null
        and exists (select 1 from game_players me where me.game_id = g.id and me.user_id = $1)
        ${cursor ? 'and (g.ended_at, g.id) < ($3::timestamptz, $4::uuid)' : ''}
      order by g.ended_at desc, g.id desc
      limit $2`,
    cursor ? [userId, limit + 1, cursor.t, cursor.id] : [userId, limit + 1],
  );
  const page = r.rows.slice(0, limit);
  const last = page.at(-1);
  const more = r.rows.length > limit && last?.ended_at;
  return {
    items: page.map((row) => toSummary(row, userId)),
    nextCursor: more && last?.ended_at ? encodeCursor(last.ended_at, last.id) : null,
  };
}

export interface GameDetail extends GameSummary {
  pgn: string;
  initialFen: string;
  finalFen: string;
}

/** One game the user owns or played in; null otherwise (callers answer 404 so existence is not leaked). */
export async function getGame(db: Db, userId: string, gameId: string): Promise<GameDetail | null> {
  const r = await db.query<GameRow & { pgn: string; initial_fen: string; current_fen: string }>(
    `select s.*, g2.pgn, g2.initial_fen, g2.current_fen from (${SELECT} where g.id = $1
        and (g.owner_id = $2 or exists (select 1 from game_players p where p.game_id = g.id and p.user_id = $2))) s
      join games g2 on g2.id = s.id`,
    [gameId, userId],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    ...toSummary(row, userId),
    pgn: row.pgn,
    initialFen: row.initial_fen,
    finalFen: row.current_fen,
  };
}

export interface InsertGameInput {
  userId: string;
  displayName: string;
  clientId?: string | undefined;
  submitted: SubmittedGame;
  validated: ValidatedGame;
  clock?: { baseMs: number; incrementMs: number } | undefined;
}

export type InsertGameResult = { id: string; duplicate: boolean };

/** Stores a finished game with its players and moves in one transaction; idempotent per (owner, clientId). */
export async function insertGame(db: Db, input: InsertGameInput): Promise<InsertGameResult> {
  const { userId, submitted, validated } = input;
  const client = await db.connect();
  try {
    await client.query('begin');
    if (input.clientId) {
      const existing = await client.query<{ id: string }>(
        'select id from games where owner_id = $1 and client_id = $2',
        [userId, input.clientId],
      );
      if (existing.rows[0]) {
        await client.query('rollback');
        return { id: existing.rows[0].id, duplicate: true };
      }
    }
    const human = submitted.humanColor ?? 'w';
    const g = await client.query<{ id: string }>(
      `insert into games (owner_id, client_id, mode, status, initial_fen, current_fen, pgn, result, termination,
                          opening_id, opening_name, eco, time_base_ms, time_increment_ms, bot_rating, ply_count, source, started_at, ended_at)
       values ($1, $2, $3, 'FINISHED', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'client', now(), now())
       returning id`,
      [
        userId,
        input.clientId ?? null,
        submitted.mode,
        validated.initialFen,
        validated.finalFen,
        validated.game.getPgn({
          Event: submitted.mode === 'BOT' ? 'Bot game' : 'Local game',
          Result: submitted.result,
        }),
        submitted.result,
        submitted.termination,
        validated.opening?.id ?? null,
        validated.opening?.name ?? null,
        validated.opening?.eco ?? null,
        input.clock?.baseMs ?? null,
        input.clock?.incrementMs ?? null,
        submitted.botRating ?? null,
        validated.moves.length,
      ],
    );
    const id = (g.rows[0] as { id: string }).id;
    const players =
      submitted.mode === 'BOT'
        ? [
            {
              color: human,
              userId,
              name: input.displayName,
              isBot: false,
              rating: null as number | null,
            },
            {
              color: human === 'w' ? 'b' : 'w',
              userId: null as string | null,
              name: `Bot ${submitted.botRating}`,
              isBot: true,
              rating: submitted.botRating ?? null,
            },
          ]
        : [
            { color: 'w', userId, name: 'White', isBot: false, rating: null },
            { color: 'b', userId, name: 'Black', isBot: false, rating: null },
          ];
    for (const p of players) {
      await client.query(
        'insert into game_players (game_id, color, user_id, display_name, is_bot, bot_rating) values ($1, $2, $3, $4, $5, $6)',
        [id, p.color, p.userId, p.name, p.isBot, p.rating],
      );
    }
    await client.query(
      `insert into game_moves (game_id, ply, uci, san, fen_after)
       select $1, ply, uci, san, fen from unnest($2::int[], $3::text[], $4::text[], $5::text[]) as t(ply, uci, san, fen)`,
      [
        id,
        validated.moves.map((_, i) => i + 1),
        validated.moves.map((m) => m.lan),
        validated.moves.map((m) => m.san),
        validated.moves.map((m) => m.after),
      ],
    );
    await client.query('commit');
    return { id, duplicate: false };
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteGame(db: Db, userId: string, gameId: string): Promise<boolean> {
  const r = await db.query('delete from games where id = $1 and owner_id = $2', [gameId, userId]);
  return (r.rowCount ?? 0) > 0;
}
