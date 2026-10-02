import { z } from 'zod';
import type { ClockConfig, ClockState } from './clock';

export type OnlineColor = 'w' | 'b';
export type OnlineStatus = 'WAITING' | 'ACTIVE' | 'FINISHED';

export interface OnlinePlayer {
  id: string;
  name: string;
}

/** Full, self-contained view of an online game. Sent on subscribe/resync and by REST. */
export interface OnlineSnapshot {
  id: string;
  status: OnlineStatus;
  result: '1-0' | '0-1' | '1/2-1/2' | '*' | null;
  termination: string | null;
  /** All moves so far in UCI, from the initial position. */
  moves: string[];
  initialFen: string;
  players: { w: OnlinePlayer | null; b: OnlinePlayer | null };
  clockConfig: ClockConfig | null;
  /** Authoritative clock (timestamps in the server's epoch); `null` for untimed games. */
  clock: ClockState | null;
  /** The side that has offered a draw, if any. */
  drawOfferBy: OnlineColor | null;
  /** Increases on every change; clients use it to detect missed events. */
  version: number;
  /** Server time when this snapshot was produced (ms). Lets clients correct for clock skew. */
  serverTime: number;
  /** Which seats currently have a connected player. */
  presence: { w: boolean; b: boolean };
  isPublic: boolean;
  /** Invite code, only included for the creator while the game is waiting for an opponent. */
  code?: string;
}

export interface LobbyEntry {
  id: string;
  creator: string;
  /** The colour the joiner would play. */
  yourColor: OnlineColor;
  clockConfig: ClockConfig | null;
  createdAt: string;
}

export const MAX_WS_MESSAGE_BYTES = 4096;
const uuid = z.string().uuid();
const uci = z.string().regex(/^[a-h][1-8][a-h][1-8][qrbn]?$/);

/** Messages a client may send over the WebSocket. Anything else is rejected. */
export const clientMessageSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('auth'), token: z.string().min(10).max(2000) }),
  z.object({ t: z.literal('sub'), game: uuid }),
  z.object({ t: z.literal('unsub'), game: uuid }),
  z.object({
    t: z.literal('move'),
    game: uuid,
    uci,
    ply: z.number().int().min(0).max(2000),
    cid: z.string().max(64).optional(),
  }),
  z.object({ t: z.literal('resign'), game: uuid, cid: z.string().max(64).optional() }),
  z.object({
    t: z.literal('draw'),
    game: uuid,
    action: z.enum(['offer', 'accept', 'decline']),
    cid: z.string().max(64).optional(),
  }),
  z.object({ t: z.literal('abort'), game: uuid, cid: z.string().max(64).optional() }),
  z.object({ t: z.literal('ping') }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

export type ServerMessage =
  | { t: 'auth_ok'; userId: string; exp: number }
  | { t: 'state'; game: OnlineSnapshot }
  | {
      t: 'move';
      game: string;
      ply: number;
      uci: string;
      san: string;
      clock: ClockState | null;
      version: number;
      serverTime: number;
    }
  | { t: 'draw'; game: string; offerBy: OnlineColor | null; version: number }
  | {
      t: 'ended';
      game: string;
      result: NonNullable<OnlineSnapshot['result']>;
      termination: string;
      clock: ClockState | null;
      version: number;
      serverTime: number;
    }
  | { t: 'presence'; game: string; color: OnlineColor; online: boolean }
  | { t: 'ack'; cid?: string; game: string; ply: number; duplicate?: boolean }
  | { t: 'error'; code: OnlineErrorCode; cid?: string; game?: string }
  | { t: 'pong'; serverTime: number };

export type OnlineErrorCode =
  | 'unauthenticated'
  | 'auth_expired'
  | 'invalid_message'
  | 'rate_limited'
  | 'not_found'
  | 'not_a_player'
  | 'not_active'
  | 'not_your_turn'
  | 'illegal_move'
  | 'stale'
  | 'already_offered'
  | 'no_offer'
  | 'cannot_abort'
  | 'server_error';
