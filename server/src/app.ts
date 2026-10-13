import express from 'express';
import type { Config } from './config.js';

export interface AppDeps {
  config: Config;
}

export function createApp(_deps: AppDeps): express.Express {
  const app = express();
  app.use(express.json());
  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}
