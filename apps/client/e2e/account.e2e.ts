import { resolve } from 'node:path';
import type { Server } from 'node:http';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startApiServer, type ApiServer } from './api-server';
import { serveStatic } from './static-server';

const WEB_PORT = 8134;
const BASE = `http://localhost:${WEB_PORT}`;
const PASSWORD = 'correct horse battery staple';

let web: Server;
let api: ApiServer;
let browser: Browser;
let context: BrowserContext;
let page: Page;
let errors: string[];
let counter = 0;

const newUser = () => {
  const n = `e2e${Date.now() % 1_000_000}${++counter}`;
  return { username: n, email: `${n}@example.com` };
};

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
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  page = await context.newPage();
  errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
});
afterEach(async () => {
  expect(errors).toEqual([]);
  await context.close();
});

async function signUp(p: Page, user = newUser(), password = PASSWORD) {
  await p.goto(BASE);
  await p.getByTestId('signin-button').click();
  await p.getByRole('link', { name: /Create an account/ }).click();
  await p.getByTestId('email').fill(user.email);
  await p.getByTestId('username').fill(user.username);
  await p.getByTestId('password').fill(password);
  await p.getByTestId('auth-submit').click();
  await p.getByTestId('profile-button').waitFor();
  return user;
}

async function signIn(p: Page, identifier: string, password = PASSWORD) {
  await p.goto(BASE);
  await p.getByTestId('signin-button').click();
  await p.getByTestId('identifier').fill(identifier);
  await p.getByTestId('password').fill(password);
  await p.getByTestId('auth-submit').click();
}

async function squareCentre(p: Page, square: string) {
  const box = await p.locator('[data-testid="board"]').boundingBox();
  if (!box) throw new Error('no board');
  const cell = box.width / 8;
  return {
    x: box.x + (square.charCodeAt(0) - 97 + 0.5) * cell,
    y: box.y + (7 - (Number(square[1]) - 1) + 0.5) * cell,
  };
}
async function click(p: Page, square: string) {
  const c = await squareCentre(p, square);
  await p.mouse.click(c.x, c.y);
}

describe('registration, sessions and validation', () => {
  it('registers, lands signed in, and restores the session after a reload', async () => {
    const user = await signUp(page);
    expect(await page.getByTestId('profile-button').innerText()).toContain(user.username);
    await page.reload();
    await page.getByTestId('profile-button').waitFor({ timeout: 15_000 });
    // only the refresh token is persisted, never the password
    const stored = await page.evaluate(() => JSON.stringify(Object.entries(localStorage)));
    expect(stored).toContain('chess.refreshToken.v1');
    expect(stored).not.toContain(PASSWORD);
  });

  it('shows client-side and server-side validation errors', async () => {
    await page.goto(BASE);
    await page.getByTestId('signin-button').click();
    await page.getByRole('link', { name: /Create an account/ }).click();
    await page.getByTestId('email').fill('not-an-email');
    await page.getByTestId('auth-submit').click();
    expect(await page.getByTestId('auth-error').innerText()).toMatch(/valid email/);
    await page.getByTestId('email').fill('ok@example.com');
    await page.getByTestId('username').fill('x y');
    await page.getByTestId('auth-submit').click();
    expect(await page.getByTestId('auth-error').innerText()).toMatch(/Username must be/);
    await page.getByTestId('username').fill(newUser().username);
    await page.getByTestId('password').fill('short');
    await page.getByTestId('auth-submit').click();
    expect(await page.getByTestId('auth-error').innerText()).toMatch(/at least 10/);
    // common password passes the client check but the server rejects it with its own message
    await page.getByTestId('password').fill('password123');
    await page.getByTestId('auth-submit').click();
    await page.getByText(/too common/).waitFor();
  });

  it('rejects a duplicate email and a wrong password with clear messages', async () => {
    const user = await signUp(page);
    const other = await context.browser()!.newContext();
    const p2 = await other.newPage();
    await p2.goto(BASE);
    await p2.getByTestId('signin-button').click();
    await p2.getByRole('link', { name: /Create an account/ }).click();
    await p2.getByTestId('email').fill(user.email);
    await p2.getByTestId('username').fill(newUser().username);
    await p2.getByTestId('password').fill(PASSWORD);
    await p2.getByTestId('auth-submit').click();
    await p2.getByText('That email is already registered.').waitFor();
    await other.close();

    await page.evaluate(() => localStorage.clear());
    await signIn(page, user.username, 'wrong password!!');
    await page.getByText('Wrong email/username or password.').waitFor();
  });

  it('signs out, clears the stored token, and signs back in by username or email', async () => {
    const user = await signUp(page);
    await page.getByTestId('profile-button').click();
    await page.getByTestId('sign-out').click();
    await page.getByTestId('signin-button').waitFor();
    expect(await page.evaluate(() => localStorage.getItem('chess.refreshToken.v1'))).toBeNull();
    await page.reload();
    await page.getByTestId('signin-button').waitFor();
    await signIn(page, user.email.toUpperCase());
    await page.getByTestId('profile-button').waitFor();
  });

  it('keeps working after the access token expires (silent refresh)', async () => {
    await signUp(page);
    await page.waitForTimeout(32_000); // access tokens live 30 s in this suite
    await page.getByTestId('profile-button').click();
    // the stats request hits an expired access token, so this only shows `0` if the silent refresh worked
    await page.waitForFunction(
      () => document.querySelector('[data-testid="stat-games"]')?.textContent === '0',
      null,
      { timeout: 15_000 },
    );
    // still signed in afterwards
    await page.getByRole('button', { name: 'Back' }).click();
    await page.getByTestId('profile-button').waitFor();
  }, 60_000);
});

