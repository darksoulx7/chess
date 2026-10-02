import { chmodSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const STOCKFISH_PATH = process.env.STOCKFISH_PATH ?? '/usr/games/stockfish';
export const hasStockfish = existsSync(STOCKFISH_PATH);

/** Writes an executable node script that impersonates a UCI engine (for failure-mode tests). */
export function fakeEngineBinary(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'fake-uci-'));
  const file = join(dir, 'engine.mjs');
  writeFileSync(
    file,
    `#!/usr/bin/env node\nimport { createInterface } from 'node:readline';\nconst out = (s) => process.stdout.write(s + '\\n');\nconst rl = createInterface({ input: process.stdin });\n${body}\n`,
  );
  chmodSync(file, 0o755);
  return file;
}
