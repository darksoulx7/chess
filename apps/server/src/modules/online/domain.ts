import { ChessGame, type MoveRecord } from '@chess/chess-core';
import {
  createClock,
  flagged,
  press,
  remaining,
  stop,
  type ClockConfig,
  type ClockState,
  type OnlineColor,
  type OnlineErrorCode,
} from '@chess/game-types';

/**
 * Pure rules for server-authoritative online games. No I/O: every function takes the current game
 * and the current time and returns the next game plus the events to publish, so the whole
 * state machine (turns, clocks, idempotent moves, draws, timeouts) is unit-testable.
 */

export const FIRST_MOVE_WINDOW_MS = 60_000;
export const UNTIMED_IDLE_MS = 3 * 24 * 60 * 60 * 1000;

export interface DomainGame {
  id: string;
  status: 'WAITING' | 'ACTIVE' | 'FINISHED';
  initialFen: string;
  moves: string[];
  /** User ids by seat. */
  players: { w: string | null; b: string | null };
  clockConfig: ClockConfig | null;
  clock: ClockState | null;
  drawOfferBy: OnlineColor | null;
  result: '1-0' | '0-1' | '1/2-1/2' | '*' | null;
  termination: string | null;
  version: number;
  /** Time of the last move (or of the start), in ms. */
  lastActivityAt: number;
}

export type DomainEvent =
  | { type: 'move'; ply: number; record: MoveRecord }
  | { type: 'draw'; offerBy: OnlineColor | null }
  | { type: 'ended'; result: NonNullable<DomainGame['result']>; termination: string };

export type Command =
  | { type: 'move'; uci: string; expectedPly: number }
  | { type: 'resign' }
  | { type: 'draw'; action: 'offer' | 'accept' | 'decline' }
  | { type: 'abort' };

export type Outcome =
  | { ok: true; game: DomainGame; events: DomainEvent[]; duplicate?: boolean }
  | { ok: false; error: OnlineErrorCode };

const other = (c: OnlineColor): OnlineColor => (c === 'w' ? 'b' : 'w');
const resultFor = (winner: OnlineColor) => (winner === 'w' ? '1-0' : '0-1') as '1-0' | '0-1';

export function colorOf(game: DomainGame, userId: string): OnlineColor | null {
  if (game.players.w === userId) return 'w';
  if (game.players.b === userId) return 'b';
  return null;
}

/** Rebuilds the chess position by replaying the stored moves. Returns null if the data is corrupt. */
export function replay(game: DomainGame): ChessGame | null {
  const loaded = ChessGame.fromFen(game.initialFen);
  if (!loaded.ok) return null;
  for (const uci of game.moves) if (!loaded.value.makeMoveUci(uci).ok) return null;
  return loaded.value;
}

/** A game starts (both seats filled): clocks exist but do not run until the first move. */
export function startGame(game: DomainGame, now: number): DomainGame {
  return {
    ...game,
    status: 'ACTIVE',
    clock: game.clockConfig ? createClock(game.clockConfig) : null,
    lastActivityAt: now,
    version: game.version + 1,
  };
}

function finish(
  game: DomainGame,
  result: NonNullable<DomainGame['result']>,
  termination: string,
  now: number,
): { game: DomainGame; event: DomainEvent } {
  return {
    game: {
      ...game,
      status: 'FINISHED',
      result,
      termination,
      drawOfferBy: null,
      clock: game.clock ? stop(game.clock, now) : null,
      lastActivityAt: now,
      version: game.version + 1,
    },
    event: { type: 'ended', result, termination },
  };
}

/** Moment (ms) at which the game should be ended by the sweeper if nothing happens; null when there is none. */
export function deadlineOf(game: DomainGame): number | null {
  if (game.status !== 'ACTIVE') return null;
  if (game.moves.length < 2) return game.lastActivityAt + FIRST_MOVE_WINDOW_MS;
  if (game.clock?.running)
    return (
      (game.clock.since ?? game.lastActivityAt) +
      remaining(game.clock, game.clock.running, game.clock.since ?? 0)
    );
  return game.lastActivityAt + UNTIMED_IDLE_MS;
}

