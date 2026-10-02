import { resolve } from 'node:path';
import type { Server } from 'node:http';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { serveStatic } from './static-server';

const PORT = 8124;
const BASE = `http://localhost:${PORT}`;

let server: Server;
let browser: Browser;
let page: Page;
let errors: string[];

beforeAll(async () => {
  server = await serveStatic(resolve(__dirname, '../dist'), PORT);
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  });
});
afterAll(async () => {
  await browser?.close();
  server?.close();
});
beforeEach(async () => {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    // The home screen probes an API that is not running in e2e; that failed fetch is expected.
    if (m.type() === 'error' && !/Failed to load resource|ERR_CONNECTION_REFUSED/.test(m.text()))
      errors.push(m.text());
  });
});
afterEach(async () => {
  expect(errors).toEqual([]);
  await page.close();
});

async function boardBox() {
  const box = await page.locator('[data-testid="board"]').boundingBox();
  if (!box) throw new Error('no board');
  return box;
}
async function click(square: string) {
  const b = await boardBox();
  const cell = b.width / 8;
  const f = square.charCodeAt(0) - 97;
  const r = Number(square[1]) - 1;
  await page.mouse.click(b.x + (f + 0.5) * cell, b.y + (7 - r + 0.5) * cell);
}
const settle = () => page.waitForTimeout(400);
const status = async () => (await page.locator('[data-testid="status"]').innerText()).trim();

