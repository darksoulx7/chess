export type ClockColor = 'w' | 'b';

export interface ClockConfig {
  /** Starting time per side, in ms. */
  initialMs: number;
  /** Time added to the mover's clock after each completed move, in ms. */
  incrementMs: number;
}

/**
 * Immutable clock state. All functions take `now` (ms, any monotonic-enough epoch) explicitly,
 * so the same logic runs on the server (authoritative) and in the client (display / local games)
 * and is trivially testable.
 */
export interface ClockState {
  config: ClockConfig;
  whiteMs: number;
  blackMs: number;
  /** Side whose time is currently counting down; null before the first move or while paused. */
  running: ClockColor | null;
  /** Timestamp `running` side's time was last settled. */
  since: number | null;
  /** Side to resume when un-pausing (set while paused after having started). */
  pausedFor: ClockColor | null;
  started: boolean;
}

export function createClock(config: ClockConfig): ClockState {
  if (!(config.initialMs > 0) || config.incrementMs < 0)
    throw new RangeError('invalid clock config');
  return {
    config,
    whiteMs: config.initialMs,
    blackMs: config.initialMs,
    running: null,
    since: null,
    pausedFor: null,
    started: false,
  };
}

function remainingOf(state: ClockState, color: ClockColor, now: number): number {
  const base = color === 'w' ? state.whiteMs : state.blackMs;
  if (state.running !== color || state.since === null) return base;
  return Math.max(0, base - Math.max(0, now - state.since));
}

export function remaining(state: ClockState, color: ClockColor, now: number): number {
  return remainingOf(state, color, now);
}

/** Side whose flag has fallen (time <= 0) at `now`, if any. */
export function flagged(state: ClockState, now: number): ClockColor | null {
  if (state.running && remainingOf(state, state.running, now) <= 0) return state.running;
  return null;
}

const other = (c: ClockColor): ClockColor => (c === 'w' ? 'b' : 'w');

/**
 * Register that `mover` completed a move at `now`.
 * - The very first move starts the opponent's clock without charging or incrementing anyone.
 * - Later moves charge the mover's elapsed time, add the increment and switch sides.
 * A move made after a flag has fallen is not accepted (`flagged` is returned for the caller to end the game).
 */
export function press(
  state: ClockState,
  mover: ClockColor,
  now: number,
): { state: ClockState; flagged: ClockColor | null } {
  if (!state.started) {
    return {
      state: { ...state, started: true, running: other(mover), since: now, pausedFor: null },
      flagged: null,
    };
  }
  if (state.running !== mover) {
    return { state, flagged: null }; // out-of-turn press (paused or wrong side): ignore
  }
  const left = remainingOf(state, mover, now);
  if (left <= 0) {
    const settled = mover === 'w' ? { whiteMs: 0 } : { blackMs: 0 };
    return { state: { ...state, ...settled, running: null, since: null }, flagged: mover };
  }
  const updated = left + state.config.incrementMs;
  return {
    state: {
      ...state,
      ...(mover === 'w' ? { whiteMs: updated } : { blackMs: updated }),
      running: other(mover),
      since: now,
    },
    flagged: null,
  };
}

export function pause(state: ClockState, now: number): ClockState {
  if (!state.running) return state;
  const color = state.running;
  const left = remainingOf(state, color, now);
  return {
    ...state,
    ...(color === 'w' ? { whiteMs: left } : { blackMs: left }),
    running: null,
    since: null,
    pausedFor: color,
  };
}

export function resume(state: ClockState, now: number): ClockState {
  if (state.running || !state.pausedFor) return state;
  return { ...state, running: state.pausedFor, since: now, pausedFor: null };
}

/** Stops the clock for good (game over), settling the running side's time. */
export function stop(state: ClockState, now: number): ClockState {
  const settled = pause(state, now);
  return { ...settled, pausedFor: null };
}

export interface TimeControlPreset {
  id: string;
  label: string;
  config: ClockConfig | null;
}

const min = 60_000;
export const TIME_CONTROLS: readonly TimeControlPreset[] = [
  { id: 'none', label: 'No clock', config: null },
  { id: '1+0', label: '1 min', config: { initialMs: 1 * min, incrementMs: 0 } },
  { id: '3+0', label: '3 min', config: { initialMs: 3 * min, incrementMs: 0 } },
  { id: '3+2', label: '3 | 2', config: { initialMs: 3 * min, incrementMs: 2000 } },
  { id: '5+0', label: '5 min', config: { initialMs: 5 * min, incrementMs: 0 } },
  { id: '10+0', label: '10 min', config: { initialMs: 10 * min, incrementMs: 0 } },
  { id: '15+10', label: '15 | 10', config: { initialMs: 15 * min, incrementMs: 10_000 } },
  { id: '30+0', label: '30 min', config: { initialMs: 30 * min, incrementMs: 0 } },
];

export function getTimeControl(id: string): TimeControlPreset {
  return TIME_CONTROLS.find((t) => t.id === id) ?? (TIME_CONTROLS[0] as TimeControlPreset);
}

export function formatClock(ms: number): string {
  const total = Math.max(0, ms);
  if (total < 20_000) {
    const tenths = Math.floor((total % 1000) / 100);
    return `${Math.floor(total / 1000)}.${tenths}`;
  }
  const s = Math.ceil(total / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m % 60)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}
