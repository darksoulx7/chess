import type { ServerMessage } from '@chess/game-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OnlineSocket, wsUrlFor, type ConnectionState, type SocketLike } from './online-socket';

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: Array<Record<string, unknown>> = [];
  closed: number | undefined;
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;
  send(d: string) {
    this.sent.push(JSON.parse(d));
  }
  close(code?: number) {
    this.closed = code;
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(m: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

let sockets: FakeSocket[];
let token: string | null;
let refreshed: number;
let states: ConnectionState[];
let messages: ServerMessage[];
let authed: number;

function make(extra: Partial<ConstructorParameters<typeof OnlineSocket>[0]> = {}) {
  return new OnlineSocket({
    url: 'ws://x/ws',
    getToken: () => token,
    refreshToken: async () => {
      refreshed++;
      token = 'fresh-token-123';
      return token;
    },
    createSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    onMessage: (m) => messages.push(m),
    onState: (s) => states.push(s),
    onAuthenticated: () => authed++,
    pingIntervalMs: 1000,
    pongTimeoutMs: 500,
    backoff: (n) => 100 * 2 ** n,
    ...extra,
  });
}
const ok: ServerMessage = { t: 'auth_ok', userId: 'u', exp: 1 };

beforeEach(() => {
  vi.useFakeTimers();
  sockets = [];
  token = 'token-abcdefghij';
  refreshed = 0;
  states = [];
  messages = [];
  authed = 0;
});
afterEach(() => vi.useRealTimers());

describe('OnlineSocket', () => {
  it('authenticates first, reports open and signals authentication', () => {
    const s = make();
    s.start();
    sockets[0]!.open();
    expect(sockets[0]!.sent[0]).toEqual({ t: 'auth', token: 'token-abcdefghij' });
    expect(s.send({ t: 'ping' })).toBe(false); // not usable before auth_ok
    sockets[0]!.receive(ok);
    expect(states).toEqual(['connecting', 'open']);
    expect(authed).toBe(1);
    expect(s.send({ t: 'sub', game: 'g' })).toBe(true);
  });

  it('reconnects with backoff after a drop and re-authenticates', () => {
    const s = make();
    s.start();
    sockets[0]!.open();
    sockets[0]!.receive(ok);
    sockets[0]!.drop();
    expect(states.at(-1)).toBe('reconnecting');
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(100);
    expect(sockets).toHaveLength(2);
    sockets[1]!.drop(); // second failure waits longer
    vi.advanceTimersByTime(150);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(60);
    expect(sockets).toHaveLength(3);
    sockets[2]!.open();
    sockets[2]!.receive(ok);
    expect(authed).toBe(2);
    expect(states.at(-1)).toBe('open');
  });

  it('does not reconnect after stop()', () => {
    const s = make();
    s.start();
    sockets[0]!.open();
    s.stop();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
    expect(states.at(-1)).toBe('closed');
  });

  it('closes and reconnects when a heartbeat gets no pong', () => {
    const s = make();
    s.start();
    sockets[0]!.open();
    sockets[0]!.receive(ok);
    vi.advanceTimersByTime(1000);
    expect(sockets[0]!.sent.at(-1)).toEqual({ t: 'ping' });
    vi.advanceTimersByTime(500);
    expect(sockets[0]!.closed).toBe(4000);
    sockets[0]!.drop(4000);
    vi.advanceTimersByTime(100);
    expect(sockets).toHaveLength(2);
  });

  it('a pong keeps the connection', () => {
    const s = make();
    s.start();
    sockets[0]!.open();
    sockets[0]!.receive(ok);
    vi.advanceTimersByTime(1000);
    sockets[0]!.receive({ t: 'pong', serverTime: 1 });
    vi.advanceTimersByTime(900); // before the next heartbeat
    expect(sockets[0]!.closed).toBeUndefined();
  });

  it('refreshes the token on auth_expired and re-sends auth on the same socket', async () => {
    const s = make();
    s.start();
    sockets[0]!.open();
    sockets[0]!.receive(ok);
    sockets[0]!.receive({ t: 'error', code: 'auth_expired' });
    await vi.advanceTimersByTimeAsync(0);
    expect(refreshed).toBe(1);
    expect(sockets[0]!.sent.at(-1)).toEqual({ t: 'auth', token: 'fresh-token-123' });
    expect(messages.at(-1)).toMatchObject({ code: 'auth_expired' });
  });

  it('refreshes the token and reconnects after an auth close code', async () => {
    const s = make();
    s.start();
    sockets[0]!.open();
    sockets[0]!.drop(4001);
    await vi.advanceTimersByTimeAsync(0);
    expect(refreshed).toBe(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(sockets).toHaveLength(2);
  });

  it('gives up when the session is gone', async () => {
    const s = make({ refreshToken: async () => null });
    s.start();
    sockets[0]!.open();
    sockets[0]!.drop(4001);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sockets).toHaveLength(1);
    expect(states.at(-1)).toBe('closed');
  });

  it('nudge() pings a live socket and reconnects immediately when there is none', () => {
    const s = make();
    s.start();
    sockets[0]!.open();
    sockets[0]!.receive(ok);
    s.nudge();
    expect(sockets[0]!.sent.at(-1)).toEqual({ t: 'ping' });
    sockets[0]!.drop();
    s.nudge(); // does not wait for the backoff timer
    expect(sockets).toHaveLength(2);
  });

  it('ignores malformed frames and events from a replaced socket', () => {
    const s = make();
    s.start();
    sockets[0]!.open();
    sockets[0]!.onmessage?.({ data: '{not json' });
    sockets[0]!.onmessage?.({ data: new ArrayBuffer(1) });
    expect(messages).toEqual([]);
    s.stop();
    sockets[0]!.receive(ok);
    expect(authed).toBe(0);
  });
});

describe('wsUrlFor', () => {
  it('maps http(s) to ws(s)', () => {
    expect(wsUrlFor('http://localhost:4100')).toBe('ws://localhost:4100/ws');
    expect(wsUrlFor('https://api.example.com')).toBe('wss://api.example.com/ws');
  });
});
