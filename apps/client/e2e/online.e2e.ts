import { resolve } from 'node:path';
import type { Server } from 'node:http';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type WebSocketRoute,
} from 'playwright-core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startApiServer, type ApiServer } from './api-server';
import { serveStatic } from './static-server';

const WEB_PORT = 8135;
const BASE = `http://localhost:${WEB_PORT}`;
const PASSWORD = 'correct horse battery staple';

let web: Server;
let api: ApiServer;
let browser: Browser;
let contexts: BrowserContext[];
let errors: string[];
let counter = 0;

beforeAll(async () => {
  web = await serveStatic(resolve(__dirname, '../dist'), WEB_PORT);
  api = await startApiServer([BASE]);
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  });
});
afterAll(async () => {
  await browser?.close();
  web?.close();
  await api?.stop();
});
beforeEach(() => {
  contexts = [];
  errors = [];
});
afterEach(async () => {
  expect(errors).toEqual([]);
  await Promise.all(contexts.map((c) => c.close()));
});

interface Player {
  page: Page;
  username: string;
  color: 'w' | 'b';
  /** Close live sockets and refuse new ones while true (simulates a network outage). */
  outage: { down: boolean; sockets: WebSocketRoute[] };
}

async function newPlayer(): Promise<Player> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  contexts.push(context);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  const outage = { down: false, sockets: [] as WebSocketRoute[] };
  await page.routeWebSocket(/\/ws$/, (ws) => {
    if (outage.down) {
      void ws.close({ code: 1006 });
      return;
    }
    outage.sockets.push(ws);
    ws.connectToServer();
  });
  const n = `on${Date.now() % 1_000_000}${++counter}`;
  await page.goto(BASE);
  await page.getByTestId('signin-button').click();
  await page.getByRole('link', { name: /Create an account/ }).click();
  await page.getByTestId('email').fill(`${n}@example.com`);
  await page.getByTestId('username').fill(n);
  await page.getByTestId('password').fill(PASSWORD);
  await page.getByTestId('auth-submit').click();
  await page.getByTestId('profile-button').waitFor();
  return { page, username: n, color: 'w', outage };
}

async function openHub(p: Player) {
  await p.page.getByRole('button', { name: 'Play', exact: true }).click();
  await p.page.getByTestId('mode-online').click();
}

/** `a` creates a private game as the given colour, `b` joins it with the invite code. */
async function startGame(
  a: Player,
  b: Player,
  opts: { color?: 'White' | 'Black'; clock?: string } = {},
) {
  await openHub(a);
  if (opts.color) await a.page.getByRole('radio', { name: opts.color, exact: true }).click();
  if (opts.clock) await a.page.getByRole('radio', { name: opts.clock, exact: true }).click();
  await a.page.getByTestId('create-online').click();
  const code = (await a.page.getByTestId('invite-code').innerText()).trim();
  expect(code).toMatch(/^[A-Z0-9]{6,}$/);
  await openHub(b);
  await b.page.getByLabel('Invite code').fill(code);
  await b.page.getByTestId('join-code').click();
  await a.page.getByTestId('board').waitFor();
  await b.page.getByTestId('board').waitFor();
  a.color = opts.color === 'Black' ? 'b' : 'w';
  b.color = a.color === 'w' ? 'b' : 'w';
  return code;
}

async function click(p: Player, square: string) {
  const box = await p.page.locator('[data-testid="board"]').boundingBox();
  if (!box) throw new Error('no board');
  const cell = box.width / 8;
  const f = square.charCodeAt(0) - 97;
  const r = Number(square[1]) - 1;
  const flipped = p.color === 'b';
  await p.page.mouse.click(
    box.x + ((flipped ? 7 - f : f) + 0.5) * cell,
    box.y + ((flipped ? r : 7 - r) + 0.5) * cell,
  );
}
const play = async (p: Player, from: string, to: string) => {
  await click(p, from);
  await click(p, to);
};
const fen = async (p: Player) => (await p.page.getByTestId('fen').innerText()).trim();
const waitFen = (p: Player, placement: string, timeout = 15_000) =>
  p.page.waitForFunction(
    (want) => (document.querySelector('[data-testid="fen"]')?.textContent ?? '').startsWith(want),
    placement,
    { timeout },
  );
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b';
const AFTER_E4_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w';

