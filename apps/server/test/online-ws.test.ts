import type { ServerMessage } from '@chess/game-types';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { buildApp } from '../src/app.js';
import { signAccessToken } from '../src/modules/auth/tokens.js';
import { loadEnv } from '../src/shared/env.js';
import { SECRET, createHarness, register, type Harness } from './auth-helper.js';

let h: Harness;
let url: string;
beforeAll(async () => {
  h = await createHarness({ WS_AUTH_TIMEOUT_MS: '400', WS_RATE_PER_SECOND: '20' });
  await h.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = h.app.server.address();
  url = `ws://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/ws`;
});
afterAll(() => h.close());

/** Minimal test client: records every message and lets a test wait for the next one matching a predicate. */
class Client {
  readonly messages: ServerMessage[] = [];
  closeCode: number | null = null;
  private taken = new Set<number>();
  private waiters: Array<() => void> = [];

  private constructor(readonly ws: WebSocket) {
    ws.on('message', (raw) => {
      this.messages.push(JSON.parse(raw.toString()) as ServerMessage);
      this.waiters.splice(0).forEach((w) => w());
    });
    ws.on('close', (code) => {
      this.closeCode = code;
      this.waiters.splice(0).forEach((w) => w());
    });
  }

  static async connect(target = url): Promise<Client> {
    const ws = new WebSocket(target);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    return new Client(ws);
  }

  send(msg: unknown) {
    this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  /** Resolves with the next unconsumed message matching `pred`; rejects after `ms`. */
  async next<T extends ServerMessage = ServerMessage>(
    pred: (m: ServerMessage) => boolean,
    ms = 3000,
  ): Promise<T> {
    const deadline = Date.now() + ms;
    for (;;) {
      // The server may send an ack and a broadcast in either order, so a message is
      // taken by the first matching wait wherever it sits in the received list.
      for (let i = 0; i < this.messages.length; i++) {
        const m = this.messages[i] as ServerMessage;
        if (!this.taken.has(i) && pred(m)) {
          this.taken.add(i);
          return m as T;
        }
      }
      const left = deadline - Date.now();
      if (left <= 0)
        throw new Error(
          `timed out waiting for message; got ${JSON.stringify(this.messages.slice(-5))}`,
        );
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, left);
        this.waiters.push(() => {
          clearTimeout(t);
          resolve();
        });
      });
    }
  }

  /** Asserts that no matching message arrives within `ms`. */
  async none(pred: (m: ServerMessage) => boolean, ms = 250) {
    await expect(this.next(pred, ms)).rejects.toThrow(/timed out/);
  }

  async auth(token: string) {
    this.send({ t: 'auth', token });
    return this.next<Extract<ServerMessage, { t: 'auth_ok' }>>((m) => m.t === 'auth_ok');
  }

  async waitClosed(ms = 2000): Promise<number> {
    const deadline = Date.now() + ms;
    while (this.closeCode === null && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 20));
    if (this.closeCode === null) throw new Error('socket did not close');
    return this.closeCode;
  }

  close() {
    this.ws.close();
  }
}

const open: Client[] = [];
const connect = async (target?: string) => {
  const c = await Client.connect(target);
  open.push(c);
  return c;
};
afterEach(() => {
  open.splice(0).forEach((c) => c.close());
});

const is =
  <T extends ServerMessage['t']>(t: T) =>
  (m: ServerMessage): m is Extract<ServerMessage, { t: T }> =>
    m.t === t;

async function newGame(clock: { initialMs: number; incrementMs: number } | null = null) {
  const a = await register(h.app);
  const b = await register(h.app);
  const g = await h.app.online.create(a.user.id, a.creds.username, {
    color: 'w',
    clockConfig: clock,
    isPublic: false,
  });
  const j = await h.app.online.join(b.user.id, b.creds.username, { gameId: g.id });
  if (!j.ok) throw new Error('join failed');
  return { a, b, id: g.id };
}

/** Both players connected, authenticated and subscribed. */
async function twoPlayers(clock: { initialMs: number; incrementMs: number } | null = null) {
  const { a, b, id } = await newGame(clock);
  const ca = await connect();
  const cb = await connect();
  await ca.auth(a.accessToken);
  await cb.auth(b.accessToken);
  ca.send({ t: 'sub', game: id });
  cb.send({ t: 'sub', game: id });
  await ca.next(is('state'));
  await cb.next(is('state'));
  return { a, b, id, ca, cb };
}

