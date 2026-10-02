import { resolve } from 'node:path';
import type { Server } from 'node:http';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startApiServer, type ApiServer } from './api-server';
import { serveStatic } from './static-server';

const WEB_PORT = 8132;
const BASE = `http://localhost:${WEB_PORT}`;

let web: Server;
let api: ApiServer;
let browser: Browser;
let page: Page;
let errors: string[];

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

const label = () => page.getByTestId('position-label').innerText();
const fen = async () => (await page.getByTestId('current-fen').innerText()).trim();

async function openAnalysis() {
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Analyze', exact: true }).click();
  await page.waitForSelector('[data-testid="board"]');
}

async function loadText(text: string) {
  await page.getByRole('radio', { name: 'Load / Export' }).click();
  await page.getByTestId('load-input').fill(text);
  await page.getByTestId('load-button').click();
}

async function squareCentre(square: string) {
  const box = await page.locator('[data-testid="board"]').boundingBox();
  if (!box) throw new Error('no board');
  const cell = box.width / 8;
  const f = square.charCodeAt(0) - 97;
  const r = Number(square[1]) - 1;
  return { x: box.x + (f + 0.5) * cell, y: box.y + (7 - r + 0.5) * cell };
}
async function click(square: string) {
  const p = await squareCentre(square);
  await page.mouse.click(p.x, p.y);
}

