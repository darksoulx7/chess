import { remaining, type ClockState } from '@chess/game-types';
import { useEffect, useState } from 'react';

/** Re-renders ~10x/s while a clock is running and returns both sides' remaining ms. */
export function useClockDisplay(
  clock: ClockState | null,
  onTick?: (now: number) => void,
  /** Added to local time to get the clock's time base (online games: server time offset). */
  offset = 0,
): { w: number; b: number } | null {
  const [now, setNow] = useState(() => Date.now());
  const running = clock?.running != null;

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      onTick?.(t);
    }, 100);
    return () => clearInterval(id);
  }, [running, onTick]);

  if (!clock) return null;
  // When no clock is running, remaining() ignores `now`, so the last tick value is always correct.
  return { w: remaining(clock, 'w', now + offset), b: remaining(clock, 'b', now + offset) };
}
