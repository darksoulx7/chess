import { ChessGame } from '@chess/chess-core';
import type { BotProfile } from './bot-profile';
import { createRng, pickWeighted, type Rng } from './rng';
import { MATE_THRESHOLD_CP, scoreToCp } from './score';
import { EngineError, type AnalysisResult, type EngineService, type Score } from './types';

/** Supplies a move from an opening repertoire, or null to hand over to the engine. */
export interface BookProvider {
  pickMove(game: ChessGame, rng: Rng): string | null;
}

export type MoveQuality = 'book' | 'best' | 'good' | 'mistake' | 'blunder' | 'only-move';

export interface BotMove {
  /** UCI move, guaranteed legal in the requested position. */
  move: string;
  quality: MoveQuality;
  /** Engine score of the chosen move from the bot's perspective (undefined for book moves). */
  score?: Score;
  /** Centipawns lost versus the best candidate. */
  lossCp: number;
}

export interface ChooseBotMoveOptions {
  fen: string;
  profile: BotProfile;
  engine: EngineService;
  seed?: number;
  book?: BookProvider;
  signal?: AbortSignal;
}

interface Candidate {
  move: string;
  cp: number;
  score: Score;
  loss: number;
}

function toCandidates(result: AnalysisResult): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const line of [...result.lines].sort((a, b) => a.multipv - b.multipv)) {
    const move = line.pv[0];
    if (!move || seen.has(move)) continue;
    seen.add(move);
    out.push({ move, cp: scoreToCp(line.score), score: line.score, loss: 0 });
  }
  const best = out[0]?.cp ?? 0;
  for (const c of out) c.loss = Math.max(0, best - c.cp);
  return out;
}

/**
 * Chooses a move for a bot of the given profile.
 *
 * The engine ranks candidate moves (MultiPV); the bot then picks among them so that weaker bots
 * make *plausible* mistakes (bounded centipawn loss, never walking into a forced mate by choice)
 * instead of random legal moves. Deterministic for a given seed and engine output.
 */
export async function chooseBotMove(opts: ChooseBotMoveOptions): Promise<BotMove> {
  const { fen, profile, engine, signal } = opts;
  const rng = createRng(opts.seed ?? Math.floor(Math.random() * 2 ** 32));

  const loaded = ChessGame.fromFen(fen);
  if (!loaded.ok) throw new EngineError('invalid-request', 'invalid FEN');
  const game = loaded.value;
  if (game.isGameOver()) throw new EngineError('invalid-request', 'game is over');

  const legal = new Set(game.getLegalMoves().map((m) => m.lan));
  const legalList = [...legal];

  const bookMove = opts.book?.pickMove(game, rng);
  if (bookMove && legal.has(bookMove)) {
    return { move: bookMove, quality: 'book', lossCp: 0 };
  }

  if (legalList.length === 1) {
    return { move: legalList[0] as string, quality: 'only-move', lossCp: 0 };
  }

  const limits: { depth: number; nodes?: number; movetimeMs?: number } = {
    depth: profile.searchDepth,
  };
  if (profile.nodes !== undefined) limits.nodes = profile.nodes;
  if (profile.moveTimeMs !== undefined) limits.movetimeMs = profile.moveTimeMs;

  const result = await engine.analyze({
    fen,
    limits,
    multiPv: Math.min(profile.candidateMoveCount, legalList.length),
    ...(signal ? { signal } : {}),
  });

  // Never trust engine output blindly: keep only moves that are legal here.
  const candidates = toCandidates(result).filter((c) => legal.has(c.move));
  const best = candidates[0];
  if (!best) {
    const fallback =
      result.bestMove && legal.has(result.bestMove) ? result.bestMove : (legalList[0] as string);
    return { move: fallback, quality: 'best', lossCp: 0 };
  }

  const finish = (c: Candidate, quality: MoveQuality): BotMove => ({
    move: c.move,
    quality,
    score: c.score,
    lossCp: c.loss,
  });

  // A forced mate for us is always played by bots that can see it at all.
  if (best.cp >= MATE_THRESHOLD_CP && profile.targetRating >= 1000) return finish(best, 'best');

  const notLosingToMate = (c: Candidate) =>
    c.cp > -MATE_THRESHOLD_CP || best.cp <= -MATE_THRESHOLD_CP;
  const good = candidates.filter((c) => c.loss <= profile.goodWindowCp);
  const mistakes = candidates.filter(
    (c) =>
      c.loss > profile.goodWindowCp && c.loss <= profile.maxMistakeLossCp && notLosingToMate(c),
  );
  const blunders = candidates.filter(
    (c) =>
      c.loss > profile.maxMistakeLossCp && c.loss <= profile.maxBlunderLossCp && notLosingToMate(c),
  );

  const roll = rng();
  if (roll < profile.blunderRate && blunders.length > 0) {
    return finish(
      pickWeighted(
        blunders,
        blunders.map(() => 1),
        rng,
      ),
      'blunder',
    );
  }
  if (roll < profile.blunderRate + profile.mistakeRate && mistakes.length > 0) {
    return finish(
      pickWeighted(
        mistakes,
        mistakes.map((c) => 1 / (1 + c.loss / 100)),
        rng,
      ),
      'mistake',
    );
  }

  // Otherwise a good move, favouring the best with a temperature-controlled falloff.
  const pool = good.length > 0 ? good : [best];
  const temperature = Math.max(0.05, profile.randomness);
  const picked = pickWeighted(
    pool,
    pool.map((_, rank) => Math.exp(-rank / temperature)),
    rng,
  );
  return finish(picked, picked === best ? 'best' : 'good');
}
