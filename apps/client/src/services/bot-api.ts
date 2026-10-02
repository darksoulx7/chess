import { getApiUrl } from './config';

export type BotErrorCode =
  'busy' | 'timeout' | 'unavailable' | 'network' | 'invalid' | 'rate-limited';

export class BotApiError extends Error {
  constructor(
    readonly code: BotErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'BotApiError';
  }
}

export interface BotMoveResponse {
  move: string;
  san?: string;
  quality?: string;
  thinkMs: number;
}

export const BOT_ERROR_TEXT: Record<BotErrorCode, string> = {
  busy: 'The engine is busy. Try again in a moment.',
  timeout: 'The engine took too long to answer.',
  unavailable: 'The engine is unavailable right now.',
  network: 'Cannot reach the server. Check your connection.',
  invalid: 'The server rejected the request.',
  'rate-limited': 'Too many requests. Wait a few seconds.',
};

/** Asks the server for the bot's move. Rejects with BotApiError; an aborted request rejects with an AbortError. */
export async function requestBotMove(
  params: {
    fen: string;
    targetRating: number;
    seed?: number;
    /** UCI moves played so far; required together with `opening`. */
    moves?: string[];
    opening?: { id: string; maxMoves: number };
  },
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<BotMoveResponse> {
  let res: Response;
  try {
    res = await fetchImpl(`${getApiUrl()}/api/bot/move`, {
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
    const body = (await res.json()) as Partial<BotMoveResponse>;
    if (typeof body.move !== 'string') throw new BotApiError('invalid', 'malformed response');
    return body as BotMoveResponse;
  }
  if (res.status === 429) throw new BotApiError('rate-limited');
  if (res.status === 504) throw new BotApiError('timeout');
  if (res.status === 503) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new BotApiError(body.error === 'engine_busy' ? 'busy' : 'unavailable');
  }
  throw new BotApiError('invalid', `HTTP ${res.status}`);
}
