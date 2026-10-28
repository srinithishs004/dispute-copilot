import { existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import express from 'express';

// Paths owned by the API; the single-page fallback never answers for these.
const SERVER_PREFIXES = ['/api', '/auth', '/webhooks', '/store', '/debug', '/health'];
const isServerPath = (path: string) => SERVER_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));

/**
 * Serve the built web app: static files, then index.html for client-side routes.
 * Call after all API routes. No built app on disk: log one line and serve nothing.
 */
export function serveWeb(app: express.Express, opts: { distDir: string; logger?: Pick<Console, 'info'> }): boolean {
  const { distDir, logger = console } = opts;
  const indexHtml = join(distDir, 'index.html');
  if (!existsSync(indexHtml)) {
    logger.info('web app not served: no build found');
    return false;
  }
  app.use(
    express.static(distDir, {
      index: false,
      maxAge: '1h',
      setHeaders(res, file) {
        if (relative(distDir, file).split(sep)[0] === 'assets') {
          // Vite fingerprints asset names, so they never change.
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );
  app.get(/.*/, (req, res, next) => {
    if (isServerPath(req.path) || req.path.startsWith('/assets/') || !req.accepts('html')) {
      next();
      return;
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexHtml);
  });
  return true;
}