describe('analysis (real server + Stockfish)', () => {
  it('shows engine lines and an evaluation for the start position', async () => {
    await openAnalysis();
    await page.getByTestId('engine-line-1').waitFor({ timeout: 20_000 });
    expect(await page.getByTestId('engine-line-3').count()).toBe(1);
    const line = await page.getByTestId('engine-line-1').innerText();
    expect(line).toMatch(/[+-]?\d+\.\d\d/); // score
    expect(line).toMatch(/1\. [a-hNBRQK]/); // numbered SAN line
    await page.waitForFunction(
      () => document.querySelector('[data-testid="eval-label"]')?.textContent !== '–',
    );
    expect(await label()).toContain('Start position');
  });

  it('loads a PGN, navigates with buttons and the keyboard, and the engine follows', async () => {
    await openAnalysis();
    await loadText('[Event "t"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *');
    expect(await label()).toContain('After 3... a6');
    await page.getByRole('button', { name: 'Previous move' }).click();
    expect(await label()).toContain('After 3. Bb5');
    await page.keyboard.press('ArrowLeft');
    expect(await label()).toContain('After 2... Nc6');
    await page.keyboard.press('Home');
    expect(await label()).toContain('Start position');
    await page.keyboard.press('End');
    expect(await label()).toContain('After 3... a6');
    await page.getByRole('button', { name: 'First move' }).click();
    await page.getByTestId('engine-line-1').waitFor({ timeout: 20_000 });
    expect(await fen()).toContain('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w');
    // clicking a move in the list jumps to it
    await page.getByRole('radio', { name: 'Moves' }).click();
    await page.getByRole('button', { name: 'Nf3' }).click();
    expect(await label()).toContain('After 2. Nf3');
  });

  it('reports invalid input and loads a FEN position', async () => {
    await openAnalysis();
    await loadText('this is not chess');
    await page.getByTestId('load-error').waitFor();
    expect(await page.getByTestId('load-error').innerText()).toMatch(/Could not read/);
    const startFen = '8/P6k/8/8/8/8/8/K7 w - - 0 1';
    await page.getByTestId('load-input').fill(startFen);
    await page.getByTestId('load-button').click();
    expect(await page.getByTestId('load-error').count()).toBe(0);
    expect(await fen()).toBe(startFen);
    expect(await label()).toContain('Start position');
  });

  it('plays moves on the analysis board; moving from an earlier position replaces the rest', async () => {
    await openAnalysis();
    await loadText('1. e4 e5 2. Nf3 *');
    await page.getByRole('button', { name: 'First move' }).click();
    await page.getByRole('button', { name: 'Next move' }).click(); // after 1. e4
    await click('d7');
    await click('d5');
    await page.getByRole('radio', { name: 'Load / Export' }).click();
    await page.waitForFunction(() =>
      document.querySelector('[data-testid="current-pgn"]')?.textContent?.includes('1. e4 d5'),
    );
    expect(await page.getByTestId('current-pgn').innerText()).not.toContain('Nf3');
    expect(await label()).toContain('After 1... d5');
  });

  it('draws and clears annotation arrows with the right mouse button', async () => {
    await openAnalysis();
    await page.getByTestId('engine-line-1').waitFor({ timeout: 20_000 });
    const a = await squareCentre('g1');
    const b = await squareCentre('f3');
    expect(await page.getByRole('button', { name: 'Clear arrows' }).count()).toBe(0);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await page.mouse.up({ button: 'right' });
    await page.getByRole('button', { name: 'Clear arrows' }).waitFor();
    await page.getByRole('button', { name: 'Clear arrows' }).click();
    expect(await page.getByRole('button', { name: 'Clear arrows' }).count()).toBe(0);
  });

  it('turning the engine off stops analysis; turning it on resumes', async () => {
    await openAnalysis();
    await page.getByTestId('engine-line-1').waitFor({ timeout: 20_000 });
    await page.getByRole('switch', { name: 'Engine' }).click();
    await page.getByText('Turn the engine on to see evaluations and best moves.').waitFor();
    await page.getByRole('switch', { name: 'Engine' }).click();
    await page.getByTestId('engine-line-1').waitFor({ timeout: 20_000 });
  });

  it('shows the result instead of a score for a finished game', async () => {
    await openAnalysis();
    await loadText('1. f3 e5 2. g4 Qh4# 0-1');
    expect(await page.getByTestId('eval-label').innerText()).toBe('0-1');
    await page.getByText('Checkmate — Black wins').waitFor({ timeout: 20_000 });
  });

  it('reviews a game: finds the blunder, summarizes both sides, and jumps to it', async () => {
    await openAnalysis();
    await loadText('1. e4 e5 2. Qh5 Nc6 3. Qxe5+ Nxe5 0-1'); // 3.Qxe5+?? hangs the queen
    await page.getByRole('radio', { name: 'Review' }).click();
    await page.getByTestId('start-review').click();
    await page.getByTestId('review-results').waitFor({ timeout: 90_000 });
    expect(Number(await page.getByTestId('count-w-blunder').innerText())).toBeGreaterThanOrEqual(1);
    const white = parseInt(await page.getByTestId('accuracy-white').innerText(), 10);
    const black = parseInt(await page.getByTestId('accuracy-black').innerText(), 10);
    expect(white).toBeLessThan(black);
    await page.getByRole('button', { name: /Go to move 3\. Qxe5\+/ }).waitFor();
    await page.getByRole('button', { name: /Go to move 3\. Qxe5\+/ }).click();
    expect(await label()).toContain('After 3. Qxe5+');
    // the move list now carries a symbol for the blunder
    await page.getByRole('radio', { name: 'Moves' }).click();
    await page.getByRole('button', { name: /Qxe5\+/ }).waitFor();
    expect(await page.getByRole('button', { name: /Qxe5\+/ }).innerText()).toContain('??');
  }, 120_000);

  it('Analyze from a finished game opens it in the analysis board', async () => {
    await page.goto(`${BASE}/play/local-setup`);
    await page.getByRole('button', { name: 'Start game' }).click();
    await page.waitForSelector('[data-testid="board"]');
    for (const [from, to] of [
      ['f2', 'f3'],
      ['e7', 'e5'],
      ['g2', 'g4'],
      ['d8', 'h4'],
    ] as const) {
      await click(from);
      await click(to);
      await page.waitForTimeout(350);
    }
    await page.getByRole('button', { name: 'View board' }).click();
    await page.getByTestId('analyze-game').click();
    await page.waitForFunction(() =>
      document
        .querySelector('[data-testid="position-label"]')
        ?.textContent?.includes('After 2... Qh4#'),
    );
    await page.getByRole('radio', { name: 'Load / Export' }).click();
    expect(await page.getByTestId('current-pgn').innerText()).toContain('1. f3 e5 2. g4 Qh4#');
  });
});
