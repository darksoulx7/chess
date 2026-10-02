import type { ClientMessage, ServerMessage } from '@chess/game-types';

/** The subset of the WebSocket API used here (browser, React Native and test fakes all provide it). */
export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export type ConnectionState = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface OnlineSocketOptions {
  url: string;
  getToken: () => string | null;
  /** Obtains a fresh access token; resolves null when the session is gone. */
  refreshToken: () => Promise<string | null>;
  createSocket?: (url: string) => SocketLike;
  onMessage: (msg: ServerMessage) => void;
  onState: (state: ConnectionState) => void;
  /** Called after every (re)authentication so the owner can resubscribe. */
  onAuthenticated: () => void;
  pingIntervalMs?: number;
  pongTimeoutMs?: number;
  /** Delay before reconnect attempt `n` (0-based). */
  backoff?: (attempt: number) => number;
}

const OPEN = 1;
const CLOSE_AUTH = [4001, 4008]; // unauthenticated / auth timeout: re-authenticate on a fresh socket

export const defaultBackoff = (attempt: number): number => {
  const base = Math.min(15_000, 500 * 2 ** attempt);
  return base / 2 + Math.random() * (base / 2); // jitter so clients do not reconnect in lockstep
};

/**
 * One authenticated connection to `/ws` that stays alive: heartbeats detect half-open
 * connections, closes trigger reconnects with backoff, and `onAuthenticated` lets the owner
 * resubscribe (the server answers a subscribe with a full snapshot, so no events are lost).
 */
export class OnlineSocket {
  private ws: SocketLike | null = null;
  private attempt = 0;
  private wanted = false;
  private authed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshing = false;
  private readonly pingMs: number;
  private readonly pongMs: number;
  private readonly backoff: (n: number) => number;

  constructor(private readonly o: OnlineSocketOptions) {
    this.pingMs = o.pingIntervalMs ?? 20_000;
    this.pongMs = o.pongTimeoutMs ?? 10_000;
    this.backoff = o.backoff ?? defaultBackoff;
  }

  get isAuthenticated(): boolean {
    return this.authed && this.ws?.readyState === OPEN;
  }

  start(): void {
    this.wanted = true;
    if (!this.ws) this.connect();
  }

  stop(): void {
    this.wanted = false;
    this.clearTimers();
    const ws = this.ws;
    this.ws = null;
    this.authed = false;
    if (ws) {
      ws.onclose = ws.onmessage = ws.onopen = ws.onerror = null;
      ws.close(1000);
    }
    this.o.onState('closed');
  }

  /** Sends a command if the connection is authenticated; returns whether it was sent. */
  send(msg: ClientMessage): boolean {
    if (!this.isAuthenticated || !this.ws) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  /** App returned to the foreground or the network came back: reconnect now, or verify liveness. */
  nudge(): void {
    if (!this.wanted) return;
    if (!this.ws) {
      this.clearReconnect();
      this.connect();
    } else if (this.isAuthenticated) {
      this.ping(); // a socket that died while backgrounded is detected within the pong timeout
    }
  }

  private connect(): void {
    this.clearReconnect();
    this.o.onState(this.attempt === 0 ? 'connecting' : 'reconnecting');
    const make = this.o.createSocket ?? ((u: string) => new WebSocket(u) as unknown as SocketLike);
    let ws: SocketLike;
    try {
      ws = make(this.o.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    this.authed = false;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      const token = this.o.getToken();
      if (token) ws.send(JSON.stringify({ t: 'auth', token }));
      else void this.reauth(ws);
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws || typeof ev.data !== 'string') return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data) as ServerMessage;
      } catch {
        return;
      }
      this.handle(ws, msg);
    };
    ws.onerror = () => undefined; // close always follows; handled there
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.authed = false;
      this.clearPing();
      if (!this.wanted) return;
      if (CLOSE_AUTH.includes(ev.code)) {
        void this.refreshThenReconnect();
      } else {
        this.scheduleReconnect();
      }
    };
  }

  private handle(ws: SocketLike, msg: ServerMessage): void {
    if (msg.t === 'pong') {
      this.clearPong();
      return;
    }
    if (msg.t === 'auth_ok') {
      this.authed = true;
      this.attempt = 0;
      this.o.onState('open');
      this.startPing();
      this.o.onAuthenticated();
      return;
    }
    if (msg.t === 'error' && (msg.code === 'auth_expired' || msg.code === 'unauthenticated')) {
      void this.reauth(ws); // fresh token on the same socket, then the owner resubscribes
    }
    this.o.onMessage(msg);
  }

  /** Refreshes the token and re-sends `auth` on a live socket. */
  private async reauth(ws: SocketLike): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const token = await this.o.refreshToken();
      if (this.ws !== ws) return;
      if (!token) {
        this.stop(); // signed out: nothing to reconnect with
        return;
      }
      ws.send(JSON.stringify({ t: 'auth', token }));
    } finally {
      this.refreshing = false;
    }
  }

  private async refreshThenReconnect(): Promise<void> {
    const token = await this.o.refreshToken().catch(() => null);
    if (!this.wanted) return;
    if (!token) {
      this.stop();
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (!this.wanted || this.reconnectTimer) return;
    this.o.onState('reconnecting');
    const delay = this.backoff(this.attempt++);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.wanted && !this.ws) this.connect();
    }, delay);
  }

  private ping(): void {
    if (!this.ws || this.ws.readyState !== OPEN) return;
    this.ws.send(JSON.stringify({ t: 'ping' }));
    if (!this.pongTimer) {
      const ws = this.ws;
      this.pongTimer = setTimeout(() => {
        this.pongTimer = null;
        if (this.ws === ws) ws.close(4000); // no pong: treat the connection as dead and reconnect
      }, this.pongMs);
    }
  }

  private startPing(): void {
    this.clearPing();
    this.pingTimer = setInterval(() => this.ping(), this.pingMs);
  }

  private clearPong(): void {
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.pongTimer = null;
  }
  private clearPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.clearPong();
  }
  private clearReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
  private clearTimers(): void {
    this.clearPing();
    this.clearReconnect();
  }
}

/** `http(s)://host` → `ws(s)://host/ws`. */
export function wsUrlFor(apiUrl: string): string {
  return `${apiUrl.replace(/^http/, 'ws')}/ws`;
}
