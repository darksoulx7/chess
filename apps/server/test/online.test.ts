import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createHarness, register, type Harness } from './auth-helper.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

type Snap = {
  id: string;
  status: string;
  code?: string;
  players: { w: { name: string } | null; b: { name: string } | null };
  moves: string[];
  clock: unknown;
  isPublic: boolean;
};
const call = (method: 'GET' | 'POST' | 'DELETE', url: string, token?: string, payload?: unknown) =>
  h.app.inject({
    method,
    url,
    headers: token ? bearer(token) : {},
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
const create = async (token: string, body: Record<string, unknown> = {}) =>
  (await call('POST', '/api/online/games', token, body)).json() as { game: Snap };

describe('creating and joining', () => {
  it('requires authentication', async () => {
    for (const [m, u] of [
      ['POST', '/api/online/games'],
      ['POST', '/api/online/games/join'],
      ['GET', '/api/online/lobby'],
      ['GET', '/api/online/active'],
    ] as const) {
      expect((await call(m, u)).statusCode, u).toBe(401);
    }
  });

  it('creates a waiting game with an invite code visible only to its creator', async () => {
    const a = await register(h.app);
    const b = await register(h.app);
    const res = await call('POST', '/api/online/games', a.accessToken, {
      color: 'w',
      clock: { baseMs: 180_000, incrementMs: 2000 },
    });
    expect(res.statusCode).toBe(201);
    const { game } = res.json() as { game: Snap };
    expect(game).toMatchObject({ status: 'WAITING', isPublic: false });
    expect(game.code).toMatch(/^[A-HJ-KM-NP-Z2-9]{8}$/);
    expect(game.players.w?.name).toBe(a.creds.username);
    expect(game.players.b).toBeNull();
    expect(game.clock).toBeNull(); // the clock only exists once the game starts
    // another user cannot read a waiting game they are not part of, and never sees its code
    expect((await call('GET', `/api/online/games/${game.id}`, b.accessToken)).statusCode).toBe(404);
    expect(
      ((await call('GET', `/api/online/games/${game.id}`, a.accessToken)).json() as { game: Snap })
        .game.code,
    ).toBe(game.code);
  });

  it.each([
    ['clock too short', { clock: { baseMs: 1000, incrementMs: 0 } }],
    ['clock too long', { clock: { baseMs: 99_999_999, incrementMs: 0 } }],
    ['negative increment', { clock: { baseMs: 60_000, incrementMs: -1 } }],
    ['bad colour', { color: 'green' }],
    ['non-boolean public', { public: 'yes' }],
  ])('400 for %s', async (_n, body) => {
    const a = await register(h.app);
    expect((await call('POST', '/api/online/games', a.accessToken, body)).statusCode).toBe(400);
  });

  it('assigns a random colour when asked and honours an explicit one', async () => {
    const a = await register(h.app);
    const seats = new Set<string>();
    for (let i = 0; i < 24; i++) {
      const { game } = await create(a.accessToken, { color: 'random' });
      seats.add(game.players.w ? 'w' : 'b');
    }
    expect(seats).toEqual(new Set(['w', 'b']));
    expect((await create(a.accessToken, { color: 'b' })).game.players.b).not.toBeNull();
  });

  it('joins by code (case/whitespace-insensitive), starts the game, and burns the code', async () => {
    const a = await register(h.app);
    const b = await register(h.app);
    const { game } = await create(a.accessToken, {
      color: 'w',
      clock: { baseMs: 60_000, incrementMs: 0 },
    });
    const res = await call('POST', '/api/online/games/join', b.accessToken, {
      code: `  ${game.code!.toLowerCase()} `,
    });
    expect(res.statusCode).toBe(200);
    const joined = (res.json() as { game: Snap }).game;
    expect(joined).toMatchObject({ id: game.id, status: 'ACTIVE' });
    expect(joined.players.b?.name).toBe(b.creds.username);
    expect(joined.clock).toMatchObject({ whiteMs: 60_000, blackMs: 60_000, running: null });
    const row = (
      await h.t.db.query('select invite_code, status, turn_deadline from games where id = $1', [
        game.id,
      ])
    ).rows[0];
    expect(row.invite_code).toBeNull();
    expect(row.turn_deadline).not.toBeNull();
    expect(
      (
        await call('POST', '/api/online/games/join', (await register(h.app)).accessToken, {
          code: game.code,
        })
      ).statusCode,
    ).toBe(404); // burned
  });

  it('rejects joining your own game, an unknown code, and a game that already started', async () => {
    const a = await register(h.app);
    const b = await register(h.app);
    const c = await register(h.app);
    const { game } = await create(a.accessToken);
    expect(
      (
        (
          await call('POST', '/api/online/games/join', a.accessToken, { code: game.code })
        ).json() as { error: string }
      ).error,
    ).toBe('own_game');
    expect(
      (await call('POST', '/api/online/games/join', b.accessToken, { code: 'ZZZZZZZZ' }))
        .statusCode,
    ).toBe(404);
    expect(
      (await call('POST', '/api/online/games/join', b.accessToken, { code: '12' })).statusCode,
    ).toBe(400);
    await call('POST', '/api/online/games/join', b.accessToken, { code: game.code });
    const lateById = await call('POST', `/api/online/games/${game.id}/join`, c.accessToken);
    expect(lateById.statusCode).toBe(409);
    expect(lateById.json()).toEqual({ error: 'not_open' });
    expect(
      (await call('POST', '/api/online/games/not-a-uuid/join', c.accessToken)).statusCode,
    ).toBe(404);
  });

  it('two simultaneous joiners: exactly one gets the seat', async () => {
    const a = await register(h.app);
    const b = await register(h.app);
    const c = await register(h.app);
    const d = await register(h.app);
    const e = await register(h.app);
    // By code: the winner burns the code, so the loser's lookup no longer finds the game (404).
    const byCode = (await create(a.accessToken)).game;
    const codeRace = await Promise.all([
      call('POST', '/api/online/games/join', b.accessToken, { code: byCode.code }),
      call('POST', '/api/online/games/join', c.accessToken, { code: byCode.code }),
    ]);
    expect(codeRace.map((r) => r.statusCode).sort()).toEqual([200, 404]);
    // By id (lobby): the loser finds the row but it is no longer open (409).
    const byId = (await create(a.accessToken, { public: true })).game;
    const idRace = await Promise.all([
      call('POST', `/api/online/games/${byId.id}/join`, d.accessToken),
      call('POST', `/api/online/games/${byId.id}/join`, e.accessToken),
    ]);
    expect(idRace.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    for (const id of [byCode.id, byId.id]) {
      expect(
        (await h.t.db.query('select count(*)::int as n from game_players where game_id = $1', [id]))
          .rows[0].n,
      ).toBe(2);
    }
  });
});

describe('lobby and resuming', () => {
  it('lists open public games for others, hides private and own games, and removes them once taken or cancelled', async () => {
    const a = await register(h.app);
    const b = await register(h.app);
    const pub = (
      await create(a.accessToken, {
        public: true,
        color: 'w',
        clock: { baseMs: 300_000, incrementMs: 0 },
      })
    ).game;
    const priv = (await create(a.accessToken, { public: false })).game;
    const lobby = async (token: string) =>
      (
        (await call('GET', '/api/online/lobby', token)).json() as {
          items: Array<{ id: string; creator: string; yourColor: string }>;
        }
      ).items;

    const forB = await lobby(b.accessToken);
    expect(forB.map((g) => g.id)).toContain(pub.id);
    expect(forB.map((g) => g.id)).not.toContain(priv.id);
    expect(forB.find((g) => g.id === pub.id)).toMatchObject({
      creator: a.creds.username,
      yourColor: 'b',
    });
    expect((await lobby(a.accessToken)).map((g) => g.id)).not.toContain(pub.id); // not your own

    expect((await call('POST', `/api/online/games/${pub.id}/join`, b.accessToken)).statusCode).toBe(
      200,
    );
    expect((await lobby(b.accessToken)).map((g) => g.id)).not.toContain(pub.id);

    const second = (await create(a.accessToken, { public: true })).game;
    expect((await call('DELETE', `/api/online/games/${second.id}`, b.accessToken)).statusCode).toBe(
      404,
    ); // only the creator
    expect((await call('DELETE', `/api/online/games/${second.id}`, a.accessToken)).statusCode).toBe(
      204,
    );
    expect((await lobby(b.accessToken)).map((g) => g.id)).not.toContain(second.id);
    expect((await call('DELETE', `/api/online/games/${pub.id}`, a.accessToken)).statusCode).toBe(
      404,
    ); // already started
  });

  it('lists my waiting and active games so a refreshed client can resume', async () => {
    const a = await register(h.app);
    const b = await register(h.app);
    const w = (await create(a.accessToken)).game;
    const s = (await create(a.accessToken)).game;
    await call('POST', '/api/online/games/join', b.accessToken, { code: s.code });
    const mine = (
      (await call('GET', '/api/online/active', a.accessToken)).json() as { items: Snap[] }
    ).items;
    expect(mine.map((g) => g.id).sort()).toEqual([w.id, s.id].sort());
    expect(mine.find((g) => g.id === w.id)?.code).toBeTruthy(); // creator still sees the code of a waiting game
    expect(
      (
        (await call('GET', '/api/online/active', b.accessToken)).json() as { items: Snap[] }
      ).items.map((g) => g.id),
    ).toEqual([s.id]);
  });
});

describe('commands, persistence and history', () => {
  async function startGame(clock: { initialMs: number; incrementMs: number } | null = null) {
    const a = await register(h.app);
    const b = await register(h.app);
    const g = await h.app.online.create(a.user.id, a.creds.username, {
      color: 'w',
      clockConfig: clock,
      isPublic: false,
    });
    const joined = await h.app.online.join(b.user.id, b.creds.username, { gameId: g.id });
    if (!joined.ok) throw new Error('join failed');
    return { a, b, id: g.id };
  }

  it('persists moves, the position and the clock as the game goes on', async () => {
    const { a, b, id } = await startGame({ initialMs: 60_000, incrementMs: 0 });
    expect(
      await h.app.online.command(a.user.id, id, { type: 'move', uci: 'e2e4', expectedPly: 0 }),
    ).toEqual({ ok: true, ply: 1 });
    expect(
      await h.app.online.command(b.user.id, id, { type: 'move', uci: 'e7e5', expectedPly: 1 }),
    ).toEqual({ ok: true, ply: 2 });
    const row = (
      await h.t.db.query(
        'select current_fen, ply_count, version, status, clock from games where id = $1',
        [id],
      )
    ).rows[0];
    expect(row).toMatchObject({
      ply_count: 2,
      status: 'ACTIVE',
      current_fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
    });
    expect(row.clock.running).toBe('w');
    const moves = (
      await h.t.db.query('select ply, uci, san from game_moves where game_id = $1 order by ply', [
        id,
      ])
    ).rows;
    expect(moves).toEqual([
      { ply: 1, uci: 'e2e4', san: 'e4' },
      { ply: 2, uci: 'e7e5', san: 'e5' },
    ]);
  });

  it('rejects bad commands without touching the stored game', async () => {
    const { a, b, id } = await startGame();
    const before = (await h.t.db.query('select version from games where id = $1', [id])).rows[0]
      .version;
    expect(
      await h.app.online.command(b.user.id, id, { type: 'move', uci: 'e7e5', expectedPly: 0 }),
    ).toEqual({ ok: false, error: 'not_your_turn' });
    expect(
      await h.app.online.command(a.user.id, id, { type: 'move', uci: 'e2e5', expectedPly: 0 }),
    ).toEqual({ ok: false, error: 'illegal_move' });
    expect(
      await h.app.online.command((await register(h.app)).user.id, id, { type: 'resign' }),
    ).toEqual({ ok: false, error: 'not_a_player' });
    expect(
      await h.app.online.command(a.user.id, '00000000-0000-0000-0000-000000000000', {
        type: 'resign',
      }),
    ).toEqual({ ok: false, error: 'not_found' });
    expect(
      (await h.t.db.query('select version from games where id = $1', [id])).rows[0].version,
    ).toBe(before);
  });

  it('serialises concurrent commands (optimistic concurrency): one move per ply, no corruption', async () => {
    const { a, id } = await startGame();
    // The same user fires the same move twice, and a different move for the same ply, all at once.
    const results = await Promise.all([
      h.app.online.command(a.user.id, id, { type: 'move', uci: 'e2e4', expectedPly: 0 }),
      h.app.online.command(a.user.id, id, { type: 'move', uci: 'e2e4', expectedPly: 0 }),
      h.app.online.command(a.user.id, id, { type: 'move', uci: 'd2d4', expectedPly: 0 }),
    ]);
    const moves = (
      await h.t.db.query('select uci from game_moves where game_id = $1 order by ply', [id])
    ).rows.map((r) => r.uci);
    expect(moves).toHaveLength(1);
    expect(results.filter((r) => r.ok && !r.duplicate)).toHaveLength(1);
    expect(['e2e4', 'd2d4']).toContain(moves[0]);
    expect(results.every((r) => r.ok || r.error === 'stale' || r.error === 'not_your_turn')).toBe(
      true,
    );
  });

  it('re-sending an already-applied move is acknowledged and changes nothing', async () => {
    const { a, id } = await startGame();
    await h.app.online.command(a.user.id, id, { type: 'move', uci: 'e2e4', expectedPly: 0 });
    const v = (await h.t.db.query('select version from games where id = $1', [id])).rows[0].version;
    expect(
      await h.app.online.command(a.user.id, id, { type: 'move', uci: 'e2e4', expectedPly: 0 }),
    ).toEqual({ ok: true, ply: 1, duplicate: true });
    expect(
      (await h.t.db.query('select version from games where id = $1', [id])).rows[0].version,
    ).toBe(v);
  });

  it("a finished game stores its PGN and result, and shows up in BOTH players' history and stats", async () => {
    const { a, b, id } = await startGame({ initialMs: 300_000, incrementMs: 2000 });
    for (const [user, uci, ply] of [
      [a, 'f2f3', 0],
      [b, 'e7e5', 1],
      [a, 'g2g4', 2],
      [b, 'd8h4', 3],
    ] as const) {
      expect(
        (await h.app.online.command(user.user.id, id, { type: 'move', uci, expectedPly: ply })).ok,
      ).toBe(true);
    }
    const row = (
      await h.t.db.query(
        'select status, result, termination, pgn, ended_at from games where id = $1',
        [id],
      )
    ).rows[0];
    expect(row).toMatchObject({ status: 'FINISHED', result: '0-1', termination: 'checkmate' });
    expect(row.ended_at).not.toBeNull();
    expect(row.pgn).toContain(`[White "${a.creds.username}"]`);
    expect(row.pgn).toContain(`[Black "${b.creds.username}"]`);
    expect(row.pgn).toContain('[TimeControl "300+2"]');
    expect(row.pgn).toContain('1. f3 e5 2. g4 Qh4#');

    for (const [user, expected] of [
      [a, { wins: 0, losses: 1 }],
      [b, { wins: 1, losses: 0 }],
    ] as const) {
      const hist = (await call('GET', '/api/games', user.accessToken)).json() as {
        items: Array<{
          id: string;
          mode: string;
          myColor: string;
          players: Array<{ name: string }>;
        }>;
      };
      expect(hist.items.map((g) => g.id)).toContain(id);
      expect(hist.items.find((g) => g.id === id)).toMatchObject({ mode: 'ONLINE' });
      const stats = (await call('GET', '/api/me/stats', user.accessToken)).json() as {
        gamesPlayed: number;
        wins: number;
        losses: number;
      };
      expect(stats).toMatchObject({ gamesPlayed: 1, ...expected });
      expect((await call('GET', `/api/games/${id}/pgn`, user.accessToken)).statusCode).toBe(200);
    }
    // finished games are no longer "active"
    expect(
      ((await call('GET', '/api/online/active', a.accessToken)).json() as { items: unknown[] })
        .items,
    ).toEqual([]);
  });

  it('an abandoned game (no result) is kept out of the stats', async () => {
    const { a, id } = await startGame();
    expect((await h.app.online.command(a.user.id, id, { type: 'abort' })).ok).toBe(true);
    const stats = (await call('GET', '/api/me/stats', a.accessToken)).json() as {
      gamesPlayed: number;
    };
    expect(stats.gamesPlayed).toBe(0);
  });
});

describe('the sweeper', () => {
  async function startTimed(ms: number) {
    const a = await register(h.app);
    const b = await register(h.app);
    const g = await h.app.online.create(a.user.id, a.creds.username, {
      color: 'w',
      clockConfig: { initialMs: ms, incrementMs: 0 },
      isPublic: false,
    });
    await h.app.online.join(b.user.id, b.creds.username, { gameId: g.id });
    return { a, b, id: g.id };
  }
  const row = async (id: string) =>
    (await h.t.db.query('select status, result, termination from games where id = $1', [id]))
      .rows[0];

  it('ends a game on time once the running clock expires, and is idempotent', async () => {
    const { a, b, id } = await startTimed(300);
    await h.app.online.command(a.user.id, id, { type: 'move', uci: 'e2e4', expectedPly: 0 });
    await h.app.online.command(b.user.id, id, { type: 'move', uci: 'e7e5', expectedPly: 1 });
    expect(await h.app.online.sweep()).toBe(0); // nothing due yet
    await new Promise((r) => setTimeout(r, 450));
    expect(await h.app.online.sweep()).toBe(1);
    expect(await row(id)).toEqual({ status: 'FINISHED', result: '0-1', termination: 'timeout' }); // white was to move and ran out
    expect(await h.app.online.sweep()).toBe(0);
  });

  it('abandons games that never got going, and purges stale waiting games', async () => {
    const { id } = await startTimed(60_000);
    // The deadline is derived from last_activity_at, so move both back in time.
    await h.t.db.query(
      `update games set last_activity_at = now() - interval '2 minutes', turn_deadline = now() - interval '1 minute' where id = $1`,
      [id],
    );
    expect(await h.app.online.sweep()).toBe(1);
    expect(await row(id)).toEqual({ status: 'FINISHED', result: '*', termination: 'abandoned' });

    const a = await register(h.app);
    const waiting = await h.app.online.create(a.user.id, a.creds.username, {
      color: 'w',
      clockConfig: null,
      isPublic: true,
    });
    await h.t.db.query(`update games set created_at = now() - interval '2 hours' where id = $1`, [
      waiting.id,
    ]);
    await h.app.online.sweep();
    expect(
      (await h.t.db.query('select count(*)::int as n from games where id = $1', [waiting.id]))
        .rows[0].n,
    ).toBe(0);
  });

  it('survives two sweepers racing on the same game', async () => {
    const { a, b, id } = await startTimed(200);
    await h.app.online.command(a.user.id, id, { type: 'move', uci: 'e2e4', expectedPly: 0 });
    await h.app.online.command(b.user.id, id, { type: 'move', uci: 'e7e5', expectedPly: 1 });
    await new Promise((r) => setTimeout(r, 350));
    const [x, y] = await Promise.all([h.app.online.sweep(), h.app.online.sweep()]);
    expect(x + y).toBe(1); // ended exactly once
    expect((await row(id)).termination).toBe('timeout');
  });
});

describe('rate limiting', () => {
  it('limits creating and joining games per client', async () => {
    const limited = await createHarness({ ONLINE_RATE_LIMIT_MAX: '2' });
    try {
      const a = await register(limited.app);
      const codes: number[] = [];
      for (let i = 0; i < 4; i++) {
        codes.push(
          (
            await limited.app.inject({
              method: 'POST',
              url: '/api/online/games',
              headers: bearer(a.accessToken),
              payload: {},
            })
          ).statusCode,
        );
      }
      expect(codes).toEqual([201, 201, 429, 429]);
    } finally {
      await limited.close();
    }
  });
});
