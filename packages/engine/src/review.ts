import type { ChessGame, Color, MoveRecord } from '@chess/chess-core';
import { MATE_CP, scoreToCp, winProbability } from './score';
import type { Score } from './types';

/**
 * Game review: turns per-position engine evaluations into move classifications and an
 * accuracy-style metric. Everything here is a *heuristic with explicit thresholds*, not an
 * objective truth; all thresholds are configurable and documented in docs/ANALYSIS.md.
 */
export interface ReviewThresholds {
  /** Centipawn loss at/above which a move is an inaccuracy / mistake / blunder. */
  inaccuracyCp: number;
  mistakeCp: number;
  blunderCp: number;
  /** A move losing at most this much counts as "best" even if it is not the engine's first choice. */
  bestEpsilonCp: number;
  /** Evaluations are clamped to ±this before comparing (so mate-vs-mate swings stay bounded). */
  clampCp: number;
  /** "Missed opportunity": the best move was at least this good for the mover, and the played move was not. */
  missedWinCp: number;
  /** Accuracy per move = 100 * exp(-k * winProbabilityLoss). */
  accuracyK: number;
  /** Per-phase label cut-offs on average accuracy. */
  strongAccuracy: number;
  solidAccuracy: number;
  /** Total non-pawn material (both sides, P=0 N/B=3 R=5 Q=9) at/below which the position is an endgame. */
  endgameMaterial: number;
  /** Positions up to this ply count as opening (or the book length if larger). */
  openingPlies: number;
}

export const DEFAULT_THRESHOLDS: ReviewThresholds = {
  inaccuracyCp: 50,
  mistakeCp: 100,
  blunderCp: 200,
  bestEpsilonCp: 10,
  clampCp: 1000,
  missedWinCp: 200,
  accuracyK: 4,
  strongAccuracy: 85,
  solidAccuracy: 70,
  endgameMaterial: 26,
  openingPlies: 12,
};

export type MoveClass = 'book' | 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';
export type Phase = 'opening' | 'middlegame' | 'endgame';

/** Engine verdict for one position (score is from the side to move's point of view). */
export interface PositionEval {
  score: Score;
  bestMove: string | null;
}

/** Evaluation of a finished game's last position (the side to move has lost or it is drawn). */
export const CHECKMATED_EVAL: PositionEval = {
  score: { type: 'cp', value: -MATE_CP },
  bestMove: null,
};
export const DRAWN_EVAL: PositionEval = { score: { type: 'cp', value: 0 }, bestMove: null };

export interface ReviewMoveInput {
  uci: string;
  san: string;
  color: Color;
  /** Position before this move (used for the phase heuristic). */
  fenBefore: string;
}

export interface MoveReview {
  /** 1-based half-move number. */
  ply: number;
  color: Color;
  uci: string;
  san: string;
  moveClass: MoveClass;
  lossCp: number;
  /** Win-probability lost by the mover, 0..1. */
  winLoss: number;
  /** 0..100, from `accuracyK` and `winLoss`. */
  accuracy: number;
  /** Evaluation (clamped cp, mover's POV) before the move was played, and after it. */
  evalBeforeCp: number;
  evalAfterCp: number;
  /** Engine's preferred move in the position before (UCI), if any. */
  bestMove: string | null;
  missedOpportunity: boolean;
  phase: Phase;
}

export interface SideSummary {
  /** Mean of per-move accuracy over non-book moves (100 if there were none). */
  accuracy: number;
  counts: Record<MoveClass, number>;
  averageLossCp: number;
  missedOpportunities: number;
}

export interface PhaseSummary {
  moves: number;
  accuracy: number;
  label: 'strong' | 'solid' | 'needs-work' | 'n/a';
}

export interface ReviewResult {
  moves: MoveReview[];
  white: SideSummary;
  black: SideSummary;
  /** Evaluation (clamped cp, White's POV) before each ply and after the last: length = moves + 1. */
  whiteEvals: number[];
  /** Per side and phase: the mover's accuracy in that phase. */
  phases: Record<Color, Record<Phase, PhaseSummary>>;
  thresholds: ReviewThresholds;
}

const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');
const clamp = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));
const emptyCounts = (): Record<MoveClass, number> => ({
  book: 0,
  best: 0,
  good: 0,
  inaccuracy: 0,
  mistake: 0,
  blunder: 0,
});

const VALUE: Record<string, number> = { n: 3, b: 3, r: 5, q: 9 };

/** Phase heuristic: opening by move number, endgame by remaining non-pawn material, otherwise middlegame. */
export function classifyPhase(
  fen: string,
  ply: number,
  bookPlies: number,
  t: ReviewThresholds = DEFAULT_THRESHOLDS,
): Phase {
  if (ply <= Math.max(bookPlies, t.openingPlies)) return 'opening';
  const board = fen.split(' ')[0] ?? '';
  let material = 0;
  for (const ch of board) material += VALUE[ch.toLowerCase()] ?? 0;
  return material <= t.endgameMaterial ? 'endgame' : 'middlegame';
}

