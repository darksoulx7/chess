import type { Color, MoveRecord, PieceType } from '@chess/chess-core';

export const PIECE_VALUE: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export interface CapturedSummary {
  /** Pieces each side has captured (i.e. opponent pieces taken), ordered by value. */
  byWhite: PieceType[];
  byBlack: PieceType[];
  /** Positive when White is ahead in material from captures. */
  balance: number;
}

const ORDER: PieceType[] = ['q', 'r', 'b', 'n', 'p'];

/**
 * Derived from capture history. Promotions are not netted out (a promoted pawn still counts
 * as a captured pawn when it is taken), which matches how most clients display it.
 */
export function summarizeCaptures(history: MoveRecord[]): CapturedSummary {
  const byWhite: PieceType[] = [];
  const byBlack: PieceType[] = [];
  for (const m of history) {
    if (!m.captured) continue;
    (m.color === 'w' ? byWhite : byBlack).push(m.captured);
  }
  const sort = (a: PieceType[]) => a.sort((x, y) => ORDER.indexOf(x) - ORDER.indexOf(y));
  const total = (a: PieceType[]) => a.reduce((n, p) => n + PIECE_VALUE[p], 0);
  return {
    byWhite: sort(byWhite),
    byBlack: sort(byBlack),
    balance: total(byWhite) - total(byBlack),
  };
}

export function materialAdvantage(summary: CapturedSummary, color: Color): number {
  return color === 'w' ? summary.balance : -summary.balance;
}
