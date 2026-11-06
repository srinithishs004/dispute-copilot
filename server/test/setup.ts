import { afterAll, afterEach } from 'vitest';
import { closeTestDbs } from './helpers.js';

// Each PGlite clone is a separate WASM Postgres; release them when a test file finishes.
afterEach(async () => {
  await closeTestDbs();
});

afterAll(async () => {
  await closeTestDbs();
});
