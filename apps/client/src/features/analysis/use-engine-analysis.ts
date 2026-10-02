import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { BotApiError } from '../../services/bot-api';
import { fetchPositionAnalysis, type PositionAnalysis } from '../../services/analysis-api';

/** Value that follows `value` after it has been stable for `ms` (avoids one request per arrow-key press). */
export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export interface EngineAnalysisState {
  data: PositionAnalysis | undefined;
  /** True while the shown data belongs to a previous position (or none yet) and a request is pending. */
  analyzing: boolean;
  error: BotApiError | null;
  refetch: () => void;
}

/**
 * Engine analysis of `fen` via the server. Requests are cancelled when the position changes,
 * results are cached per (fen, depth, lines) for the session, and the previous result stays visible
 * (marked `analyzing`) while the next one loads.
 */
export function useEngineAnalysis(
  fen: string,
  enabled: boolean,
  depth: number,
  multiPv = 3,
): EngineAnalysisState {
  const target = useDebounced(fen, 150);
  const query = useQuery({
    queryKey: ['analysis', target, depth, multiPv],
    queryFn: ({ signal }) => fetchPositionAnalysis({ fen: target, depth, multiPv }, signal),
    enabled,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    placeholderData: keepPreviousData,
    retry: (count, err) =>
      count < 2 && err instanceof BotApiError && ['busy', 'timeout', 'network'].includes(err.code),
    retryDelay: (n) => 400 * (n + 1),
  });
  const error =
    query.error instanceof BotApiError
      ? query.error
      : query.error
        ? new BotApiError('unavailable')
        : null;
  return {
    data: query.data,
    analyzing: enabled && (query.isFetching || query.data?.fen !== fen) && !error,
    error,
    refetch: () => void query.refetch(),
  };
}
