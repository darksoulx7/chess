import type { ChessGame, Color } from '@chess/chess-core';
import type { ClockConfig } from '@chess/game-types';
import type { GameResultCode, Termination } from '@chess/game-types';
import type { GameMode } from './game-store';
import type { ResultOverride } from './game-view';

export interface SaveGamePayload {
  clientId: string;
  mode: Exclude<GameMode, never>;
  pgn: string;
  result: GameResultCode;
  termination: Termination;
  humanColor?: Color;
  botRating?: number;
  clock?: { baseMs: number; incrementMs: number };
}

export interface FinishedGame {
  game: ChessGame;
  override: ResultOverride | null;
  mode: GameMode;
  humanColor: Color;
  botRating: number | null;
  clock: ClockConfig | null;
  clientId: string;
}

const RULE_TERMINATION = {
  stalemate: 'stalemate',
  'insufficient-material': 'insufficient-material',
  'threefold-repetition': 'threefold-repetition',
  'fifty-move-rule': 'fifty-move-rule',
} as const;

const winnerResult = (c: Color): GameResultCode => (c === 'w' ? '1-0' : '0-1');

/** Maps a finished client game to the server's save request, or null if the game is not over / has no moves. */
export function buildSavePayload(f: FinishedGame): SaveGamePayload | null {
  if (f.game.getHistory().length === 0) return null;
  let result: GameResultCode;
  let termination: Termination;

  if (f.override) {
    if (f.override.kind === 'agreement') {
      result = '1/2-1/2';
      termination = 'agreement';
    } else {
      result = winnerResult(f.override.loser === 'w' ? 'b' : 'w');
      termination = f.override.kind === 'resign' ? 'resignation' : 'timeout';
    }
  } else {
    const s = f.game.getStatus();
    if (s.state === 'checkmate') {
      result = winnerResult(s.winner);
      termination = 'checkmate';
    } else if (s.state === 'draw') {
      result = '1/2-1/2';
      termination = RULE_TERMINATION[s.reason];
    } else {
      return null;
    }
  }

  return {
    clientId: f.clientId,
    mode: f.mode,
    pgn: f.game.getPgn({ Result: result }),
    result,
    termination,
    ...(f.mode === 'BOT'
      ? { humanColor: f.humanColor, ...(f.botRating !== null ? { botRating: f.botRating } : {}) }
      : {}),
    ...(f.clock ? { clock: { baseMs: f.clock.initialMs, incrementMs: f.clock.incrementMs } } : {}),
  };
}
