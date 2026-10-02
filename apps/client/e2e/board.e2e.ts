import { resolve } from 'node:path';
import type { Server } from 'node:http';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { serveStatic } from './static-server';

const PORT = 8123;
const URL = `http://localhost:${PORT}/play/local`;

let server: Server;
let browser: Browser;
let page: Page;

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
  await page.goto(URL);
  await page.waitForSelector('[data-testid="board"]');
});

async function boardBox() {
  const box = await page.locator('[data-testid="board"]').boundingBox();
  if (!box) throw new Error('no board');
  return box;
}

/** Centre of a square in page coordinates (white at the bottom unless flipped). */
async function sq(square: string, flipped = false) {
  const b = await boardBox();
  const cell = b.width / 8;
  const f = square.charCodeAt(0) - 97;
  const r = Number(square[1]) - 1;
  const col = flipped ? 7 - f : f;
  const row = flipped ? r : 7 - r;
  return { x: b.x + (col + 0.5) * cell, y: b.y + (row + 0.5) * cell };
}

async function click(square: string, flipped = false) {
  const p = await sq(square, flipped);
  await page.mouse.click(p.x, p.y);
}

async function drag(from: string, to: string) {
  const a = await sq(from);
  const b = await sq(to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
}

const fen = async () => (await page.locator('[data-testid="fen"]').innerText()).trim();
const status = async () => (await page.locator('[data-testid="status"]').innerText()).trim();
const piece = (label: string) => page.locator(`[aria-label="${label}"]`);

async function settle() {
  await page.waitForTimeout(450); // longer than the slide animation
}

describe('local game on the web board', () => {
  it('renders the start position', async () => {
    expect(await fen()).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    expect(await piece('White pawn on e2').count()).toBe(1);
    expect(
      await page
        .locator(
          '[aria-label^="White "][aria-label*=" on "], [aria-label^="Black "][aria-label*=" on "]',
        )
        .count(),
    ).toBe(32);
    expect(await status()).toBe('White to move');
  });

  it('click-to-move: select, then move to a legal square', async () => {
    await click('e2');
    await click('e4');
    await settle();
    expect(await fen()).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
    expect(await status()).toBe('Black to move');
    const b = await boardBox();
    const e4 = await sq('e4');
    const box = await piece('White pawn on e4').boundingBox();
    expect(
      box &&
        Math.abs(box.x + box.width / 2 - e4.x) < 2 &&
        Math.abs(box.y + box.height / 2 - e4.y) < 2,
    ).toBe(true);
    expect(b.width).toBeGreaterThan(300);
  });

  it('ignores illegal clicks and the wrong side', async () => {
    const start = await fen();
    await click('e2');
    await click('e5'); // illegal
    await click('e7'); // opponent piece, nothing selected
    await click('e5');
    await settle();
    expect(await fen()).toBe(start);
  });

  it('drag-and-drop moves a piece', async () => {
    await drag('g1', 'f3');
    await settle();
    expect(await fen()).toContain('5N2');
    expect(await status()).toBe('Black to move');
  });

  it('dropping on an illegal square snaps back without moving', async () => {
    const start = await fen();
    await drag('g1', 'g4');
    await settle();
    expect(await fen()).toBe(start);
    const g1 = await sq('g1');
    const box = await piece('White knight on g1').boundingBox();
    expect(box && Math.abs(box.x + box.width / 2 - g1.x) < 2).toBe(true);
  });

  it('plays fools mate; board then locks', async () => {
    for (const [a, b] of [
      ['f2', 'f3'],
      ['e7', 'e5'],
      ['g2', 'g4'],
      ['d8', 'h4'],
    ] as const) {
      await click(a);
      await click(b);
      await settle();
    }
    expect(await status()).toBe('Black wins — Checkmate');
    const end = await fen();
    await click('a2');
    await click('a3');
    await settle();
    expect(await fen()).toBe(end);
  });

  it('promotion shows a piece picker and applies the choice', async () => {
    const line: Array<[string, string]> = [
      ['a2', 'a4'],
      ['b7', 'b5'],
      ['a4', 'b5'],
      ['g8', 'f6'],
      ['b5', 'b6'],
      ['f6', 'd5'],
      ['b6', 'c7'],
      ['d5', 'b4'],
    ];
    for (const [a, b] of line) {
      await click(a);
      await click(b);
      await settle();
    }
    await click('c7');
    await click('d8');
    expect(await page.getByLabel('Promote to Queen').count()).toBe(1);
    expect(await page.getByLabel('Promote to Knight').count()).toBe(1);
    await page.getByLabel('Promote to Knight').click();
    await settle();
    expect(await piece('White knight on d8').count()).toBe(1);
    expect(await page.getByLabel('Promote to Queen').count()).toBe(0);
  });

  it('promotion can be cancelled', async () => {
    const line: Array<[string, string]> = [
      ['a2', 'a4'],
      ['b7', 'b5'],
      ['a4', 'b5'],
      ['g8', 'f6'],
      ['b5', 'b6'],
      ['f6', 'd5'],
      ['b6', 'c7'],
      ['d5', 'b4'],
    ];
    for (const [a, b] of line) {
      await click(a);
      await click(b);
      await settle();
    }
    const before = await fen();
    await click('c7');
    await click('d8');
    await page.getByLabel('Cancel promotion').click({ position: { x: 10, y: 10 } });
    await settle();
    expect(await fen()).toBe(before);
    expect(await piece('White pawn on c7').count()).toBe(1);
  });

  it('flip changes orientation and clicks still map to the right squares', async () => {
    await page.getByRole('button', { name: 'Flip' }).click();
    await settle();
    const b = await boardBox();
    const a1 = await piece('White rook on a1').boundingBox();
    expect(a1 && a1.x > b.x + b.width / 2 && a1.y < b.y + b.height / 2).toBe(true); // a1 is top-right
    await click('e2', true);
    await click('e4', true);
    await settle();
    expect(await fen()).toContain('4P3');
  });

  it('undo and new game', async () => {
    await click('e2');
    await click('e4');
    await settle();
    await page.getByRole('button', { name: 'Undo' }).click();
    await settle();
    expect(await fen()).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    await click('d2');
    await click('d4');
    await settle();
    await page.getByRole('button', { name: 'New game' }).click();
    await settle();
    expect(await fen()).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  });

  it('shows legal-move markers for the selected piece (screenshot sanity)', async () => {
    await click('g1');
    const before = await page.locator('[data-testid="board"]').screenshot();
    await click('g1'); // deselect
    const after = await page.locator('[data-testid="board"]').screenshot();
    expect(before.equals(after)).toBe(false);
  });
});