describe('connection and authentication', () => {
  it('answers pings without authentication', async () => {
    const c = await connect();
    c.send({ t: 'ping' });
    const pong = await c.next(is('pong'));
    expect(Math.abs(pong.serverTime - Date.now())).toBeLessThan(2000);
  });

  it('refuses everything else until authenticated', async () => {
    const { id } = await newGame();
    const c = await connect();
    c.send({ t: 'sub', game: id });
    expect(await c.next(is('error'))).toMatchObject({ code: 'unauthenticated' });
    c.send({ t: 'move', game: id, uci: 'e2e4', ply: 0 });
    expect(await c.next(is('error'))).toMatchObject({ code: 'unauthenticated' });
  });

  it('rejects invalid, expired and foreign-secret tokens', async () => {
    const c = await connect();
    for (const token of [
      'x'.repeat(40),
      await signAccessToken(
        { userId: 'u', familyId: 'f' },
        'another-secret-another-secret-another-secret',
        60,
      ),
    ]) {
      c.send({ t: 'auth', token });
      expect(await c.next(is('error'))).toMatchObject({ code: 'unauthenticated' });
    }
  });

  it('closes a connection that never authenticates', async () => {
    const c = await connect();
    expect(await c.waitClosed()).toBe(4001);
  });

  it('cannot switch accounts mid-connection', async () => {
    const { a, b } = await newGame();
    const c = await connect();
    await c.auth(a.accessToken);
    c.send({ t: 'auth', token: b.accessToken });
    expect(await c.next(is('error'))).toMatchObject({ code: 'unauthenticated' });
  });

  it('enforces access-token expiry per command and accepts a fresh token on the same connection', async () => {
    const { a, id } = await newGame();
    const c = await connect();
    const shortLived = await signAccessToken({ userId: a.user.id, familyId: 'f' }, SECRET, 1);
    await c.auth(shortLived);
    c.send({ t: 'sub', game: id });
    await c.next(is('state'));
    await new Promise((r) => setTimeout(r, 1200));
    c.send({ t: 'move', game: id, uci: 'e2e4', ply: 0, cid: 'late' });
    expect(await c.next(is('error'))).toMatchObject({ code: 'auth_expired' });
    await c.auth(a.accessToken); // refreshed token
    c.send({ t: 'move', game: id, uci: 'e2e4', ply: 0, cid: 'ok' });
    expect(await c.next(is('ack'))).toMatchObject({ cid: 'ok', ply: 1 });
  });
});

describe('subscribing', () => {
  it('sends the full state to players and hides the game from everyone else', async () => {
    const { a, id } = await newGame({ initialMs: 60_000, incrementMs: 0 });
    const stranger = await register(h.app);
    const cs = await connect();
    await cs.auth(stranger.accessToken);
    cs.send({ t: 'sub', game: id });
    expect(await cs.next(is('error'))).toMatchObject({ code: 'not_found', game: id });

    const ca = await connect();
    await ca.auth(a.accessToken);
    ca.send({ t: 'sub', game: id });
    const { game } = await ca.next(is('state'));
    expect(game).toMatchObject({ id, status: 'ACTIVE', moves: [], version: 1, drawOfferBy: null });
    expect(game.players.w?.id).toBe(a.user.id);
    expect(game.clock).toMatchObject({ whiteMs: 60_000, running: null });
    expect(Math.abs(game.serverTime - Date.now())).toBeLessThan(2000);
    expect(game.presence.w).toBe(true);
  });

  it('rejects malformed game ids and unknown games', async () => {
    const { a } = await newGame();
    const c = await connect();
    await c.auth(a.accessToken);
    c.send({ t: 'sub', game: 'nope' });
    expect(await c.next(is('error'))).toMatchObject({ code: 'invalid_message' });
    c.send({ t: 'sub', game: '00000000-0000-0000-0000-000000000000' });
    expect(await c.next(is('error'))).toMatchObject({ code: 'not_found' });
  });
});

