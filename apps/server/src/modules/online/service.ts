import { randomInt } from 'node:crypto';
import type {
  ClockConfig,
  LobbyEntry,
  OnlineColor,
  OnlineErrorCode,
  OnlineSnapshot,
  ServerMessage,
} from '@chess/game-types';
import type { Db } from '../../infrastructure/db.js';
import {
  applyCommand,
  applyTimeout,
  colorOf,
  replay,
  startGame,
  type Command,
  type DomainEvent,
  type DomainGame,
  type Outcome,
} from './domain.js';
import {
  cancelWaiting,
  createGame,
  dueGames,
  joinGame,
  listLobby,
  listMyActive,
  loadGame,
  normalizeCode,
  purgeStaleWaiting,
  saveGame,
  type StoredGame,
} from './repository.js';

/** What the service needs from the real-time layer. */
export interface Bus {
  publish(gameId: string, messages: ServerMessage[]): Promise<void>;
  presence(gameId: string): Promise<{ w: boolean; b: boolean }>;
}

export type CommandResult =
  { ok: true; ply: number; duplicate?: boolean } | { ok: false; error: OnlineErrorCode };

const MAX_ATTEMPTS = 4;

export function buildSnapshot(
  stored: StoredGame,
  presence: { w: boolean; b: boolean },
  now: number,
  viewerId: string | null,
): OnlineSnapshot {
  const { game, names } = stored;
  const player = (c: OnlineColor) =>
    game.players[c] ? { id: game.players[c] as string, name: names[c] ?? 'Player' } : null;
  return {
    id: game.id,
    status: game.status,
    result: game.result,
    termination: game.termination,
    moves: game.moves,
    initialFen: game.initialFen,
    players: { w: player('w'), b: player('b') },
    clockConfig: game.clockConfig,
    clock: game.clock,
    drawOfferBy: game.drawOfferBy,
    version: game.version,
    serverTime: now,
    presence,
    isPublic: stored.isPublic,
    ...(stored.code &&
    game.status === 'WAITING' &&
    viewerId !== null &&
    stored.creatorId === viewerId
      ? { code: stored.code }
      : {}),
  };
}

function toMessages(
  gameId: string,
  after: DomainGame,
  events: DomainEvent[],
  now: number,
): ServerMessage[] {
  return events.map((e): ServerMessage => {
    switch (e.type) {
      case 'move':
        return {
          t: 'move',
          game: gameId,
          ply: e.ply,
          uci: e.record.lan,
          san: e.record.san,
          clock: after.clock,
          version: after.version,
          serverTime: now,
        };
      case 'draw':
        return { t: 'draw', game: gameId, offerBy: e.offerBy, version: after.version };
      case 'ended':
        return {
          t: 'ended',
          game: gameId,
          result: e.result,
          termination: e.termination,
          clock: after.clock,
          version: after.version,
          serverTime: now,
        };
    }
  });
}

export class OnlineService {
  constructor(
    private readonly db: Db,
    private readonly bus: Bus,
    private readonly clockNow: () => number = Date.now,
    private readonly onError: (err: unknown, context: string) => void = () => {},
  ) {}

  private async snapshot(stored: StoredGame, viewerId: string | null): Promise<OnlineSnapshot> {
    const presence = await this.bus.presence(stored.game.id).catch(() => ({ w: false, b: false }));
    return buildSnapshot(stored, presence, this.clockNow(), viewerId);
  }

  async create(
    userId: string,
    username: string,
    opts: { color: 'w' | 'b' | 'random'; clockConfig: ClockConfig | null; isPublic: boolean },
  ): Promise<OnlineSnapshot> {
    const color = opts.color === 'random' ? (randomInt(2) === 0 ? 'w' : 'b') : opts.color;
    const stored = await createGame(this.db, {
      userId,
      username,
      color,
      clockConfig: opts.clockConfig,
      isPublic: opts.isPublic,
    });
    return this.snapshot(stored, userId);
  }

  async join(
    userId: string,
    username: string,
    target: { code: string } | { gameId: string },
  ): Promise<
    { ok: true; game: OnlineSnapshot } | { ok: false; error: 'not_found' | 'own_game' | 'not_open' }
  > {
    const result = await joinGame(this.db, {
      userId,
      username,
      now: this.clockNow(),
      start: startGame,
      ...('code' in target ? { code: normalizeCode(target.code) } : { gameId: target.gameId }),
    });
    if (!result.ok) return result;
    const game = await this.snapshot(result.stored, null);
    // Tell anyone already watching this (waiting) game that it has started.
    await this.bus
      .publish(game.id, [{ t: 'state', game }])
      .catch((e) => this.onError(e, 'publish join'));
    return { ok: true, game: await this.snapshot(result.stored, userId) };
  }

