import { ChessGame } from '@chess/chess-core';
import { describe, expect, it } from 'vitest';
import {
  CHECKMATED_EVAL,
  DEFAULT_THRESHOLDS,
  DRAWN_EVAL,
  classifyPhase,
  reviewGame,
  reviewMovesFromGame,
  reviewPositions,
  type PositionEval,
} from '../src';

const cp = (value: number, bestMove: string | null = null): PositionEval => ({
  score: { type: 'cp', value },
  bestMove,
});
const mate = (value: number, bestMove: string | null = null): PositionEval => ({
  score: { type: 'mate', value },
  bestMove,
});

function game(...sans: string[]) {
  const g = ChessGame.create();
  for (const s of sans) if (!g.makeMoveSan(s).ok) throw new Error(`illegal ${s}`);
  return g;
}

/** Reviews `g` with evals given as White-POV centipawns per position; best moves optional. */
function review(
  g: ChessGame,
  whitePov: number[],
  bestMoves: Array<string | null> = [],
  extra: { bookPlies?: number } = {},
) {
  const moves = reviewMovesFromGame(g);
  const evals = whitePov.map((v, i) => cp(i % 2 === 0 ? v : -v, bestMoves[i] ?? null)); // side to move POV
  return reviewGame({ moves, evals, ...extra });
}

describe('reviewGame: classification', () => {
  it('requires one evaluation per position', () => {
    const g = game('e4', 'e5');
    expect(() => reviewGame({ moves: reviewMovesFromGame(g), evals: [cp(0)] })).toThrow(RangeError);
  });

  it('keeps a stable evaluation as best/good', () => {
    const r = review(game('e4', 'e5', 'Nf3'), [20, 20, 25, 25]);
    expect(r.moves.map((m) => m.moveClass)).toEqual(['best', 'best', 'best']);
    expect(r.white.accuracy).toBeGreaterThan(95);
  });

  it('classifies by centipawn loss using the default thresholds', () => {
    // White to move each time; black's reply eval keeps it simple: use one-move games via custom evals
    const g = game('e4');
    const cases: Array<[number, string]> = [
      [5, 'best'], // within bestEpsilon
      [30, 'good'],
      [50, 'inaccuracy'],
      [99, 'inaccuracy'],
      [100, 'mistake'],
      [199, 'mistake'],
      [200, 'blunder'],
      [900, 'blunder'],
    ];
    for (const [loss, expected] of cases) {
      const r = review(g, [100, 100 - loss]);
      expect(r.moves[0]?.lossCp).toBe(loss);
      expect(r.moves[0]?.moveClass, `loss ${loss}`).toBe(expected);
    }
  });

  it('treats the engine best move as best even if the eval wobbles', () => {
    const r = review(game('e4'), [100, 20], ['e2e4']);
    expect(r.moves[0]).toMatchObject({ moveClass: 'best', lossCp: 0, winLoss: 0 });
    expect(r.moves[0]?.accuracy).toBe(100);
  });

  it('never gives a negative loss when the move improves the position', () => {
    const r = review(game('e4'), [0, 150]);
    expect(r.moves[0]?.lossCp).toBe(0);
    expect(r.moves[0]?.moveClass).toBe('best');
  });

  it('marks opening-theory plies as book', () => {
    const r = review(game('e4', 'e5', 'Nf3', 'Nc6'), [20, 20, 20, 20, 20], [], { bookPlies: 3 });
    expect(r.moves.map((m) => m.moveClass)).toEqual(['book', 'book', 'book', 'best']);
    expect(r.white.counts.book).toBe(2);
    expect(r.black.counts.book).toBe(1);
  });

  it('is configurable', () => {
    const base = review(game('e4'), [100, 70]);
    expect(base.moves[0]?.moveClass).toBe('good'); // loss 30 < 50
    const strict = reviewGame({
      moves: reviewMovesFromGame(game('e4')),
      evals: [cp(100), cp(-70)],
      thresholds: { inaccuracyCp: 20, mistakeCp: 40, blunderCp: 80 },
    });
    expect(strict.moves[0]?.moveClass).toBe('inaccuracy');
    expect(strict.thresholds.inaccuracyCp).toBe(20);
  });
});

