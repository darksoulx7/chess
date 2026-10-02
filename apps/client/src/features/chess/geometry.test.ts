import { describe, expect, it } from 'vitest';
import { coordinateLabels, isLightSquare, pointToSquare, squareToPoint } from './geometry';

describe('geometry', () => {
  it('places a1 bottom-left for white and top-right for black', () => {
    expect(squareToPoint('a1', 800, 'w')).toEqual({ x: 0, y: 700 });
    expect(squareToPoint('h8', 800, 'w')).toEqual({ x: 700, y: 0 });
    expect(squareToPoint('a1', 800, 'b')).toEqual({ x: 700, y: 0 });
    expect(squareToPoint('h8', 800, 'b')).toEqual({ x: 0, y: 700 });
  });

  it('squareToPoint and pointToSquare are inverses in both orientations', () => {
    for (const o of ['w', 'b'] as const) {
      for (const sq of ['a1', 'e4', 'h8', 'c7', 'g2'] as const) {
        const p = squareToPoint(sq, 400, o);
        expect(pointToSquare(p.x + 1, p.y + 1, 400, o)).toBe(sq);
        expect(pointToSquare(p.x + 49, p.y + 49, 400, o)).toBe(sq);
      }
    }
  });

  it('returns null outside the board', () => {
    expect(pointToSquare(-1, 10, 400, 'w')).toBeNull();
    expect(pointToSquare(400, 10, 400, 'w')).toBeNull();
    expect(pointToSquare(10, 400, 400, 'w')).toBeNull();
    expect(pointToSquare(NaN, 10, 400, 'w')).toBeNull();
  });

  it('labels follow orientation', () => {
    expect(coordinateLabels('w').files[0]).toBe('a');
    expect(coordinateLabels('w').ranks[0]).toBe('8');
    expect(coordinateLabels('b').files[0]).toBe('h');
    expect(coordinateLabels('b').ranks[0]).toBe('1');
  });

  it('colours squares like a real board (a1 dark, h1 light)', () => {
    expect(isLightSquare('a1')).toBe(false);
    expect(isLightSquare('h1')).toBe(true);
    expect(isLightSquare('d4')).toBe(false);
    expect(isLightSquare('e4')).toBe(true);
  });
});
