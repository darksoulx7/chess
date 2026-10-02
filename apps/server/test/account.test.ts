import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createHarness, register, type Harness } from './auth-helper.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

type Req = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  token?: string;
  payload?: unknown;
};
const call = (r: Req) =>
  h.app.inject({
    method: r.method,
    url: r.url,
    headers: r.token ? bearer(r.token) : {},
    ...(r.payload !== undefined ? { payload: r.payload as object } : {}),
  });

describe('profile', () => {
  it('requires authentication', async () => {
    for (const [method, url] of [
      ['GET', '/api/me'],
      ['PATCH', '/api/me'],
      ['DELETE', '/api/me'],
      ['GET', '/api/me/preferences'],
      ['PUT', '/api/me/preferences'],
      ['GET', '/api/me/stats'],
    ] as const) {
      expect((await call({ method, url })).statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('returns and updates the profile', async () => {
    const a = await register(h.app);
    expect(
      (await call({ method: 'GET', url: '/api/me', token: a.accessToken })).json(),
    ).toMatchObject({ user: { id: a.user.id, email: a.creds.email } });
    const upd = await call({
      method: 'PATCH',
      url: '/api/me',
      token: a.accessToken,
      payload: { username: 'NewName_1', avatar: 'queen' },
    });
    expect(upd.statusCode).toBe(200);
    expect(upd.json()).toMatchObject({ user: { username: 'NewName_1', avatar: 'queen' } });
    expect(
      (
        await call({
          method: 'PATCH',
          url: '/api/me',
          token: a.accessToken,
          payload: { avatar: 'rook' },
        })
      ).json(),
    ).toMatchObject({ user: { username: 'NewName_1', avatar: 'rook' } });
  });

  it('rejects invalid or conflicting updates', async () => {
    const a = await register(h.app);
    const b = await register(h.app);
    expect(
      (await call({ method: 'PATCH', url: '/api/me', token: a.accessToken, payload: {} }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await call({
          method: 'PATCH',
          url: '/api/me',
          token: a.accessToken,
          payload: { avatar: 'dragon' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call({
          method: 'PATCH',
          url: '/api/me',
          token: a.accessToken,
          payload: { username: 'x y' },
        })
      ).statusCode,
    ).toBe(400);
    const taken = await call({
      method: 'PATCH',
      url: '/api/me',
      token: a.accessToken,
      payload: { username: b.creds.username.toUpperCase() },
    });
    expect(taken.statusCode).toBe(409);
    expect(taken.json()).toEqual({ error: 'username_taken' });
  });

  it('deletes an account only with the right password, taking sessions and owned games with it', async () => {
    const a = await register(h.app);
    await call({
      method: 'POST',
      url: '/api/games',
      token: a.accessToken,
      payload: GAMES.foolsMateBlack,
    });
    expect(
      (
        await call({
          method: 'DELETE',
          url: '/api/me',
          token: a.accessToken,
          payload: { password: 'wrong wrong wrong' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await call({ method: 'DELETE', url: '/api/me', token: a.accessToken, payload: {} }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await call({
          method: 'DELETE',
          url: '/api/me',
          token: a.accessToken,
          payload: { password: a.creds.password },
        })
      ).statusCode,
    ).toBe(204);
    expect((await call({ method: 'GET', url: '/api/me', token: a.accessToken })).statusCode).toBe(
      401,
    );
    expect(
      (
        await h.app.inject({
          method: 'POST',
          url: '/api/auth/refresh',
          payload: { refreshToken: a.refreshToken },
        })
      ).statusCode,
    ).toBe(401);
    const left = await h.t.db.query(
      'select (select count(*)::int from games where owner_id = $1) as g, (select count(*)::int from game_players where user_id = $1) as p',
      [a.user.id],
    );
    expect(left.rows[0]).toEqual({ g: 0, p: 0 });
  });
});

describe('preferences', () => {
  it('defaults to empty, stores partial updates, strips unknown keys, and replaces on PUT', async () => {
    const a = await register(h.app);
    expect(
      (await call({ method: 'GET', url: '/api/me/preferences', token: a.accessToken })).json(),
    ).toEqual({ preferences: {} });
    const put = await call({
      method: 'PUT',
      url: '/api/me/preferences',
      token: a.accessToken,
      payload: { boardThemeId: 'midnight', soundEnabled: false, evil: '<script>' },
    });
    expect(put.json()).toEqual({ preferences: { boardThemeId: 'midnight', soundEnabled: false } });
    expect(
      (await call({ method: 'GET', url: '/api/me/preferences', token: a.accessToken })).json(),
    ).toEqual({ preferences: { boardThemeId: 'midnight', soundEnabled: false } });
    await call({
      method: 'PUT',
      url: '/api/me/preferences',
      token: a.accessToken,
      payload: { animationSpeed: 'fast' },
    });
    expect(
      (await call({ method: 'GET', url: '/api/me/preferences', token: a.accessToken })).json(),
    ).toEqual({ preferences: { animationSpeed: 'fast' } });
  });

  it.each([
    ['bad enum', { animationSpeed: 'warp' }],
    ['wrong type', { soundEnabled: 'yes' }],
    ['theme id too long', { boardThemeId: 'x'.repeat(41) }],
    ['empty theme id', { pieceThemeId: '' }],
    ['not an object', [1]],
  ])('400 for %s', async (_n, payload) => {
    const a = await register(h.app);
    expect(
      (await call({ method: 'PUT', url: '/api/me/preferences', token: a.accessToken, payload }))
        .statusCode,
    ).toBe(400);
  });

  it('is isolated per user and tolerates a corrupt stored row', async () => {
    const a = await register(h.app);
    const b = await register(h.app);
    await call({
      method: 'PUT',
      url: '/api/me/preferences',
      token: a.accessToken,
      payload: { boardThemeId: 'wood' },
    });
    expect(
      (await call({ method: 'GET', url: '/api/me/preferences', token: b.accessToken })).json(),
    ).toEqual({ preferences: {} });
    await h.t.db.query(
      `update user_preferences set data = '{"animationSpeed": 42}'::jsonb where user_id = $1`,
      [a.user.id],
    );
    expect(
      (await call({ method: 'GET', url: '/api/me/preferences', token: a.accessToken })).json(),
    ).toEqual({ preferences: {} });
  });
});

export const GAMES = {
  /** 1.f3 e5 2.g4 Qh4# — Black wins by checkmate. */
  foolsMateBlack: {
    mode: 'BOT',
    pgn: '1. f3 e5 2. g4 Qh4# 0-1',
    result: '0-1',
    termination: 'checkmate',
    humanColor: 'b',
    botRating: 800,
  },
  /** Same game where the human plays White, so the human loses. */
  foolsMateHumanWhite: {
    mode: 'BOT',
    pgn: '1. f3 e5 2. g4 Qh4# 0-1',
    result: '0-1',
    termination: 'checkmate',
    humanColor: 'w',
    botRating: 800,
  },
  /** Sam Loyd's 10-move stalemate. */
  stalemate: {
    mode: 'BOT',
    pgn: '1. e3 a5 2. Qh5 Ra6 3. Qxa5 h5 4. h4 Rah6 5. Qxc7 f6 6. Qxd7+ Kf7 7. Qxb7 Qd3 8. Qxb8 Qh7 9. Qxc8 Kg6 10. Qe6 *',
    result: '1/2-1/2',
    termination: 'stalemate',
    humanColor: 'w',
    botRating: 1200,
  },
  resignation: {
    mode: 'BOT',
    pgn: '1. e4 e5 2. Nf3 Nc6 3. Bc4 *',
    result: '0-1',
    termination: 'resignation',
    humanColor: 'w',
    botRating: 1600,
  },
  localDraw: {
    mode: 'LOCAL',
    pgn: '1. e4 e5 2. Nf3 *',
    result: '1/2-1/2',
    termination: 'agreement',
  },
} as const;

describe('saving games and stats', () => {
  const save = (token: string, payload: unknown) =>
    call({ method: 'POST', url: '/api/games', token, payload });

  it('saves a checkmated game with players, moves, and an identified opening', async () => {
    const a = await register(h.app);
    const res = await save(a.accessToken, {
      ...GAMES.resignation,
      clientId: crypto.randomUUID(),
      clock: { baseMs: 300000, incrementMs: 2000 },
    });
    expect(res.statusCode).toBe(201);
    const id = (res.json() as { id: string }).id;
    const detail = (
      await call({ method: 'GET', url: `/api/games/${id}`, token: a.accessToken })
    ).json() as { game: Record<string, unknown> };
    expect(detail.game).toMatchObject({
      mode: 'BOT',
      result: '0-1',
      termination: 'resignation',
      plyCount: 5,
      botRating: 1600,
      myColor: 'w',
      timeBaseMs: 300000,
      timeIncrementMs: 2000,
    });
    expect(detail.game.openingName).toMatch(/Italian Game/);
    expect(detail.game.pgn).toContain('1. e4 e5 2. Nf3 Nc6 3. Bc4');
    expect(
      (detail.game.players as Array<{ isBot: boolean; name: string }>).map((p) => p.name),
    ).toEqual([a.creds.username, 'Bot 1600']);
    const moves = (
      await h.t.db.query('select ply, san from game_moves where game_id = $1 order by ply', [id])
    ).rows;
    expect(moves.map((m) => m.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4']);
  });

  it('is idempotent per clientId', async () => {
    const a = await register(h.app);
    const clientId = crypto.randomUUID();
    const first = await save(a.accessToken, { ...GAMES.foolsMateBlack, clientId });
    const second = await save(a.accessToken, { ...GAMES.foolsMateBlack, clientId });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json() as { id: string; duplicate: boolean }).toMatchObject({
      id: (first.json() as { id: string }).id,
      duplicate: true,
    });
    expect(
      (await h.t.db.query('select count(*)::int as n from games where owner_id = $1', [a.user.id]))
        .rows[0].n,
    ).toBe(1);
    // another user may reuse the same clientId
    const b = await register(h.app);
    expect((await save(b.accessToken, { ...GAMES.foolsMateBlack, clientId })).statusCode).toBe(201);
  });

  it.each([
    ['unauthenticated', undefined, GAMES.foolsMateBlack, 401],
    ['checkmate with the wrong winner', 'a', { ...GAMES.foolsMateBlack, result: '1-0' }, 400],
    [
      'checkmate with a different termination',
      'a',
      { ...GAMES.foolsMateBlack, termination: 'resignation' },
      400,
    ],
    [
      'stalemate claimed as a win',
      'a',
      { ...GAMES.stalemate, result: '1-0', termination: 'checkmate' },
      400,
    ],
    [
      'a game still in progress claimed as checkmate',
      'a',
      { ...GAMES.resignation, termination: 'checkmate' },
      400,
    ],
    ['an agreed draw that is decisive', 'a', { ...GAMES.localDraw, result: '1-0' }, 400],
    ['a drawn resignation', 'a', { ...GAMES.resignation, result: '1/2-1/2' }, 400],
    [
      'a bot agreeing to a draw',
      'a',
      { ...GAMES.resignation, result: '1/2-1/2', termination: 'agreement' },
      400,
    ],
    ['a bot game without a rating', 'a', { ...GAMES.resignation, botRating: undefined }, 400],
    ['a local game with bot settings', 'a', { ...GAMES.localDraw, botRating: 800 }, 400],
    ['a bot rating out of range', 'a', { ...GAMES.resignation, botRating: 99 }, 400],
    ['an unknown mode (ONLINE is server-only)', 'a', { ...GAMES.resignation, mode: 'ONLINE' }, 400],
    ['a game with no moves', 'a', { ...GAMES.resignation, pgn: '*' }, 400],
    ['an illegal PGN', 'a', { ...GAMES.resignation, pgn: '1. e4 e4' }, 400],
    ['an oversized PGN', 'a', { ...GAMES.resignation, pgn: 'x'.repeat(250_000) }, 400],
    ['a bad clientId', 'a', { ...GAMES.resignation, clientId: 'nope' }, 400],
    ['a bad clock', 'a', { ...GAMES.resignation, clock: { baseMs: 1, incrementMs: 0 } }, 400],
  ])('rejects %s', async (_name, who, payload, status) => {
    const a = await register(h.app);
    const res = await save(who ? a.accessToken : '', payload);
    expect(res.statusCode).toBe(status);
  });

  it('computes stats from bot games only and lists favourite openings and recent games', async () => {
    const a = await register(h.app);
    const b = await register(h.app);
    await save(a.accessToken, GAMES.foolsMateBlack); // human black wins
    await save(a.accessToken, GAMES.foolsMateHumanWhite); // human white loses
    await save(a.accessToken, GAMES.stalemate); // draw
    await save(a.accessToken, GAMES.resignation); // human white, result 0-1 -> loss
    await save(a.accessToken, GAMES.localDraw); // local: excluded from stats
    await save(b.accessToken, GAMES.foolsMateBlack);
    const stats = (
      await call({ method: 'GET', url: '/api/me/stats', token: a.accessToken })
    ).json() as {
      gamesPlayed: number;
      wins: number;
      losses: number;
      draws: number;
      winRate: number;
      favoriteOpenings: Array<{ name: string; count: number }>;
      recentGames: Array<{ mode: string }>;
    };
    expect(stats).toMatchObject({ gamesPlayed: 4, wins: 1, losses: 2, draws: 1, winRate: 0.25 });
    expect(stats.favoriteOpenings.length).toBeGreaterThan(0);
    expect(stats.favoriteOpenings.reduce((n, o) => n + o.count, 0)).toBeGreaterThanOrEqual(1);
    expect(stats.recentGames).toHaveLength(5); // history includes the local game
    const empty = await register(h.app);
    expect(
      (await call({ method: 'GET', url: '/api/me/stats', token: empty.accessToken })).json(),
    ).toMatchObject({ gamesPlayed: 0, winRate: 0, favoriteOpenings: [], recentGames: [] });
  });
});

describe('game history, access control and export', () => {
  const save = (token: string, payload: unknown) =>
    call({ method: 'POST', url: '/api/games', token, payload });

  it('paginates newest first without gaps or duplicates', async () => {
    const a = await register(h.app);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.unshift(((await save(a.accessToken, GAMES.foolsMateBlack)).json() as { id: string }).id);
      await new Promise((r) => setTimeout(r, 5));
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page++) {
      const res = (
        await call({
          method: 'GET',
          url: `/api/games?limit=2${cursor ? `&cursor=${cursor}` : ''}`,
          token: a.accessToken,
        })
      ).json() as { items: Array<{ id: string }>; nextCursor: string | null };
      seen.push(...res.items.map((i) => i.id));
      cursor = res.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toEqual(ids);
  });

  it('rejects bad pagination input', async () => {
    const a = await register(h.app);
    for (const q of [
      'limit=0',
      'limit=101',
      'limit=abc',
      'cursor=!!!',
      `cursor=${Buffer.from('{"t":"x","id":"y"}').toString('base64url')}`,
    ]) {
      expect(
        (await call({ method: 'GET', url: `/api/games?${q}`, token: a.accessToken })).statusCode,
        q,
      ).toBe(400);
    }
  });

  it("never exposes another user's games (404, not 403)", async () => {
    const a = await register(h.app);
    const b = await register(h.app);
    const id = ((await save(a.accessToken, GAMES.foolsMateBlack)).json() as { id: string }).id;
    for (const [method, url] of [
      ['GET', `/api/games/${id}`],
      ['GET', `/api/games/${id}/pgn`],
      ['DELETE', `/api/games/${id}`],
      ['GET', `/api/games/${id}/review`],
    ] as const) {
      expect(
        (await call({ method, url, token: b.accessToken })).statusCode,
        `${method} ${url}`,
      ).toBe(404);
    }
    expect(
      (await call({ method: 'GET', url: '/api/games', token: b.accessToken })).json(),
    ).toMatchObject({ items: [] });
    expect(
      (await call({ method: 'GET', url: `/api/games/${id}`, token: a.accessToken })).statusCode,
    ).toBe(200); // still there for the owner
    for (const bad of ['not-a-uuid', '00000000-0000-0000-0000-000000000000']) {
      expect(
        (await call({ method: 'GET', url: `/api/games/${bad}`, token: a.accessToken })).statusCode,
      ).toBe(404);
    }
  });

  it('exports PGN as a download and deletes games', async () => {
    const a = await register(h.app);
    const id = ((await save(a.accessToken, GAMES.foolsMateBlack)).json() as { id: string }).id;
    const pgn = await call({ method: 'GET', url: `/api/games/${id}/pgn`, token: a.accessToken });
    expect(pgn.statusCode).toBe(200);
    expect(pgn.headers['content-type']).toContain('chess-pgn');
    expect(pgn.headers['content-disposition']).toBe(`attachment; filename="game-${id}.pgn"`);
    expect(pgn.body).toContain('1. f3 e5 2. g4 Qh4#');
    expect(
      (await call({ method: 'DELETE', url: `/api/games/${id}`, token: a.accessToken })).statusCode,
    ).toBe(204);
    expect(
      (await call({ method: 'GET', url: `/api/games/${id}`, token: a.accessToken })).statusCode,
    ).toBe(404);
    expect(
      (await h.t.db.query('select count(*)::int as n from game_moves where game_id = $1', [id]))
        .rows[0].n,
    ).toBe(0); // cascade
  });

  it('stores and returns the latest review for a game, only for its owner', async () => {
    const a = await register(h.app);
    const b = await register(h.app);
    const id = ((await save(a.accessToken, GAMES.foolsMateBlack)).json() as { id: string }).id;
    const review = {
      moves: [{ ply: 1 }],
      white: { accuracy: 50 },
      black: { accuracy: 90 },
      whiteEvals: [0, 10, -20],
    };
    expect(
      (await call({ method: 'GET', url: `/api/games/${id}/review`, token: a.accessToken }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await call({
          method: 'PUT',
          url: `/api/games/${id}/review`,
          token: a.accessToken,
          payload: { depth: 12, result: review },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await call({
          method: 'PUT',
          url: `/api/games/${id}/review`,
          token: a.accessToken,
          payload: { depth: 14, result: { ...review, white: { accuracy: 70 } } },
        })
      ).statusCode,
    ).toBe(204);
    const got = (
      await call({ method: 'GET', url: `/api/games/${id}/review`, token: a.accessToken })
    ).json() as { depth: number; result: { white: { accuracy: number } } };
    expect(got.depth).toBe(14);
    expect(got.result.white.accuracy).toBe(70);
    expect(
      (
        await h.t.db.query('select count(*)::int as n from analysis_results where game_id = $1', [
          id,
        ])
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await call({
          method: 'PUT',
          url: `/api/games/${id}/review`,
          token: b.accessToken,
          payload: { depth: 12, result: review },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await call({
          method: 'PUT',
          url: `/api/games/${id}/review`,
          token: a.accessToken,
          payload: { depth: 12, result: { nope: 1 } },
        })
      ).statusCode,
    ).toBe(400);
  });
});

describe('saved games', () => {
  const create = (token: string, payload: unknown) =>
    call({ method: 'POST', url: '/api/saved-games', token, payload });

  it('creates from PGN, lists, reads, renames, exports and deletes', async () => {
    const a = await register(h.app);
    const res = await create(a.accessToken, {
      name: '  My Sicilian  ',
      pgn: '[Event "x"]\n\n1. e4 c5 2. Nf3 d6 *',
    });
    expect(res.statusCode).toBe(201);
    const saved = (
      res.json() as { savedGame: { id: string; name: string; plyCount: number; result: string } }
    ).savedGame;
    expect(saved).toMatchObject({ name: 'My Sicilian', plyCount: 4, result: '*' });

    expect(
      (await call({ method: 'GET', url: '/api/saved-games', token: a.accessToken })).json(),
    ).toMatchObject({ items: [{ id: saved.id }] });
    const one = (
      await call({ method: 'GET', url: `/api/saved-games/${saved.id}`, token: a.accessToken })
    ).json() as { savedGame: { pgn: string } };
    expect(one.savedGame.pgn).toContain('1. e4 c5 2. Nf3 d6');

    const renamed = await call({
      method: 'PATCH',
      url: `/api/saved-games/${saved.id}`,
      token: a.accessToken,
      payload: { name: 'Renamed' },
    });
    expect(renamed.json()).toMatchObject({ savedGame: { name: 'Renamed' } });

    const exported = await call({
      method: 'GET',
      url: `/api/saved-games/${saved.id}/pgn`,
      token: a.accessToken,
    });
    expect(exported.headers['content-disposition']).toBe('attachment; filename="Renamed.pgn"');
    expect(exported.body).toContain('2. Nf3 d6');

    expect(
      (await call({ method: 'DELETE', url: `/api/saved-games/${saved.id}`, token: a.accessToken }))
        .statusCode,
    ).toBe(204);
    expect(
      (await call({ method: 'GET', url: `/api/saved-games/${saved.id}`, token: a.accessToken }))
        .statusCode,
    ).toBe(404);
  });

  it('records the result from the board and keeps a custom start position', async () => {
    const a = await register(h.app);
    const mate = await create(a.accessToken, { name: 'mate', pgn: '1. f3 e5 2. g4 Qh4#' });
    expect(mate.json()).toMatchObject({ savedGame: { result: '0-1' } });
    const fen = await create(a.accessToken, {
      name: 'promo',
      pgn: '[SetUp "1"]\n[FEN "8/P6k/8/8/8/8/8/K7 w - - 0 1"]\n\n1. a8=Q *',
    });
    expect(fen.statusCode).toBe(201);
    const id = (fen.json() as { savedGame: { id: string } }).savedGame.id;
    expect(
      (await call({ method: 'GET', url: `/api/saved-games/${id}`, token: a.accessToken })).json(),
    ).toMatchObject({ savedGame: { initialFen: '8/P6k/8/8/8/8/8/K7 w - - 0 1' } });
  });

  it('can be created from one of my own saved history games', async () => {
    const a = await register(h.app);
    const gameId = (
      (
        await call({
          method: 'POST',
          url: '/api/games',
          token: a.accessToken,
          payload: GAMES.resignation,
        })
      ).json() as { id: string }
    ).id;
    const res = await create(a.accessToken, { name: 'From history', gameId });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ savedGame: { gameId, plyCount: 5 } });
  });

  it.each([
    ['empty name', { name: '   ', pgn: '1. e4 *' }],
    ['name too long', { name: 'x'.repeat(101), pgn: '1. e4 *' }],
    ['neither pgn nor game', { name: 'x' }],
    ['invalid pgn', { name: 'x', pgn: '1. e4 e4' }],
    ['oversized pgn', { name: 'x', pgn: 'x'.repeat(250_000) }],
  ])('400 for %s', async (_n, payload) => {
    const a = await register(h.app);
    expect((await create(a.accessToken, payload)).statusCode).toBe(400);
  });

  it("isolates users: nobody can read, rename, export or delete another user's saved game, or link their history game", async () => {
    const a = await register(h.app);
    const b = await register(h.app);
    const id = (
      (await create(a.accessToken, { name: 'private', pgn: '1. e4 *' })).json() as {
        savedGame: { id: string };
      }
    ).savedGame.id;
    const aGame = (
      (
        await call({
          method: 'POST',
          url: '/api/games',
          token: a.accessToken,
          payload: GAMES.resignation,
        })
      ).json() as { id: string }
    ).id;
    for (const [method, url, payload] of [
      ['GET', `/api/saved-games/${id}`, undefined],
      ['GET', `/api/saved-games/${id}/pgn`, undefined],
      ['PATCH', `/api/saved-games/${id}`, { name: 'hacked' }],
      ['DELETE', `/api/saved-games/${id}`, undefined],
    ] as const) {
      expect(
        (await call({ method, url, token: b.accessToken, payload })).statusCode,
        `${method} ${url}`,
      ).toBe(404);
    }
    expect((await create(b.accessToken, { name: 'steal', gameId: aGame })).statusCode).toBe(404);
    expect(
      (await call({ method: 'GET', url: '/api/saved-games', token: b.accessToken })).json(),
    ).toEqual({ items: [] });
    expect(
      (await call({ method: 'GET', url: `/api/saved-games/${id}`, token: a.accessToken })).json(),
    ).toMatchObject({ savedGame: { name: 'private' } });
  });

  it('stores hostile names literally and keeps the export header safe', async () => {
    const a = await register(h.app);
    const name = `a"b\r\nSet-Cookie: x=1; '); drop table saved_games;--`.slice(0, 100);
    const id = (
      (await create(a.accessToken, { name, pgn: '1. e4 *' })).json() as {
        savedGame: { id: string };
      }
    ).savedGame.id;
    const res = await call({
      method: 'GET',
      url: `/api/saved-games/${id}/pgn`,
      token: a.accessToken,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="[A-Za-z0-9_. -]+\.pgn"$/,
    );
    expect(
      (await call({ method: 'GET', url: `/api/saved-games/${id}`, token: a.accessToken })).json(),
    ).toMatchObject({ savedGame: { name } });
  });

  it('enforces a per-user limit', async () => {
    const a = await register(h.app);
    await h.t.db.query(
      `insert into saved_games (user_id, name, pgn, initial_fen) select $1, 'g' || i, '', 'f' from generate_series(1, 500) i`,
      [a.user.id],
    );
    const res = await create(a.accessToken, { name: 'one too many', pgn: '1. e4 *' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'limit_reached', limit: 500 });
  });
});
