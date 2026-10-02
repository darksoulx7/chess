import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { migrate } from '../src/infrastructure/migrate.js';

const URL = process.env.DATABASE_URL ?? 'postgres://chess:chess@127.0.0.1:5432/chess';

export interface TestDb {
  db: pg.Pool;
  schema: string;
  drop(): Promise<void>;
}

/**
 * A migrated database confined to a private schema, so tests never touch (or depend on) dev data and
 * parallel test files cannot interfere with each other.
 */
export async function createTestDb(): Promise<TestDb> {
  const schema = `t_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const admin = new pg.Pool({ connectionString: URL, max: 1 });
  await admin.query(`create schema ${schema}`);
  await admin.end();
  const db = new pg.Pool({ connectionString: URL, max: 5, options: `-c search_path=${schema}` });
  await migrate(db);
  return {
    db,
    schema,
    async drop() {
      await db.end();
      const cleanup = new pg.Pool({ connectionString: URL, max: 1 });
      await cleanup.query(`drop schema ${schema} cascade`);
      await cleanup.end();
    },
  };
}
