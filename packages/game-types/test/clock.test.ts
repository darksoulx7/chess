import { describe, expect, it } from 'vitest';
import {
  createClock,
  flagged,
  formatClock,
  getTimeControl,
  pause,
  press,
  remaining,
  resume,
  stop,
} from '../src';

const cfg = { initialMs: 60_000, incrementMs: 2_000 };

describe('clock', () => {
  it('does not run before the first move', () => {
    const c = createClock(cfg);
    expect(remaining(c, 'w', 1_000_000)).toBe(60_000);
    expect(c.running).toBeNull();
  });

  it('first move starts the opponent clock without charging or incrementing', () => {
    const { state } = press(createClock(cfg), 'w', 1000);
    expect(state.running).toBe('b');
    expect(state.whiteMs).toBe(60_000);
    expect(remaining(state, 'b', 4000)).toBe(57_000);
  });

  it('charges elapsed time, adds increment and switches sides', () => {
    let s = press(createClock(cfg), 'w', 0).state;
    s = press(s, 'b', 5_000).state; // black used 5s, +2s
    expect(s.blackMs).toBe(57_000);
    expect(s.running).toBe('w');
    s = press(s, 'w', 8_000).state; // white used 3s (since 5s), +2s
    expect(s.whiteMs).toBe(59_000);
    expect(s.running).toBe('b');
  });

  it('detects timeout and does not accept the late move', () => {
    const s0 = press(createClock({ initialMs: 10_000, incrementMs: 0 }), 'w', 0).state;
    expect(flagged(s0, 9_999)).toBeNull();
    expect(flagged(s0, 10_000)).toBe('b');
    const late = press(s0, 'b', 12_000);
    expect(late.flagged).toBe('b');
    expect(late.state.blackMs).toBe(0);
    expect(late.state.running).toBeNull();
  });

  it('ignores a press from the side whose clock is not running', () => {
    const s = press(createClock(cfg), 'w', 0).state;
    expect(press(s, 'w', 1000).state).toBe(s);
  });

  it('pause/resume freezes time', () => {
    let s = press(createClock(cfg), 'w', 0).state;
    s = pause(s, 4_000);
    expect(s.blackMs).toBe(56_000);
    expect(remaining(s, 'b', 999_999)).toBe(56_000);
    s = resume(s, 10_000);
    expect(remaining(s, 'b', 12_000)).toBe(54_000);
  });

  it('stop settles and cannot be resumed', () => {
    let s = press(createClock(cfg), 'w', 0).state;
    s = stop(s, 3_000);
    expect(s.blackMs).toBe(57_000);
    expect(resume(s, 5_000)).toBe(s);
  });

  it('is immutable', () => {
    const c = createClock(cfg);
    press(c, 'w', 0);
    expect(c.started).toBe(false);
  });

  it('never goes negative or counts backwards on clock skew', () => {
    const s = press(createClock(cfg), 'w', 10_000).state;
    expect(remaining(s, 'b', 5_000)).toBe(60_000);
    expect(remaining(s, 'b', 1_000_000)).toBe(0);
  });

  it('rejects invalid config', () => {
    expect(() => createClock({ initialMs: 0, incrementMs: 0 })).toThrow(RangeError);
    expect(() => createClock({ initialMs: 1000, incrementMs: -1 })).toThrow(RangeError);
  });
});

describe('formatting and presets', () => {
  it('formats clock times', () => {
    expect(formatClock(600_000)).toBe('10:00');
    expect(formatClock(65_400)).toBe('1:06');
    expect(formatClock(3_725_000)).toBe('1:02:05');
    expect(formatClock(9_400)).toBe('9.4');
    expect(formatClock(-5)).toBe('0.0');
  });
  it('looks up presets with a safe fallback', () => {
    expect(getTimeControl('3+2').config).toEqual({ initialMs: 180_000, incrementMs: 2000 });
    expect(getTimeControl('nope').config).toBeNull();
  });
});
