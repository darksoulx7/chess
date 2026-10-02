import { randomBytes } from 'node:crypto';
import { START_FEN } from '@chess/chess-core';
import type { ClockConfig, ClockState } from '@chess/game-types';
import type { Db } from '../../infrastructure/db.js';
import { deadlineOf, type DomainGame } from './domain.js';

export interface StoredGame {
  game: DomainGame;
  names: { w: string | null; b: string | null };
  isPublic: boolean;
  code: string | null;
  creatorId: string | null;
  createdAt: Date;
}

interface Row {
  id: string;
  status: DomainGame['status'];
  initial_fen: string;
  result: DomainGame['result'];
  termination: string | null;
  version: number;
  time_base_ms: number | null;
  time_increment_ms: number | null;
  clock: ClockState | null;
  draw_offer_by: 'w' | 'b' | null;
  last_activity_at: Date | null;
  created_at: Date;
  is_public: boolean;
  invite_code: string | null;
  owner_id: string | null;
}

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
export function newInviteCode(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export function normalizeCode(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

async function hydrate(db: Pick<Db, 'query'>, row: Row): Promise<StoredGame> {
  const players = await db.query<{
    color: 'w' | 'b';
    user_id: string | null;
    username: string | null;
  }>(
    `select p.color, p.user_id, u.username from game_players p left join users u on u.id = p.user_id where p.game_id = $1`,
    [row.id],
  );
  const moves = await db.query<{ uci: string }>(
    'select uci from game_moves where game_id = $1 order by ply',
    [row.id],
  );
  const seat = (c: 'w' | 'b') => players.rows.find((p) => p.color === c);
  const clockConfig: ClockConfig | null = row.time_base_ms
    ? { initialMs: row.time_base_ms, incrementMs: row.time_increment_ms ?? 0 }
    : null;
  return {
    game: {
      id: row.id,
      status: row.status,
      initialFen: row.initial_fen,
      moves: moves.rows.map((m) => m.uci),
      players: { w: seat('w')?.user_id ?? null, b: seat('b')?.user_id ?? null },
      clockConfig,
      clock: row.clock,
      drawOfferBy: row.draw_offer_by,
      result: row.result,
      termination: row.termination,
      version: row.version,
      lastActivityAt: (row.last_activity_at ?? row.created_at).getTime(),
    },
    names: { w: seat('w')?.username ?? null, b: seat('b')?.username ?? null },
    isPublic: row.is_public,
    code: row.invite_code,
    creatorId: row.owner_id,
    createdAt: row.created_at,
  };
}

const COLUMNS = `id, status, initial_fen, result, termination, version, time_base_ms, time_increment_ms, clock, draw_offer_by,
                 last_activity_at, created_at, is_public, invite_code, owner_id`;

export async function loadGame(db: Pick<Db, 'query'>, id: string): Promise<StoredGame | null> {
  const r = await db.query<Row>(`select ${COLUMNS} from games where id = $1 and mode = 'ONLINE'`, [
    id,
  ]);
  return r.rows[0] ? hydrate(db, r.rows[0]) : null;
}

export async function loadGameByCode(
  db: Pick<Db, 'query'>,
  code: string,
): Promise<StoredGame | null> {
  const r = await db.query<Row>(
    `select ${COLUMNS} from games where invite_code = $1 and mode = 'ONLINE'`,
    [code],
  );
  return r.rows[0] ? hydrate(db, r.rows[0]) : null;
}

export interface CreateInput {
  userId: string;
  username: string;
  color: 'w' | 'b';
  clockConfig: ClockConfig | null;
  isPublic: boolean;
}

export async function createGame(db: Db, input: CreateInput): Promise<StoredGame> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newInviteCode();
    const client = await db.connect();
    try {
      await client.query('begin');
      const g = await client.query<{ id: string }>(
        `insert into games (owner_id, mode, status, initial_fen, current_fen, pgn, result, invite_code, is_public,
                            time_base_ms, time_increment_ms, source, last_activity_at)
         values ($1, 'ONLINE', 'WAITING', $2, $2, '', '*', $3, $4, $5, $6, 'server', now()) returning id`,
        [
          input.userId,
          START_FEN,
          code,
          input.isPublic,
          input.clockConfig?.initialMs ?? null,
          input.clockConfig?.incrementMs ?? null,
        ],
      );
      const id = (g.rows[0] as { id: string }).id;
      await client.query(
        'insert into game_players (game_id, color, user_id, display_name) values ($1, $2, $3, $4)',
        [id, input.color, input.userId, input.username],
      );
      await client.query('commit');
      return (await loadGame(db, id)) as StoredGame;
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      if ((err as { code?: string }).code === '23505') continue; // invite code collision: try another
      throw err;
    } finally {
      client.release();
    }
  }
  throw new Error('could not allocate an invite code');
}

export type JoinResult =
  { ok: true; stored: StoredGame } | { ok: false; error: 'not_found' | 'own_game' | 'not_open' };

