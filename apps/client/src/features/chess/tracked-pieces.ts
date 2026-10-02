import type {
  ChessGame,
  Color,
  MoveRecord,
  PieceType,
  PlacedPiece,
  Square,
} from '@chess/chess-core';
import { ChessGame as Game } from '@chess/chess-core';

/** A piece with a stable identity across moves, so the UI can animate it from square to square. */
export interface TrackedPiece {
  id: string;
  type: PieceType;
  color: Color;
  square: Square;
}

function fromPlaced(placed: PlacedPiece[]): TrackedPiece[] {
  return placed.map(({ square, piece }) => ({
    id: `${piece.color}${piece.type}@${square}`,
    type: piece.type,
    color: piece.color,
    square,
  }));
}

/** Applies one move to a tracked piece list (captures, en passant, castling, promotion). */
export function applyMove(pieces: TrackedPiece[], move: MoveRecord): TrackedPiece[] {
  const captureSquare: Square = move.isEnPassant
    ? (`${move.to[0]}${move.from[1]}` as Square)
    : move.to;
  const rookMove =
    move.castle === 'k'
      ? { from: `h${move.from[1]}`, to: `f${move.from[1]}` }
      : move.castle === 'q'
        ? { from: `a${move.from[1]}`, to: `d${move.from[1]}` }
        : null;

  const next: TrackedPiece[] = [];
  for (const p of pieces) {
    if (move.isCapture && p.square === captureSquare && p.color !== move.color) continue;
    if (p.square === move.from && p.color === move.color) {
      next.push({ ...p, square: move.to, type: move.promotion ?? p.type });
    } else if (rookMove && p.square === rookMove.from && p.color === move.color) {
      next.push({ ...p, square: rookMove.to as Square });
    } else {
      next.push(p);
    }
  }
  return next;
}

/**
 * Rebuilds tracked pieces by replaying history from the initial position (optionally only the
 * first `ply` half-moves). Deterministic, so undo/redo/load/navigation all stay consistent
 * without extra bookkeeping.
 */
export function buildTrackedPieces(game: ChessGame, ply?: number): TrackedPiece[] {
  const start = Game.fromFen(game.getInitialFen());
  if (!start.ok) return fromPlaced(game.getPieces());
  let pieces = fromPlaced(start.value.getPieces());
  const history = game.getHistory();
  for (const move of ply === undefined ? history : history.slice(0, ply)) {
    pieces = applyMove(pieces, move);
  }
  return pieces;
}