function classify(loss: number, t: ReviewThresholds): MoveClass {
  if (loss <= t.bestEpsilonCp) return 'best';
  if (loss < t.inaccuracyCp) return 'good';
  if (loss < t.mistakeCp) return 'inaccuracy';
  if (loss < t.blunderCp) return 'mistake';
  return 'blunder';
}

export interface ReviewInput {
  moves: ReviewMoveInput[];
  /** One evaluation per position: `moves.length + 1` entries (before move 1 … after the last move). */
  evals: PositionEval[];
  /** Number of leading plies that are known opening theory; those moves are classed as "book". */
  bookPlies?: number;
  thresholds?: Partial<ReviewThresholds>;
}

export function reviewGame(input: ReviewInput): ReviewResult {
  const t: ReviewThresholds = { ...DEFAULT_THRESHOLDS, ...input.thresholds };
  const { moves, evals } = input;
  const bookPlies = input.bookPlies ?? 0;
  if (evals.length !== moves.length + 1) {
    throw new RangeError(`expected ${moves.length + 1} evaluations, got ${evals.length}`);
  }

  const reviews: MoveReview[] = moves.map((m, i) => {
    const before = evals[i] as PositionEval;
    const after = evals[i + 1] as PositionEval;
    const evalBefore = clamp(scoreToCp(before.score), t.clampCp);
    const evalAfter = clamp(-scoreToCp(after.score), t.clampCp); // opponent's best reply, flipped to the mover's POV
    const playedBest = before.bestMove !== null && before.bestMove === m.uci;
    const lossCp = playedBest ? 0 : Math.max(0, evalBefore - evalAfter);
    const winLoss = playedBest
      ? 0
      : Math.max(0, winProbability(evalBefore) - winProbability(evalAfter));
    const ply = i + 1;
    const moveClass: MoveClass =
      ply <= bookPlies ? 'book' : playedBest ? 'best' : classify(lossCp, t);
    return {
      ply,
      color: m.color,
      uci: m.uci,
      san: m.san,
      moveClass,
      lossCp,
      winLoss,
      accuracy: 100 * Math.exp(-t.accuracyK * winLoss),
      evalBeforeCp: evalBefore,
      evalAfterCp: evalAfter,
      bestMove: before.bestMove,
      missedOpportunity:
        moveClass !== 'book' &&
        lossCp >= t.inaccuracyCp &&
        evalBefore >= t.missedWinCp &&
        evalAfter < t.missedWinCp,
      phase: classifyPhase(m.fenBefore, ply, bookPlies, t),
    };
  });

  const summarize = (color: Color): SideSummary => {
    const mine = reviews.filter((r) => r.color === color);
    const counts = emptyCounts();
    for (const r of mine) counts[r.moveClass]++;
    const scored = mine.filter((r) => r.moveClass !== 'book');
    return {
      accuracy: scored.length ? mean(scored.map((r) => r.accuracy)) : 100,
      counts,
      averageLossCp: scored.length ? mean(scored.map((r) => r.lossCp)) : 0,
      missedOpportunities: mine.filter((r) => r.missedOpportunity).length,
    };
  };

  const phaseSummary = (color: Color, phase: Phase): PhaseSummary => {
    const mine = reviews.filter(
      (r) => r.color === color && r.phase === phase && r.moveClass !== 'book',
    );
    if (mine.length < 3)
      return {
        moves: mine.length,
        accuracy: mine.length ? mean(mine.map((r) => r.accuracy)) : 100,
        label: 'n/a',
      };
    const accuracy = mean(mine.map((r) => r.accuracy));
    const label =
      accuracy >= t.strongAccuracy
        ? 'strong'
        : accuracy >= t.solidAccuracy
          ? 'solid'
          : 'needs-work';
    return { moves: mine.length, accuracy, label };
  };

  // Evaluation graph in White's point of view (position i is before move i+1).
  const initialTurn: Color = moves[0]?.color ?? 'w';
  const whiteEvals = evals.map((e, i) => {
    const turn: Color = i % 2 === 0 ? initialTurn : other(initialTurn);
    const cp = clamp(scoreToCp(e.score), t.clampCp);
    return turn === 'w' ? cp : -cp;
  });

  const phases = (['w', 'b'] as const).reduce(
    (acc, c) => ({
      ...acc,
      [c]: {
        opening: phaseSummary(c, 'opening'),
        middlegame: phaseSummary(c, 'middlegame'),
        endgame: phaseSummary(c, 'endgame'),
      },
    }),
    {} as ReviewResult['phases'],
  );

  return {
    moves: reviews,
    white: summarize('w'),
    black: summarize('b'),
    whiteEvals,
    phases,
    thresholds: t,
  };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Builds `ReviewMoveInput`s (with the position before each move) from a game's history. */
export function reviewMovesFromGame(game: ChessGame): ReviewMoveInput[] {
  return game
    .getHistory()
    .map((m: MoveRecord) => ({ uci: m.lan, san: m.san, color: m.color, fenBefore: m.before }));
}

/** Position FENs a review needs analysed: before every move plus the final position. */
export function reviewPositions(game: ChessGame): string[] {
  const history = game.getHistory();
  return [...history.map((m) => m.before), game.getFen()];
}
