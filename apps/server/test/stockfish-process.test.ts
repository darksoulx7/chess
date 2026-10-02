import { ChessGame, START_FEN } from '@chess/chess-core';
import { EngineError } from '@chess/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { StockfishProcess } from '../src/modules/analysis/stockfish-process.js';
import { STOCKFISH_PATH, fakeEngineBinary, hasStockfish } from './support.js';

const engines: StockfishProcess[] = [];
const make = (opts: Partial<ConstructorParameters<typeof StockfishProcess>[0]> = {}) => {
  const e = new StockfishProcess({ path: STOCKFISH_PATH, ...opts });
  engines.push(e);
  return e;
};
afterEach(async () => {
  await Promise.all(engines.splice(0).map((e) => e.dispose()));
});

describe.skipIf(!hasStockfish)('StockfishProcess (real Stockfish)', () => {
  it('analyses the start position with MultiPV and returns a legal best move', async () => {
    const r = await make().analyze({ fen: START_FEN, limits: { depth: 8 }, multiPv: 3 });
    expect(r.lines).toHaveLength(3);
    expect(r.lines.map((l) => l.multipv)).toEqual([1, 2, 3]);
    const legal = new Set(
      ChessGame.create()
        .getLegalMoves()
        .map((m) => m.lan),
    );
    expect(legal.has(r.bestMove as string)).toBe(true);
    for (const l of r.lines) expect(legal.has(l.pv[0] as string)).toBe(true);
    // best line should not be worse than the others
    const cp = (l: (typeof r.lines)[number]) => (l.score.type === 'cp' ? l.score.value : 0);
    expect(cp(r.lines[0]!)).toBeGreaterThanOrEqual(cp(r.lines[2]!));
  });

  it('finds a mate in one', async () => {
    const r = await make().analyze({
      fen: '6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1',
      limits: { depth: 6 },
    });
    expect(r.bestMove).toBe('a1a8');
    expect(r.lines[0]?.score).toEqual({ type: 'mate', value: 1 });
  });

  it('reports no best move for a finished game', async () => {
    const r = await make().analyze({ fen: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', limits: { depth: 4 } });
    expect(r.bestMove).toBeNull();
  });

  it('honours node limits', async () => {
    const r = await make().analyze({ fen: START_FEN, limits: { nodes: 2000 } });
    expect(r.bestMove).not.toBeNull();
  });

  it('serializes concurrent searches on one process', async () => {
    const e = make();
    const results = await Promise.all([
      e.analyze({ fen: START_FEN, limits: { depth: 6 } }),
      e.analyze({ fen: '6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1', limits: { depth: 6 } }),
      e.analyze({ fen: START_FEN, limits: { depth: 6 }, multiPv: 2 }),
    ]);
    expect(results[1].bestMove).toBe('a1a8');
    expect(results[2].lines).toHaveLength(2);
  });

  it('aborts a long search quickly and stays usable', async () => {
    const e = make();
    const ctl = new AbortController();
    const started = Date.now();
    const p = e.analyze({ fen: START_FEN, limits: { depth: 40 }, signal: ctl.signal });
    setTimeout(() => ctl.abort(), 150);
    await expect(p).rejects.toMatchObject({ code: 'aborted' });
    expect(Date.now() - started).toBeLessThan(3000);
    const next = await e.analyze({ fen: START_FEN, limits: { depth: 5 } });
    expect(next.bestMove).not.toBeNull();
  });

  it('rejects immediately for an already-aborted signal', async () => {
    const ctl = new AbortController();
    ctl.abort();
    await expect(
      make().analyze({ fen: START_FEN, limits: { depth: 3 }, signal: ctl.signal }),
    ).rejects.toMatchObject({ code: 'aborted' });
  });

  it('times out an over-long search and recovers', async () => {
    const e = make({ maxSearchMs: 300, graceMs: 200 });
    await expect(e.analyze({ fen: START_FEN, limits: { depth: 60 } })).rejects.toMatchObject({
      code: 'timeout',
    });
    const next = await e.analyze({ fen: START_FEN, limits: { depth: 5 } });
    expect(next.bestMove).not.toBeNull();
  });

  it('rejects malformed FEN input without touching the engine', async () => {
    await expect(make().analyze({ fen: 'e2e4; quit', limits: { depth: 3 } })).rejects.toMatchObject(
      { code: 'invalid-request' },
    );
    await expect(
      make().analyze({ fen: 'x'.repeat(500), limits: { depth: 3 } }),
    ).rejects.toMatchObject({ code: 'invalid-request' });
  });

  it('rejects after dispose', async () => {
    const e = make();
    await e.dispose();
    await expect(e.analyze({ fen: START_FEN, limits: { depth: 3 } })).rejects.toMatchObject({
      code: 'unavailable',
    });
  });
});

describe('StockfishProcess failure modes (fake engines)', () => {
  it('reports unavailable when the binary does not exist', async () => {
    const e = make({ path: '/nonexistent/stockfish' });
    await expect(e.analyze({ fen: START_FEN, limits: { depth: 3 } })).rejects.toBeInstanceOf(
      EngineError,
    );
    await expect(e.analyze({ fen: START_FEN, limits: { depth: 3 } })).rejects.toMatchObject({
      code: 'unavailable',
    });
  });

  it('reports crashed when the engine dies mid-search, then restarts on the next call', async () => {
    const marker = `${process.pid}-${Date.now()}`;
    const bin = fakeEngineBinary(`
import { existsSync, writeFileSync } from 'node:fs';
const flag = '/tmp/fake-uci-${marker}';
rl.on('line', (l) => {
  if (l === 'uci') out('uciok');
  else if (l === 'isready') out('readyok');
  else if (l.startsWith('go')) {
    if (!existsSync(flag)) { writeFileSync(flag, '1'); process.exit(1); }
    out('info depth 1 multipv 1 score cp 10 pv e2e4');
    out('bestmove e2e4');
  } else if (l === 'quit') process.exit(0);
});`);
    const e = make({ path: bin });
    await expect(e.analyze({ fen: START_FEN, limits: { depth: 3 } })).rejects.toMatchObject({
      code: 'crashed',
    });
    const ok = await e.analyze({ fen: START_FEN, limits: { depth: 3 } });
    expect(ok.bestMove).toBe('e2e4');
  });

  it('times out an engine that never answers go and kills it', async () => {
    const bin = fakeEngineBinary(`
rl.on('line', (l) => {
  if (l === 'uci') out('uciok');
  else if (l === 'isready') out('readyok');
  else if (l === 'quit') process.exit(0);
  // 'go' and 'stop' are ignored: a hung engine
});`);
    const e = make({ path: bin, maxSearchMs: 200, graceMs: 100 });
    await expect(e.analyze({ fen: START_FEN, limits: { depth: 3 } })).rejects.toMatchObject({
      code: 'timeout',
    });
  });
});
