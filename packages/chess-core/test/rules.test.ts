import { describe, expect, it } from 'vitest';
import { ChessGame, START_FEN } from '../src';
import { fromFen, perft, play } from './helpers';

describe('legal move generation (perft)', () => {
  const cases: Array<[string, string, number[]]> = [
    ['start position', START_FEN, [20, 400, 8902]],
    [
      'kiwipete',
      'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
      [48, 2039],
    ],
    ['endgame (ep + pins)', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812]],
    [
      'promotions + castling',
      'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
      [6, 264, 9467],
    ],
  ];
  for (const [name, fen, expected] of cases) {
    it(`${name}: ${expected.join(', ')}`, () => {
      const game = fromFen(fen);
      expected.forEach((count, i) => expect(perft(game, i + 1)).toBe(count));
      expect(game.getFen()).toBe(fromFen(fen).getFen()); // undo restored the position
    });
  }
});

describe('basic moves', () => {
  it('starts with 20 legal moves and white to move', () => {
    const g = ChessGame.create();
    expect(g.turn()).toBe('w');
    expect(g.getLegalMoves()).toHaveLength(20);
    expect(g.getPieces()).toHaveLength(32);
  });

  it('restricts legal moves to a square', () => {
    const g = ChessGame.create();
    expect(
      g
        .getLegalMoves('e2')
        .map((m) => m.to)
        .sort(),
    ).toEqual(['e3', 'e4']);
    expect(g.getLegalMoves('e1')).toEqual([]);
  });

  it('records move details', () => {
    const g = ChessGame.create();
    const r = g.makeMove({ from: 'e2', to: 'e4' });
    expect(r.ok && r.value).toMatchObject({ san: 'e4', lan: 'e2e4', piece: 'p', color: 'w' });
    expect(g.turn()).toBe('b');
    expect(g.getLastMove()?.to).toBe('e4');
  });

  it('rejects illegal moves without mutating state', () => {
    const g = ChessGame.create();
    const before = g.getFen();
    expect(g.makeMove({ from: 'e2', to: 'e5' })).toEqual({ ok: false, error: 'illegal-move' });
    expect(g.makeMove({ from: 'e7', to: 'e5' })).toEqual({ ok: false, error: 'illegal-move' });
    expect(g.makeMove({ from: 'e4', to: 'e5' })).toEqual({ ok: false, error: 'illegal-move' });
    expect(g.getFen()).toBe(before);
  });

  it('rejects malformed input', () => {
    const g = ChessGame.create();
    expect(g.makeMove({ from: 'z9' as never, to: 'e4' })).toEqual({
      ok: false,
      error: 'invalid-input',
    });
    expect(g.makeMove({ from: 'e2', to: 'e4', promotion: 'k' as never })).toEqual({
      ok: false,
      error: 'invalid-input',
    });
    expect(g.makeMoveUci('garbage')).toEqual({ ok: false, error: 'invalid-input' });
    expect(g.makeMoveSan('Qh9')).toEqual({ ok: false, error: 'illegal-move' });
    expect(g.makeMoveSan('x'.repeat(100))).toEqual({ ok: false, error: 'invalid-input' });
  });

  it('cannot move a pinned piece off the pin line', () => {
    const pin = fromFen('4k3/4r3/8/8/8/8/4B3/4K3 w - - 0 1');
    expect(pin.makeMove({ from: 'e2', to: 'd3' })).toEqual({ ok: false, error: 'illegal-move' });
    // The pinned bishop may still move along the pin line? No: a bishop cannot move along a file.
    expect(pin.getLegalMoves('e2')).toEqual([]);
  });

  it('accepts UCI and SAN input', () => {
    const g = ChessGame.create();
    expect(g.makeMoveUci('g1f3').ok).toBe(true);
    expect(g.makeMoveSan('Nc6').ok).toBe(true);
    expect(g.getHistory().map((m) => m.san)).toEqual(['Nf3', 'Nc6']);
  });
});

