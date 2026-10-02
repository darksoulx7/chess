import { describe, expect, it } from 'vitest';
import {
  BOT_RATINGS,
  buildBotProfile,
  createRng,
  formatScore,
  scoreToCp,
  winProbability,
} from '../src';

describe('bot profiles', () => {
  it('covers 100..2500 in steps of 100 (25 strengths)', () => {
    expect(BOT_RATINGS).toHaveLength(25);
    expect(BOT_RATINGS[0]).toBe(100);
    expect(BOT_RATINGS.at(-1)).toBe(2500);
  });

  it('rejects out-of-range ratings', () => {
    for (const r of [0, 50, 2600, 1500.5, NaN])
      expect(() => buildBotProfile(r)).toThrow(RangeError);
  });

  it('gets monotonically stronger with rating', () => {
    const profiles = BOT_RATINGS.map((r) => buildBotProfile(r));
    for (let i = 1; i < profiles.length; i++) {
      const a = profiles[i - 1]!;
      const b = profiles[i]!;
      expect(b.searchDepth).toBeGreaterThanOrEqual(a.searchDepth);
      expect(b.blunderRate).toBeLessThanOrEqual(a.blunderRate);
      expect(b.mistakeRate).toBeLessThanOrEqual(a.mistakeRate);
      expect(b.randomness).toBeLessThanOrEqual(a.randomness);
      expect(b.goodWindowCp).toBeLessThanOrEqual(a.goodWindowCp);
    }
  });

  it('is valid for every rating', () => {
    for (const r of BOT_RATINGS) {
      const p = buildBotProfile(r);
      expect(p.targetRating).toBe(r);
      expect(p.searchDepth).toBeGreaterThanOrEqual(1);
      expect(p.candidateMoveCount).toBeGreaterThanOrEqual(1);
      expect(p.mistakeRate + p.blunderRate).toBeLessThan(1);
      expect(p.maxBlunderLossCp).toBeGreaterThanOrEqual(p.maxMistakeLossCp);
    }
  });

  it('hits anchors exactly and supports custom anchor tables', () => {
    expect(buildBotProfile(1600).searchDepth).toBe(8);
    const custom = buildBotProfile(300, [
      {
        rating: 100,
        searchDepth: 1,
        candidateMoveCount: 2,
        randomness: 1,
        mistakeRate: 0,
        blunderRate: 0,
        goodWindowCp: 10,
        maxMistakeLossCp: 20,
        maxBlunderLossCp: 30,
      },
      {
        rating: 500,
        searchDepth: 5,
        candidateMoveCount: 2,
        randomness: 1,
        mistakeRate: 0,
        blunderRate: 0,
        goodWindowCp: 10,
        maxMistakeLossCp: 20,
        maxBlunderLossCp: 30,
      },
    ]);
    expect(custom.searchDepth).toBe(3);
  });
});

describe('score helpers and rng', () => {
  it('maps mate scores above any centipawn score, shorter mates higher', () => {
    expect(scoreToCp({ type: 'mate', value: 1 })).toBeGreaterThan(
      scoreToCp({ type: 'mate', value: 5 }),
    );
    expect(scoreToCp({ type: 'mate', value: 5 })).toBeGreaterThan(5000);
    expect(scoreToCp({ type: 'mate', value: -2 })).toBeLessThan(-5000);
    expect(scoreToCp({ type: 'cp', value: 42 })).toBe(42);
  });
  it('formats scores', () => {
    expect(formatScore({ type: 'cp', value: 42 })).toBe('+0.42');
    expect(formatScore({ type: 'cp', value: -120 })).toBe('-1.20');
    expect(formatScore({ type: 'mate', value: -3 })).toBe('-M3');
  });
  it('win probability is monotonic and centered', () => {
    expect(winProbability(0)).toBeCloseTo(0.5, 5);
    expect(winProbability(300)).toBeGreaterThan(winProbability(100));
    expect(winProbability(-300)).toBeLessThan(0.5);
  });
  it('rng is deterministic per seed and in [0,1)', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 5 }, a);
    expect(Array.from({ length: 5 }, b)).toEqual(seqA);
    expect(seqA.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(Array.from({ length: 5 }, createRng(43))).not.toEqual(seqA);
  });
});