/** Atomically takes the free seat of a waiting game and starts it (row lock, so two joiners cannot both win). */
export async function joinGame(
  db: Db,
  input: {
    gameId?: string;
    code?: string;
    userId: string;
    username: string;
    now: number;
    start: (g: DomainGame, now: number) => DomainGame;
  },
): Promise<JoinResult> {
  const client = await db.connect();
  try {
    await client.query('begin');
    const found = input.gameId
      ? await client.query<Row>(
          `select ${COLUMNS} from games where id = $1 and mode = 'ONLINE' for update`,
          [input.gameId],
        )
      : await client.query<Row>(
          `select ${COLUMNS} from games where invite_code = $1 and mode = 'ONLINE' for update`,
          [input.code],
        );
    const row = found.rows[0];
    if (!row) {
      await client.query('rollback');
      return { ok: false, error: 'not_found' };
    }
    const stored = await hydrate(client, row);
    if (stored.game.status !== 'WAITING') {
      await client.query('rollback');
      return { ok: false, error: 'not_open' };
    }
    if (stored.game.players.w === input.userId || stored.game.players.b === input.userId) {
      await client.query('rollback');
      return { ok: false, error: 'own_game' };
    }
    const freeSeat: 'w' | 'b' = stored.game.players.w === null ? 'w' : 'b';
    await client.query(
      'insert into game_players (game_id, color, user_id, display_name) values ($1, $2, $3, $4)',
      [row.id, freeSeat, input.userId, input.username],
    );
    const started = input.start(
      { ...stored.game, players: { ...stored.game.players, [freeSeat]: input.userId } },
      input.now,
    );
    await client.query(
      `update games set status = 'ACTIVE', invite_code = null, clock = $2::jsonb, version = $3, started_at = now(),
                        last_activity_at = to_timestamp($4 / 1000.0), turn_deadline = to_timestamp($5 / 1000.0) where id = $1`,
      [
        row.id,
        started.clock ? JSON.stringify(started.clock) : null,
        started.version,
        started.lastActivityAt,
        deadlineOf(started),
      ],
    );
    await client.query('commit');
    return { ok: true, stored: (await loadGame(db, row.id)) as StoredGame };
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export interface MoveRow {
  ply: number;
  uci: string;
  san: string;
  fenAfter: string;
}

export interface SaveInput {
  before: DomainGame;
  after: DomainGame;
  newMove?: MoveRow | undefined;
  currentFen: string;
  /** Final PGN, provided when the game finished. */
  pgn?: string | undefined;
}

/**
 * Persists a state change with optimistic concurrency: returns false if another writer got there first
 * (the caller reloads and re-applies its command). Move row and game row commit atomically.
 */
export async function saveGame(db: Db, input: SaveInput): Promise<boolean> {
  const { before, after } = input;
  const client = await db.connect();
  try {
    await client.query('begin');
    const upd = await client.query(
      `update games set status = $3, result = coalesce($4, result), termination = $5, clock = $6::jsonb, draw_offer_by = $7,
                        version = $8, last_activity_at = to_timestamp($9 / 1000.0), turn_deadline = to_timestamp($10 / 1000.0),
                        current_fen = $11, ply_count = $12,
                        ended_at = case when $3 = 'FINISHED' then now() else null end,
                        pgn = case when $13::text is null then pgn else $13 end
        where id = $1 and version = $2`,
      [
        after.id,
        before.version,
        after.status,
        after.result,
        after.termination,
        after.clock ? JSON.stringify(after.clock) : null,
        after.drawOfferBy,
        after.version,
        after.lastActivityAt,
        deadlineOf(after),
        input.currentFen,
        after.moves.length,
        input.pgn ?? null,
      ],
    );
    if (upd.rowCount === 0) {
      await client.query('rollback');
      return false;
    }
    if (input.newMove) {
      await client.query(
        'insert into game_moves (game_id, ply, uci, san, fen_after) values ($1, $2, $3, $4, $5)',
        [after.id, input.newMove.ply, input.newMove.uci, input.newMove.san, input.newMove.fenAfter],
      );
    }
    await client.query('commit');
    return true;
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function listLobby(db: Db, userId: string, limit = 30) {
  const r = await db.query<{
    id: string;
    username: string;
    color: 'w' | 'b';
    time_base_ms: number | null;
    time_increment_ms: number | null;
    created_at: Date;
  }>(
    `select g.id, u.username, p.color, g.time_base_ms, g.time_increment_ms, g.created_at
       from games g join game_players p on p.game_id = g.id join users u on u.id = p.user_id
      where g.status = 'WAITING' and g.is_public and g.mode = 'ONLINE' and g.owner_id <> $1
      order by g.created_at desc limit $2`,
    [userId, limit],
  );
  return r.rows;
}

export async function listMyActive(db: Db, userId: string): Promise<string[]> {
  const r = await db.query<{ id: string }>(
    `select g.id from games g join game_players p on p.game_id = g.id
      where p.user_id = $1 and g.mode = 'ONLINE' and g.status in ('WAITING', 'ACTIVE') order by g.created_at desc limit 20`,
    [userId],
  );
  return r.rows.map((x) => x.id);
}

export async function cancelWaiting(db: Db, userId: string, id: string): Promise<boolean> {
  const r = await db.query(
    `delete from games where id = $1 and owner_id = $2 and status = 'WAITING' and mode = 'ONLINE'`,
    [id, userId],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function dueGames(db: Db, limit = 50): Promise<string[]> {
  const r = await db.query<{ id: string }>(
    `select id from games where status = 'ACTIVE' and mode = 'ONLINE' and turn_deadline <= now() order by turn_deadline limit $1`,
    [limit],
  );
  return r.rows.map((x) => x.id);
}

export async function purgeStaleWaiting(db: Db, olderThanMinutes = 60): Promise<number> {
  const r = await db.query(
    `delete from games where status = 'WAITING' and mode = 'ONLINE' and created_at < now() - ($1 || ' minutes')::interval`,
    [String(olderThanMinutes)],
  );
  return r.rowCount ?? 0;
}
