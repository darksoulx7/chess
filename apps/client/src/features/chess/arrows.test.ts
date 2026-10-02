import { describe, expect, it } from 'vitest';
import { arrowGeometry } from './arrows';

describe('arrowGeometry', () => {
  it('draws a circle when from equals to', () => {
    const g = arrowGeometry('e4', 'e4', 800, 'w');
    expect(g.circle).toBe(true);
    expect(g.cx).toBe(450);
    expect(g.cy).toBe(450);
  });

  it('points from the origin square towards the target for white', () => {
    const g = arrowGeometry('e2', 'e4', 800, 'w');
    expect(g.circle).toBe(false);
    expect(g.x1).toBeCloseTo(450); // same file
    expect(g.y1).toBeLessThan(650); // starts inside e2 (centre y=650) moving up the board
    expect(g.y1).toBeGreaterThan(g.y2);
    expect(g.head[0].y).toBeLessThan(g.y2); // tip beyond the shaft end, towards e4
    expect(g.head[0].y).toBeGreaterThan(450 - 1); // but not past the e4 centre (y = 450)
  });

  it('mirrors for black orientation', () => {
    const w = arrowGeometry('a1', 'h8', 800, 'w');
    const b = arrowGeometry('a1', 'h8', 800, 'b');
    expect(w.x1).toBeLessThan(w.x2);
    expect(b.x1).toBeGreaterThan(b.x2);
  });

  it('keeps the head inside the board for corner-to-corner and tiny arrows', () => {
    for (const [f, t] of [
      ['a1', 'h8'],
      ['h1', 'a8'],
      ['e4', 'e5'],
    ] as const) {
      const g = arrowGeometry(f, t, 800, 'w');
      for (const p of g.head) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(800);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(800);
      }
    }
  });
});
