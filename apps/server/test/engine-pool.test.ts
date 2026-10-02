import { EngineError, type AnalysisRequest, type EngineService } from '@chess/engine';
import { describe, expect, it } from 'vitest';
import { EnginePool } from '../src/modules/analysis/engine-pool.js';

function slowEngine(ms: number, log: string[], name: string, fail = false): EngineService {
  return {
    async analyze() {
      log.push(`start:${name}`);
      await new Promise((r) => setTimeout(r, ms));
      log.push(`end:${name}`);
      if (fail) throw new EngineError('crashed');
      return { lines: [], bestMove: name };
    },
    async dispose() {},
  };
}
const req: AnalysisRequest = { fen: 'x', limits: { depth: 1 } };

describe('EnginePool', () => {
  it('never runs more searches than engines', async () => {
    let active = 0;
    let peak = 0;
    const eng = (): EngineService => ({
      async analyze() {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 20));
        active--;
        return { lines: [], bestMove: null };
      },
      async dispose() {},
    });
    const pool = new EnginePool([eng(), eng()]);
    await Promise.all(Array.from({ length: 8 }, () => pool.analyze(req)));
    expect(peak).toBe(2);
  });

  it('sheds load with busy when the queue is full', async () => {
    const log: string[] = [];
    const pool = new EnginePool([slowEngine(50, log, 'a')], 1);
    const first = pool.analyze(req); // running
    const second = pool.analyze(req); // queued
    await expect(pool.analyze(req)).rejects.toMatchObject({ code: 'busy' });
    await Promise.all([first, second]);
  });

  it('removes an aborted waiter from the queue', async () => {
    const log: string[] = [];
    const pool = new EnginePool([slowEngine(50, log, 'a')], 5);
    const running = pool.analyze(req);
    const ctl = new AbortController();
    const waiting = pool.analyze({ ...req, signal: ctl.signal });
    expect(pool.queued).toBe(1);
    ctl.abort();
    await expect(waiting).rejects.toMatchObject({ code: 'aborted' });
    expect(pool.queued).toBe(0);
    await running;
    expect(log.filter((l) => l.startsWith('start'))).toHaveLength(1);
  });

  it('releases the engine after a failure', async () => {
    const log: string[] = [];
    const pool = new EnginePool([slowEngine(5, log, 'a', true)]);
    await expect(pool.analyze(req)).rejects.toMatchObject({ code: 'crashed' });
    await expect(pool.analyze(req)).rejects.toMatchObject({ code: 'crashed' }); // would hang if leaked
  });

  it('rejects waiters on dispose and refuses new work', async () => {
    const pool = new EnginePool([slowEngine(50, [], 'a')], 5);
    const running = pool.analyze(req);
    const waiting = pool.analyze(req);
    await pool.dispose();
    await expect(waiting).rejects.toMatchObject({ code: 'unavailable' });
    await running.catch(() => undefined);
    await expect(pool.analyze(req)).rejects.toMatchObject({ code: 'unavailable' });
  });
});
