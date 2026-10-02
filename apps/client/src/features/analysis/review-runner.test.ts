import { ChessGame } from '@chess/chess-core';
import { describe, expect, it, vi } from 'vitest';
import { BotApiError } from '../../services/bot-api';
import type { PositionAnalysis } from '../../services/analysis-api';
import { evalFromAnalysis, runReview, type Fetcher } from './review-runner';

function game(...sans: string[]) {
  const g = ChessGame.create();
  for (const s of sans) if (!g.makeMoveSan(s).ok) throw new Error(`illegal ${s}`);
  return g;
}

const analysis = (fen: string, cp: number, bestMove = 'e2e4'): PositionAnalysis => ({
  fen,
  depth: 8,
  lines: [{ multipv: 1, depth: 8, score: { type: 'cp', value: cp }, pv: [bestMove], san: [] }],
  bestMove,
  cached: false,
});

/** Fetcher that returns 20cp for the side to move at every position. */
const flatFetcher: Fetcher = async ({ fen }) => analysis(fen, 20);

describe('evalFromAnalysis', () => {
  it('maps terminal positions and rejects empty results', () => {
    const base = { fen: 'x', depth: 0, lines: [], bestMove: null, cached: false };
    expect(
      evalFromAnalysis({ ...base, terminal: { state: 'checkmate', winner: 'b' } }).score,
    ).toEqual({ type: 'cp', value: -100_000 });
    expect(
      evalFromAnalysis({ ...base, terminal: { state: 'draw', reason: 'stalemate' } }).score,
    ).toEqual({ type: 'cp', value: 0 });
    expect(() => evalFromAnalysis(base)).toThrow(BotApiError);
  });

  it('uses the engine best move, falling back to the first PV move', () => {
    expect(evalFromAnalysis(analysis('x', 10, 'd2d4')).bestMove).toBe('d2d4');
    const noBest = { ...analysis('x', 10, 'g1f3'), bestMove: null };
    expect(evalFromAnalysis(noBest).bestMove).toBe('g1f3');
  });
});

describe('runReview', () => {
  it('analyses every position (moves + 1) and returns a review', async () => {
    const fetcher = vi.fn(flatFetcher);
    const g = game('e4', 'e5', 'Nf3');
    const r = await runReview({ game: g, fetcher });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(r.moves).toHaveLength(3);
    expect(r.whiteEvals).toHaveLength(4);
    expect(fetcher.mock.calls.map((c) => c[0].fen)).toEqual(
      expect.arrayContaining([g.getInitialFen(), g.getFen()]),
    );
  });

  it('marks the opening line as book using the opening database', async () => {
    const r = await runReview({
      game: game('e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'),
      fetcher: flatFetcher,
    });
    expect(r.moves.slice(0, 6).every((m) => m.moveClass === 'book')).toBe(true);
  });

  it('respects the concurrency limit and reports progress', async () => {
    let active = 0;
    let peak = 0;
    const fetcher: Fetcher = async ({ fen }) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return analysis(fen, 0);
    };
    const progress: number[] = [];
    await runReview({
      game: game('e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6'),
      fetcher,
      concurrency: 2,
      onProgress: (p) => progress.push(p.done),
    });
    expect(peak).toBe(2);
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(9);
    expect([...progress].sort((a, b) => a - b)).toEqual(progress);
  });

  it('retries busy responses with backoff, then succeeds', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const fetcher: Fetcher = async ({ fen }) => {
      if (calls++ < 2) throw new BotApiError('busy');
      return analysis(fen, 0);
    };
    await runReview({
      game: game('e4'),
      fetcher,
      concurrency: 1,
      sleep: async (ms) => void sleeps.push(ms),
    });
    expect(sleeps).toEqual([500, 1000]);
  });

  it('gives up after the retry budget and surfaces the error', async () => {
    const fetcher: Fetcher = async () => {
      throw new BotApiError('busy');
    };
    await expect(
      runReview({ game: game('e4'), fetcher, retries: 1, sleep: async () => {} }),
    ).rejects.toMatchObject({ code: 'busy' });
  });

  it('does not retry non-retryable failures and stops the other workers', async () => {
    let calls = 0;
    const fetcher: Fetcher = async ({ fen }) => {
      calls++;
      if (calls === 1) throw new BotApiError('unavailable');
      await new Promise((r) => setTimeout(r, 20));
      return analysis(fen, 0);
    };
    await expect(
      runReview({ game: game('e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'), fetcher, concurrency: 3 }),
    ).rejects.toMatchObject({ code: 'unavailable' });
    expect(calls).toBeLessThan(7); // not every position was analysed after the failure
  });

  it('can be cancelled mid-run', async () => {
    const ctl = new AbortController();
    const fetcher: Fetcher = (_p, signal) =>
      new Promise((resolve, reject) => {
        signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
        setTimeout(() => resolve(analysis('x', 0)), 1000);
      });
    const p = runReview({ game: game('e4', 'e5', 'Nf3'), fetcher, signal: ctl.signal });
    setTimeout(() => ctl.abort(), 20);
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('works for an empty game (only the start position)', async () => {
    const r = await runReview({ game: ChessGame.create(), fetcher: flatFetcher });
    expect(r.moves).toEqual([]);
    expect(r.whiteEvals).toHaveLength(1);
  });

  it('handles a finished game (checkmate as the last position)', async () => {
    const g = game('f3', 'e5', 'g4', 'Qh4#');
    const fetcher: Fetcher = async ({ fen }) =>
      fen === g.getFen()
        ? {
            fen,
            depth: 0,
            lines: [],
            bestMove: null,
            terminal: { state: 'checkmate', winner: 'b' },
            cached: false,
          }
        : analysis(fen, 0, 'd8h4');
    const r = await runReview({ game: g, fetcher });
    expect(r.moves).toHaveLength(4);
    expect(r.whiteEvals.at(-1)).toBe(-1000);
  });
});