describe('check, checkmate, stalemate', () => {
  it("fool's mate is checkmate won by black", () => {
    const g = play(ChessGame.create(), 'f3', 'e5', 'g4', 'Qh4#');
    expect(g.getStatus()).toEqual({ state: 'checkmate', winner: 'b' });
    expect(g.isGameOver()).toBe(true);
    expect(g.getLastMove()?.givesCheckmate).toBe(true);
    expect(g.makeMove({ from: 'a2', to: 'a3' })).toEqual({ ok: false, error: 'game-over' });
    expect(g.makeMoveSan('a3')).toEqual({ ok: false, error: 'game-over' });
  });

  it('reports check', () => {
    const g = play(ChessGame.create(), 'e4', 'f6', 'Qh5+');
    expect(g.getStatus()).toEqual({ state: 'active', inCheck: true });
    expect(g.isInCheck()).toBe(true);
    expect(g.getLastMove()?.givesCheck).toBe(true);
    // Kf7 is attacked by the queen, so blocking with g6 is the only legal reply.
    expect(g.getLegalMoves().map((m) => m.san)).toEqual(['g6']);
  });

  it('detects stalemate', () => {
    const g = fromFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    expect(g.getStatus()).toEqual({ state: 'draw', reason: 'stalemate' });
    expect(g.getLegalMoves()).toEqual([]);
  });
});

describe('castling', () => {
  const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';

  it('castles kingside and queenside', () => {
    const k = fromFen(fen);
    const rk = k.makeMove({ from: 'e1', to: 'g1' });
    expect(rk.ok && rk.value).toMatchObject({ san: 'O-O', castle: 'k' });
    expect(k.getPieceAt('f1')).toEqual({ type: 'r', color: 'w' });
    expect(k.getPieceAt('g1')).toEqual({ type: 'k', color: 'w' });

    const q = fromFen(fen);
    const rq = q.makeMove({ from: 'e1', to: 'c1' });
    expect(rq.ok && rq.value).toMatchObject({ san: 'O-O-O', castle: 'q' });
    expect(q.getPieceAt('d1')).toEqual({ type: 'r', color: 'w' });
  });

  it('forbids castling through an attacked square, allows the other side', () => {
    const g = fromFen('r3kr2/8/8/8/8/8/8/R3K2R w KQq - 0 1');
    expect(g.makeMove({ from: 'e1', to: 'g1' })).toEqual({ ok: false, error: 'illegal-move' });
    expect(g.makeMove({ from: 'e1', to: 'c1' }).ok).toBe(true);
  });

  it('forbids castling out of check', () => {
    const g = fromFen('4r1k1/8/8/8/8/8/8/R3K2R w KQ - 0 1');
    expect(g.makeMove({ from: 'e1', to: 'g1' })).toEqual({ ok: false, error: 'illegal-move' });
  });

  it('loses the right after the rook moves', () => {
    const g = fromFen(fen);
    play(g, 'Rg1', 'Ra7', 'Rh1', 'Ra8');
    expect(g.makeMove({ from: 'e1', to: 'g1' })).toEqual({ ok: false, error: 'illegal-move' });
    expect(g.makeMove({ from: 'e1', to: 'c1' }).ok).toBe(true);
  });
});

describe('en passant', () => {
  it('captures en passant and removes the pawn', () => {
    const g = play(ChessGame.create(), 'e4', 'a6', 'e5', 'd5');
    const r = g.makeMove({ from: 'e5', to: 'd6' });
    expect(r.ok && r.value).toMatchObject({ isEnPassant: true, isCapture: true, captured: 'p' });
    expect(g.getPieceAt('d5')).toBeNull();
  });

  it('is only available immediately', () => {
    const g = play(ChessGame.create(), 'e4', 'a6', 'e5', 'd5', 'Nf3', 'a5');
    expect(g.makeMove({ from: 'e5', to: 'd6' })).toEqual({ ok: false, error: 'illegal-move' });
  });
});

describe('promotion', () => {
  const fen = '8/P6k/8/8/8/8/8/K7 w - - 0 1';

  it('requires a promotion piece', () => {
    const g = fromFen(fen);
    expect(g.isPromotionMove('a7', 'a8')).toBe(true);
    expect(g.isPromotionMove('a7', 'a7')).toBe(false);
    expect(g.makeMove({ from: 'a7', to: 'a8' })).toEqual({
      ok: false,
      error: 'promotion-required',
    });
  });

  it.each(['q', 'r', 'b', 'n'] as const)('promotes to %s', (p) => {
    const g = fromFen(fen);
    const r = g.makeMove({ from: 'a7', to: 'a8', promotion: p });
    expect(r.ok && r.value).toMatchObject({ isPromotion: true, promotion: p });
    expect(g.getPieceAt('a8')).toEqual({ type: p, color: 'w' });
    expect(g.getPieceAt('a7')).toBeNull();
  });

  it('rejects a promotion piece on a non-promotion move', () => {
    const g = ChessGame.create();
    expect(g.makeMove({ from: 'e2', to: 'e4', promotion: 'q' })).toEqual({
      ok: false,
      error: 'illegal-move',
    });
  });

  it('promotes with capture via UCI', () => {
    const g = fromFen('1n5k/P7/8/8/8/8/8/K7 w - - 0 1');
    const r = g.makeMoveUci('a7b8q');
    expect(r.ok && r.value).toMatchObject({ captured: 'n', promotion: 'q' });
  });
});

