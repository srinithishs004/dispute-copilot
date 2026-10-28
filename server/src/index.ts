import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createLlm } from './ai/llm.js';
import { loadConfig } from './config.js';
import { createDb } from './db/db.js';
import { migrate } from './db/migrate.js';
import { buildHandlers } from './jobs/handlers.js';
import { ensureDeadlineSweepQueued } from './jobs/deadlineSweep.js';
import { abortableSleep } from './jobs/sleep.js';
import { startWorker } from './jobs/worker.js';
import { createPayPalClient } from './paypal/client.js';
import { seedStore } from './store/seed.js';

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const db = await createDb({ databaseUrl: config.databaseUrl, pgliteDir: config.pgliteDir });
  await migrate(db);
  await seedStore(db);

  const paypal = createPayPalClient({
    clientId: config.paypal.clientId,
    clientSecret: config.paypal.clientSecret,
    baseUrl: config.paypal.baseUrl,
  });
  const llm = createLlm({ ...config.llm });

  const server = createApp({ config, paypal, db, webDistDir: fileURLToPath(new URL('./web/', import.meta.url)) }).listen(config.port, () => {
    console.log(`Dispute Copilot listening on port ${config.port}`);
  });
  // Listen failures (e.g. EADDRINUSE) arrive as events, not rejections.
  server.on('error', (err: Error) => {
    console.error(`startup failed: ${err.name}: ${err.message.split('\n')[0]}`);
    process.exit(1);
  });

  await ensureDeadlineSweepQueued(db, new Date());

  const abort = new AbortController();
  let workerLoop: Promise<void> = Promise.resolve();
  if (config.runWorkerInline) {
    workerLoop = startWorker({
      db,
      handlers: buildHandlers({ db, paypal, llm, now: () => new Date(), storeName: config.storeName, logger: console }),
      now: () => new Date(),
      logger: console,
      signal: abort.signal,
      sleep: (ms) => abortableSleep(ms, abort.signal),
    });
    console.log('Job worker running inline');
  }

  let stopping = false;
  const shutdown = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    abort.abort();
    let code = 0;
    try {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections();
      });
      await workerLoop;
      await db.close();
    } catch (err) {
      console.error(`shutdown error: ${err instanceof Error ? err.name : 'Error'}`);
      code = 1;
    }
    process.exit(code);
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
}

// Startup failures print one line (no stack, no secrets) and exit 1.
main().catch((err: unknown) => {
  const name = err instanceof Error ? err.name : 'Error';
  const message = err instanceof Error ? err.message.split('\n')[0] : 'startup failed';
  console.error(`startup failed: ${name}: ${message}`);
  process.exit(1);
});
