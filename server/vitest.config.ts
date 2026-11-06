import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30000,
    setupFiles: ['test/setup.ts'],
    // Every file boots PGlite (WASM Postgres). Unbounded parallel workers exhaust RAM on small machines.
    maxWorkers: 2,
  },
});
