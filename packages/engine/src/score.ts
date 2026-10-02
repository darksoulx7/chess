import type { Score } from './types';

/** Centipawn stand-in for a forced mate; shorter mates score higher. */
export const MATE_CP = 100_000;
/** Scores at or beyond this magnitude are treated as forced mates when classifying moves. */
export const MATE_THRESHOLD_CP = MATE_CP - 1000;

export function scoreToCp(score: Score): number {
  if (score.type === 'cp') return score.value;
  const sign = score.value >= 0 ? 1 : -1;
  return sign * (MATE_CP - Math.min(Math.abs(score.value), 999));
}

export function formatScore(score: Score): string {
  if (score.type === 'mate') return `${score.value < 0 ? '-' : ''}M${Math.abs(score.value)}`;
  const v = score.value / 100;
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
}

/** Converts a side-to-move score into White's point of view. */
export function toWhitePerspective(score: Score, sideToMove: 'w' | 'b'): Score {
  return sideToMove === 'w' ? score : { type: score.type, value: -score.value };
}

/** Expected-score style win probability (0..1) for the side the score belongs to. */
export function winProbability(cp: number): number {
  const clamped = Math.max(-1000, Math.min(1000, cp));
  return 1 / (1 + Math.exp(-0.00368208 * clamped));
}
