import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import type { AppDeps } from '../app.js';
import { PayPalError } from '../paypal/client.js';
import { MissingHeadersError, verifyWebhook } from '../paypal/webhooks.js';

function tokenMatches(provided: string | undefined, expected: string): boolean {
  if (provided === undefined) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function str(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function webhookRoutes(deps: AppDeps): Router {
  const { config, paypal, eventLog } = deps;
  const logger = deps.logger ?? console;
  const router = Router();

  router.post('/webhooks/paypal', async (req, res) => {
    const webhookId = config.paypal.webhookId;
    if (webhookId === null) {
      res.status(503).json({ error: 'PAYPAL_WEBHOOK_ID not set' });
      return;
    }
    const body: unknown = req.body;
    const headers: Record<string, string | undefined> = {};
    for (const h of [
      'paypal-auth-algo',
      'paypal-cert-url',
      'paypal-transmission-id',
      'paypal-transmission-sig',
      'paypal-transmission-time',
    ]) {
      headers[h] = str(req.headers[h]);
    }

    let verified: boolean;
    try {
      verified = await verifyWebhook(paypal, webhookId, headers, body);
    } catch (err) {
      if (err instanceof MissingHeadersError) {
        res.status(400).json({ error: 'missing transmission headers' });
        return;
      }
      const detail =
        err instanceof PayPalError
          ? `status=${err.status} name=${err.name} debug_id=${err.debugId ?? '-'}`
          : `name=${err instanceof Error ? err.name : typeof err}`;
      logger.warn(`webhook verification call failed: ${detail}`);
      res.status(500).json({ error: 'verification unavailable' });
      return;
    }
    if (!verified) {
      logger.warn('webhook signature verification failed');
      res.status(400).json({ error: 'signature verification failed' });
      return;
    }

    const ev = (body ?? {}) as { id?: unknown; event_type?: unknown; resource?: { id?: unknown } | null };
    if (typeof ev.id !== 'string') {
      res.status(400).json({ error: 'event id missing' });
      return;
    }
    const eventType = typeof ev.event_type === 'string' ? ev.event_type : 'unknown';
    const resourceId = typeof ev.resource?.id === 'string' ? ev.resource.id : null;
    const added = eventLog.add({
      id: ev.id,
      eventType,
      resourceId,
      receivedAt: new Date().toISOString(),
      raw: body,
    });
    logger.info(`webhook ${added ? 'received' : 'duplicate'}: ${eventType} ${resourceId ?? '-'}`);
    res.status(200).json({ received: true });
  });

  router.get('/debug/events', (req, res) => {
    const expected = config.debugToken;
    if (expected === null) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    if (!tokenMatches(str(req.headers['x-debug-token']), expected)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    res.json({ events: eventLog.list() });
  });

  return router;
}
