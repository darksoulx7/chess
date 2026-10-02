import { useCallback, useLayoutEffect, useRef } from 'react';

/** Stable function identity that always calls the most recent `fn` (safe to capture in long-lived objects). */
export function useLatestCallback<A extends unknown[], R>(
  fn: (...args: A) => R,
): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}
