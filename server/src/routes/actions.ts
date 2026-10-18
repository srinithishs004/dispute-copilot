import { Router } from 'express';
import type { AppDeps } from '../app.js';
import { ActionConflictError, createPendingAction, type ActionPayload } from '../actions/repo.js';
import { claimForAction, upsertDispute } from '../disputes/repo.js';
import { enqueue } from '../jobs/queue.js';
import { maskId } from '../log.js';
import { allowedActions, getDispute, type DisputeAction } from '../paypal/disputes.js';
import { findOrderBundle } from '../store/repo.js';
import { makeRequireDebugToken } from './webhooks.js';

const ACTIONS: readonly DisputeAction[] = ['FIGHT', 'OFFER', 'ACCEPT'];
const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;
const NOTE_MIN = 20;
const NOTE_MAX = 2000;

/** "12.5" -> 1250. Callers must have matched AMOUNT_RE (or know the value is a PayPal decimal string). */
function toCents(v: string): number {
  const [whole = '0', frac = ''] = v.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0').slice(0, 2));
}

function fromCents(c: number): string {
  return `${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`;
}

type DisputeRow = {
  local_state: string;
  order_id: string | null;
  amount: string | null;
  currency: string | null;
};

class NotReadyError extends Error {
  override name = 'NotReadyError';
}

export function actionRoutes(deps: AppDeps): Router {
  const { db, config, paypal } = deps;
  const logger = deps.logger ?? console;
  const router = Router();
  const guard = makeRequireDebugToken(config);

  router.post('/api/disputes/:id/approve', guard, async (req, res) => {
    const id = String(req.params.id);
    const row = (
      await db.query<DisputeRow>(
        'select local_state, order_id, amount, currency from disputes where paypal_dispute_id = $1',
        [id],
      )
    ).rows[0];
    if (!row) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    if (row.local_state !== 'READY_FOR_REVIEW' && row.local_state !== 'NEEDS_MANUAL') {
      res.status(409).json({ error: 'not ready' });
      return;
    }

    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>;
    const action = ACTIONS.find((a) => a === body.action);
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (!action) {
      res.status(400).json({ error: 'action must be FIGHT, OFFER or ACCEPT' });
      return;
    }
    if (note.length < NOTE_MIN || note.length > NOTE_MAX) {
      res.status(400).json({ error: `note must be ${NOTE_MIN}-${NOTE_MAX} characters` });
      return;
    }
    let fresh;
    try {
      fresh = await getDispute(paypal, id);
    } catch {
      logger.warn(`approve: could not fetch dispute ${maskId(id)} from PayPal`);
      res.status(502).json({ error: 'could not reach PayPal' });
      return;
    }
    await upsertDispute(db, fresh, row.order_id);
    const allowed = allowedActions(fresh);
    const ok = action === 'FIGHT' ? allowed.fight : action === 'OFFER' ? allowed.offer : allowed.accept;
    if (!ok) {
      logger.info(`approve: ${action} not allowed now for dispute ${maskId(id)}`);
      res.status(409).json({ error: 'action not allowed now', allowed });
      return;
    }

    let offerAmount: string | undefined;
    if (action === 'OFFER') {
      const raw = body.offerAmount;
      if (typeof raw !== 'string' || !AMOUNT_RE.test(raw)) {
        res.status(400).json({ error: 'offerAmount must be a decimal string with up to 2 decimals' });
        return;
      }
      const cents = toCents(raw);
      const disputed = fresh.dispute_amount?.value ?? row.amount;
      if (disputed == null || cents <= 0 || cents >= toCents(String(disputed))) {
        res.status(400).json({ error: 'offerAmount must be greater than 0 and less than the disputed amount' });
        return;
      }
      offerAmount = fromCents(cents);
    }

    const payload: ActionPayload = { note, currency: row.currency ?? fresh.dispute_amount?.currency_code ?? 'USD' };
    if (offerAmount !== undefined) payload.offerAmount = offerAmount;
    if (action === 'FIGHT' && row.order_id) {
      const bundle = await findOrderBundle(db, row.order_id);
      const tracking = (bundle?.shipments ?? []).flatMap((s) =>
        s.trackingNumber && s.carrier ? [{ carrier: s.carrier, number: s.trackingNumber }] : [],
      );
      if (tracking.length > 0) payload.tracking = tracking;
    }

    try {
      const actionId = await db.transaction(async (tx) => {
        if (!(await claimForAction(tx, id))) throw new NotReadyError();
        const aid = await createPendingAction(tx, id, action, payload, new Date());
        await enqueue(tx, 'executeAction', { actionId: aid });
        return aid;
      });
      logger.info(`approve: ${action} queued for dispute ${maskId(id)} action=${actionId}`);
      res.status(202).json({ actionId, state: 'PENDING' });
    } catch (err) {
      if (err instanceof NotReadyError) {
        res.status(409).json({ error: 'not ready' });
        return;
      }
      if (err instanceof ActionConflictError) {
        res.status(409).json({ error: 'action already pending' });
        return;
      }
      throw err;
    }
  });

  return router;
}
