import type { AppDeps } from '../src/app.js';
import type { Config } from '../src/config.js';
import { createEventLog } from '../src/webhooks/eventLog.js';
import { createDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { fakeClient } from './paypal/fake.js';

export const testConfig: Config = {
  port: 3000,
  paypal: {
    clientId: 'id',
    clientSecret: 'sec',
    baseUrl: 'https://api-m.sandbox.paypal.com',
    webhookId: 'WH-TEST',
  },
  debugToken: 'dbg',
  databaseUrl: null,
  pgliteDir: '.data/pglite',
  publicBaseUrl: 'http://localhost:3000',
};

/** Stub for tests that never touch the database: any use fails loudly, with no PGlite startup cost. */
const noDb: Db = {
  query: () => Promise.reject(new Error('db not provided in test')),
  exec: () => Promise.reject(new Error('db not provided in test')),
  transaction: () => Promise.reject(new Error('db not provided in test')),
  close: () => Promise.resolve(),
};

export function makeTestDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  return {
    db: noDb,
    config: testConfig,
    paypal: fakeClient({ verification_status: 'SUCCESS' }).client,
    eventLog: createEventLog(),
    logger: { info: () => {}, warn: () => {} },
    ...overrides,
  };
}

/** In-memory PGlite database with all migrations applied. */
export async function makeTestDb(): Promise<Db> {
  const db = await createDb({ databaseUrl: null, pgliteDir: null });
  await migrate(db);
  return db;
}
