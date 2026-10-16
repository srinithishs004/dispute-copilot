import { afterEach, expect, test } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, type Db } from '../../src/db/db.js';
import { migrate } from '../../src/db/migrate.js';
import { loadConfig } from '../../src/config.js';

const TABLES = [
  'orders', 'shipments', 'messages', 'store_policy', 'webhook_events', 'disputes',
  'evidence_items', 'analyses', 'actions', 'jobs', 'schema_migrations',
];

let db: Db | undefined;
afterEach(async () => {
  await db?.close();
  db = undefined;
});

test('migrate applies 001_init.sql once and creates every table', async () => {
  db = await createDb({ databaseUrl: null, pgliteDir: null });
  expect(await migrate(db)).toEqual(['001_init.sql']);
  const { rows } = await db.query<{ table_name: string }>(
    `select table_name from information_schema.tables where table_schema = 'public'`,
  );
  const names = rows.map((r) => r.table_name);
  for (const t of TABLES) expect(names).toContain(t);
  expect(await migrate(db)).toEqual([]);
});

test('a failing migration rolls back and names the file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mig-'));
  writeFileSync(join(dir, '001_ok.sql'), 'create table t1 (id int);');
  writeFileSync(join(dir, '002_bad.sql'), 'create table t2 (id int); select nope from missing;');
  db = await createDb({ databaseUrl: null, pgliteDir: null });
  await expect(migrate(db, dir)).rejects.toThrow(/002_bad\.sql/);
  const { rows } = await db.query<{ name: string }>('select name from schema_migrations');
  expect(rows.map((r) => r.name)).toEqual(['001_ok.sql']);
  const t = await db.query(`select 1 from information_schema.tables where table_name = 't2'`);
  expect(t.rows).toHaveLength(0);
});

test('loadConfig defaults databaseUrl and pgliteDir', () => {
  const c = loadConfig({ PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 's' });
  expect(c.databaseUrl).toBeNull();
  expect(c.pgliteDir).toBe('.data/pglite');
  const c2 = loadConfig({
    PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 's', DATABASE_URL: 'postgres://x/y', PGLITE_DIR: '',
  });
  expect(c2.databaseUrl).toBe('postgres://x/y');
  expect(c2.pgliteDir).toBe('.data/pglite');
});
