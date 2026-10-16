import { timingSafeEqual } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { AppDeps } from '../app.js';
import { enqueue } from '../jobs/queue.js';
import { maskId } from '../log.js';
import { listDisputes } from '../paypal/disputes.js';
import { PayPalError } from '../paypal/client.js';
import { MissingHeadersError, verifyWebhook } from '../paypal/webhooks.js';
import { disputeIdFromEvent } from '../webhooks/disputeEvent.js';

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
  const { config, paypal, db } = deps;
  const logger = deps.logger ?? console;
  const router = Router();

  const requireDebugToken = (req: Request, res: Response, next: NextFunction): void => {
    const expected = config.debugToken;
    if (expected === null) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    if (!tokenMatches(str(req.headers['x-debug-token']), expected)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  };

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
    const eventId = ev.id;
    const eventType = typeof ev.event_type === 'string' ? ev.event_type : 'unknown';
    const disputeId = disputeIdFromEvent(body);
    const resourceId = disputeId ?? (typeof ev.resource?.id === 'string' ? ev.resource.id : null);
    // Event row and job commit together, so a crash cannot record the event without its job.
    const added = await db.transaction(async (tx) => {
      const ins = await tx.query(
        `INSERT INTO webhook_events (paypal_event_id, event_type, resource_id, raw)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (paypal_event_id) DO NOTHING
         RETURNING paypal_event_id`,
        [eventId, eventType, resourceId, JSON.stringify(body)],
      );
      if (ins.rows.length === 0) return false;
      if (disputeId !== null) await enqueue(tx, 'processDispute', { disputeId });
      return true;
    });
    logger.info(`webhook ${added ? 'received' : 'duplicate'}: ${eventType} ${maskId(disputeId)}`);
    res.status(200).json({ received: true });
  });

  router.get('/debug/events', requireDebugToken, async (_req, res) => {
    const rows = await db.query<{
      paypal_event_id: string;
      event_type: string;
      resource_id: string | null;
      received_at: Date | string;
      raw: unknown;
    }>(
      `SELECT paypal_event_id, event_type, resource_id, received_at, raw
       FROM webhook_events ORDER BY received_at DESC, paypal_event_id DESC LIMIT 50`,
    );
    res.json({
      events: rows.rows.map((r) => ({
        id: r.paypal_event_id,
        eventType: r.event_type,
        resourceId: r.resource_id,
        receivedAt: new Date(r.received_at).toISOString(),
        raw: r.raw,
      })),
    });
  });

  // Fallback when webhooks are slow: queue every recent dispute for (re)processing.
  router.post('/api/disputes/sync', requireDebugToken, async (_req, res) => {
    let disputes;
    try {
      disputes = await listDisputes(paypal, { pageSize: 20 });
    } catch (err) {
      const detail =
        err instanceof PayPalError
          ? `status=${err.status} name=${err.name} debug_id=${err.debugId ?? '-'}`
          : `name=${err instanceof Error ? err.name : typeof err}`;
      logger.warn(`dispute sync: PayPal request failed: ${detail}`);
      res.status(502).json({ error: 'PayPal request failed' });
      return;
    }
    await db.transaction(async (tx) => {
      for (const d of disputes) await enqueue(tx, 'processDispute', { disputeId: d.dispute_id });
    });
    logger.info(`dispute sync: queued ${disputes.length} (${disputes.map((d) => maskId(d.dispute_id)).join(' ')})`);
    res.json({ queued: disputes.length });
  });

  return router;
}
