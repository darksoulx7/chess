import type { EngineLine } from '@chess/engine';
import { BotApiError } from './bot-api';
import { getApiUrl } from './config';

export interface AnalysisLine extends EngineLine {
  /** Principal variation in SAN (first plies), computed by the server. */
  san: string[];
}

export interface PositionAnalysis {
  fen: string;
  depth: number;
  lines: AnalysisLine[];
  bestMove: string | null;
  /** Present when the position is finished (no engine search was needed). */
  terminal?: { state: 'checkmate'; winner: 'w' | 'b' } | { state: 'draw'; reason: string };
  cached: boolean;
}

export interface AnalysisParams {
  fen: string;
  depth?: number;
  multiPv?: number;
}

/** Engine analysis of one position. Errors reuse the bot API's error type (same HTTP contract). */
export async function fetchPositionAnalysis(
  params: AnalysisParams,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<PositionAnalysis> {
  let res: Response;
  try {
    res = await fetchImpl(`${getApiUrl()}/api/analysis/position`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
      ...(signal ? { signal } : {}),
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    throw new BotApiError('network');
  }
  if (res.ok) {
    const body = (await res.json()) as Partial<PositionAnalysis>;
    if (!Array.isArray(body.lines) || typeof body.fen !== 'string') {
      throw new BotApiError('invalid', 'malformed response');
    }
    return body as PositionAnalysis;
  }
  if (res.status === 429) throw new BotApiError('rate-limited');
  if (res.status === 504) throw new BotApiError('timeout');
  if (res.status === 503) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new BotApiError(body.error === 'engine_busy' ? 'busy' : 'unavailable');
  }
  throw new BotApiError('invalid', `HTTP ${res.status}`);
}
