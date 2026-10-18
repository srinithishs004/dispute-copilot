import type { Db } from '../db/db.js';
import type { PayPalClient } from '../paypal/client.js';
import { getDispute } from '../paypal/disputes.js';
import { findOrderBundle } from '../store/repo.js';
import { buildEvidencePack } from '../agent/evidence.js';
import {
  ADVANCED_STATES,
  getLocalState,
  matchOrderId,
  setLocalState,
  setLocalStateIf,
  upsertDispute,
} from '../disputes/repo.js';
import { enqueue } from './queue.js';
import type { JobHandler } from './worker.js';

/** Gives the UPDATED webhook (~20 s after CREATED) time to refresh evidence before drafting. */
const DRAFT_DELAY_MS = 60_000;

export interface ProcessDisputeDeps {
  db: Db;
  paypal: PayPalClient;
  now: () => Date;
}

export function processDispute(deps: ProcessDisputeDeps): JobHandler {
  const { db, paypal, now } = deps;
  return async (job) => {
    const disputeId = (job.payload as { disputeId?: unknown } | null)?.disputeId;
    if (typeof disputeId !== 'string' || !disputeId) throw new Error('processDispute: payload.disputeId missing');

    // Never trust the webhook body: always re-fetch.
    const detail = await getDispute(paypal, disputeId);
    await db.transaction(async (tx) => {
      const orderId = await matchOrderId(tx, detail);
      const bundle = orderId ? await findOrderBundle(tx, orderId) : null;
      await upsertDispute(tx, detail, orderId);
      const current = await getLocalState(tx, detail.dispute_id);
      let advanced = current != null && ADVANCED_STATES.includes(current);
      const closed = detail.status === 'RESOLVED';

      if (!bundle) {
        if (closed) {
          if (current !== 'RESOLVED') await setLocalState(tx, detail.dispute_id, 'RESOLVED');
          return;
        }
        if (!advanced) await setLocalState(tx, detail.dispute_id, 'NEEDS_MANUAL', 'no matching order');
        return;
      }

      // The buyer declined our offer / replied: PayPal hands the case back, so analyse it again.
      if (
        current === 'ACTION_SENT' &&
        detail.status === 'WAITING_FOR_SELLER_RESPONSE' &&
        (await setLocalStateIf(tx, detail.dispute_id, 'ACTION_SENT', 'ANALYZING'))
      ) {
        advanced = false;
      } else if (!advanced && !closed) {
        await setLocalState(tx, detail.dispute_id, 'ANALYZING');
      }
      const pack = buildEvidencePack(detail, bundle);
      await tx.query('delete from evidence_items where dispute_id = $1', [detail.dispute_id]);
      for (const f of pack.facts) {
        await tx.query(
          'insert into evidence_items (dispute_id, type, description, file_path) values ($1, $2, $3, null)',
          [detail.dispute_id, f.id, `${f.label}: ${f.value}`],
        );
      }

      // Closed on PayPal's side: record it, never draft.
      if (closed) {
        if (current !== 'RESOLVED') await setLocalState(tx, detail.dispute_id, 'RESOLVED');
        return;
      }
      // Already reviewed or acted on: refresh evidence only, do not redraft.
      if (advanced) return;
      const pending = await tx.query(
        `select 1 from jobs where type in ('analyzeDispute','draftLetter') and state in ('queued','running')
           and payload->>'disputeId' = $1 limit 1`,
        [detail.dispute_id],
      );
      if (pending.rows.length === 0) await enqueue(tx, 'analyzeDispute', { disputeId: detail.dispute_id }, { runAt: new Date(now().getTime() + DRAFT_DELAY_MS) });
    });
  };
}
