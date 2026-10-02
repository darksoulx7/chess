import type { File, MoveInput, PromotionPiece, Rank, Square } from './types';

export const FILES: readonly File[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
export const RANKS: readonly Rank[] = ['1', '2', '3', '4', '5', '6', '7', '8'];

export const ALL_SQUARES: readonly Square[] = RANKS.flatMap((r) =>
  FILES.map((f) => `${f}${r}` as Square),
);

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export function isSquare(value: string): value is Square {
  return /^[a-h][1-8]$/.test(value);
}

export function fileIndex(square: Square): number {
  return square.charCodeAt(0) - 97;
}

export function rankIndex(square: Square): number {
  return square.charCodeAt(1) - 49;
}

export function toUci(move: MoveInput): string {
  return `${move.from}${move.to}${move.promotion ?? ''}`;
}

/** Parses `e2e4` / `e7e8q`. Returns null for anything that is not well-formed UCI. */
export function parseUci(uci: string): MoveInput | null {
  const m = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(uci);
  if (!m) return null;
  const from = m[1] as Square;
  const to = m[2] as Square;
  const promotion = m[3] as PromotionPiece | undefined;
  return promotion ? { from, to, promotion } : { from, to };
}