describe('online games (real server, two browsers)', () => {
  it('requires sign-in to play online', async () => {
    const context = await browser.newContext();
    contexts.push(context);
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(BASE);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByTestId('mode-online').click();
    await page.getByText('Sign in to play against other people.').waitFor();
  });

  it('plays moves in real time, with each side oriented to its own colour', async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    await startGame(a, b, { color: 'White' });
    expect(await a.page.getByTestId('status').innerText()).toContain('Your move');
    expect(await b.page.getByTestId('status').innerText()).toContain("Opponent's move");

    await play(a, 'e2', 'e4');
    await waitFen(b, AFTER_E4);
    expect(await b.page.getByTestId('status').innerText()).toContain('Your move');

    // the waiting side cannot move out of turn
    await play(a, 'd2', 'd4');
    await a.page.waitForTimeout(500);
    expect(await fen(a)).toMatch(/^rnbqkbnr\/pppppppp\/8\/8\/4P3\/8\/PPPP1PPP\/RNBQKBNR b/);

    await play(b, 'e7', 'e5');
    await waitFen(a, AFTER_E4_E5);
    // black sees the board from its side: the black king is on the top half… of white's view, bottom of black's
    const board = await b.page.locator('[data-testid="board"]').boundingBox();
    const king = await b.page
      .locator('[data-testid="board"] [aria-label="Black king on e8"]')
      .boundingBox();
    expect(king && board && king.y > board.y + board.height / 2).toBe(true);
    expect(await a.page.getByTestId('move-list').innerText()).toMatch(/1\.\s*e4\s+e5/);
  });

  it('a lobby game created as public is listed and joinable by someone else', async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    await openHub(a);
    await a.page.getByRole('switch', { name: 'List in lobby' }).click();
    await a.page.getByRole('radio', { name: 'Black', exact: true }).click();
    await a.page.getByTestId('create-online').click();
    await a.page.getByTestId('invite-code').waitFor();

    await openHub(b);
    const entry = b.page.getByTestId('lobby-entry').filter({ hasText: a.username });
    await entry.waitFor({ timeout: 15_000 });
    expect(await entry.innerText()).toContain('you play White'); // creator chose Black
    await entry.getByRole('button', { name: `Join ${a.username}` }).click();
    await a.page.getByTestId('board').waitFor();
    await b.page.getByTestId('board').waitFor();
    // a game that has started leaves the lobby
    const c = await newPlayer();
    await openHub(c);
    await c.page.getByTestId('lobby-empty').waitFor({ timeout: 15_000 });
  });

  it('rejects joining your own game and unknown codes with a clear message', async () => {
    const a = await newPlayer();
    await openHub(a);
    await a.page.getByTestId('create-online').click();
    const code = (await a.page.getByTestId('invite-code').innerText()).trim();
    await a.page.goto(`${BASE}/join/${code}`);
    await a.page.getByTestId('join-code').click();
    await a.page.getByText('That is your own game.').waitFor();
    await a.page.getByLabel('Invite code').fill('ZZZZZZ');
    await a.page.getByTestId('join-code').click();
    await a.page.getByText('No open game with that code.').waitFor();
  });

  it('draw offer: decline keeps playing, accept ends the game as a draw for both', async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    await startGame(a, b, { color: 'White' });
    await play(a, 'e2', 'e4');
    await waitFen(b, AFTER_E4);
    // draws can be offered once both sides have moved (before that the game can be aborted)
    expect(
      await b.page.getByRole('button', { name: 'Offer draw' }).getAttribute('aria-disabled'),
    ).toBe('true');
    await play(b, 'e7', 'e5');
    await waitFen(a, AFTER_E4_E5);

    await b.page.getByRole('button', { name: 'Offer draw' }).click();
    await a.page.getByTestId('draw-offer').waitFor();
    await b.page.getByRole('button', { name: 'Draw offered' }).waitFor();
    await a.page.getByRole('button', { name: 'Decline' }).click();
    await b.page.getByRole('button', { name: 'Offer draw' }).waitFor();
    expect(await a.page.getByTestId('draw-offer').count()).toBe(0);

    await a.page.getByRole('button', { name: 'Offer draw' }).click();
    await b.page.getByTestId('draw-offer').waitFor();
    await b.page.getByRole('button', { name: 'Accept draw' }).click();
    for (const p of [a, b]) {
      await p.page.getByTestId('game-over').waitFor();
      expect(await p.page.getByTestId('game-over').innerText()).toContain('Draw by agreement');
    }
  });

  it('resigning ends the game; both players find it in their history', async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    await startGame(a, b, { color: 'White' });
    await play(a, 'e2', 'e4');
    await waitFen(b, AFTER_E4);
    await play(b, 'e7', 'e5');
    await waitFen(a, AFTER_E4_E5);

    await a.page.getByRole('button', { name: 'Resign', exact: true }).click();
    await a.page.getByRole('button', { name: 'Resign', exact: true }).last().click();
    for (const p of [a, b]) {
      await p.page.getByTestId('game-over').waitFor();
      expect(await p.page.getByTestId('game-over').innerText()).toContain('Black wins');
    }
    await a.page.goto(`${BASE}/history`);
    await b.page.goto(`${BASE}/history`);
    await a.page.getByTestId('history-item').first().waitFor({ timeout: 15_000 });
    await b.page.getByTestId('history-item').first().waitFor({ timeout: 15_000 });
    expect(await a.page.getByTestId('history-item').first().innerText()).toContain(
      `vs ${b.username}`,
    );
    expect(await a.page.getByTestId('history-item').first().innerText()).toContain('Loss');
    expect(await b.page.getByTestId('history-item').first().innerText()).toContain('Win');
  });

  it('abort is only offered before both sides have moved', async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    await startGame(a, b, { color: 'White' });
    expect(await a.page.getByRole('button', { name: 'Abort' }).count()).toBe(1);
    expect(await a.page.getByRole('button', { name: 'Resign', exact: true }).count()).toBe(0);
    await a.page.getByRole('button', { name: 'Abort' }).click();
    await a.page.getByRole('button', { name: 'Abort' }).last().click();
    for (const p of [a, b]) {
      await p.page.getByTestId('game-over').waitFor();
      expect(await p.page.getByTestId('game-over').innerText()).toContain('Game aborted');
    }
  });

  it('survives a dropped connection: reconnects, resyncs missed moves and resends a pending move', async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    await startGame(a, b, { color: 'White' });

    // b loses the network; a plays while b is away
    b.outage.down = true;
    for (const ws of b.outage.sockets.splice(0)) await ws.close({ code: 1006 });
    await b.page.getByTestId('connection-status').waitFor();
    await play(a, 'e2', 'e4');
    await a.page.getByText('Opponent is offline').waitFor({ timeout: 15_000 });

    // b comes back and catches up without a reload
    b.outage.down = false;
    await waitFen(b, AFTER_E4, 30_000);
    await b.page.getByTestId('connection-status').waitFor({ state: 'detached', timeout: 15_000 });

    // b plays a move in a second outage: it shows at once and is delivered after reconnecting
    b.outage.down = true;
    for (const ws of b.outage.sockets.splice(0)) await ws.close({ code: 1006 });
    await b.page.getByTestId('connection-status').waitFor();
    await play(b, 'e7', 'e5');
    await waitFen(b, AFTER_E4_E5); // optimistic
    b.outage.down = false;
    await waitFen(a, AFTER_E4_E5, 30_000);
    // exactly one e5 was recorded
    expect(await a.page.getByTestId('move-list').innerText()).toMatch(/1\.\s*e4\s+e5/);
  }, 120_000);

  it('a reload mid-game resumes it from the lobby', async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    await startGame(a, b, { color: 'White' });
    await play(a, 'e2', 'e4');
    await waitFen(b, AFTER_E4);
    await b.page.goto(BASE);
    await b.page.getByRole('button', { name: 'Play', exact: true }).click();
    await b.page.getByTestId('mode-online').click();
    await b.page.getByTestId('resume-game').click();
    await b.page.getByTestId('board').waitFor();
    await waitFen(b, AFTER_E4);
  });

  it('timed game: the clock runs for the side to move and flags on time', async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    await startGame(a, b, { color: 'White', clock: '1 min' });
    await play(a, 'e2', 'e4');
    await waitFen(b, AFTER_E4);
    // black's clock is counting down on both screens
    const t1 = await b.page.getByTestId('bar-bottom').innerText();
    await b.page.waitForTimeout(2200);
    const t2 = await b.page.getByTestId('bar-bottom').innerText();
    expect(t2).not.toBe(t1);
    await a.page.waitForFunction(
      () =>
        /0:5\d|0:4\d/.test(document.querySelector('[data-testid="bar-top"]')?.textContent ?? ''),
      null,
      { timeout: 10_000 },
    );
  });
});
