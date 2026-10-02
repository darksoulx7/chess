export const MIN_BOT_RATING = 100;
export const MAX_BOT_RATING = 2500;
export const BOT_RATING_STEP = 100;

/**
 * A bot's strength configuration. `targetRating` is a *label for a tuning profile*, not a certified
 * Elo: the parameters below are hand-tuned starting points and are meant to be adjusted.
 */
export interface BotProfile {
  targetRating: number;
  searchDepth: number;
  nodes?: number;
  moveTimeMs?: number;
  /** Lines (MultiPV) the engine computes; the bot picks among them. */
  candidateMoveCount: number;
  /** Softmax temperature for choosing among good moves (higher = flatter / more random). */
  randomness: number;
  /** Chance of deliberately choosing an inaccurate-to-mistake move (centipawn loss in the mistake band). */
  mistakeRate: number;
  /** Chance of choosing a clearly bad move (loss in the blunder band). */
  blunderRate: number;
  /** Candidates within this many centipawns of the best are "good". */
  goodWindowCp: number;
  /** Upper bound for a "mistake" move's loss. */
  maxMistakeLossCp: number;
  /** Upper bound for a "blunder" move's loss. Keeps weak bots from hanging everything at once. */
  maxBlunderLossCp: number;
}

type Anchor = Omit<BotProfile, 'targetRating'> & { rating: number };

/** Tuning table. Values between anchors are linearly interpolated. Edit freely; this is data, not logic. */
export const PROFILE_ANCHORS: readonly Anchor[] = [
  {
    rating: 100,
    searchDepth: 1,
    nodes: 50,
    candidateMoveCount: 8,
    randomness: 2.0,
    mistakeRate: 0.35,
    blunderRate: 0.3,
    goodWindowCp: 400,
    maxMistakeLossCp: 500,
    maxBlunderLossCp: 900,
  },
  {
    rating: 500,
    searchDepth: 2,
    nodes: 400,
    candidateMoveCount: 6,
    randomness: 1.5,
    mistakeRate: 0.3,
    blunderRate: 0.15,
    goodWindowCp: 250,
    maxMistakeLossCp: 350,
    maxBlunderLossCp: 700,
  },
  {
    rating: 800,
    searchDepth: 3,
    nodes: 2000,
    candidateMoveCount: 5,
    randomness: 1.2,
    mistakeRate: 0.25,
    blunderRate: 0.08,
    goodWindowCp: 180,
    maxMistakeLossCp: 300,
    maxBlunderLossCp: 600,
  },
  {
    rating: 1200,
    searchDepth: 5,
    nodes: 20000,
    candidateMoveCount: 4,
    randomness: 0.9,
    mistakeRate: 0.18,
    blunderRate: 0.04,
    goodWindowCp: 120,
    maxMistakeLossCp: 250,
    maxBlunderLossCp: 500,
  },
  {
    rating: 1600,
    searchDepth: 8,
    candidateMoveCount: 4,
    randomness: 0.6,
    mistakeRate: 0.1,
    blunderRate: 0.015,
    goodWindowCp: 80,
    maxMistakeLossCp: 200,
    maxBlunderLossCp: 400,
  },
  {
    rating: 2000,
    searchDepth: 12,
    candidateMoveCount: 3,
    randomness: 0.35,
    mistakeRate: 0.05,
    blunderRate: 0.004,
    goodWindowCp: 50,
    maxMistakeLossCp: 150,
    maxBlunderLossCp: 300,
  },
  {
    rating: 2500,
    searchDepth: 18,
    moveTimeMs: 1500,
    candidateMoveCount: 2,
    randomness: 0.1,
    mistakeRate: 0.01,
    blunderRate: 0,
    goodWindowCp: 25,
    maxMistakeLossCp: 100,
    maxBlunderLossCp: 200,
  },
];

export const BOT_RATINGS: readonly number[] = Array.from(
  { length: (MAX_BOT_RATING - MIN_BOT_RATING) / BOT_RATING_STEP + 1 },
  (_, i) => MIN_BOT_RATING + i * BOT_RATING_STEP,
);

export function isValidBotRating(rating: number): boolean {
  return Number.isInteger(rating) && rating >= MIN_BOT_RATING && rating <= MAX_BOT_RATING;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function buildBotProfile(
  targetRating: number,
  anchors: readonly Anchor[] = PROFILE_ANCHORS,
): BotProfile {
  if (!isValidBotRating(targetRating))
    throw new RangeError(`bot rating out of range: ${targetRating}`);
  const lo = [...anchors].reverse().find((a) => a.rating <= targetRating) ?? (anchors[0] as Anchor);
  const hi = anchors.find((a) => a.rating >= targetRating) ?? (anchors.at(-1) as Anchor);
  const t = hi.rating === lo.rating ? 0 : (targetRating - lo.rating) / (hi.rating - lo.rating);
  const mix = (k: keyof Anchor) => lerp(lo[k] as number, hi[k] as number, t);

  const profile: BotProfile = {
    targetRating,
    searchDepth: Math.max(1, Math.round(mix('searchDepth'))),
    candidateMoveCount: Math.max(1, Math.round(mix('candidateMoveCount'))),
    randomness: round(mix('randomness'), 3),
    mistakeRate: round(mix('mistakeRate'), 4),
    blunderRate: round(mix('blunderRate'), 4),
    goodWindowCp: Math.round(mix('goodWindowCp')),
    maxMistakeLossCp: Math.round(mix('maxMistakeLossCp')),
    maxBlunderLossCp: Math.round(mix('maxBlunderLossCp')),
  };
  // Node and time caps are not interpolated: take them from the nearer anchor.
  const near = t < 0.5 ? lo : hi;
  if (near.nodes !== undefined) profile.nodes = near.nodes;
  if (near.moveTimeMs !== undefined) profile.moveTimeMs = near.moveTimeMs;
  return profile;
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
