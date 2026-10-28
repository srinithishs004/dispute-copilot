import { afterEach, expect, test } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

test('migrate applies migrations once and creates every table', async () => {
  db = await createDb({ databaseUrl: null, pgliteDir: null });
  expect(await migrate(db)).toEqual(['001_init.sql', '002_phase2.sql', '003_phase3.sql']);
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

test('createDb creates a missing nested pgliteDir', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pgl-'));
  try {
    const dir = join(root, 'a', 'b', 'pglite');
    db = await createDb({ databaseUrl: null, pgliteDir: dir });
    await migrate(db);
    expect(existsSync(dir)).toBe(true);
    await db.close();
    db = undefined;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('003 backfills original_amount from the PayPal transaction, else the current amount', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mig-'));
  const src = new URL('../../src/db/migrations/', import.meta.url);
  for (const f of ['001_init.sql', '002_phase2.sql']) {
    writeFileSync(join(dir, f), readFileSync(new URL(f, src), 'utf8'));
  }
  db = await createDb({ databaseUrl: null, pgliteDir: null });
  expect(await migrate(db, dir)).toEqual(['001_init.sql', '002_phase2.sql']);
  const ins = (id: string, raw: unknown) =>
    db!.query('insert into disputes (paypal_dispute_id, amount, raw) values ($1, 12.50, $2::jsonb)', [id, JSON.stringify(raw)]);
  await ins('with-gross', { disputed_transactions: [{ gross_amount: { value: '25.00' } }] });
  await ins('no-gross', {});
  await ins('bad-gross', { disputed_transactions: [{ gross_amount: { value: 'n/a' } }] });
  expect(await migrate(db)).toEqual(['003_phase3.sql']);
  const { rows } = await db.query<{ id: string; o: string }>(
    'select paypal_dispute_id id, original_amount::text o from disputes order by 1',
  );
  expect(Object.fromEntries(rows.map((r) => [r.id, r.o]))).toEqual({
    'with-gross': '25.00',
    'no-gross': '12.50',
    'bad-gross': '12.50',
  });
});
