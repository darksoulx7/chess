import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { migrate } from '../src/infrastructure/migrate.js';
import { createTestDb } from './db-helper.js';

const t = await createTestDb();
afterAll(() => t.drop());

describe('migrations', () => {
  it('creates the schema and is idempotent', async () => {
    const tables = (
      await t.db.query<{ table_name: string }>(
        `select table_name from information_schema.tables where table_schema = $1 order by 1`,
        [t.schema],
      )
    ).rows.map((r) => r.table_name);
    for (const name of [
      'users',
      'sessions',
      'user_preferences',
      'games',
      'game_players',
      'game_moves',
      'saved_games',
      'analysis_results',
      'schema_migrations',
    ]) {
      expect(tables).toContain(name);
    }
    expect(await migrate(t.db)).toEqual([]); // nothing left to apply
  });

  it('creates the documented indexes', async () => {
    const idx = (
      await t.db.query<{ indexname: string }>(
        `select indexname from pg_indexes where schemaname = $1`,
        [t.schema],
      )
    ).rows.map((r) => r.indexname);
    for (const name of [
      'users_email_lower_idx',
      'users_username_lower_idx',
      'sessions_token_hash_idx',
      'games_owner_ended_idx',
      'game_players_user_idx',
      'saved_games_user_updated_idx',
    ]) {
      expect(idx).toContain(name);
    }
  });

  it('enforces case-insensitive uniqueness of email and username', async () => {
    await t.db.query(
      `insert into users (email, username, password_hash) values ('A@x.io', 'Bob', 'h')`,
    );
    await expect(
      t.db.query(
        `insert into users (email, username, password_hash) values ('a@X.io', 'other', 'h')`,
      ),
    ).rejects.toThrow(/users_email_lower_idx/);
    await expect(
      t.db.query(
        `insert into users (email, username, password_hash) values ('b@x.io', 'bOB', 'h')`,
      ),
    ).rejects.toThrow(/users_username_lower_idx/);
  });

  it('enforces check constraints and cascades', async () => {
    const u = (
      await t.db.query<{ id: string }>(
        `insert into users (email, username, password_hash) values ('c@x.io', 'carol', 'h') returning id`,
      )
    ).rows[0]!.id;
    await expect(
      t.db.query(
        `insert into games (mode, initial_fen, current_fen, pgn, result) values ('NOPE', 'f', 'f', '', '*')`,
      ),
    ).rejects.toThrow(/check/);
    await expect(
      t.db.query(
        `insert into saved_games (user_id, name, pgn, initial_fen) values ($1, '', '', 'f')`,
        [u],
      ),
    ).rejects.toThrow(/check/);
    await expect(
      t.db.query(`insert into analysis_results (user_id, depth, result) values ($1, 10, '{}')`, [
        u,
      ]),
    ).rejects.toThrow(/check/);
    await t.db.query(
      `insert into saved_games (user_id, name, pgn, initial_fen) values ($1, 'x', '', 'f')`,
      [u],
    );
    await t.db.query(`delete from users where id = $1`, [u]);
    expect(
      (await t.db.query(`select count(*)::int as n from saved_games where user_id = $1`, [u]))
        .rows[0].n,
    ).toBe(0);
  });

  it('rolls back a failing migration and reports it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig-'));
    writeFileSync(join(dir, '0001_a.sql'), 'create table mig_ok (id int);');
    writeFileSync(
      join(dir, '0002_b.sql'),
      'create table mig_half (id int); select * from does_not_exist;',
    );
    await expect(migrate(t.db, dir)).rejects.toThrow(/0002_b.sql failed/);
    const names = (
      await t.db.query(`select table_name from information_schema.tables where table_schema = $1`, [
        t.schema,
      ])
    ).rows.map((r) => r.table_name);
    expect(names).toContain('mig_ok'); // first migration committed
    expect(names).not.toContain('mig_half'); // second rolled back entirely
  });

  it('serialises concurrent migrators', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig-'));
    writeFileSync(join(dir, '0001_x.sql'), 'create table mig_concurrent (id int);');
    const results = await Promise.allSettled([
      migrate(t.db, dir),
      migrate(t.db, dir),
      migrate(t.db, dir),
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const applied = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
    expect(applied).toEqual(['0001_x.sql']); // applied exactly once
  });
});

describe('defaultMigrationsDir', () => {
  it('resolves the same directory from the source layout and from the bundled layout', async () => {
    const { defaultMigrationsDir } = await import('../src/infrastructure/migrate.js');
    const root = '/srv/app/apps/server';
    expect(defaultMigrationsDir(`file://${root}/src/infrastructure/migrate.ts`)).toBe(
      `${root}/migrations/`,
    );
    expect(defaultMigrationsDir(`file://${root}/dist/main.js`)).toBe(`${root}/migrations/`);
    expect(defaultMigrationsDir()).toMatch(/apps\/server\/migrations\/$/); // the real one, from the test run
  });
});