  /** The game as seen by one of its players; null for non-players (callers answer 404 so existence is not leaked). */
  async snapshotFor(userId: string, gameId: string): Promise<OnlineSnapshot | null> {
    const stored = await loadGame(this.db, gameId);
    if (!stored || colorOf(stored.game, userId) === null) return null;
    return this.snapshot(stored, userId);
  }

  async cancel(userId: string, gameId: string): Promise<boolean> {
    return cancelWaiting(this.db, userId, gameId);
  }

  async lobby(userId: string): Promise<LobbyEntry[]> {
    const rows = await listLobby(this.db, userId);
    return rows.map((r) => ({
      id: r.id,
      creator: r.username,
      yourColor: r.color === 'w' ? 'b' : 'w',
      clockConfig: r.time_base_ms
        ? { initialMs: r.time_base_ms, incrementMs: r.time_increment_ms ?? 0 }
        : null,
      createdAt: r.created_at.toISOString(),
    }));
  }

  async active(userId: string): Promise<OnlineSnapshot[]> {
    const ids = await listMyActive(this.db, userId);
    const out: OnlineSnapshot[] = [];
    for (const id of ids) {
      const s = await this.snapshotFor(userId, id);
      if (s) out.push(s);
    }
    return out;
  }

  /** Applies a player command with optimistic concurrency, persists it, then publishes the resulting events. */
  async command(userId: string, gameId: string, cmd: Command): Promise<CommandResult> {
    return this.run(gameId, (game, now) => applyCommand(game, userId, cmd, now));
  }

  /** Ends a game whose deadline passed (timeout / abandonment). A no-op if it was already decided. */
  async expire(gameId: string): Promise<boolean> {
    const r = await this.run(gameId, (game, now) => applyTimeout(game, now));
    return r.ok;
  }

  async sweep(): Promise<number> {
    let ended = 0;
    for (const id of await dueGames(this.db)) {
      try {
        if (await this.expire(id)) ended++;
      } catch (err) {
        this.onError(err, `expire ${id}`);
      }
    }
    await purgeStaleWaiting(this.db).catch((e) => this.onError(e, 'purge waiting'));
    return ended;
  }

  private async run(
    gameId: string,
    step: (game: DomainGame, now: number) => Outcome,
  ): Promise<CommandResult> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const stored = await loadGame(this.db, gameId);
      if (!stored) return { ok: false, error: 'not_found' };
      const now = this.clockNow();
      const outcome = step(stored.game, now);
      if (!outcome.ok) return outcome;
      if (outcome.events.length === 0)
        return { ok: true, ply: stored.game.moves.length, duplicate: true };

      const chess = replay(outcome.game);
      if (!chess) return { ok: false, error: 'server_error' };
      const moveEvent = outcome.events.find(
        (e): e is Extract<DomainEvent, { type: 'move' }> => e.type === 'move',
      );
      const finished = outcome.game.status === 'FINISHED';
      const pgn = finished
        ? chess.getPgn({
            Event: 'Online game',
            White: stored.names.w ?? 'White',
            Black: stored.names.b ?? 'Black',
            Result: outcome.game.result ?? '*',
            ...(outcome.game.termination ? { Termination: outcome.game.termination } : {}),
            ...(outcome.game.clockConfig
              ? {
                  TimeControl: `${Math.round(outcome.game.clockConfig.initialMs / 1000)}+${Math.round(outcome.game.clockConfig.incrementMs / 1000)}`,
                }
              : {}),
          })
        : undefined;

      const saved = await saveGame(this.db, {
        before: stored.game,
        after: outcome.game,
        currentFen: chess.getFen(),
        ...(moveEvent
          ? {
              newMove: {
                ply: moveEvent.ply,
                uci: moveEvent.record.lan,
                san: moveEvent.record.san,
                fenAfter: moveEvent.record.after,
              },
            }
          : {}),
        ...(pgn ? { pgn } : {}),
      });
      if (!saved) continue; // someone else changed the game first: reload and re-apply

      await this.bus
        .publish(gameId, toMessages(gameId, outcome.game, outcome.events, now))
        .catch((e) => this.onError(e, 'publish'));
      return { ok: true, ply: outcome.game.moves.length };
    }
    return { ok: false, error: 'server_error' };
  }
}
