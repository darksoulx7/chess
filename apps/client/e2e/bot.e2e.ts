import { resolve } from 'node:path';
import type { Server } from 'node:http';
import { ChessGame } from '@chess/chess-core';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startApiServer, type ApiServer } from './api-server';
import { serveStatic } from './static-server';

const WEB_PORT = 8129;
const BASE = `http://localhost:${WEB_PORT}`;

let web: Server;
let api: ApiServer;
let browser: Browser;
let page: Page;
let errors: string[];
let humanBlack = false;

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
beforeEach(async () => {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
});
afterEach(async () => {
  expect(errors).toEqual([]);
  await page.close();
});

async function squareCentre(square: string) {
  const box = await page.locator('[data-testid="board"]').boundingBox();
  if (!box) throw new Error('no board');
  const cell = box.width / 8;
  const flipped = humanBlack; // the board is oriented to the human's colour
  const f = square.charCodeAt(0) - 97;
  const r = Number(square[1]) - 1;
  return {
    x: box.x + ((flipped ? 7 - f : f) + 0.5) * cell,
    y: box.y + ((flipped ? r : 7 - r) + 0.5) * cell,
  };
}
async function click(square: string) {
  const p = await squareCentre(square);
  await page.mouse.click(p.x, p.y);
}
const fen = async () => (await page.locator('[data-testid="fen"]').innerText()).trim();
/** Half-moves played are derived from the FEN: (fullmove - 1) * 2 + (black to move ? 1 : 0). */
async function waitForPlies(n: number, timeout = 20_000) {
  await page.waitForFunction(
    (target) => {
      const f = (document.querySelector('[data-testid="fen"]')?.textContent ?? '')
        .trim()
        .split(' ');
      return (Number(f[5]) - 1) * 2 + (f[1] === 'b' ? 1 : 0) >= target;
    },
    n,
    { timeout },
  );
}
const history = async () => (await page.locator('[data-testid="move-list"]').innerText()).trim();

interface OpeningOpts {
  family: string;
  /** Variation row label, or 'Random variation'; omit for the whole family. */
  variation?: string;
  depth?: string;
}

async function startBot(
  opts: { color?: 'White' | 'Black'; rating?: string; clock?: string; opening?: OpeningOpts } = {},
) {
  humanBlack = opts.color === 'Black';
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Play vs Bot' }).click();
  if (opts.color) await page.getByRole('radio', { name: opts.color, exact: true }).click();
  if (opts.rating) await page.getByRole('radio', { name: opts.rating, exact: true }).click();
  if (opts.clock) await page.getByRole('radio', { name: opts.clock, exact: true }).click();
  if (opts.opening) {
    await page.getByRole('radio', { name: 'Choose opening', exact: true }).click();
    await page.getByRole('radio', { name: opts.opening.family, exact: true }).click();
    if (opts.opening.variation) {
      await page.getByRole('radio', { name: opts.opening.variation, exact: true }).click();
    }
    if (opts.opening.depth) {
      await page.getByRole('radio', { name: opts.opening.depth, exact: true }).last().click();
    }
  }
  await page.getByRole('button', { name: 'Start game' }).click();
  await page.waitForSelector('[data-testid="board"]');
}

