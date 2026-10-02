import { ChessGame, START_FEN } from '@chess/chess-core';
import { describe, expect, it } from 'vitest';
import {
  EngineError,
  buildBotProfile,
  chooseBotMove,
  type AnalysisRequest,
  type AnalysisResult,
  type BookProvider,
  type EngineLine,
  type EngineService,
} from '../src';

/** Engine returning canned lines for the start position; records requests. */
function fakeEngine(
  lines: Array<{ move: string; cp: number }>,
  calls: AnalysisRequest[] = [],
): EngineService {
  return {
    async analyze(req) {
      calls.push(req);
      const out: EngineLine[] = lines.slice(0, req.multiPv ?? 1).map((l, i) => ({
        multipv: i + 1,
        depth: 5,
        score: { type: 'cp', value: l.cp },
        pv: [l.move],
      }));
      return { lines: out, bestMove: lines[0]?.move ?? null } satisfies AnalysisResult;
    },
    async dispose() {},
  };
}

const LINES = [
  { move: 'e2e4', cp: 30 },
  { move: 'd2d4', cp: 25 },
  { move: 'g1f3', cp: 20 },
  { move: 'c2c4', cp: -80 }, // mistake band for weak bots
  { move: 'f2f3', cp: -300 }, // blunder band
  { move: 'h2h4', cp: -500 }, // loss 530: inside the 500-profile blunder band (350-700)
];

const play = async (rating: number, seed: number, lines = LINES) => {
  const r = await chooseBotMove({
    fen: START_FEN,
    profile: buildBotProfile(rating),
    engine: fakeEngine(lines),
    seed,
  });
  return r;
};

