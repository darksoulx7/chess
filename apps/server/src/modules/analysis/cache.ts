import { createHash } from 'node:crypto';
import type { AnalysisResult } from '@chess/engine';
import type { RedisClient } from '../../infrastructure/redis.js';

/** Result cache for position analysis. Failures must never fail a request (cache is an optimisation). */
export interface AnalysisCache {
  get(key: string): Promise<AnalysisResult | null>;
  set(key: string, value: AnalysisResult): Promise<void>;
}

/** Key is a hash of everything that changes the result: FEN, depth, MultiPV and the time cap. */
export function analysisCacheKey(params: {
  fen: string;
  depth: number;
  multiPv: number;
  maxMs: number;
}): string {
  const h = createHash('sha256')
    .update(`${params.fen}|${params.depth}|${params.multiPv}|${params.maxMs}`)
    .digest('hex')
    .slice(0, 40);
  return `analysis:v1:${h}`;
}

export class RedisAnalysisCache implements AnalysisCache {
  constructor(
    private readonly redis: RedisClient,
    private readonly ttlSeconds = 60 * 60 * 24,
    private readonly onError: (err: unknown) => void = () => {},
  ) {}

  async get(key: string): Promise<AnalysisResult | null> {
    try {
      const raw = await this.redis.get(key);
      return raw ? (JSON.parse(raw) as AnalysisResult) : null;
    } catch (err) {
      this.onError(err);
      return null;
    }
  }

  async set(key: string, value: AnalysisResult): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', this.ttlSeconds);
    } catch (err) {
      this.onError(err);
    }
  }
}
