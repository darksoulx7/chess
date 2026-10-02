import { randomUUID } from 'node:crypto';
import {
  MAX_WS_MESSAGE_BYTES,
  clientMessageSchema,
  type ClientMessage,
  type OnlineErrorCode,
  type ServerMessage,
} from '@chess/game-types';
import type { FastifyInstance } from 'fastify';
import type WebSocket from 'ws';
import { verifyAccessToken } from '../auth/tokens.js';
import { colorOf, type Command } from './domain.js';
import type { Connection, GameHub } from './hub.js';
import { loadGame } from './repository.js';
import type { OnlineService } from './service.js';
import type { Db } from '../../infrastructure/db.js';

export interface WsDeps {
  service: OnlineService;
  hub: GameHub;
  db: Db;
  jwtSecret: string;
  /** Messages per second allowed per connection (token bucket; burst = 2 s worth). */
  ratePerSecond: number;
  authTimeoutMs: number;
}

const CLOSE_AUTH_TIMEOUT = 4001;
const CLOSE_RATE = 4008;
const CLOSE_TOO_LARGE = 1009;

/** `GET /ws`: the real-time game channel. First message must be `auth`; everything is validated against a schema. */
export function registerOnlineSocket(app: FastifyInstance, deps: WsDeps): void {
  app.get('/ws', { websocket: true }, (socket: WebSocket, req) => {
    const id = randomUUID();
    let userId: string | null = null;
    let authExpiresAt = 0;
    const subscribed = new Set<string>();
    let tokens = deps.ratePerSecond * 2;
    let lastRefill = Date.now();

    const send = (m: ServerMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(m));
    };
    const fail = (code: OnlineErrorCode, extra: { cid?: string | undefined; game?: string } = {}) =>
      send({
        t: 'error',
        code,
        ...(extra.cid ? { cid: extra.cid } : {}),
        ...(extra.game ? { game: extra.game } : {}),
      });

    const conn: Connection = {
      id,
      get userId() {
        return userId ?? '';
      },
      send,
    };
    const log = req.log.child({ wsConnection: id });

    const authTimer = setTimeout(() => {
      if (!userId) socket.close(CLOSE_AUTH_TIMEOUT, 'auth timeout');
    }, deps.authTimeoutMs);

    const sendState = async (gameId: string) => {
      const snap = await deps.service.snapshotFor(userId as string, gameId);
      if (!snap) return fail('not_found', { game: gameId });
      send({ t: 'state', game: snap });
    };

    async function handle(msg: ClientMessage): Promise<void> {
      if (msg.t === 'ping') {
        send({ t: 'pong', serverTime: Date.now() });
        await deps.hub.touch(conn);
        return;
      }
      if (msg.t === 'auth') {
        const claims = await verifyAccessToken(msg.token, deps.jwtSecret);
        if (!claims) return fail('unauthenticated');
        if (userId && userId !== claims.userId) return fail('unauthenticated'); // cannot switch accounts mid-connection
        userId = claims.userId;
        authExpiresAt = (claims.exp ?? 0) * 1000;
        send({ t: 'auth_ok', userId, exp: authExpiresAt });
        return;
      }
      if (!userId) return fail('unauthenticated');
      if (Date.now() >= authExpiresAt) return fail('auth_expired');

      switch (msg.t) {
        case 'sub': {
          const stored = await loadGame(deps.db, msg.game);
          const color = stored ? colorOf(stored.game, userId) : null;
          if (!stored || !color) return fail('not_found', { game: msg.game });
          await deps.hub.subscribe(conn, msg.game, color);
          subscribed.add(msg.game);
          return sendState(msg.game);
        }
        case 'unsub':
          subscribed.delete(msg.game);
          return deps.hub.unsubscribe(conn, msg.game);
        case 'move':
        case 'resign':
        case 'draw':
        case 'abort': {
          const cmd: Command =
            msg.t === 'move'
              ? { type: 'move', uci: msg.uci, expectedPly: msg.ply }
              : msg.t === 'draw'
                ? { type: 'draw', action: msg.action }
                : { type: msg.t };
          const r = await deps.service.command(userId, msg.game, cmd);
          if (!r.ok) {
            fail(r.error, { cid: 'cid' in msg ? msg.cid : undefined, game: msg.game });
            if (r.error === 'stale') await sendState(msg.game); // the client is out of sync: give it the truth
            return;
          }
          if (msg.t === 'move')
            send({
              t: 'ack',
              ...(msg.cid ? { cid: msg.cid } : {}),
              game: msg.game,
              ply: r.ply,
              ...(r.duplicate ? { duplicate: true } : {}),
            });
          return;
        }
      }
    }

    socket.on('message', (raw: Buffer) => {
      if (raw.length > MAX_WS_MESSAGE_BYTES) {
        socket.close(CLOSE_TOO_LARGE, 'message too large');
        return;
      }
      const now = Date.now();
      tokens = Math.min(
        deps.ratePerSecond * 2,
        tokens + ((now - lastRefill) / 1000) * deps.ratePerSecond,
      );
      lastRefill = now;
      if (tokens < 1) {
        fail('rate_limited');
        if (tokens < -deps.ratePerSecond) socket.close(CLOSE_RATE, 'rate limited');
        tokens -= 1;
        return;
      }
      tokens -= 1;

      let parsed: ClientMessage;
      try {
        const result = clientMessageSchema.safeParse(JSON.parse(raw.toString('utf8')));
        if (!result.success) return fail('invalid_message');
        parsed = result.data;
      } catch {
        return fail('invalid_message');
      }
      handle(parsed).catch((err) => {
        log.error({ err }, 'ws handler error');
        fail('server_error');
      });
    });

    socket.on('close', () => {
      clearTimeout(authTimer);
      void deps.hub.leaveAll(conn).catch((err) => log.warn({ err }, 'ws cleanup failed'));
    });
    socket.on('error', (err: Error) => log.warn({ err }, 'ws error'));
  });
}