describe('games, history and stats', () => {
  it('saves a finished bot game; stats, history and analysis reflect it; delete removes it', async () => {
    const user = await signUp(page);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByRole('button', { name: 'Play vs Bot' }).click();
    await page.getByRole('radio', { name: '400', exact: true }).click();
    await page.getByRole('button', { name: 'Start game' }).click();
    await page.waitForSelector('[data-testid="board"]');
    await click(page, 'e2');
    await click(page, 'e4');
    await page.waitForFunction(
      () => /\s2$/.test((document.querySelector('[data-testid="fen"]')?.textContent ?? '').trim()),
      null,
      { timeout: 20_000 },
    );
    await page.getByRole('button', { name: 'Resign', exact: true }).click();
    await page.getByRole('button', { name: 'Resign', exact: true }).last().click();
    await page.getByText('Saved to your history ✓').waitFor({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Menu' }).last().click();

    await page.getByTestId('profile-button').click();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="stat-games"]')?.textContent === '1',
      null,
      { timeout: 15_000 },
    );
    expect(await page.getByTestId('stat-losses').innerText()).toBe('1');
    expect(await page.getByTestId('stat-winrate').innerText()).toBe('0%');

    await page.getByRole('button', { name: 'Game history' }).click();
    const item = page.getByTestId('history-item').first();
    await item.waitFor();
    expect(await item.innerText()).toContain('Loss');
    expect(await item.innerText()).toContain('vs Bot 400');
    await item.getByRole('button', { name: 'Analyze' }).click();
    await page.getByTestId('position-label').waitFor();
    expect(await page.getByTestId('position-label').innerText()).toMatch(/After 1\.\.\. /);
    await page.goBack();

    await page.getByTestId('history-item').first().getByRole('button', { name: 'Delete' }).click();
    await page.getByText('No games yet.').waitFor();
    expect(user.username).toBeTruthy();
  }, 90_000);

  it('saves a local game once, even though the sheet re-renders', async () => {
    await signUp(page);
    await page.goto(`${BASE}/play/local-setup`);
    await page.getByRole('button', { name: 'Start game' }).click();
    await page.waitForSelector('[data-testid="board"]');
    for (const [from, to] of [
      ['f2', 'f3'],
      ['e7', 'e5'],
      ['g2', 'g4'],
      ['d8', 'h4'],
    ] as const) {
      await click(page, from);
      await click(page, to);
      await page.waitForTimeout(350);
    }
    await page.getByText('Saved to your history ✓').waitFor({ timeout: 15_000 });
    await page.goto(`${BASE}/history`);
    await page.getByTestId('history-item').first().waitFor({ timeout: 15_000 });
    expect(await page.getByTestId('history-item').count()).toBe(1);
    expect(await page.getByTestId('history-item').first().innerText()).toContain('Local game');
  }, 60_000);

  it('offers sign-in instead of saving when signed out', async () => {
    await page.goto(`${BASE}/play/local-setup`);
    await page.getByRole('button', { name: 'Start game' }).click();
    await page.waitForSelector('[data-testid="board"]');
    for (const [from, to] of [
      ['f2', 'f3'],
      ['e7', 'e5'],
      ['g2', 'g4'],
      ['d8', 'h4'],
    ] as const) {
      await click(page, from);
      await click(page, to);
      await page.waitForTimeout(350);
    }
    await page.getByRole('button', { name: 'Sign in to save your games' }).waitFor();
  });
});

