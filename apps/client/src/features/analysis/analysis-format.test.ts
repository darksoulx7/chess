import { describe, expect, it } from 'vitest';
import {
  evalGraphPoints,
  formatPv,
  plyAtGraphX,
  scoreLabel,
  toWhite,
  whiteShare,
} from './analysis-format';

describe('score helpers', () => {
  it('flips to White POV', () => {
    expect(toWhite({ type: 'cp', value: 40 }, 'b')).toEqual({ type: 'cp', value: -40 });
    expect(toWhite({ type: 'mate', value: 2 }, 'w')).toEqual({ type: 'mate', value: 2 });
  });
  it('white share: 0.5 at equal, mate fills the bar, monotonic', () => {
    expect(whiteShare({ type: 'cp', value: 0 })).toBeCloseTo(0.5);
    expect(whiteShare({ type: 'mate', value: 3 })).toBe(1);
    expect(whiteShare({ type: 'mate', value: -1 })).toBe(0);
    expect(whiteShare({ type: 'cp', value: 200 })).toBeGreaterThan(
      whiteShare({ type: 'cp', value: 50 }),
    );
    expect(whiteShare({ type: 'cp', value: -9999 })).toBeLessThan(0.05);
  });
  it('labels', () => {
    expect(scoreLabel({ type: 'cp', value: 42 })).toBe('+0.42');
    expect(scoreLabel({ type: 'cp', value: -130 })).toBe('-1.30');
    expect(scoreLabel({ type: 'cp', value: 0 })).toBe('0.00');
    expect(scoreLabel({ type: 'mate', value: 3 })).toBe('M3');
    expect(scoreLabel({ type: 'mate', value: -2 })).toBe('-M2');
  });
});

describe('formatPv', () => {
  const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  it('numbers white-to-move lines', () => {
    expect(formatPv(['e4', 'e5', 'Nf3'], start)).toBe('1. e4 e5 2. Nf3');
  });
  it('uses the ellipsis when black moves first, and continues numbering', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
    expect(formatPv(['e5', 'Nf3', 'Nc6'], fen)).toBe('1... e5 2. Nf3 Nc6');
  });
  it('handles empty lines and bad fullmove numbers', () => {
    expect(formatPv([], start)).toBe('');
    expect(formatPv(['e4'], 'x w - - 0 abc')).toBe('1. e4');
  });
});

describe('evaluation graph', () => {
  it('maps evals to points: winning for white is at the top', () => {
    const pts = evalGraphPoints([0, 500, -500], 200, 100);
    expect(pts.map((p) => p.x)).toEqual([0, 100, 200]);
    expect(pts[0]!.y).toBeCloseTo(50);
    expect(pts[1]!.y).toBeLessThan(pts[0]!.y);
    expect(pts[2]!.y).toBeGreaterThan(pts[0]!.y);
  });
  it('handles a single point and maps x back to a ply', () => {
    expect(evalGraphPoints([10], 100, 50)).toEqual([{ x: 0, y: expect.any(Number) }]);
    expect(plyAtGraphX(0, 200, 5)).toBe(0);
    expect(plyAtGraphX(200, 200, 5)).toBe(4);
    expect(plyAtGraphX(100, 200, 5)).toBe(2);
    expect(plyAtGraphX(-50, 200, 5)).toBe(0);
    expect(plyAtGraphX(999, 200, 5)).toBe(4);
    expect(plyAtGraphX(10, 0, 5)).toBe(0);
  });
});
