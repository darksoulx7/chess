import { ChessGame, START_FEN } from '@chess/chess-core';
import { remaining } from '@chess/game-types';
import { describe, expect, it } from 'vitest';
import {
  FIRST_MOVE_WINDOW_MS,
  UNTIMED_IDLE_MS,
  applyCommand,
  applyTimeout,
  colorOf,
  deadlineOf,
  replay,
  startGame,
  type Command,
  type DomainGame,
  type Outcome,
} from '../src/modules/online/domain.js';

const A = 'user-a'; // white
const B = 'user-b'; // black
const T0 = 1_000_000;

const waiting = (clock: { initialMs: number; incrementMs: number } | null = null): DomainGame => ({
  id: 'g1',
  status: 'WAITING',
  initialFen: START_FEN,
  moves: [],
  players: { w: A, b: B },
  clockConfig: clock,
  clock: null,
  drawOfferBy: null,
  result: null,
  termination: null,
  version: 0,
  lastActivityAt: T0,
});
const active = (clock: { initialMs: number; incrementMs: number } | null = null) =>
  startGame(waiting(clock), T0);

/** Applies commands in order and returns the last successful game; throws on the first failure. */
function play(game: DomainGame, steps: Array<[string, Command, number?]>): DomainGame {
  let g = game;
  let t = T0;
  for (const [user, cmd, at] of steps) {
    t = at ?? t + 1000;
    const r = applyCommand(g, user, cmd, t);
    if (!r.ok) throw new Error(`step failed: ${JSON.stringify(cmd)} -> ${r.error}`);
    g = r.game;
  }
  return g;
}
const mv = (uci: string, ply: number): Command => ({ type: 'move', uci, expectedPly: ply });
const ok = (r: Outcome) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
  return r;
};
const err = (r: Outcome) => (r.ok ? 'ok' : r.error);

/** UCI list for a SAN game. */
const uciOf = (...sans: string[]) => {
  const g = ChessGame.create();
  for (const s of sans) g.makeMoveSan(s);
  return g.getHistory().map((m) => m.lan);
};

describe('setup', () => {
  it('maps users to seats and starts with a stopped clock', () => {
    expect(colorOf(waiting(), A)).toBe('w');
    expect(colorOf(waiting(), B)).toBe('b');
    expect(colorOf(waiting(), 'x')).toBeNull();
    const g = active({ initialMs: 60_000, incrementMs: 0 });
    expect(g.status).toBe('ACTIVE');
    expect(g.clock?.running).toBeNull();
    expect(g.clock?.whiteMs).toBe(60_000);
    expect(g.version).toBe(1);
    expect(active().clock).toBeNull();
  });

  it('replays stored moves and detects corrupt data', () => {
    const g = play(active(), [
      [A, mv('e2e4', 0)],
      [B, mv('e7e5', 1)],
    ]);
    expect(
      replay(g)
        ?.getHistory()
        .map((m) => m.san),
    ).toEqual(['e4', 'e5']);
    expect(replay({ ...g, moves: ['e2e5'] })).toBeNull();
  });
});

