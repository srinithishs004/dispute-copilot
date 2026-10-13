import { createApp } from './app.js';
import { loadConfig, type Config } from './config.js';

let config: Config;
try {
  config = loadConfig(process.env);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

createApp({ config }).listen(config.port, () => {
  console.log(`Dispute Copilot listening on port ${config.port}`);
});
