import { ChessGame, type Color, type MoveRecord, type Square } from '@chess/chess-core';
import { buildTrackedPieces, type TrackedPiece } from '../chess/tracked-pieces';

export interface AnalysisPosition {
  ply: number;
  fen: string;
  turn: Color;
  pieces: TrackedPiece[];
  lastMove: { from: Square; to: Square } | null;
  checkSquare: Square | null;
  status: ReturnType<ChessGame['getStatus']>;
  /** A game rebuilt from `fen`: use it for legal moves / promotion checks at this ply. */
  positionGame: ChessGame;
}

/** Everything the board needs for the position after `ply` half-moves of `game`. */
export function deriveAnalysisPosition(game: ChessGame, ply: number): AnalysisPosition {
  const history: MoveRecord[] = game.getHistory();
  const clamped = Math.max(0, Math.min(ply, history.length));
  const fen = game.getFenAtPly(clamped) ?? game.getFen();
  const loaded = ChessGame.fromFen(fen);
  const positionGame = loaded.ok ? loaded.value : ChessGame.create();
  const status = positionGame.getStatus();
  const turn = positionGame.turn();
  const pieces = buildTrackedPieces(game, clamped);
  const last = clamped > 0 ? history[clamped - 1] : undefined;
  const inDanger = status.state === 'checkmate' || (status.state === 'active' && status.inCheck);
  return {
    ply: clamped,
    fen,
    turn,
    pieces,
    lastMove: last ? { from: last.from, to: last.to } : null,
    checkSquare: inDanger
      ? (pieces.find((p) => p.type === 'k' && p.color === turn)?.square ?? null)
      : null,
    status,
    positionGame,
  };
}