describe('moves', () => {
  it("accepts a legal move on the mover's turn and reports it", () => {
    const r = ok(applyCommand(active(), A, mv('e2e4', 0), T0 + 500));
    expect(r.game.moves).toEqual(['e2e4']);
    expect(r.game.version).toBe(2);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ type: 'move', ply: 1, record: { san: 'e4', lan: 'e2e4' } });
    expect(r.game.lastActivityAt).toBe(T0 + 500);
  });

  it('does not mutate its input', () => {
    const g = active({ initialMs: 60_000, incrementMs: 0 });
    const copy = JSON.stringify(g);
    applyCommand(g, A, mv('e2e4', 0), T0 + 1);
    expect(JSON.stringify(g)).toBe(copy);
  });

  it.each([
    ['a stranger', 'x', mv('e2e4', 0), 'not_a_player'],
    ['the wrong side', B, mv('e7e5', 0), 'not_your_turn'],
    ['an illegal move', A, mv('e2e5', 0), 'illegal_move'],
    ['a promotion without a piece', A, mv('a7a8', 0), 'illegal_move'],
    ['a stale ply', A, mv('e2e4', 3), 'stale'],
  ])('rejects %s', (_n, user, cmd, error) => {
    expect(err(applyCommand(active(), user, cmd, T0 + 1))).toBe(error);
  });

  it('rejects commands on games that are not active', () => {
    expect(err(applyCommand(waiting(), A, mv('e2e4', 0), T0))).toBe('not_active');
    const done = play(active(), [[A, { type: 'resign' }]]);
    expect(err(applyCommand(done, B, mv('e7e5', 0), T0 + 9))).toBe('not_active');
  });

  it('acknowledges a re-sent move without changing anything (idempotent)', () => {
    const g = play(active(), [[A, mv('e2e4', 0)]]);
    const r = ok(applyCommand(g, A, mv('e2e4', 0), T0 + 5000));
    expect(r.duplicate).toBe(true);
    expect(r.events).toEqual([]);
    expect(r.game).toBe(g);
  });

  it("does not treat a different move, or the opponent's identical move, as a duplicate", () => {
    const g = play(active(), [[A, mv('e2e4', 0)]]);
    expect(err(applyCommand(g, A, mv('d2d4', 0), T0 + 5000))).toBe('stale'); // A tries a different move for ply 0
    expect(err(applyCommand(g, B, mv('e2e4', 0), T0 + 5000))).toBe('stale'); // B cannot "duplicate" A's move
  });

  it('ends the game on checkmate with the right winner', () => {
    const g = play(active(), [
      [A, mv('f2f3', 0)],
      [B, mv('e7e5', 1)],
      [A, mv('g2g4', 2)],
    ]);
    const r = ok(applyCommand(g, B, mv('d8h4', 3), T0 + 9000));
    expect(r.game).toMatchObject({ status: 'FINISHED', result: '0-1', termination: 'checkmate' });
    expect(r.events.map((e) => e.type)).toEqual(['move', 'ended']);
  });

  it('ends the game on stalemate and on repetition', () => {
    const stalemate = uciOf(
      'e3',
      'a5',
      'Qh5',
      'Ra6',
      'Qxa5',
      'h5',
      'h4',
      'Rah6',
      'Qxc7',
      'f6',
      'Qxd7+',
      'Kf7',
      'Qxb7',
      'Qd3',
      'Qxb8',
      'Qh7',
      'Qxc8',
      'Kg6',
      'Qe6',
    );
    let g = active();
    stalemate.forEach((u, i) => {
      const r = applyCommand(g, i % 2 === 0 ? A : B, mv(u, i), T0 + 1000 * (i + 1));
      g = ok(r).game;
    });
    expect(g).toMatchObject({ status: 'FINISHED', result: '1/2-1/2', termination: 'stalemate' });

    const rep = uciOf('Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8');
    let h = active();
    rep.forEach(
      (u, i) => (h = ok(applyCommand(h, i % 2 === 0 ? A : B, mv(u, i), T0 + 1000 * (i + 1))).game),
    );
    expect(h).toMatchObject({
      status: 'FINISHED',
      result: '1/2-1/2',
      termination: 'threefold-repetition',
    });
  });
});