describe('saved games', () => {
  it('saves from the analysis screen, then lists, renames, opens, exports and deletes', async () => {
    await signUp(page);
    await page.goto(BASE);
    await page.getByRole('button', { name: 'Analyze', exact: true }).click();
    await page.getByRole('radio', { name: 'Load / Export' }).click();
    await page.getByTestId('load-input').fill('1. e4 c5 2. Nf3 d6 3. d4 cxd4 *');
    await page.getByTestId('load-button').click();
    await page.getByTestId('save-name').fill('My Sicilian');
    await page.getByTestId('save-to-games').click();
    await page.getByText('Saved. Find it under Saved games.').waitFor();

    await page.goto(`${BASE}/saved`);
    const item = page.getByTestId('saved-item').first();
    await item.waitFor({ timeout: 15_000 });
    expect(await item.innerText()).toContain('My Sicilian');

    await item.getByRole('button', { name: 'Rename' }).click();
    await page.getByTestId('rename-input').fill('Najdorf prep');
    await page.getByTestId('rename-save').click();
    await page.getByText('Najdorf prep').first().waitFor();

    await page.getByTestId('saved-item').first().getByRole('button', { name: 'Analyze' }).click();
    await page.getByTestId('position-label').waitFor();
    expect(await page.getByTestId('position-label').innerText()).toContain('After 3... cxd4');
    await page.goBack();

    await page.getByTestId('saved-item').first().getByRole('button', { name: 'Delete' }).click();
    await page.getByText(/Nothing saved yet/).waitFor();
  }, 60_000);
});

describe('preferences, profile and account deletion', () => {
  it('syncs board settings across devices', async () => {
    const user = await signUp(page);
    await page.goto(`${BASE}/settings`);
    await page.getByRole('radio', { name: 'Midnight board' }).click();
    await page.getByRole('radio', { name: 'Modern', exact: true }).click();
    await page.waitForTimeout(2000); // upload is debounced by 1 s

    const second = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const p2 = await second.newPage();
    await signIn(p2, user.username);
    await p2.getByTestId('profile-button').waitFor();
    await p2.waitForTimeout(1500); // first sync after sign-in
    await p2.goto(`${BASE}/settings`);
    await p2.getByRole('radio', { name: 'Midnight board' }).waitFor();
    expect(
      await p2.getByRole('radio', { name: 'Midnight board' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      await p2.getByRole('radio', { name: 'Modern', exact: true }).getAttribute('aria-checked'),
    ).toBe('true');
    await second.close();
  }, 60_000);

  it('edits the username and avatar', async () => {
    await signUp(page);
    await page.getByTestId('profile-button').click();
    const fresh = `renamed${Date.now() % 100000}`;
    await page.getByTestId('edit-username').fill(fresh);
    await page.getByTestId('save-username').click();
    await page.getByText('Saved.').waitFor();
    expect(await page.getByTestId('profile-name').innerText()).toBe(fresh);
    await page.getByRole('radio', { name: 'queen avatar' }).click();
    await page.waitForFunction(
      () =>
        document.querySelector('[aria-label="queen avatar"]')?.getAttribute('aria-checked') ===
        'true',
    );
  });

  it('deletes the account after confirming the password', async () => {
    const user = await signUp(page);
    await page.getByTestId('profile-button').click();
    await page.getByRole('button', { name: 'Delete account' }).click();
    await page.getByTestId('delete-password').fill('wrong wrong wrong');
    await page.getByTestId('confirm-delete').click();
    await page.getByText('Wrong email/username or password.').waitFor();
    await page.getByTestId('delete-password').fill(PASSWORD);
    await page.getByTestId('confirm-delete').click();
    await page.getByTestId('signin-button').waitFor({ timeout: 15_000 });
    await signIn(page, user.username);
    await page.getByText('Wrong email/username or password.').waitFor();
  });
});