describe('moves', () => {
  it('broadcasts accepted moves to both players and acknowledges the sender', async () => {
    const { id, ca, cb } = await twoPlayers({ initialMs: 60_000, incrementMs: 0 });
    ca.send({ t: 'move', game: id, uci: 'e2e4', ply: 0, cid: 'm1' });
    const ack = await ca.next(is('ack'));
    expect(ack).toMatchObject({ cid: 'm1', game: id, ply: 1 });
    expect(ack.duplicate).toBeUndefined();
    for (const c of [ca, cb]) {
      const m = await c.next(is('move'));
      expect(m).toMatchObject({ game: id, ply: 1, uci: 'e2e4', san: 'e4' });
      expect(m.clock?.running).toBe('b'); // first move starts the opponent's clock
      expect(Math.abs(m.serverTime - Date.now())).toBeLessThan(2000);
    }
    cb.send({ t: 'move', game: id, uci: 'e7e5', ply: 1, cid: 'm2' });
    expect(await cb.next(is('ack'))).toMatchObject({ ply: 2 });
    const m2 = await ca.next(is('move'));
    expect(m2).toMatchObject({ ply: 2, uci: 'e7e5' });
    expect(m2.version).toBeGreaterThan(1);
  });

  it('rejects illegal moves, wrong-turn moves and stale plies with the right error, echoing the client id', async () => {
    const { id, ca, cb } = await twoPlayers();
    ca.send({ t: 'move', game: id, uci: 'e2e5', ply: 0, cid: 'x1' });
    expect(await ca.next(is('error'))).toMatchObject({ code: 'illegal_move', cid: 'x1', game: id });
    cb.send({ t: 'move', game: id, uci: 'e7e5', ply: 0, cid: 'x2' });
    expect(await cb.next(is('error'))).toMatchObject({ code: 'not_your_turn', cid: 'x2' });
    await ca.none(is('move'));

    ca.send({ t: 'move', game: id, uci: 'e2e4', ply: 0 });
    await ca.next(is('ack'));
    ca.send({ t: 'move', game: id, uci: 'd2d4', ply: 0, cid: 'x3' }); // client believes it is still ply 0
    expect(await ca.next(is('error'))).toMatchObject({ code: 'stale', cid: 'x3' });
    const resync = await ca.next(is('state')); // the server sends the truth along with a stale error
    expect(resync.game.moves).toEqual(['e2e4']);
  });

  it('treats a re-sent move as a duplicate: acknowledged, but not applied or broadcast again', async () => {
    const { id, ca, cb } = await twoPlayers();
    ca.send({ t: 'move', game: id, uci: 'e2e4', ply: 0, cid: 'first' });
    await ca.next(is('ack'));
    await cb.next(is('move'));
    ca.send({ t: 'move', game: id, uci: 'e2e4', ply: 0, cid: 'retry' });
    expect(await ca.next(is('ack'))).toMatchObject({ cid: 'retry', ply: 1, duplicate: true });
    await cb.none(is('move'));
    expect(h.app.online).toBeDefined();
    expect(
      (await h.t.db.query('select count(*)::int as n from game_moves where game_id = $1', [id]))
        .rows[0].n,
    ).toBe(1);
  });

  it('plays a full game to checkmate and tells both players', async () => {
    const { a, b, id, ca, cb } = await twoPlayers();
    const seq: Array<[typeof ca, string, number]> = [
      [ca, 'f2f3', 0],
      [cb, 'e7e5', 1],
      [ca, 'g2g4', 2],
      [cb, 'd8h4', 3],
    ];
    for (const [c, uci, ply] of seq) {
      c.send({ t: 'move', game: id, uci, ply });
      await c.next(is('ack')); // a client moves only after its previous move was acknowledged
    }
    for (const c of [ca, cb]) {
      const ended = await c.next(is('ended'));
      expect(ended).toMatchObject({ game: id, result: '0-1', termination: 'checkmate' });
    }
    ca.send({ t: 'move', game: id, uci: 'a2a3', ply: 4 });
    expect(await ca.next(is('error'))).toMatchObject({ code: 'not_active' });
    expect(a.user.id).not.toBe(b.user.id);
  });
});