describe('chooseBotMove', () => {
  it('is deterministic for a given seed', async () => {
    const a = await Promise.all([1, 2, 3, 4, 5].map((s) => play(800, s)));
    const b = await Promise.all([1, 2, 3, 4, 5].map((s) => play(800, s)));
    expect(a).toEqual(b);
  });

  it('always returns a legal move', async () => {
    const g = ChessGame.create();
    const legal = new Set(g.getLegalMoves().map((m) => m.lan));
    for (let seed = 0; seed < 200; seed++) {
      expect(legal.has((await play(100, seed)).move)).toBe(true);
    }
  });

  it('strong bots almost always play top candidates; weak bots err more often', async () => {
    const sample = async (rating: number) => {
      let bad = 0;
      const n = 600;
      for (let seed = 0; seed < n; seed++) {
        const m = await play(rating, seed);
        if (m.quality === 'mistake' || m.quality === 'blunder') bad++;
      }
      return bad / n;
    };
    const weak = await sample(300);
    const mid = await sample(1400);
    const strong = await sample(2400);
    expect(weak).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(strong);
    expect(strong).toBeLessThan(0.05);
    expect(weak).toBeGreaterThan(0.25);
  });

  it('error rates are close to the configured rates', async () => {
    const profile = buildBotProfile(500);
    let blunders = 0;
    const n = 2000;
    for (let seed = 0; seed < n; seed++) {
      const r = await chooseBotMove({ fen: START_FEN, profile, engine: fakeEngine(LINES), seed });
      if (r.quality === 'blunder') blunders++;
    }
    expect(Math.abs(blunders / n - profile.blunderRate)).toBeLessThan(0.04);
  });

  it('never exceeds the loss caps of the profile and never picks a move that loses to mate on purpose', async () => {
    const lines = [
      { move: 'e2e4', cp: 30 },
      { move: 'd2d4', cp: 20 },
      { move: 'f2f3', cp: -99_950 }, // forced mate against: must never be chosen deliberately
    ];
    const profile = buildBotProfile(100);
    for (let seed = 0; seed < 500; seed++) {
      const r = await chooseBotMove({ fen: START_FEN, profile, engine: fakeEngine(lines), seed });
      expect(r.move).not.toBe('f2f3');
      expect(r.lossCp).toBeLessThanOrEqual(profile.maxBlunderLossCp);
    }
  });

  it('plays a forced mate when it is available (for bots that can see it)', async () => {
    const lines = [
      { move: 'e2e4', cp: 99_990 },
      { move: 'd2d4', cp: 40 },
    ];
    for (let seed = 0; seed < 100; seed++) {
      const r = await chooseBotMove({
        fen: START_FEN,
        profile: buildBotProfile(1500),
        engine: fakeEngine(lines),
        seed,
      });
      expect(r.move).toBe('e2e4');
    }
  });

  it('requests MultiPV and limits from the profile', async () => {
    const calls: AnalysisRequest[] = [];
    const profile = buildBotProfile(1200);
    await chooseBotMove({ fen: START_FEN, profile, engine: fakeEngine(LINES, calls), seed: 1 });
    expect(calls[0]?.multiPv).toBe(profile.candidateMoveCount);
    expect(calls[0]?.limits.depth).toBe(profile.searchDepth);
    expect(calls[0]?.limits.nodes).toBe(profile.nodes);
  });

  it('discards illegal engine moves and falls back safely', async () => {
    const r = await chooseBotMove({
      fen: START_FEN,
      profile: buildBotProfile(1600),
      engine: fakeEngine([{ move: 'e2e5', cp: 100 }]), // illegal
      seed: 1,
    });
    expect(
      new Set(
        ChessGame.create()
          .getLegalMoves()
          .map((m) => m.lan),
      ).has(r.move),
    ).toBe(true);
  });

  it('returns the only legal move without asking the engine', async () => {
    // Black king a8 with white Kb6 and Rh1: Kb8 is the only legal move.
    const single = 'k7/8/1K6/8/8/8/8/7R b - - 0 1';
    const calls: AnalysisRequest[] = [];
    const g = ChessGame.fromFen(single);
    if (!g.ok) throw new Error('fen');
    const legal = g.value.getLegalMoves();
    expect(legal).toHaveLength(1);
    const r = await chooseBotMove({
      fen: single,
      profile: buildBotProfile(1600),
      engine: fakeEngine([], calls),
      seed: 1,
    });
    expect(r.quality).toBe('only-move');
    expect(calls).toHaveLength(0);
  });

  it('uses a book move when provided and legal; falls through when illegal or null', async () => {
    const calls: AnalysisRequest[] = [];
    const book = (move: string | null): BookProvider => ({ pickMove: () => move });
    const a = await chooseBotMove({
      fen: START_FEN,
      profile: buildBotProfile(1600),
      engine: fakeEngine(LINES, calls),
      seed: 1,
      book: book('e2e4'),
    });
    expect(a).toMatchObject({ move: 'e2e4', quality: 'book' });
    expect(calls).toHaveLength(0);
    await chooseBotMove({
      fen: START_FEN,
      profile: buildBotProfile(1600),
      engine: fakeEngine(LINES, calls),
      seed: 1,
      book: book('e2e5'),
    });
    await chooseBotMove({
      fen: START_FEN,
      profile: buildBotProfile(1600),
      engine: fakeEngine(LINES, calls),
      seed: 1,
      book: book(null),
    });
    expect(calls).toHaveLength(2);
  });

  it('rejects invalid FEN and finished games', async () => {
    const engine = fakeEngine(LINES);
    await expect(
      chooseBotMove({ fen: 'nonsense', profile: buildBotProfile(800), engine }),
    ).rejects.toMatchObject({ code: 'invalid-request' });
    await expect(
      chooseBotMove({
        fen: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1',
        profile: buildBotProfile(800),
        engine,
      }),
    ).rejects.toBeInstanceOf(EngineError);
  });

  it('propagates engine failures', async () => {
    const failing: EngineService = {
      analyze: async () => {
        throw new EngineError('crashed');
      },
      dispose: async () => {},
    };
    await expect(
      chooseBotMove({ fen: START_FEN, profile: buildBotProfile(800), engine: failing }),
    ).rejects.toMatchObject({ code: 'crashed' });
  });
});
