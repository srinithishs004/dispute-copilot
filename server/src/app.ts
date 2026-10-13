import express from 'express';
import type { Config } from './config.js';
import type { PayPalClient } from './paypal/client.js';
import { webhookRoutes } from './routes/webhooks.js';
import type { EventLog } from './webhooks/eventLog.js';

export interface AppDeps {
  config: Config;
  paypal: PayPalClient;
  eventLog: EventLog;
  logger?: Pick<Console, 'info' | 'warn'>;
}

export function createApp(deps: AppDeps): express.Express {
  const app = express();
  app.use(express.json());
  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use(webhookRoutes(deps));
  return app;
}