/** Ends the game if its deadline has passed (timeout, or abandonment before both sides moved). */
export function applyTimeout(game: DomainGame, now: number): Outcome {
  if (game.status !== 'ACTIVE') return { ok: false, error: 'not_active' };
  const deadline = deadlineOf(game);
  if (deadline === null || now < deadline) return { ok: false, error: 'not_active' };
  if (game.moves.length < 2) {
    const f = finish(game, '*', 'abandoned', now);
    return { ok: true, game: f.game, events: [f.event] };
  }
  if (game.clock?.running) {
    const f = finish(game, resultFor(other(game.clock.running)), 'timeout', now);
    return { ok: true, game: f.game, events: [f.event] };
  }
  const f = finish(game, '*', 'abandoned', now);
  return { ok: true, game: f.game, events: [f.event] };
}

export function applyCommand(game: DomainGame, userId: string, cmd: Command, now: number): Outcome {
  const me = colorOf(game, userId);
  if (!me) return { ok: false, error: 'not_a_player' };

  // Duplicate delivery of a move that already took effect (reconnect resend): acknowledge, change nothing.
  if (cmd.type === 'move') {
    const played = game.moves[cmd.expectedPly];
    if (
      played !== undefined &&
      played === cmd.uci &&
      (cmd.expectedPly % 2 === 0 ? 'w' : 'b') === me
    ) {
      return { ok: true, game, events: [], duplicate: true };
    }
  }
  if (game.status !== 'ACTIVE') return { ok: false, error: 'not_active' };

  switch (cmd.type) {
    case 'move': {
      if (cmd.expectedPly !== game.moves.length) return { ok: false, error: 'stale' };
      const chess = replay(game);
      if (!chess) return { ok: false, error: 'server_error' };
      if (chess.turn() !== me) return { ok: false, error: 'not_your_turn' };

      // A move arriving after the mover's flag fell is not accepted: the game ends on time instead.
      if (game.clock) {
        const late = flagged(game.clock, now);
        if (late) {
          const f = finish(game, resultFor(other(late)), 'timeout', now);
          return { ok: true, game: f.game, events: [f.event] };
        }
      }
      const r = chess.makeMoveUci(cmd.uci);
      if (!r.ok) return { ok: false, error: 'illegal_move' };

      const events: DomainEvent[] = [{ type: 'move', ply: game.moves.length + 1, record: r.value }];
      let next: DomainGame = {
        ...game,
        moves: [...game.moves, cmd.uci],
        clock: game.clock ? press(game.clock, me, now).state : null,
        lastActivityAt: now,
        version: game.version + 1,
      };
      if (game.drawOfferBy) {
        next = { ...next, drawOfferBy: null }; // any move declines a pending offer
        events.push({ type: 'draw', offerBy: null });
      }
      const status = chess.getStatus();
      if (status.state !== 'active') {
        const f =
          status.state === 'checkmate'
            ? finish(next, resultFor(status.winner), 'checkmate', now)
            : finish(next, '1/2-1/2', status.reason, now);
        return { ok: true, game: f.game, events: [...events, f.event] };
      }
      return { ok: true, game: next, events };
    }

    case 'resign': {
      const f = finish(game, resultFor(other(me)), 'resignation', now);
      return { ok: true, game: f.game, events: [f.event] };
    }

    case 'draw': {
      if (cmd.action === 'offer') {
        if (game.drawOfferBy === me) return { ok: false, error: 'already_offered' };
        if (game.drawOfferBy === other(me)) {
          const f = finish(game, '1/2-1/2', 'agreement', now); // both want it
          return { ok: true, game: f.game, events: [f.event] };
        }
        return {
          ok: true,
          game: { ...game, drawOfferBy: me, version: game.version + 1 },
          events: [{ type: 'draw', offerBy: me }],
        };
      }
      if (game.drawOfferBy !== other(me)) return { ok: false, error: 'no_offer' };
      if (cmd.action === 'accept') {
        const f = finish(game, '1/2-1/2', 'agreement', now);
        return { ok: true, game: f.game, events: [f.event] };
      }
      return {
        ok: true,
        game: { ...game, drawOfferBy: null, version: game.version + 1 },
        events: [{ type: 'draw', offerBy: null }],
      };
    }

    case 'abort': {
      if (game.moves.length >= 2) return { ok: false, error: 'cannot_abort' };
      const f = finish(game, '*', 'abandoned', now);
      return { ok: true, game: f.game, events: [f.event] };
    }
  }
}
