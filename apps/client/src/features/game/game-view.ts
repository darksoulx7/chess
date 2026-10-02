import type { ChessGame, Color, MoveRecord, Square } from '@chess/chess-core';
import { buildTrackedPieces, type TrackedPiece } from '../chess/tracked-pieces';

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
