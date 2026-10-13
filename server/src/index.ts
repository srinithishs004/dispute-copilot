import { createApp } from './app.js';
import { loadConfig, type Config } from './config.js';
import { createPayPalClient } from './paypal/client.js';
import { createEventLog } from './webhooks/eventLog.js';

let config: Config;
try {
  config = loadConfig(process.env);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const paypal = createPayPalClient({
  clientId: config.paypal.clientId,
  clientSecret: config.paypal.clientSecret,
  baseUrl: config.paypal.baseUrl,
});

createApp({ config, paypal, eventLog: createEventLog() }).listen(config.port, () => {
  console.log(`Dispute Copilot listening on port ${config.port}`);
});