describe('resign, draws and abort', () => {
  it('resignation ends the game for both', async () => {
    const { id, ca, cb } = await twoPlayers();
    cb.send({ t: 'resign', game: id });
    for (const c of [ca, cb])
      expect(await c.next(is('ended'))).toMatchObject({
        result: '1-0',
        termination: 'resignation',
      });
  });

  it('draw offer, decline, re-offer, accept', async () => {
    const { id, ca, cb } = await twoPlayers();
    ca.send({ t: 'draw', game: id, action: 'offer' });
    for (const c of [ca, cb]) expect(await c.next(is('draw'))).toMatchObject({ offerBy: 'w' });
    ca.send({ t: 'draw', game: id, action: 'offer' });
    expect(await ca.next(is('error'))).toMatchObject({ code: 'already_offered' });
    ca.send({ t: 'draw', game: id, action: 'accept' });
    expect(await ca.next(is('error'))).toMatchObject({ code: 'no_offer' }); // cannot accept your own
    cb.send({ t: 'draw', game: id, action: 'decline' });
    for (const c of [ca, cb]) expect(await c.next(is('draw'))).toMatchObject({ offerBy: null });
    cb.send({ t: 'draw', game: id, action: 'offer' });
    await ca.next(is('draw'));
    ca.send({ t: 'draw', game: id, action: 'accept' });
    for (const c of [ca, cb])
      expect(await c.next(is('ended'))).toMatchObject({
        result: '1/2-1/2',
        termination: 'agreement',
      });
  });

  it('a move implicitly declines a pending offer', async () => {
    const { id, ca, cb } = await twoPlayers();
    ca.send({ t: 'draw', game: id, action: 'offer' });
    await cb.next(is('draw'));
    cb.send({ t: 'move', game: id, uci: 'e7e5', ply: 0 });
    expect(await cb.next(is('error'))).toMatchObject({ code: 'not_your_turn' }); // black cannot move first...
    ca.send({ t: 'move', game: id, uci: 'e2e4', ply: 0 });
    await cb.next(is('move'));
    expect(await cb.next(is('draw'))).toMatchObject({ offerBy: null });
  });

  it('abort works only before both players have moved', async () => {
    const { id, ca, cb } = await twoPlayers();
    ca.send({ t: 'abort', game: id });
    for (const c of [ca, cb])
      expect(await c.next(is('ended'))).toMatchObject({ result: '*', termination: 'abandoned' });
    const g2 = await twoPlayers();
    g2.ca.send({ t: 'move', game: g2.id, uci: 'e2e4', ply: 0 });
    await g2.ca.next(is('ack'));
    g2.cb.send({ t: 'move', game: g2.id, uci: 'e7e5', ply: 1 });
    await g2.cb.next(is('ack'));
    g2.ca.send({ t: 'abort', game: g2.id });
    expect(await g2.ca.next(is('error'))).toMatchObject({ code: 'cannot_abort' });
  });
});

describe('presence, reconnection and timeouts', () => {
  it('shows when the opponent connects and disconnects', async () => {
    const { a, b, id } = await newGame();
    const ca = await connect();
    await ca.auth(a.accessToken);
    ca.send({ t: 'sub', game: id });
    expect((await ca.next(is('state'))).game.presence).toEqual({ w: true, b: false });
    const cb = await connect();
    await cb.auth(b.accessToken);
    cb.send({ t: 'sub', game: id });
    expect(await ca.next((m) => m.t === 'presence' && m.color === 'b')).toMatchObject({
      online: true,
    });
    cb.close();
    expect(await ca.next((m) => m.t === 'presence' && m.color === 'b' && !m.online)).toMatchObject({
      online: false,
    });
  });

  it('a player can drop, miss moves, reconnect, resync from the snapshot and carry on', async () => {
    const { a, id, ca, cb } = await twoPlayers();
    ca.send({ t: 'move', game: id, uci: 'e2e4', ply: 0 });
    await ca.next(is('ack'));
    ca.close(); // white drops off
    cb.send({ t: 'move', game: id, uci: 'e7e5', ply: 1 });
    await cb.next(is('ack'));

    const back = await connect();
    await back.auth(a.accessToken);
    back.send({ t: 'sub', game: id });
    const { game } = await back.next(is('state'));
    expect(game.moves).toEqual(['e2e4', 'e7e5']); // caught up on what it missed
    back.send({ t: 'move', game: id, uci: 'g1f3', ply: game.moves.length, cid: 'after-reconnect' });
    expect(await back.next(is('ack'))).toMatchObject({ ply: 3 });
    expect(await cb.next((m) => m.t === 'move' && m.uci === 'g1f3')).toMatchObject({ ply: 3 });
  });

  it('pushes a timeout to both players when the sweeper ends the game', async () => {
    const { id, ca, cb } = await twoPlayers({ initialMs: 250, incrementMs: 0 });
    ca.send({ t: 'move', game: id, uci: 'e2e4', ply: 0 });
    await ca.next(is('ack'));
    cb.send({ t: 'move', game: id, uci: 'e7e5', ply: 1 });
    await cb.next(is('ack'));
    await new Promise((r) => setTimeout(r, 400));
    expect(await h.app.online.sweep()).toBe(1);
    for (const c of [ca, cb])
      expect(await c.next(is('ended'))).toMatchObject({ result: '0-1', termination: 'timeout' });
  });

  it('serves the final state of a finished game on subscribe', async () => {
    const { a, id, ca } = await twoPlayers();
    ca.send({ t: 'resign', game: id });
    await ca.next(is('ended'));
    const late = await connect();
    await late.auth(a.accessToken);
    late.send({ t: 'sub', game: id });
    expect((await late.next(is('state'))).game).toMatchObject({
      status: 'FINISHED',
      result: '0-1',
      termination: 'resignation',
    });
  });
});

