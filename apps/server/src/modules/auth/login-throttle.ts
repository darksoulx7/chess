import { createHash } from 'node:crypto';
import type { RedisClient } from '../../infrastructure/redis.js';

/**
 * Failed-login counter per account identifier (in addition to the per-IP rate limit), so a distributed
 * guessing attack on one account is slowed even when each IP stays under its limit.
 * Redis errors fail open: login must keep working if Redis is down (the IP limit still applies).
 */
export class LoginThrottle {
  constructor(
    private readonly redis: RedisClient,
    private readonly maxFailures: number,
    private readonly windowSeconds = 15 * 60,
    private readonly onError: (err: unknown) => void = () => {},
  ) {}

  private key(identifier: string): string {
    return `login:fail:${createHash('sha256').update(identifier.toLowerCase()).digest('hex').slice(0, 32)}`;
  }

  /** Seconds the caller must wait, or 0 if the attempt may proceed. */
  async blockedFor(identifier: string): Promise<number> {
    try {
      const k = this.key(identifier);
      const count = Number((await this.redis.get(k)) ?? 0);
      if (count < this.maxFailures) return 0;
      return Math.max(1, await this.redis.ttl(k));
    } catch (err) {
      this.onError(err);
      return 0;
    }
  }

  async recordFailure(identifier: string): Promise<void> {
    try {
      const k = this.key(identifier);
      const n = await this.redis.incr(k);
      if (n === 1) await this.redis.expire(k, this.windowSeconds);
    } catch (err) {
      this.onError(err);
    }
  }

  async reset(identifier: string): Promise<void> {
    try {
      await this.redis.del(this.key(identifier));
    } catch (err) {
      this.onError(err);
    }
  }
}
