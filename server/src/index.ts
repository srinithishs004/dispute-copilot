import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db/db.js';
import { migrate } from './db/migrate.js';
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

  createApp({ config, paypal, db }).listen(config.port, () => {
    console.log(`Dispute Copilot listening on port ${config.port}`);
  });
}

// Startup failures print one line (no stack, no secrets) and exit 1.
main().catch((err: unknown) => {
  const name = err instanceof Error ? err.name : 'Error';
  const message = err instanceof Error ? err.message.split('\n')[0] : 'startup failed';
  console.error(`startup failed: ${name}: ${message}`);
  process.exit(1);
});