describe('hardening', () => {
  it('rejects malformed, unknown and badly typed messages without dropping the connection', async () => {
    const { a } = await newGame();
    const c = await connect();
    await c.auth(a.accessToken);
    for (const bad of [
      '{not json',
      '[]',
      '{"t":"fly"}',
      '{"t":"move"}',
      '{"t":"move","game":"x","uci":"e2e4","ply":0}',
      '{"t":"move","game":"00000000-0000-0000-0000-000000000000","uci":"e2e9","ply":0}',
      '{"t":"move","game":"00000000-0000-0000-0000-000000000000","uci":"e2e4","ply":-1}',
      '{"t":"draw","game":"00000000-0000-0000-0000-000000000000","action":"steal"}',
    ]) {
      c.send(bad);
      expect(await c.next(is('error')), bad).toMatchObject({ code: 'invalid_message' });
    }
    c.send({ t: 'ping' });
    await c.next(is('pong')); // still alive
  });

  it('closes oversized messages', async () => {
    const c = await connect();
    c.ws.send(JSON.stringify({ t: 'auth', token: 'x'.repeat(10_000) }));
    expect(await c.waitClosed()).toBe(1009);
  });

  it('rate limits a flooding connection and finally disconnects it', async () => {
    const limited = await createHarness({ WS_RATE_PER_SECOND: '5' });
    try {
      await limited.app.listen({ port: 0, host: '127.0.0.1' });
      const addr = limited.app.server.address();
      const c = await connect(
        `ws://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/ws`,
      );
      for (let i = 0; i < 60; i++) c.send({ t: 'ping' });
      expect(await c.next(is('error'))).toMatchObject({ code: 'rate_limited' });
      expect(await c.waitClosed()).toBe(4008);
    } finally {
      open.splice(0).forEach((x) => x.close());
      await limited.close();
    }
  });
});

describe('multiple server instances', () => {
  it('fans events out across instances through Redis', async () => {
    // A second app instance sharing the same database and Redis, with its own hub and sockets.
    const second = await buildApp({
      env: loadEnv({
        NODE_ENV: 'test',
        DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://chess:chess@127.0.0.1:5432/chess',
        REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
        JWT_SECRET: SECRET,
        AUTH_RATE_LIMIT_MAX: '10000',
      }),
      db: h.t.db,
      redis: h.redis,
      engine: { analyze: async () => ({ lines: [], bestMove: null }), dispose: async () => {} },
    });
    try {
      await second.listen({ port: 0, host: '127.0.0.1' });
      const addr = second.server.address();
      const urlB = `ws://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/ws`;

      const { a, b, id } = await newGame();
      const onA = await connect(url); // white on instance 1
      const onB = await connect(urlB); // black on instance 2
      await onA.auth(a.accessToken);
      await onB.auth(b.accessToken);
      onA.send({ t: 'sub', game: id });
      onB.send({ t: 'sub', game: id });
      const seen = await onA.next<Extract<ServerMessage, { t: 'state' }>>(is('state'));
      await onB.next(is('state'));
      expect(seen.game.presence.b).toBe(true); // opponent on the other instance is seen

      onA.send({ t: 'move', game: id, uci: 'e2e4', ply: 0 });
      expect(await onB.next(is('move'), 4000)).toMatchObject({ uci: 'e2e4', ply: 1 });
      onB.send({ t: 'move', game: id, uci: 'e7e5', ply: 1 });
      expect(await onA.next((m) => m.t === 'move' && m.ply === 2, 4000)).toMatchObject({
        uci: 'e7e5',
      });
      onA.send({ t: 'resign', game: id });
      expect(await onB.next(is('ended'), 4000)).toMatchObject({ result: '0-1' });
    } finally {
      open.splice(0).forEach((x) => x.close());
      await second.close();
    }
  });
});
