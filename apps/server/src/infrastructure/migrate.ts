import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Db } from './db.js';

// Both layouts resolve to apps/server/migrations:
//  - source (tsx, vitest): <server>/src/infrastructure/migrate.ts -> ../../migrations/
//  - bundled build:        <server>/dist/main.js                  -> ../migrations/
export function defaultMigrationsDir(moduleUrl: string = import.meta.url): string {
  const fromSource = moduleUrl.endsWith('/src/infrastructure/migrate.ts');
  return fileURLToPath(new URL(fromSource ? '../../migrations/' : '../migrations/', moduleUrl));
}

const DEFAULT_DIR = defaultMigrationsDir();

const LOCK_KEY = 727_274; // arbitrary constant; serialises migrators across instances

/**
 * Applies pending `NNNN_name.sql` files in order, each in its own transaction, recording them in
 * `schema_migrations`. Safe to run concurrently from several instances (advisory lock).
 * Returns the names applied by this call.
 */
export async function migrate(db: Db, dir: string = DEFAULT_DIR): Promise<string[]> {
  const client = await db.connect();
  const applied: string[] = [];
  try {
    await client.query('select pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(
      'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
    );
    const done = new Set(
      (await client.query<{ name: string }>('select name from schema_migrations')).rows.map(
        (r) => r.name,
      ),
    );
    const files = (await readdir(dir)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(`${dir}/${file}`, 'utf8');
      try {
        await client.query('begin');
        await client.query(sql);
        await client.query('insert into schema_migrations (name) values ($1)', [file]);
        await client.query('commit');
        applied.push(file);
      } catch (err) {
        await client.query('rollback');
        throw new Error(
          `migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } finally {
    await client.query('select pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    client.release();
  }
  return applied;
}
