import { describe, expect, it } from 'vitest';
import { moveCursor } from './keyboard';

describe('moveCursor', () => {
  it('moves in screen direction for white', () => {
    expect(moveCursor('e2', 'ArrowUp', 'w')).toBe('e3');
    expect(moveCursor('e2', 'ArrowRight', 'w')).toBe('f2');
    expect(moveCursor('e2', 'ArrowDown', 'w')).toBe('e1');
    expect(moveCursor('e2', 'ArrowLeft', 'w')).toBe('d2');
  });
  it('reverses for black so arrows still match the screen', () => {
    expect(moveCursor('e7', 'ArrowUp', 'b')).toBe('e6');
    expect(moveCursor('e7', 'ArrowRight', 'b')).toBe('d7');
  });
  it('clamps at the edges', () => {
    expect(moveCursor('a1', 'ArrowLeft', 'w')).toBe('a1');
    expect(moveCursor('h8', 'ArrowUp', 'w')).toBe('h8');
    expect(moveCursor('a1', 'ArrowDown', 'w')).toBe('a1');
  });
});