describe('clocks', () => {
  const cfg = { initialMs: 60_000, incrementMs: 2_000 };

  it('starts the opponent clock on the first move without charging anyone, then charges and increments', () => {
    let g = ok(applyCommand(active(cfg), A, mv('e2e4', 0), T0 + 1000)).game;
    expect(g.clock?.running).toBe('b');
    expect(g.clock?.whiteMs).toBe(60_000);
    g = ok(applyCommand(g, B, mv('e7e5', 1), T0 + 6000)).game; // black thought for 5 s, +2 s increment
    expect(g.clock?.blackMs).toBe(57_000);
    expect(g.clock?.running).toBe('w');
  });

  it("a move arriving after the mover's flag fell loses on time and is not played", () => {
    const g = ok(
      applyCommand(active({ initialMs: 10_000, incrementMs: 0 }), A, mv('e2e4', 0), T0),
    ).game;
    const r = ok(applyCommand(g, B, mv('e7e5', 1), T0 + 11_000));
    expect(r.game.moves).toEqual(['e2e4']);
    expect(r.game).toMatchObject({ status: 'FINISHED', result: '1-0', termination: 'timeout' });
    expect(r.events.map((e) => e.type)).toEqual(['ended']);
  });

  it('stops the clock when the game ends', () => {
    const g = play(active(cfg), [
      [A, mv('e2e4', 0)],
      [B, { type: 'resign' }],
    ]);
    expect(g.clock?.running).toBeNull();
    expect(remaining(g.clock!, 'b', T0 + 999_999)).toBe(g.clock!.blackMs);
  });
});

describe('deadlines and the sweeper', () => {
  it('uses the first-move window before both sides have moved', () => {
    const g = active();
    expect(deadlineOf(g)).toBe(T0 + FIRST_MOVE_WINDOW_MS);
    const one = play(g, [[A, mv('e2e4', 0)]]);
    expect(deadlineOf(one)).toBe(one.lastActivityAt + FIRST_MOVE_WINDOW_MS);
  });

  it('uses the running clock after that, and an idle limit for untimed games', () => {
    const timed = play(active({ initialMs: 30_000, incrementMs: 0 }), [
      [A, mv('e2e4', 0), T0 + 1000],
      [B, mv('e7e5', 1), T0 + 3000],
    ]);
    expect(timed.clock?.running).toBe('w');
    expect(deadlineOf(timed)).toBe(T0 + 3000 + 30_000 - 0); // white has all 30 s from the moment its clock started
    const untimed = play(active(), [
      [A, mv('e2e4', 0), T0 + 1000],
      [B, mv('e7e5', 1), T0 + 3000],
    ]);
    expect(deadlineOf(untimed)).toBe(T0 + 3000 + UNTIMED_IDLE_MS);
    expect(deadlineOf(waiting())).toBeNull();
  });

  it('times out the side whose clock ran out, only after the deadline', () => {
    const g = play(active({ initialMs: 30_000, incrementMs: 0 }), [
      [A, mv('e2e4', 0), T0 + 1000],
      [B, mv('e7e5', 1), T0 + 3000],
    ]);
    const deadline = deadlineOf(g)!;
    expect(err(applyTimeout(g, deadline - 1))).toBe('not_active');
    const r = ok(applyTimeout(g, deadline));
    expect(r.game).toMatchObject({ status: 'FINISHED', result: '0-1', termination: 'timeout' }); // white to move and out of time
  });

  it('abandons a game where one side never moved, without a result', () => {
    const g = active({ initialMs: 60_000, incrementMs: 0 });
    expect(err(applyTimeout(g, T0 + FIRST_MOVE_WINDOW_MS - 1))).toBe('not_active');
    const r = ok(applyTimeout(g, T0 + FIRST_MOVE_WINDOW_MS));
    expect(r.game).toMatchObject({ status: 'FINISHED', result: '*', termination: 'abandoned' });
    const half = play(g, [[A, mv('e2e4', 0), T0 + 1000]]);
    expect(ok(applyTimeout(half, half.lastActivityAt + FIRST_MOVE_WINDOW_MS)).game.result).toBe(
      '*',
    );
  });

  it('abandons an idle untimed game', () => {
    const g = play(active(), [
      [A, mv('e2e4', 0), T0 + 1000],
      [B, mv('e7e5', 1), T0 + 2000],
    ]);
    expect(ok(applyTimeout(g, g.lastActivityAt + UNTIMED_IDLE_MS)).game).toMatchObject({
      result: '*',
      termination: 'abandoned',
    });
  });

  it('ignores finished games', () => {
    const done = play(active(), [[A, { type: 'resign' }]]);
    expect(err(applyTimeout(done, T0 + 10 ** 9))).toBe('not_active');
  });
});

