import { randomUUID } from 'node:crypto';
import type { OnlineColor, ServerMessage } from '@chess/game-types';
import type { RedisClient } from '../../infrastructure/redis.js';
import type { Bus } from './service.js';

export interface Connection {
  readonly id: string;
  readonly userId: string;
  send(message: ServerMessage): void;
}

const PRESENCE_TTL_SECONDS = 40;
const channel = (gameId: string) => `online:game:${gameId}`;
const presenceKey = (gameId: string, color: OnlineColor) => `online:presence:${gameId}:${color}`;

/**
 * Real-time fan-out. Connections subscribe to games; events are delivered to local connections
 * immediately and published on Redis so other server instances can deliver them to theirs.
 * Presence ("is my opponent connected?") lives in Redis with a TTL that connected clients refresh.
 */
export class GameHub implements Bus {
  private readonly local = new Map<string, Map<string, { conn: Connection; color: OnlineColor }>>();
  private readonly originId = randomUUID();
  private subscriber: RedisClient | null = null;

  constructor(
    private readonly redis: RedisClient,
    private readonly onError: (err: unknown, context: string) => void = () => {},
  ) {}

  /** Starts listening for events published by other instances. */
  async start(): Promise<void> {
    const sub = this.redis.duplicate();
    sub.on('error', (err) => this.onError(err, 'subscriber'));
    sub.on('message', (_ch, raw) => this.deliverRemote(raw));
    this.subscriber = sub;
  }

  async stop(): Promise<void> {
    await this.subscriber?.quit().catch(() => undefined);
    this.subscriber = null;
    this.local.clear();
  }

  private deliverRemote(raw: string): void {
    try {
      const env = JSON.parse(raw) as { o: string; g: string; m: ServerMessage[] };
      if (env.o === this.originId) return; // our own publish, already delivered locally
      this.deliverLocal(env.g, env.m);
    } catch (err) {
      this.onError(err, 'remote message');
    }
  }

  private deliverLocal(gameId: string, messages: ServerMessage[]): void {
    const subs = this.local.get(gameId);
    if (!subs) return;
    for (const { conn } of subs.values()) {
      for (const m of messages) {
        try {
          conn.send(m);
        } catch (err) {
          this.onError(err, 'send');
        }
      }
    }
  }

  async publish(gameId: string, messages: ServerMessage[]): Promise<void> {
    this.deliverLocal(gameId, messages);
    try {
      await this.redis.publish(
        channel(gameId),
        JSON.stringify({ o: this.originId, g: gameId, m: messages }),
      );
    } catch (err) {
      this.onError(err, 'redis publish'); // local delivery already happened; other instances miss this event until they resync
    }
  }

  async presence(gameId: string): Promise<{ w: boolean; b: boolean }> {
    try {
      const [w, b] = await this.redis.mget(presenceKey(gameId, 'w'), presenceKey(gameId, 'b'));
      return { w: w !== null, b: b !== null };
    } catch {
      const subs = this.local.get(gameId);
      const has = (c: OnlineColor) => !!subs && [...subs.values()].some((s) => s.color === c);
      return { w: has('w'), b: has('b') };
    }
  }

  /** Adds a connection to a game's audience and marks that seat as present. */
  async subscribe(conn: Connection, gameId: string, color: OnlineColor): Promise<void> {
    let subs = this.local.get(gameId);
    if (!subs) {
      subs = new Map();
      this.local.set(gameId, subs);
      await this.subscriber?.subscribe(channel(gameId)).catch((e) => this.onError(e, 'subscribe'));
    }
    const wasPresent = [...subs.values()].some((s) => s.color === color);
    subs.set(conn.id, { conn, color });
    await this.redis
      .set(presenceKey(gameId, color), '1', 'EX', PRESENCE_TTL_SECONDS)
      .catch((e) => this.onError(e, 'presence set'));
    if (!wasPresent)
      await this.publish(gameId, [{ t: 'presence', game: gameId, color, online: true }]);
  }

  async unsubscribe(conn: Connection, gameId: string): Promise<void> {
    const subs = this.local.get(gameId);
    const entry = subs?.get(conn.id);
    if (!subs || !entry) return;
    subs.delete(conn.id);
    const stillThere = [...subs.values()].some((s) => s.color === entry.color);
    if (!stillThere) {
      await this.redis
        .del(presenceKey(gameId, entry.color))
        .catch((e) => this.onError(e, 'presence del'));
      await this.publish(gameId, [
        { t: 'presence', game: gameId, color: entry.color, online: false },
      ]);
    }
    if (subs.size === 0) {
      this.local.delete(gameId);
      await this.subscriber
        ?.unsubscribe(channel(gameId))
        .catch((e) => this.onError(e, 'unsubscribe'));
    }
  }

  /** Called on heartbeat: keeps this connection's seats marked present. */
  async touch(conn: Connection): Promise<void> {
    for (const [gameId, subs] of this.local) {
      const entry = subs.get(conn.id);
      if (entry)
        await this.redis
          .expire(presenceKey(gameId, entry.color), PRESENCE_TTL_SECONDS)
          .catch(() => undefined);
    }
  }

  async leaveAll(conn: Connection): Promise<void> {
    for (const gameId of [...this.local.keys()]) await this.unsubscribe(conn, gameId);
  }

  connectionCount(userId: string): number {
    const ids = new Set<string>();
    for (const subs of this.local.values())
      for (const { conn } of subs.values()) if (conn.userId === userId) ids.add(conn.id);
    return ids.size;
  }
}
