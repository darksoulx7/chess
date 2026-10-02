import { describe, expect, it } from 'vitest';
import { ChessGame, MAX_FEN_LENGTH, MAX_PGN_LENGTH, START_FEN, parseUci, toUci } from '../src';
import { fromFen, play } from './helpers';

describe('FEN', () => {
  it('roundtrips', () => {
    const fen = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
    expect(fromFen(fen).getFen()).toBe(fen);
  });

  it.each([
    '',
    'not a fen',
    '8/8/8/8/8/8/8/8 w - - 0 1', // no kings
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBN w KQkq - 0 1', // short rank
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR x KQkq - 0 1', // bad side
  ])('rejects invalid FEN %j', (fen) => {
    expect(ChessGame.fromFen(fen)).toEqual({ ok: false, error: 'invalid-fen' });
  });

  it('rejects oversized input', () => {
    expect(ChessGame.fromFen('x'.repeat(MAX_FEN_LENGTH + 1))).toEqual({
      ok: false,
      error: 'input-too-large',
    });
  });

  it('tracks the initial FEN of a custom start', () => {
    const fen = '8/P6k/8/8/8/8/8/K7 w - - 0 1';
    expect(fromFen(fen).getInitialFen()).toBe(fen);
    expect(ChessGame.create().getInitialFen()).toBe(START_FEN);
  });
});

describe('PGN', () => {
  it('exports and re-imports a game', () => {
    const g = play(ChessGame.create(), 'e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6');
    const pgn = g.getPgn({ White: 'Alice', Black: 'Bob', Event: 'Test' });
    expect(pgn).toContain('[White "Alice"]');
    expect(pgn).toContain('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6');
    const back = ChessGame.fromPgn(pgn);
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.value.getFen()).toBe(g.getFen());
      expect(back.value.getHistory().map((m) => m.san)).toEqual(g.getHistory().map((m) => m.san));
      expect(back.value.getInitialFen()).toBe(START_FEN);
    }
  });

  it('preserves a custom starting position through PGN', () => {
    const fen = '8/P6k/8/8/8/8/8/K7 w - - 0 1';
    const g = fromFen(fen);
    g.makeMoveUci('a7a8q');
    const pgn = g.getPgn();
    expect(pgn).toContain('[FEN "');
    const back = ChessGame.fromPgn(pgn);
    expect(back.ok && back.value.getInitialFen()).toBe(fen);
    expect(back.ok && back.value.getFen()).toBe(g.getFen());
  });

  it('imports a PGN with comments and a result token', () => {
    const r = ChessGame.fromPgn('[Event "x"]\n\n1. e4 {best by test} e5 2. Nf3 1-0');
    expect(r.ok && r.value.getHistory()).toHaveLength(3);
  });

  it('rejects garbage and illegal moves', () => {
    expect(ChessGame.fromPgn('1. e4 e4 2. zz9')).toEqual({ ok: false, error: 'invalid-pgn' });
    expect(ChessGame.fromPgn('1. e5')).toEqual({ ok: false, error: 'invalid-pgn' });
  });

  it('rejects oversized PGN', () => {
    expect(ChessGame.fromPgn('x'.repeat(MAX_PGN_LENGTH + 1))).toEqual({
      ok: false,
      error: 'input-too-large',
    });
  });

  it('exporting does not mutate the game', () => {
    const g = play(ChessGame.create(), 'e4');
    g.getPgn({ White: 'x' });
    expect(g.getHistory()).toHaveLength(1);
  });
});

describe('UCI helpers', () => {
  it('parses and formats', () => {
    expect(parseUci('e2e4')).toEqual({ from: 'e2', to: 'e4' });
    expect(parseUci('e7e8q')).toEqual({ from: 'e7', to: 'e8', promotion: 'q' });
    expect(parseUci('e7e8k')).toBeNull();
    expect(parseUci('e2')).toBeNull();
    expect(toUci({ from: 'e7', to: 'e8', promotion: 'n' })).toBe('e7e8n');
  });
});
