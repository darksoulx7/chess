import { FILES, RANKS, fileIndex, rankIndex, type Color, type Square } from '@chess/chess-core';

export type CursorKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

/** Moves the keyboard cursor one square in screen direction, clamped to the board. */
export function moveCursor(from: Square, key: CursorKey, orientation: Color): Square {
  // Screen-right is +file for White, -file for Black; screen-up is +rank for White, -rank for Black.
  const dir = orientation === 'w' ? 1 : -1;
  let f = fileIndex(from);
  let r = rankIndex(from);
  if (key === 'ArrowRight') f += dir;
  if (key === 'ArrowLeft') f -= dir;
  if (key === 'ArrowUp') r += dir;
  if (key === 'ArrowDown') r -= dir;
  f = Math.min(7, Math.max(0, f));
  r = Math.min(7, Math.max(0, r));
  return `${FILES[f]}${RANKS[r]}` as Square;
}
