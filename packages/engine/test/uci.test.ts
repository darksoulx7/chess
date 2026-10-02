import { describe, expect, it } from 'vitest';
import { buildGoCommand, parseBestMove, parseInfoLine } from '../src';

describe('parseInfoLine', () => {
  it('parses a normal info line', () => {
    const l = parseInfoLine(
      'info depth 12 seldepth 18 multipv 2 score cp -34 nodes 123456 nps 900000 time 137 pv e7e5 g1f3 b8c6',
    );
    expect(l).toEqual({
      multipv: 2,
      depth: 12,
      score: { type: 'cp', value: -34 },
      pv: ['e7e5', 'g1f3', 'b8c6'],
      nodes: 123456,
    });
  });
  it('parses mate scores and defaults multipv to 1', () => {
    expect(parseInfoLine('info depth 5 score mate -3 nodes 10 pv a1a2')?.score).toEqual({
      type: 'mate',
      value: -3,
    });
    expect(parseInfoLine('info depth 5 score cp 10 pv e2e4')?.multipv).toBe(1);
  });
  it('ignores bound scores, strings and malformed lines', () => {
    expect(parseInfoLine('info depth 5 score cp 10 lowerbound pv e2e4')).toBeNull();
    expect(parseInfoLine('info string NNUE evaluation using nn.nnue')).toBeNull();
    expect(parseInfoLine('info depth 5 score cp x pv e2e4')).toBeNull();
    expect(parseInfoLine('info depth 5 score cp 5')).toBeNull();
    expect(parseInfoLine('bestmove e2e4')).toBeNull();
  });
  it('keeps only well-formed UCI moves in the pv', () => {
    expect(parseInfoLine('info depth 1 score cp 1 pv e2e4 garbage e7e5')?.pv).toEqual([
      'e2e4',
      'e7e5',
    ]);
  });
});

describe('parseBestMove', () => {
  it('parses moves, ponder and none', () => {
    expect(parseBestMove('bestmove e2e4 ponder e7e5')).toEqual({ move: 'e2e4' });
    expect(parseBestMove('bestmove (none)')).toEqual({ move: null });
    expect(parseBestMove('bestmove 0000')).toEqual({ move: null });
    expect(parseBestMove('info depth 1')).toBeNull();
  });
});

describe('buildGoCommand', () => {
  it('combines limits and never sends a bare go', () => {
    expect(buildGoCommand({ depth: 8 })).toBe('go depth 8');
    expect(buildGoCommand({ depth: 8, nodes: 500, movetimeMs: 1000 })).toBe(
      'go depth 8 nodes 500 movetime 1000',
    );
    expect(buildGoCommand({})).toBe('go depth 10');
    expect(buildGoCommand({ depth: 0 })).toBe('go depth 1');
  });
});
