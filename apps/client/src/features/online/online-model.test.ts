import type { OnlineSnapshot, ServerMessage } from '@chess/game-types';
import { describe, expect, it } from 'vitest';
import {
  applyLocalMove,
  buildGame,
  describeEnd,
  fromSnapshot,
  myColor,
  reduceServer,
} from './online-model';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const snap = (over: Partial<OnlineSnapshot> = {}): OnlineSnapshot => ({
  id: 'g1',
  status: 'ACTIVE',
  result: '*',
  termination: null,
  moves: [],
  initialFen: START,
  players: { w: { id: 'u1', name: 'ann' }, b: { id: 'u2', name: 'bob' } },
  clockConfig: null,
  clock: null,
  drawOfferBy: null,
  version: 1,
  serverTime: 10_000,
  presence: { w: true, b: true },
  isPublic: false,
  ...over,
});
const move = (ply: number, uci: string, version = ply + 1): ServerMessage => ({
  t: 'move',
  game: 'g1',
  ply,
  uci,
  san: uci,
  clock: null,
  version,
  serverTime: 10_500,
});
type MoveMsg = Extract<ServerMessage, { t: 'move' }>;
const start = () => fromSnapshot(snap(), 9_000);

describe('reduceServer', () => {
  it('derives the server clock offset from the snapshot', () => {
    expect(start().offset).toBe(1_000);
  });

  it('appends an in-order move and ignores one for another game', () => {
    const { state } = reduceServer(start(), move(1, 'e2e4'), 9_500);
    expect(state.moves).toEqual(['e2e4']);
    expect(state.offset).toBe(1_000);
    expect(reduceServer(state, { ...(move(2, 'e7e5') as MoveMsg), game: 'other' }, 0).state).toBe(
      state,
    );
  });

  it('ignores a duplicate move and requests a resync when a move was missed', () => {
    const one = reduceServer(start(), move(1, 'e2e4'), 0).state;
    expect(reduceServer(one, move(1, 'e2e4'), 0).state.moves).toEqual(['e2e4']);
    const gap = reduceServer(one, move(3, 'g1f3'), 0);
    expect(gap.effect).toBe('resync');
    expect(gap.state.moves).toEqual(['e2e4']);
  });

  it('confirms an optimistic move when the server echoes it', () => {
    const optimistic = applyLocalMove(start(), 'e2e4', 'c1');
    expect(optimistic.pending).toEqual({ ply: 0, uci: 'e2e4', cid: 'c1' });
    const { state } = reduceServer(optimistic, move(1, 'e2e4'), 0);
    expect(state.moves).toEqual(['e2e4']);
    expect(state.pending).toBeNull();
  });

  it('replaces an optimistic move that lost the race with the server move', () => {
    const optimistic = applyLocalMove(start(), 'e2e4', 'c1');
    const { state } = reduceServer(optimistic, move(1, 'd2d4'), 0);
    expect(state.moves).toEqual(['d2d4']);
    expect(state.pending).toBeNull();
  });

  it('rolls back a rejected optimistic move and resyncs on stale', () => {
    const optimistic = applyLocalMove(start(), 'e2e4', 'c1');
    const illegal = reduceServer(
      optimistic,
      { t: 'error', code: 'illegal_move', cid: 'c1', game: 'g1' },
      0,
    );
    expect(illegal.state.moves).toEqual([]);
    expect(illegal.state.pending).toBeNull();
    expect(illegal.state.error).toBe('illegal_move');
    const stale = reduceServer(optimistic, { t: 'error', code: 'stale', game: 'g1' }, 0);
    expect(stale.effect).toBe('resync');
    expect(stale.state.moves).toEqual([]);
  });

  it('an ack clears only the matching pending move', () => {
    const optimistic = applyLocalMove(start(), 'e2e4', 'c1');
    expect(
      reduceServer(optimistic, { t: 'ack', game: 'g1', ply: 1, cid: 'zz' }, 0).state.pending,
    ).not.toBeNull();
    expect(
      reduceServer(optimistic, { t: 'ack', game: 'g1', ply: 1, cid: 'c1' }, 0).state.pending,
    ).toBeNull();
  });

  it('a snapshot replaces local state but keeps an optimistic move the server has not seen', () => {
    const optimistic = applyLocalMove(start(), 'e2e4', 'c1');
    const fresh = reduceServer(optimistic, { t: 'state', game: snap({ version: 3 }) }, 0).state;
    expect(fresh.moves).toEqual(['e2e4']);
    expect(fresh.pending?.cid).toBe('c1');
    // …but drops it when the snapshot already contains that move
    const seen = reduceServer(
      optimistic,
      { t: 'state', game: snap({ version: 3, moves: ['e2e4'] }) },
      0,
    ).state;
    expect(seen.moves).toEqual(['e2e4']);
    expect(seen.pending).toBeNull();
  });

  it('ignores a snapshot older than the current state', () => {
    const cur = reduceServer(start(), move(1, 'e2e4', 5), 0).state;
    expect(reduceServer(cur, { t: 'state', game: snap({ version: 2 }) }, 0).state).toBe(cur);
  });

  it('tracks draw offers (cleared by the next move), presence and the end of the game', () => {
    let s = reduceServer(start(), { t: 'draw', game: 'g1', offerBy: 'b', version: 2 }, 0).state;
    expect(s.drawOfferBy).toBe('b');
    s = reduceServer(s, { t: 'presence', game: 'g1', color: 'b', online: false }, 0).state;
    expect(s.presence).toEqual({ w: true, b: false });
    s = reduceServer(s, move(1, 'e2e4'), 0).state;
    expect(s.drawOfferBy).toBeNull();
    s = reduceServer(
      s,
      {
        t: 'ended',
        game: 'g1',
        result: '1-0',
        termination: 'resignation',
        clock: null,
        version: 9,
        serverTime: 1,
      },
      0,
    ).state;
    expect(s).toMatchObject({ status: 'FINISHED', result: '1-0', termination: 'resignation' });
  });

  it('asks for a token refresh when auth expired', () => {
    expect(reduceServer(start(), { t: 'error', code: 'auth_expired' }, 0).effect).toBe(
      'refresh-auth',
    );
  });
});

describe('helpers', () => {
  it('replays moves into a game and rejects corrupt move lists', () => {
    expect(buildGame({ initialFen: START, moves: ['e2e4', 'e7e5'] })?.getFen()).toContain(
      'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w',
    );
    expect(buildGame({ initialFen: START, moves: ['e2e5'] })).toBeNull();
  });

  it('finds the viewer’s colour', () => {
    const s = start();
    expect(myColor(s, 'u1')).toBe('w');
    expect(myColor(s, 'u2')).toBe('b');
    expect(myColor(s, 'x')).toBeNull();
    expect(myColor(s, null)).toBeNull();
  });

  it('describes how a game ended', () => {
    expect(describeEnd('1-0', 'resignation')).toEqual({
      title: 'White wins',
      detail: 'Black resigned',
    });
    expect(describeEnd('0-1', 'timeout')).toEqual({
      title: 'Black wins',
      detail: 'White ran out of time',
    });
    expect(describeEnd('1/2-1/2', 'agreement').detail).toBe('Draw by agreement');
    expect(describeEnd('*', 'abandoned').title).toBe('Game aborted');
  });
});
