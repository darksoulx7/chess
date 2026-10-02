import type { ChessGame } from '@chess/chess-core';
import {
  CHECKMATED_EVAL,
  DRAWN_EVAL,
  reviewGame,
  reviewMovesFromGame,
  reviewPositions,
  type PositionEval,
  type ReviewResult,
  type ReviewThresholds,
} from '@chess/engine';
import { getOpeningIndex, identifyOpening } from '@chess/openings';
import { BotApiError } from '../../services/bot-api';
import {
  fetchPositionAnalysis,
  type AnalysisParams,
  type PositionAnalysis,
} from '../../services/analysis-api';

export type Fetcher = (params: AnalysisParams, signal?: AbortSignal) => Promise<PositionAnalysis>;

export interface ReviewProgress {
  done: number;
  total: number;
}

export interface RunReviewOptions {
  game: ChessGame;
  depth?: number;
  signal?: AbortSignal;
  onProgress?: (p: ReviewProgress) => void;
  fetcher?: Fetcher;
  /** Parallel requests; keep at or below the server's engine pool size to avoid `busy` responses. */
  concurrency?: number;
  /** Retries for `busy` / `rate-limited` / `timeout` responses, with linear backoff. */
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
  thresholds?: Partial<ReviewThresholds>;
}

const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
const RETRYABLE = new Set(['busy', 'rate-limited', 'timeout']);

export function evalFromAnalysis(a: PositionAnalysis): PositionEval {
  if (a.terminal) return a.terminal.state === 'checkmate' ? CHECKMATED_EVAL : DRAWN_EVAL;
  const top = a.lines[0];
  if (!top) throw new BotApiError('invalid', 'engine returned no lines');
  return { score: top.score, bestMove: a.bestMove ?? top.pv[0] ?? null };
}

/**
 * Analyses every position of the game on the server and converts the evaluations into a review.
 * Cancellable; stops at the first non-retryable failure.
 */
export async function runReview(options: RunReviewOptions): Promise<ReviewResult> {
  const {
    game,
    depth = 12,
    signal,
    onProgress,
    fetcher = fetchPositionAnalysis,
    concurrency = 3,
    retries = 3,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = options;

  const fens = reviewPositions(game);
  const evals: PositionEval[] = new Array(fens.length);
  const internal = new AbortController();
  const onAbort = () => internal.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) internal.abort();

  let next = 0;
  let done = 0;
  let failure: unknown = null;
  onProgress?.({ done, total: fens.length });

  const analyse = async (fen: string): Promise<PositionEval> => {
    for (let attempt = 0; ; attempt++) {
      if (internal.signal.aborted) throw abortError();
      try {
        return evalFromAnalysis(await fetcher({ fen, depth, multiPv: 1 }, internal.signal));
      } catch (err) {
        const retryable = err instanceof BotApiError && RETRYABLE.has(err.code);
        if (!retryable || attempt >= retries) throw err;
        await sleep(500 * (attempt + 1));
      }
    }
  };

  const worker = async () => {
    while (!internal.signal.aborted) {
      const i = next++;
      if (i >= fens.length) return;
      try {
        evals[i] = await analyse(fens[i] as string);
        onProgress?.({ done: ++done, total: fens.length });
      } catch (err) {
        failure ??= err;
        internal.abort(); // stop the other workers promptly
        return;
      }
    }
  };

  try {
    await Promise.all(
      Array.from({ length: Math.max(1, Math.min(concurrency, fens.length)) }, worker),
    );
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
  if (failure) throw failure;
  if (signal?.aborted) throw abortError();

  const uci = game.getHistory().map((m) => m.lan);
  const bookPlies = identifyOpening(getOpeningIndex(), uci)?.plies ?? 0;
  return reviewGame({
    moves: reviewMovesFromGame(game),
    evals,
    bookPlies,
    ...(options.thresholds ? { thresholds: options.thresholds } : {}),
  });
}
