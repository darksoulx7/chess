import { ChessGame } from '@chess/chess-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseAnalysisInput } from './analysis-input';
import { deriveAnalysisPosition } from './analysis-view';
import { useAnalysis } from './analysis-store';

const s = () => useAnalysis.getState();
const game = (...sans: string[]) => {
  const g = ChessGame.create();
  for (const x of sans) if (!g.makeMoveSan(x).ok) throw new Error(`illegal ${x}`);
  return g;
};

beforeEach(() => s().reset());

describe('parseAnalysisInput', () => {
  it('detects FEN and PGN', () => {
    const fen = parseAnalysisInput('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
    expect(fen).toMatchObject({ ok: true, kind: 'fen' });
    const pgn = parseAnalysisInput('[Event "x"]\n\n1. e4 e5 2. Nf3 *');
    expect(pgn).toMatchObject({ ok: true, kind: 'pgn' });
    expect(pgn.ok && pgn.game.getHistory()).toHaveLength(3);
    const bare = parseAnalysisInput('1. d4 d5 2. c4');
    expect(bare.ok && bare.kind).toBe('pgn');
  });

  it.each([
    ['', /Paste/],
    ['   ', /Paste/],
    ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBN w KQkq - 0 1', /valid FEN/],
    ['hello world', /Could not read/],
    ['1. e4 e4', /Could not read/],
    ['x'.repeat(300_000), /too large/],
  ])('rejects %j', (text, message) => {
    const r = parseAnalysisInput(text);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toMatch(message);
  });
});

describe('deriveAnalysisPosition', () => {
  it('gives the position, last move and check at any ply', () => {
    const g = game('e4', 'f6', 'Qh5');
    const p0 = deriveAnalysisPosition(g, 0);
    expect(p0.fen).toBe(g.getInitialFen());
    expect(p0.lastMove).toBeNull();
    expect(p0.pieces).toHaveLength(32);
    const p3 = deriveAnalysisPosition(g, 3);
    expect(p3.lastMove).toEqual({ from: 'd1', to: 'h5' });
    expect(p3.checkSquare).toBe('e8');
    expect(p3.turn).toBe('b');
    const clamped = deriveAnalysisPosition(g, 99);
    expect(clamped.ply).toBe(3);
  });

  it('reports checkmate on the mated king', () => {
    const p = deriveAnalysisPosition(game('f3', 'e5', 'g4', 'Qh4#'), 4);
    expect(p.status).toMatchObject({ state: 'checkmate', winner: 'b' });
    expect(p.checkSquare).toBe('e1');
  });
});

describe('analysis store', () => {
  it('loads a game at its end and navigates within bounds', () => {
    s().loadGame(game('e4', 'e5', 'Nf3'));
    expect(s().ply).toBe(3);
    s().step(-1);
    expect(s().ply).toBe(2);
    s().goto(-5);
    expect(s().ply).toBe(0);
    s().goto(99);
    expect(s().ply).toBe(3);
    s().step(1);
    expect(s().ply).toBe(3);
  });

  it('loadText loads PGN at the end and FEN at ply 0, and reports errors without changing state', () => {
    expect(s().loadText('1. e4 e5 2. Nf3 Nc6')).toBeNull();
    expect(s().source).toBe('pgn');
    expect(s().ply).toBe(4);
    const before = s().version;
    expect(s().loadText('garbage')).toMatch(/Could not read/);
    expect(s().version).toBe(before);
    expect(s().loadText('8/P6k/8/8/8/8/8/K7 w - - 0 1')).toBeNull();
    expect(s().source).toBe('fen');
    expect(s().ply).toBe(0);
    expect(s().game.getHistory()).toHaveLength(0);
  });

  it('extends the game when moving at the end, and replaces the rest when moving earlier', () => {
    s().loadGame(game('e4', 'e5', 'Nf3'));
    expect(s().makeMove({ from: 'b8', to: 'c6' }).ok).toBe(true);
    expect(
      s()
        .game.getHistory()
        .map((m) => m.san),
    ).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
    expect(s().ply).toBe(4);
    s().goto(2);
    expect(s().makeMove({ from: 'f1', to: 'c4' }).ok).toBe(true);
    expect(
      s()
        .game.getHistory()
        .map((m) => m.san),
    ).toEqual(['e4', 'e5', 'Bc4']);
    expect(s().ply).toBe(3);
  });

  it('rejects illegal moves and leaves the game untouched', () => {
    s().loadGame(game('e4', 'e5'));
    const before = s().game.getFen();
    const v = s().version;
    expect(s().makeMove({ from: 'e2', to: 'e5' }).ok).toBe(false);
    expect(s().game.getFen()).toBe(before);
    expect(s().version).toBe(v);
    s().goto(1);
    expect(s().makeMove({ from: 'a1', to: 'a5' }).ok).toBe(false);
    expect(s().game.getHistory()).toHaveLength(2); // the future was not truncated by a rejected move
  });

  it('does not mutate the game passed to loadGame', () => {
    const g = game('e4', 'e5');
    s().loadGame(g);
    s().makeMove({ from: 'g1', to: 'f3' });
    expect(g.getHistory()).toHaveLength(2);
  });

  it('arrows toggle, clear on navigation, and clear on load', () => {
    s().loadGame(game('e4', 'e5'));
    s().toggleArrow('e2', 'e4');
    s().toggleArrow('g1', 'f3');
    expect(s().arrows).toHaveLength(2);
    s().toggleArrow('e2', 'e4');
    expect(s().arrows.map((a) => a.from)).toEqual(['g1']);
    s().step(-1);
    expect(s().arrows).toEqual([]);
    s().toggleArrow('a2', 'a4');
    s().loadGame(game('d4'));
    expect(s().arrows).toEqual([]);
  });

  it('engine, depth and orientation settings', () => {
    expect(s().engineOn).toBe(true);
    s().toggleEngine();
    expect(s().engineOn).toBe(false);
    s().setDepth(18);
    expect(s().depth).toBe(18);
    s().flip();
    expect(s().orientation).toBe('b');
  });

  it('changing the game invalidates a finished review', () => {
    s().loadGame(game('e4', 'e5'));
    useAnalysis.setState({ review: { status: 'error', message: 'x' } });
    s().makeMove({ from: 'g1', to: 'f3' });
    expect(s().review).toEqual({ status: 'idle' });
  });
});