async function startLocal(timeControlLabel?: string) {
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Play on this device' }).click();
  if (timeControlLabel) await page.getByRole('radio', { name: timeControlLabel }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  await page.waitForSelector('[data-testid="board"]');
}

describe('navigation and setup', () => {
  it('home -> setup -> game and back to menu', async () => {
    await startLocal();
    expect(await status()).toBe('White to move');
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByText('Play, practice and analyze.').filter({ visible: true }).waitFor();
  });

  it('untimed games show no clocks', async () => {
    await startLocal('No clock');
    expect(await page.locator('[data-testid="bar-top-clock"]').count()).toBe(0);
  });
});

describe('clocks', () => {
  it('shows clocks, starts only after the first move, then counts down', async () => {
    await startLocal('3 min');
    const topClock = page.locator('[data-testid="bar-top-clock"]');
    const bottomClock = page.locator('[data-testid="bar-bottom-clock"]');
    expect(await bottomClock.innerText()).toBe('3:00');
    await page.waitForTimeout(1200);
    expect(await bottomClock.innerText()).toBe('3:00'); // not running before the first move
    await click('e2');
    await click('e4');
    await page.waitForTimeout(2300);
    const black = await topClock.innerText();
    expect(black).not.toBe('3:00'); // black's clock is now running
    expect(await bottomClock.innerText()).toBe('3:00');
  });

  it('disables undo when a clock is used', async () => {
    await startLocal('5 min');
    await click('e2');
    await click('e4');
    await settle();
    expect(await page.getByRole('button', { name: 'Undo' }).isDisabled()).toBe(true);
  });
});

describe('game end flows', () => {
  it('resign asks for confirmation, then shows the result sheet and locks the board', async () => {
    await startLocal();
    await page.getByRole('button', { name: 'Resign', exact: true }).click();
    await page.getByText('White resigns?').waitFor();
    await page.getByRole('button', { name: 'Cancel' }).click();
    expect(await status()).toBe('White to move');

    await page.getByRole('button', { name: 'Resign', exact: true }).click();
    await page.getByRole('button', { name: 'Resign', exact: true }).last().click();
    await page.getByText('Black wins').first().waitFor();
    await page.getByText('White resigned').first().waitFor();
    await page.getByRole('button', { name: 'View board' }).click();
    expect(await status()).toBe('Black wins — White resigned');
    const fenBefore = await page.locator('[data-testid="fen"]').innerText();
    await click('e2');
    await click('e4');
    await settle();
    expect(await page.locator('[data-testid="fen"]').innerText()).toBe(fenBefore);
  });

  it('draw by agreement', async () => {
    await startLocal();
    await page.getByRole('button', { name: 'Draw', exact: true }).click();
    await page.getByText('Agree to a draw?').waitFor();
    await page.getByRole('button', { name: 'Draw', exact: true }).last().click();
    await page.getByText('Draw by agreement').first().waitFor();
  });

  it('flagging ends the game on time', async () => {
    await startLocal('1 min');
    await click('e2');
    await click('e4');
    await settle();
    // Fast-forward: black's clock runs from the first move; wait it out by shifting Date.
    await page.evaluate(() => {
      const realNow = Date.now;
      const offset = 61_000;
      Date.now = () => realNow() + offset;
    });
    await page.getByText('Black ran out of time').first().waitFor({ timeout: 5000 });
    await page.getByText('White wins').first().waitFor();
  });

  it('new game from the result sheet resets the board', async () => {
    await startLocal();
    await click('e2');
    await click('e4');
    await settle();
    await page.getByRole('button', { name: 'Draw', exact: true }).click();
    await page.getByRole('button', { name: 'Draw', exact: true }).last().click();
    await page.getByRole('button', { name: 'New game' }).last().click(); // the sheet renders last
    await settle();
    expect(await page.locator('[data-testid="fen"]').innerText()).toContain(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w',
    );
  });
});

describe('captured pieces', () => {
  it('shows material advantage after a capture', async () => {
    await startLocal();
    for (const [a, b] of [
      ['e2', 'e4'],
      ['d7', 'd5'],
      ['e4', 'd5'],
    ] as const) {
      await click(a);
      await click(b);
      await settle();
    }
    await page.getByText('+1').first().waitFor();
  });
});

describe('keyboard navigation', () => {
  it('moves a piece with arrow keys + Enter', async () => {
    await startLocal();
    const board = page.locator('[aria-label^="Chess board. Use arrow keys"]').last();
    await board.focus();
    // The cursor appears on the first arrow key (e2 -> e1 -> e2); then select, move up twice to e4, confirm.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await settle();
    expect(await page.locator('[data-testid="fen"]').innerText()).toContain('4P3');
    await page.keyboard.press('Escape');
  });
});

describe('settings', () => {
  it('persists a theme change across reloads and applies it to the board', async () => {
    await page.goto(`${BASE}/settings`);
    await page.getByRole('radio', { name: 'Midnight board' }).click();
    await page.getByRole('radio', { name: 'Modern', exact: true }).click();
    await page.reload();
    expect(
      await page.getByRole('radio', { name: 'Midnight board' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      await page.getByRole('radio', { name: 'Modern', exact: true }).getAttribute('aria-checked'),
    ).toBe('true');
    const stored = await page.evaluate(() => localStorage.getItem('chess.settings.v1'));
    expect(stored).toContain('midnight');
  });

  it('ignores a corrupt stored blob', async () => {
    await page.goto(BASE);
    await page.evaluate(() =>
      localStorage.setItem(
        'chess.settings.v1',
        '{"state":{"boardThemeId":42,"animationSpeed":"warp"},"version":1}',
      ),
    );
    await page.goto(`${BASE}/settings`);
    await page.getByText('Settings', { exact: true }).waitFor();
    expect(
      await page.getByRole('radio', { name: 'Classic board' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(await page.getByRole('radio', { name: 'Normal' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('move confirmation requires a second tap', async () => {
    await page.goto(`${BASE}/settings`);
    await page.getByRole('switch', { name: 'Move confirmation' }).click();
    await page.goto(`${BASE}/play`);
    await page.getByRole('button', { name: 'Start game' }).click();
    await page.waitForSelector('[data-testid="board"]');
    await click('e2');
    await click('e4');
    await settle();
    expect(await page.locator('[data-testid="fen"]').innerText()).toContain(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP',
    );
    await click('e4');
    await settle();
    expect(await page.locator('[data-testid="fen"]').innerText()).toContain('4P3');
  });
});
