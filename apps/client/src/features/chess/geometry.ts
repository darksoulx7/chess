import { FILES, RANKS, fileIndex, rankIndex, type Color, type Square } from '@chess/chess-core';

export interface Point {
  x: number;
  y: number;
}

/** Top-left pixel of a square in a board of side `size`, from the given side's point of view. */
export function squareToPoint(square: Square, size: number, orientation: Color): Point {
  const cell = size / 8;
  const f = fileIndex(square);
  const r = rankIndex(square);
  return orientation === 'w'
    ? { x: f * cell, y: (7 - r) * cell }
    : { x: (7 - f) * cell, y: r * cell };
}

/** Square under a pixel, or null when the point lies outside the board. */
export function pointToSquare(
  x: number,
  y: number,
  size: number,
  orientation: Color,
): Square | null {
  if (!(x >= 0 && y >= 0 && x < size && y < size)) return null;
  const cell = size / 8;
  const col = Math.floor(x / cell);
  const row = Math.floor(y / cell);
  const f = orientation === 'w' ? col : 7 - col;
  const r = orientation === 'w' ? 7 - row : row;
  const file = FILES[f];
  const rank = RANKS[r];
  return file && rank ? (`${file}${rank}` as Square) : null;
}

/** Board-edge coordinate labels in display order. */
export function coordinateLabels(orientation: Color): { files: string[]; ranks: string[] } {
  const files = FILES.map((f) => f as string);
  const ranks = RANKS.map((r) => r as string);
  return orientation === 'w'
    ? { files, ranks: [...ranks].reverse() }
    : { files: [...files].reverse(), ranks };
}

export function isLightSquare(square: Square): boolean {
  return (fileIndex(square) + rankIndex(square)) % 2 === 1;
}
