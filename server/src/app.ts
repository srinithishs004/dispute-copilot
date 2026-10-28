import express, { type NextFunction, type Request, type Response } from 'express';
import type { Db } from './db/db.js';
import type { Config } from './config.js';
import type { PayPalClient } from './paypal/client.js';
import { authRoutes } from './auth/routes.js';
import { actionRoutes } from './routes/actions.js';
import { agentRoutes } from './routes/agent.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { disputeRoutes } from './routes/disputes.js';
import { storeRoutes } from './routes/store.js';
import { webhookRoutes } from './routes/webhooks.js';

export interface AppDeps {
  config: Config;
  paypal: PayPalClient;
  db: Db;
  logger?: Pick<Console, 'info' | 'warn'>;
  /** Epoch-ms clock for sessions and the login rate limit; tests inject it. */
  now?: () => number;
  /** fetch for request-time LLM calls (the agent proxy); tests inject a fake. */
  llmFetch?: typeof fetch;
}

// Reserved for future webhook signature debugging; not read anywhere yet.
export interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

interface HttpError {
  type?: unknown;
  status?: unknown;
}

export function createApp(deps: AppDeps): express.Express {
  const app = express();
  const logger = deps.logger ?? console;
  app.set('trust proxy', deps.config.trustProxy);
  // Before the global JSON parser: agent turns carry up to 512 KB and parse after auth.
  app.use(agentRoutes(deps));
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as RawBodyRequest).rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: false }));
  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use(authRoutes(deps));
  app.use(webhookRoutes(deps));
  app.use(disputeRoutes(deps));
  app.use(actionRoutes(deps));
  app.use(dashboardRoutes(deps));
  app.use(storeRoutes(deps));
  // Final error handler: JSON only, and never log the request body or the stack.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const e = (typeof err === 'object' && err !== null ? err : {}) as HttpError;
    const type = typeof e.type === 'string' ? e.type : 'unknown';
    const status = typeof e.status === 'number' ? e.status : 500;
    logger.warn(`request error: type=${type} status=${status}`);
    if (type === 'entity.parse.failed') {
      res.status(400).json({ error: 'invalid JSON' });
      return;
    }
    res.status(status).json({ error: 'internal error' });
  });
  return app;
}