describe('reviewGame: mates, clamping, missed opportunities', () => {
  it('missing a forced mate is a blunder and a missed opportunity', () => {
    const g = game('e4');
    const r = reviewGame({
      moves: reviewMovesFromGame(g),
      evals: [mate(2, 'a1a8'), cp(-150)], // mate in 2 available; after e4 black is only slightly worse for white
    });
    expect(r.moves[0]?.moveClass).toBe('blunder');
    expect(r.moves[0]?.missedOpportunity).toBe(true);
    expect(r.moves[0]?.evalBeforeCp).toBe(DEFAULT_THRESHOLDS.clampCp); // mate clamped
  });

  it('giving up a winning advantage is flagged missed; a small slip is not', () => {
    const lost = review(game('e4'), [400, 100]);
    expect(lost.moves[0]).toMatchObject({ moveClass: 'blunder', missedOpportunity: true });
    const slip = review(game('e4'), [400, 340]); // still clearly winning after the slip
    expect(slip.moves[0]?.moveClass).toBe('inaccuracy');
    expect(slip.moves[0]?.missedOpportunity).toBe(false);
  });

  it('allowing mate is a blunder; the mating move itself is best', () => {
    const g = game('f3', 'e5', 'g4', 'Qh4#');
    const evals: PositionEval[] = [cp(0), cp(0), cp(-30), cp(-40), CHECKMATED_EVAL]; // side-to-move POV
    // before g4 White is fine (-30 for black means +30 for white); g4 allows mate in 1
    evals[3] = mate(1, 'd8h4'); // black to move, mate in one
    const r = reviewGame({ moves: reviewMovesFromGame(g), evals });
    expect(r.moves[2]?.moveClass).toBe('blunder'); // 3. g4
    expect(r.moves[3]).toMatchObject({ moveClass: 'best', lossCp: 0 }); // 3...Qh4#
    expect(r.white.counts.blunder).toBe(1);
    expect(r.whiteEvals.at(-1)).toBe(-DEFAULT_THRESHOLDS.clampCp); // checkmated side is White: clamped loss
  });

  it('final-position helpers', () => {
    expect(CHECKMATED_EVAL.score).toEqual({ type: 'cp', value: -100_000 });
    expect(DRAWN_EVAL.score).toEqual({ type: 'cp', value: 0 });
  });
});

describe('reviewGame: summaries', () => {
  it('counts per side and computes accuracy / average loss', () => {
    const g = game('e4', 'e5', 'Qh5', 'Nc6'); // 2. Qh5 weakens; give White a mistake and Black a blunder
    // White-POV evals: start 20, after e4 25, after e5 20, after Qh5 -10 (white mistake of 30..), after Nc6 -310
    const r = review(g, [20, 25, 20, -90, -90]);
    expect(
      r.white.counts.mistake +
        r.white.counts.inaccuracy +
        r.white.counts.good +
        r.white.counts.best,
    ).toBe(2);
    expect(r.white.accuracy).toBeLessThan(100);
    expect(r.black.accuracy).toBeGreaterThan(0);
    expect(r.white.averageLossCp).toBeGreaterThan(0);
  });

  it('a game with no non-book moves has 100% accuracy', () => {
    const r = review(game('e4'), [20, 20], [], { bookPlies: 5 });
    expect(r.white.accuracy).toBe(100);
    expect(r.white.averageLossCp).toBe(0);
  });

  it('accuracy falls monotonically with win-probability loss', () => {
    const acc = (after: number) => review(game('e4'), [100, after]).moves[0]!.accuracy;
    expect(acc(100)).toBeGreaterThan(acc(60));
    expect(acc(60)).toBeGreaterThan(acc(-100));
    expect(acc(-100)).toBeGreaterThan(acc(-600));
  });

  it('builds a White-POV evaluation graph with moves+1 points', () => {
    const r = review(game('e4', 'e5'), [30, 40, -20]);
    expect(r.whiteEvals).toEqual([30, 40, -20]);
  });

  it('supports games starting with Black to move', () => {
    const start = ChessGame.fromFen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
    if (!start.ok) throw new Error('fen');
    start.value.makeMoveSan('e5');
    const evals = [cp(-30), cp(30)]; // black POV -30 (white +30); then white to move +30
    const r = reviewGame({ moves: reviewMovesFromGame(start.value), evals });
    expect(r.whiteEvals).toEqual([30, 30]);
    expect(r.moves[0]?.color).toBe('b');
  });
});

describe('phases and positions', () => {
  it('classifies opening, middlegame and endgame', () => {
    expect(classifyPhase('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 3, 0)).toBe(
      'opening',
    );
    const middle = 'r2q1rk1/pp2bppp/2n1bn2/2pp4/3P4/2PBPN2/PP1N1PPP/R1BQ1RK1 w - - 0 10';
    expect(classifyPhase(middle, 30, 0)).toBe('middlegame');
    expect(classifyPhase('8/5pk1/6p1/8/8/6P1/5PK1/3R4 w - - 0 40', 80, 0)).toBe('endgame');
    expect(classifyPhase(middle, 14, 20)).toBe('opening'); // within a long book line
  });

  it('labels phases only with enough moves and uses thresholds', () => {
    const sans = [
      'e4',
      'e5',
      'Nf3',
      'Nc6',
      'Bc4',
      'Bc5',
      'c3',
      'Nf6',
      'd3',
      'd6',
      'O-O',
      'O-O',
      'Re1',
      'Re8',
    ];
    const g = game(...sans);
    const flat = Array(sans.length + 1).fill(10);
    const r = reviewGame({
      moves: reviewMovesFromGame(g),
      evals: flat.map((v, i) => cp(i % 2 === 0 ? v : -v)),
    });
    expect(r.phases.w.opening.label).toBe('strong');
    expect(r.phases.w.endgame.label).toBe('n/a');
  });

  it('lists the positions to analyse: before each move plus the final one', () => {
    const g = game('e4', 'e5');
    const fens = reviewPositions(g);
    expect(fens).toHaveLength(3);
    expect(fens[0]).toBe(g.getInitialFen());
    expect(fens[2]).toBe(g.getFen());
  });
});