describe('draw rules', () => {
  it('threefold repetition', () => {
    const g = ChessGame.create();
    play(g, 'Nf3', 'Nf6', 'Ng1', 'Ng8'); // position occurs 2nd time
    expect(g.getStatus().state).toBe('active');
    play(g, 'Nf3', 'Nf6', 'Ng1', 'Ng8'); // 3rd time
    expect(g.getStatus()).toEqual({ state: 'draw', reason: 'threefold-repetition' });
    expect(g.isGameOver()).toBe(true);
  });

  it('undo after threefold reopens the game', () => {
    const g = ChessGame.create();
    play(g, 'Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8');
    g.undo();
    expect(g.getStatus().state).toBe('active');
  });

  it('fifty-move rule', () => {
    expect(fromFen('8/8/8/4k3/8/8/4K3/4R3 w - - 99 80').getStatus().state).toBe('active');
    expect(fromFen('8/8/8/4k3/8/8/4K3/4R3 w - - 100 80').getStatus()).toEqual({
      state: 'draw',
      reason: 'fifty-move-rule',
    });
  });

  it('insufficient material', () => {
    for (const fen of [
      '8/8/8/4k3/8/8/4K3/8 w - - 0 1', // K v K
      '8/8/8/4k3/8/8/4K3/5B2 w - - 0 1', // K+B v K
      '8/8/8/4k3/8/8/4K3/5N2 w - - 0 1', // K+N v K
    ]) {
      expect(fromFen(fen).getStatus()).toEqual({ state: 'draw', reason: 'insufficient-material' });
    }
    expect(fromFen('8/8/8/4k3/8/8/4K3/5R2 w - - 0 1').getStatus().state).toBe('active');
    expect(fromFen('8/8/8/4k3/8/8/3PK3/8 w - - 0 1').getStatus().state).toBe('active');
  });
});

describe('undo and history', () => {
  it('undoes moves and restores state', () => {
    const g = ChessGame.create();
    expect(g.undo()).toBeNull();
    play(g, 'e4', 'e5', 'Nf3');
    expect(g.undo()?.san).toBe('Nf3');
    expect(g.getHistory().map((m) => m.san)).toEqual(['e4', 'e5']);
    expect(g.turn()).toBe('w');
    g.undo();
    g.undo();
    expect(g.getFen()).toBe(START_FEN);
  });

  it('undoes a capture, castle, en passant and promotion', () => {
    const g = fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    const start = g.getFen();
    g.makeMove({ from: 'e1', to: 'g1' });
    g.undo();
    expect(g.getFen()).toBe(start);

    const ep = play(ChessGame.create(), 'e4', 'a6', 'e5', 'd5');
    const beforeEp = ep.getFen();
    ep.makeMove({ from: 'e5', to: 'd6' });
    ep.undo();
    expect(ep.getFen()).toBe(beforeEp);

    const pr = fromFen('1n5k/P7/8/8/8/8/8/K7 w - - 0 1');
    const beforePr = pr.getFen();
    pr.makeMoveUci('a7b8q');
    pr.undo();
    expect(pr.getFen()).toBe(beforePr);
  });

  it('getFenAtPly navigates the history', () => {
    const g = play(ChessGame.create(), 'e4', 'e5');
    expect(g.getFenAtPly(0)).toBe(START_FEN);
    expect(g.getFenAtPly(2)).toBe(g.getFen());
    expect(g.getFenAtPly(3)).toBeUndefined();
    expect(g.getFenAtPly(-1)).toBeUndefined();
  });

  it('clone is independent', () => {
    const g = play(ChessGame.create(), 'e4');
    const c = g.clone();
    play(c, 'e5');
    expect(g.getHistory()).toHaveLength(1);
    expect(c.getHistory()).toHaveLength(2);
  });
});