describe('bot games (real server + Stockfish)', () => {
  it('white vs bot: the bot replies after the human moves', async () => {
    await startBot({ rating: '1600' });
    expect(await page.getByText('Strength 1600').count()).toBeGreaterThan(0);
    await click('e2');
    await click('e4');
    await waitForPlies(2);
    // both e4 and black's reply are in the move list
    expect((await history()).replace(/\s+/g, ' ')).toMatch(/1\. e4 \S+/);
  });

  it('black vs bot: the bot opens, the board is oriented to the human, then the game continues', async () => {
    await startBot({ color: 'Black', rating: '800' });
    await waitForPlies(1); // the bot (white) opens
    // black at the bottom: the black king sits on the bottom half of the game board
    const board = await page.locator('[data-testid="board"]').boundingBox();
    const king = await page
      .locator('[data-testid="board"] [aria-label="Black king on e8"]')
      .boundingBox();
    expect(king && board && king.y > board.y + board.height / 2).toBe(true);
    // reply with a legal black move; the bot answers again
    const g = ChessGame.fromFen(await fen());
    if (!g.ok) throw new Error('fen');
    expect(g.value.turn()).toBe('b');
    const m = g.value.getLegalMoves()[0]!;
    await click(m.from);
    await click(m.to);
    await waitForPlies(3);
  });

  it('plays 12 consecutive human moves against the bot; every position stays legal', async () => {
    await startBot({ rating: '400' });
    let expected = 0;
    for (let i = 0; i < 12; i++) {
      await waitForPlies(expected, 25_000);
      const g = ChessGame.fromFen(await fen());
      if (!g.ok) throw new Error('bad fen from UI');
      if (g.value.isGameOver()) break;
      const moves = g.value.getLegalMoves();
      const m = moves[i % moves.length]!;
      await click(m.from);
      await click(m.to);
      if (m.isPromotion) await page.getByLabel('Promote to Queen').click();
      expected += 2;
    }
    expect(ChessGame.fromFen(await fen()).ok).toBe(true);
    expect(expected).toBeGreaterThan(10);
  }, 240_000);

  it('hides the draw button and resigning ends the game with a bot win', async () => {
    await startBot({});
    expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
    await page.getByRole('button', { name: 'Resign', exact: true }).click();
    await page.getByRole('button', { name: 'Resign', exact: true }).last().click();
    await page.getByText('Black wins').first().waitFor();
    await page.getByText('White resigned').first().waitFor();
  });

  it('undo takes back the human move and the bot reply', async () => {
    await startBot({ rating: '1200' });
    await click('e2');
    await click('e4');
    await waitForPlies(2);
    await page.getByRole('button', { name: 'Undo' }).click();
    await page.waitForFunction(
      () =>
        (document.querySelector('[data-testid="fen"]')?.textContent ?? '').startsWith(
          'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w',
        ),
      null,
      { timeout: 5000 },
    );
  });

  it('recovers when the server goes away: shows an error, then Retry succeeds after it returns', async () => {
    await startBot({ rating: '800' });
    await api.stop();
    await click('e2');
    await click('e4');
    await page.getByText('Cannot reach the server').waitFor({ timeout: 15_000 });
    const retry = page.getByRole('button', { name: 'Retry' });
    expect(await retry.count()).toBe(1);
    api = await startApiServer([BASE]);
    await retry.click();
    await waitForPlies(2);
    expect(await page.getByText('Cannot reach the server').count()).toBe(0);
  }, 120_000);

  it('a new game while the bot is thinking cancels the old request cleanly', async () => {
    await startBot({ rating: '2500' }); // deep search: still thinking when we restart
    await click('e2');
    await click('e4');
    await page.getByRole('button', { name: 'New game' }).first().click();
    await page.waitForTimeout(2500);
    expect(await fen()).toContain('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w');
  });
});

const openingName = async () =>
  (await page.locator('[data-testid="opening-name"]').innerText()).trim();
const sanOf = async () => (await history()).replace(/\s+/g, ' ');

describe('openings (real server + Stockfish)', () => {
  it('Bot 1600, Italian Game, Giuoco Piano: the bot follows the line as Black', async () => {
    await startBot({
      rating: '1600',
      opening: { family: 'Italian Game', variation: 'Giuoco Piano', depth: '10' },
    });
    expect(await page.getByTestId('opening-line').innerText()).toContain(
      '1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5',
    );
    for (const [from, to, plyAfter] of [
      ['e2', 'e4', 2],
      ['g1', 'f3', 4],
      ['f1', 'c4', 6],
    ] as const) {
      await click(from);
      await click(to);
      await waitForPlies(plyAfter);
    }
    expect(await sanOf()).toContain('1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5');
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="opening-name"]')
          ?.textContent?.includes('Giuoco Piano') ?? false,
    );
    expect(await openingName()).toContain('Italian Game: Giuoco Piano');
  }, 120_000);

  it('as White the bot opens with the book move for a Black-side opening', async () => {
    await startBot({
      color: 'Black',
      rating: '800',
      opening: { family: 'Sicilian Defense', variation: 'Random variation' },
    });
    await waitForPlies(1);
    expect(await sanOf()).toContain('1. e4');
    // the Sicilian is Black's reply: play 1...c5 and the bot continues from the book
    await click('c7');
    await click('c5');
    await waitForPlies(3);
    expect(await openingName()).toMatch(/Sicilian/);
  }, 120_000);

  it('adapts when the human leaves the line: the bot still replies with a legal move', async () => {
    await startBot({
      rating: '1200',
      opening: { family: 'Italian Game', variation: 'Giuoco Piano' },
    });
    await click('d2');
    await click('d4'); // 1.d4 is not in the Italian subtree
    await waitForPlies(2);
    const g = ChessGame.fromFen(await fen());
    expect(g.ok).toBe(true);
    expect(await sanOf()).toContain('1. d4');
  }, 60_000);

  it('a family with no variation chosen offers the whole family and shows the bot plan', async () => {
    await startBot({
      color: 'Black',
      rating: '1000',
      opening: { family: 'Ruy Lopez' },
    });
    await waitForPlies(1);
    expect(await sanOf()).toContain('1. e4');
  }, 60_000);

  it('search finds any opening and selects it', async () => {
    await page.goto(BASE);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByRole('button', { name: 'Play vs Bot' }).click();
    await page.getByRole('radio', { name: 'Choose opening', exact: true }).click();
    await page.getByLabel('Search openings').fill('najdorf');
    await page
      .getByRole('radio', { name: /Sicilian Defense: Najdorf Variation/ })
      .first()
      .click();
    expect(await page.getByTestId('opening-line').innerText()).toContain('Najdorf');
  });
});
