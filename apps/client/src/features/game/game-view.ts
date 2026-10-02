import type { ChessGame, Color, MoveRecord, Square } from '@chess/chess-core';
import { buildTrackedPieces, type TrackedPiece } from '../chess/tracked-pieces';

export type ResultOverride =
  { kind: 'timeout'; loser: Color } | { kind: 'resign'; loser: Color } | { kind: 'agreement' };

export interface GameView {
  fen: string;
  turn: Color;
  pieces: TrackedPiece[];
  history: MoveRecord[];
  lastMove: { from: Square; to: Square } | null;
  checkSquare: Square | null;
  status: ReturnType<ChessGame['getStatus']>;
  isOver: boolean;
}

/** Derives everything a screen renders from a ChessGame. Pure; recompute when the game changes. */
export function deriveGameView(game: ChessGame): GameView {
  const status = game.getStatus();
  const turn = game.turn();
  const history = game.getHistory();
  const last = history.at(-1);

  // The king in check is the side to move's; on checkmate the mated side's king.
  const kingInDanger =
    status.state === 'checkmate' || (status.state === 'active' && status.inCheck);
  const pieces = buildTrackedPieces(game);
  const checkSquare = kingInDanger
    ? (pieces.find((p) => p.type === 'k' && p.color === turn)?.square ?? null)
    : null;

  return {
    fen: game.getFen(),
    turn,
    pieces,
    history,
    lastMove: last ? { from: last.from, to: last.to } : null,
    checkSquare,
    status,
    isOver: game.isGameOver(),
  };
}

export interface Outcome {
  over: boolean;
  /** 'w' | 'b' for a decisive result, 'draw' for a draw, null while in progress. */
  winner: Color | 'draw' | null;
  title: string;
  detail: string;
}

const NAME = (c: Color) => (c === 'w' ? 'White' : 'Black');
const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');

const DRAW_TEXT = {
  stalemate: 'Stalemate',
  'insufficient-material': 'Insufficient material',
  'threefold-repetition': 'Threefold repetition',
  'fifty-move-rule': 'Fifty-move rule',
} as const;

/** Combines the chess status with an external result (timeout, resignation, agreed draw). */
export function getOutcome(view: GameView, override: ResultOverride | null): Outcome {
  if (override) {
    if (override.kind === 'agreement') {
      return { over: true, winner: 'draw', title: 'Draw', detail: 'Draw by agreement' };
    }
    const winner = other(override.loser);
    return {
      over: true,
      winner,
      title: `${NAME(winner)} wins`,
      detail:
        override.kind === 'timeout'
          ? `${NAME(override.loser)} ran out of time`
          : `${NAME(override.loser)} resigned`,
    };
  }
  const s = view.status;
  if (s.state === 'checkmate') {
    return { over: true, winner: s.winner, title: `${NAME(s.winner)} wins`, detail: 'Checkmate' };
  }
  if (s.state === 'draw') {
    return { over: true, winner: 'draw', title: 'Draw', detail: DRAW_TEXT[s.reason] };
  }
  return {
    over: false,
    winner: null,
    title: `${NAME(view.turn)} to move`,
    detail: s.inCheck ? 'Check' : '',
  };
}