describe('resign, abort and draws', () => {
  it('resigning gives the win to the opponent, from either side', () => {
    expect(play(active(), [[A, { type: 'resign' }]])).toMatchObject({
      result: '0-1',
      termination: 'resignation',
      status: 'FINISHED',
    });
    expect(play(active(), [[B, { type: 'resign' }]])).toMatchObject({
      result: '1-0',
      termination: 'resignation',
    });
    expect(err(applyCommand(active(), 'x', { type: 'resign' }, T0))).toBe('not_a_player');
  });

  it('aborts only before both players have moved', () => {
    expect(play(active(), [[A, { type: 'abort' }]])).toMatchObject({
      result: '*',
      termination: 'abandoned',
    });
    const g = play(active(), [[A, mv('e2e4', 0)]]);
    expect(play(g, [[B, { type: 'abort' }]]).result).toBe('*');
    const two = play(active(), [
      [A, mv('e2e4', 0)],
      [B, mv('e7e5', 1)],
    ]);
    expect(err(applyCommand(two, A, { type: 'abort' }, T0 + 9999))).toBe('cannot_abort');
  });

  it('draw offers: offer, accept, decline, and the guard rails', () => {
    const offered = ok(applyCommand(active(), A, { type: 'draw', action: 'offer' }, T0 + 1)).game;
    expect(offered.drawOfferBy).toBe('w');
    expect(err(applyCommand(offered, A, { type: 'draw', action: 'offer' }, T0 + 2))).toBe(
      'already_offered',
    );
    expect(err(applyCommand(offered, A, { type: 'draw', action: 'accept' }, T0 + 2))).toBe(
      'no_offer',
    ); // cannot accept your own
    expect(err(applyCommand(active(), B, { type: 'draw', action: 'accept' }, T0 + 2))).toBe(
      'no_offer',
    );

    const accepted = ok(applyCommand(offered, B, { type: 'draw', action: 'accept' }, T0 + 3));
    expect(accepted.game).toMatchObject({
      status: 'FINISHED',
      result: '1/2-1/2',
      termination: 'agreement',
      drawOfferBy: null,
    });

    const declined = ok(applyCommand(offered, B, { type: 'draw', action: 'decline' }, T0 + 3));
    expect(declined.game.drawOfferBy).toBeNull();
    expect(declined.game.status).toBe('ACTIVE');
    expect(declined.events).toEqual([{ type: 'draw', offerBy: null }]);
  });

  it('a mutual offer is an agreement; any move declines a pending offer', () => {
    const offered = ok(applyCommand(active(), A, { type: 'draw', action: 'offer' }, T0 + 1)).game;
    expect(
      ok(applyCommand(offered, B, { type: 'draw', action: 'offer' }, T0 + 2)).game.result,
    ).toBe('1/2-1/2');

    const r = ok(applyCommand(offered, A, mv('e2e4', 0), T0 + 2));
    expect(r.game.drawOfferBy).toBeNull();
    expect(r.events.map((e) => e.type)).toEqual(['move', 'draw']);
  });
});

describe('versioning', () => {
  it('increases the version on every state change', () => {
    let g = active();
    const versions = [g.version];
    for (const [u, c] of [
      [A, mv('e2e4', 0)],
      [B, { type: 'draw', action: 'offer' } as Command],
      [A, { type: 'draw', action: 'decline' } as Command],
      [A, { type: 'resign' } as Command],
    ] as const) {
      g = ok(applyCommand(g, u, c as Command, T0 + 1000 * (versions.length + 1))).game;
      versions.push(g.version);
    }
    expect([...versions].sort((a, b) => a - b)).toEqual(versions);
    expect(new Set(versions).size).toBe(versions.length);
  });
});
