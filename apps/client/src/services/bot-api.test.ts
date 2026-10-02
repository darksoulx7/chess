import { describe, expect, it, vi } from 'vitest';

vi.mock('./config', () => ({ getApiUrl: () => 'http://api.test' }));
import { BotApiError, requestBotMove } from './bot-api';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const params = { fen: 'x', targetRating: 1200 };

describe('requestBotMove', () => {
  it('posts the request and returns the move', async () => {
    const f = vi.fn().mockResolvedValue(json(200, { move: 'e2e4', thinkMs: 10 }));
    const r = await requestBotMove(params, undefined, f as unknown as typeof fetch);
    expect(r.move).toBe('e2e4');
    expect(f).toHaveBeenCalledWith(
      'http://api.test/api/bot/move',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string)).toEqual(params);
  });

  it.each([
    [503, { error: 'engine_busy' }, 'busy'],
    [503, { error: 'engine_unavailable' }, 'unavailable'],
    [504, {}, 'timeout'],
    [429, {}, 'rate-limited'],
    [400, {}, 'invalid'],
  ])('maps HTTP %i to %s', async (status, body, code) => {
    const f = vi.fn().mockResolvedValue(json(status, body));
    await expect(
      requestBotMove(params, undefined, f as unknown as typeof fetch),
    ).rejects.toMatchObject({ code });
  });

  it('maps network failures and rejects malformed success bodies', async () => {
    const down = vi.fn().mockRejectedValue(new TypeError('failed'));
    await expect(
      requestBotMove(params, undefined, down as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(BotApiError);
    await expect(
      requestBotMove(params, undefined, down as unknown as typeof fetch),
    ).rejects.toMatchObject({ code: 'network' });
    const bad = vi.fn().mockResolvedValue(json(200, { nope: 1 }));
    await expect(
      requestBotMove(params, undefined, bad as unknown as typeof fetch),
    ).rejects.toMatchObject({ code: 'invalid' });
  });

  it('lets aborts through unchanged', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const f = vi.fn().mockRejectedValue(abort);
    await expect(requestBotMove(params, undefined, f as unknown as typeof fetch)).rejects.toBe(
      abort,
    );
  });
});
