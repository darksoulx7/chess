import { ChessGame, type Color } from '@chess/chess-core';
import type { ClockState, OnlineErrorCode, OnlineSnapshot, ServerMessage } from '@chess/game-types';

export interface PendingMove {
  /** Number of moves before this one (the `ply` sent to the server). */
  ply: number;
  uci: string;
  cid: string;
}

/** Everything the online screen renders. Server events are folded into it by `reduceServer`. */
export interface OnlineGameState {
  id: string;
  status: OnlineSnapshot['status'];
  result: OnlineSnapshot['result'];
  termination: string | null;
  initialFen: string;
  /** Confirmed moves plus, at the end, at most one optimistic move (`pending`). */
  moves: string[];
  players: OnlineSnapshot['players'];
  clockConfig: OnlineSnapshot['clockConfig'];
  clock: ClockState | null;
  drawOfferBy: Color | null;
  presence: { w: boolean; b: boolean };
  version: number;
  /** `serverTime - localTime` at the last server message; add to Date.now() to get server time. */
  offset: number;
  code: string | null;
  isPublic: boolean;
  pending: PendingMove | null;
  /** Last command rejection, for display. */
  error: OnlineErrorCode | null;
}

export type ServerEffect = 'resync' | 'refresh-auth' | null;

export function fromSnapshot(s: OnlineSnapshot, now: number): OnlineGameState {
  return {
    id: s.id,
    status: s.status,
    result: s.result,
    termination: s.termination,
    initialFen: s.initialFen,
    moves: [...s.moves],
    players: s.players,
    clockConfig: s.clockConfig,
    clock: s.clock,
    drawOfferBy: s.drawOfferBy,
    presence: s.presence,
    version: s.version,
    offset: s.serverTime - now,
    code: s.code ?? null,
    isPublic: s.isPublic,
    pending: null,
    error: null,
  };
}

/**
 * Folds one server message into the state. Pure: `now` is the local receive time.
 * Returns the new state plus a side effect the caller must perform (resync / token refresh).
 */
export function reduceServer(
  state: OnlineGameState,
  msg: ServerMessage,
  now: number,
): { state: OnlineGameState; effect: ServerEffect } {
  switch (msg.t) {
    case 'state': {
      if (msg.game.id !== state.id) return { state, effect: null };
      // A snapshot older than what we hold is a late reply to an earlier subscribe.
      if (msg.game.version < state.version) return { state, effect: null };
      const next = fromSnapshot(msg.game, now);
      // Keep an optimistic move the server has not seen yet.
      const pending = state.pending;
      if (pending && next.status === 'ACTIVE' && next.moves.length === pending.ply) {
        next.moves.push(pending.uci);
        next.pending = pending;
      }
      return { state: next, effect: null };
    }
    case 'move': {
      if (msg.game !== state.id) return { state, effect: null };
      if (msg.ply > state.moves.length + 1) return { state, effect: 'resync' }; // missed a move
      const moves = [...state.moves];
      let pending = state.pending;
      if (msg.ply <= moves.length) {
        if (moves[msg.ply - 1] !== msg.uci) {
          // Our optimistic move lost the race: the server's move wins.
          moves.length = msg.ply - 1;
          moves.push(msg.uci);
          pending = null;
        } else if (pending && pending.ply === msg.ply - 1) {
          pending = null; // our own move, now confirmed
        }
      } else {
        moves.push(msg.uci);
      }
      return {
        state: {
          ...state,
          moves,
          pending,
          clock: msg.clock,
          version: Math.max(state.version, msg.version),
          offset: msg.serverTime - now,
          drawOfferBy: null,
          error: null,
        },
        effect: null,
      };
    }
    case 'draw':
      if (msg.game !== state.id) return { state, effect: null };
      return {
        state: {
          ...state,
          drawOfferBy: msg.offerBy,
          version: Math.max(state.version, msg.version),
        },
        effect: null,
      };
    case 'ended':
      if (msg.game !== state.id) return { state, effect: null };
      return {
        state: {
          ...state,
          status: 'FINISHED',
          result: msg.result,
          termination: msg.termination,
          clock: msg.clock,
          version: Math.max(state.version, msg.version),
          offset: msg.serverTime - now,
          drawOfferBy: null,
          pending: null,
        },
        effect: null,
      };
    case 'presence':
      if (msg.game !== state.id) return { state, effect: null };
      return {
        state: { ...state, presence: { ...state.presence, [msg.color]: msg.online } },
        effect: null,
      };
    case 'ack':
      if (msg.game !== state.id) return { state, effect: null };
      return {
        state: state.pending?.cid === msg.cid ? { ...state, pending: null } : state,
        effect: null,
      };
    case 'error': {
      if (msg.game && msg.game !== state.id) return { state, effect: null };
      if (msg.code === 'auth_expired') return { state, effect: 'refresh-auth' };
      // A rejected optimistic move is rolled back to the server's position.
      const rolledBack = state.pending && (!msg.cid || msg.cid === state.pending.cid);
      const next: OnlineGameState = {
        ...state,
        error: msg.code,
        ...(rolledBack ? { moves: state.moves.slice(0, state.pending?.ply), pending: null } : {}),
      };
      return { state: next, effect: msg.code === 'stale' ? 'resync' : null };
    }
    default:
      return { state, effect: null };
  }
}

/** Optimistically applies the local player's move (caller already validated it locally). */
export function applyLocalMove(state: OnlineGameState, uci: string, cid: string): OnlineGameState {
  return {
    ...state,
    moves: [...state.moves, uci],
    pending: { ply: state.moves.length, uci, cid },
    error: null,
  };
}

/** Replays the move list into a ChessGame; `null` if the data is corrupt. */
export function buildGame(state: Pick<OnlineGameState, 'initialFen' | 'moves'>): ChessGame | null {
  const g = ChessGame.fromFen(state.initialFen);
  if (!g.ok) return null;
  for (const m of state.moves) if (!g.value.makeMoveUci(m).ok) return null;
  return g.value;
}

export function myColor(state: OnlineGameState, userId: string | null): Color | null {
  if (!userId) return null;
  if (state.players.w?.id === userId) return 'w';
  if (state.players.b?.id === userId) return 'b';
  return null;
}

const TERMINATION_TEXT: Record<string, string> = {
  checkmate: 'Checkmate',
  stalemate: 'Stalemate',
  'insufficient-material': 'Insufficient material',
  'threefold-repetition': 'Threefold repetition',
  'fifty-move-rule': 'Fifty-move rule',
  agreement: 'Draw by agreement',
  abandoned: 'Game aborted',
};

/** Title and detail for a finished online game. */
export function describeEnd(
  result: OnlineSnapshot['result'],
  termination: string | null,
): { title: string; detail: string } {
  const loser = result === '1-0' ? 'Black' : 'White';
  const winner = result === '1-0' ? 'White' : 'Black';
  if (termination === 'abandoned' || result === '*') {
    return { title: 'Game aborted', detail: 'No result' };
  }
  if (result === '1/2-1/2') {
    return { title: 'Draw', detail: TERMINATION_TEXT[termination ?? ''] ?? 'Draw' };
  }
  const detail =
    termination === 'resignation'
      ? `${loser} resigned`
      : termination === 'timeout'
        ? `${loser} ran out of time`
        : (TERMINATION_TEXT[termination ?? ''] ?? '');
  return { title: `${winner} wins`, detail };
}
