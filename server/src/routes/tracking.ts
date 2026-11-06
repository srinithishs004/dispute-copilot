import { Router } from 'express';
import type { AppDeps } from '../app.js';
import { getTrackingView } from '../carrier/sandboxCarrier.js';
import { errorPage, trackLookupPage, trackingPage } from '../store/pages.js';

const NUMBER_RE = /^[A-Za-z0-9]{8,40}$/;

/** Public carrier tracking: a lookup page, one page per parcel, and a JSON feed. No buyer details. */
export function trackingRoutes(deps: AppDeps): Router {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  const router = Router();

  router.get('/track', (req, res) => {
    const n = typeof req.query.number === 'string' ? req.query.number.trim() : '';
    if (n) {
      res.redirect(303, `/track/${encodeURIComponent(n)}`);
      return;
    }
    res.type('text/html; charset=utf-8').send(trackLookupPage());
  });

  router.get('/track/:number', async (req, res) => {
    const number = req.params.number ?? '';
    const view = NUMBER_RE.test(number) ? await getTrackingView(db, number, new Date(now())) : null;
    if (!view) {
      res
        .status(404)
        .type('text/html; charset=utf-8')
        .send(trackLookupPage('We could not find that tracking number. Check it and try again.'));
      return;
    }
    res.type('text/html; charset=utf-8').send(trackingPage(view));
  });

  router.get('/api/tracking/:number', async (req, res) => {
    const number = req.params.number ?? '';
    const view = NUMBER_RE.test(number) ? await getTrackingView(db, number, new Date(now())) : null;
    if (!view) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(view);
  });

  // Keep errorPage imported for a future 5xx page; Express 5 forwards async errors to the final handler.
  void errorPage;
  return router;
}
