import type { AppDeps } from '../src/app.js';
import type { Config } from '../src/config.js';
import { PGlite } from '@electric-sql/pglite';
import { wrapPglite, type Db } from '../src/db/db.js';
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
  llm: {
    gemini: { apiKey: null, model: 'gemini-3.6-flash' },
    groq: { apiKey: null, model: 'llama-3.3-70b-versatile' },
  },
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
    logger: { info: () => {}, warn: () => {} },
    ...overrides,
  };
}

let template: Promise<PGlite> | undefined;

/** Migrate once per process into a template PGlite; each test gets a cheap clone of it. */
function getTemplate(): Promise<PGlite> {
  template ??= (async () => {
    const lite = new PGlite();
    await lite.waitReady;
    await migrate(wrapPglite(lite));
    return lite;
  })();
  return template;
}

/** In-memory PGlite database with all migrations applied (an independent clone per call). */
export async function makeTestDb(): Promise<Db> {
  return wrapPglite(await (await getTemplate()).clone());
}
