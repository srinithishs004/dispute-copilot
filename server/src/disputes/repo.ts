import type { Db } from '../db/db.js';
import type { DisputeDetail } from '../paypal/disputes.js';
import { findOrderByCaptureId } from '../store/repo.js';

export type LocalState =
  | 'NEW'
  | 'ANALYZING'
  | 'READY_FOR_REVIEW'
  | 'ACTION_PENDING'
  | 'ACTION_SENT'
  | 'RESOLVED'
  | 'NEEDS_MANUAL';

/** States a re-sync must never move a dispute out of. */
export const ADVANCED_STATES: readonly LocalState[] = [
  'READY_FOR_REVIEW',
  'ACTION_PENDING',
  'ACTION_SENT',
  'RESOLVED',
];

/**
 * Inserts or refreshes the PayPal-owned columns. `local_state` is only set on insert (default NEW),
 * so a re-sync never moves it. `raw` keeps the whole payload, including allowed_response_options.
 */
export async function upsertDispute(db: Db, detail: DisputeDetail, orderId: string | null): Promise<void> {
  await db.query(
    `insert into disputes (paypal_dispute_id, order_id, reason, status, stage, amount, currency, response_due_at, raw)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     on conflict (paypal_dispute_id) do update set
       order_id = coalesce(excluded.order_id, disputes.order_id),
       reason = excluded.reason,
       status = excluded.status,
       stage = excluded.stage,
       amount = excluded.amount,
       currency = excluded.currency,
       response_due_at = excluded.response_due_at,
       raw = excluded.raw,
       updated_at = now()`,
    [
      detail.dispute_id,
      orderId,
      detail.reason,
      detail.status,
      detail.dispute_life_cycle_stage ?? null,
      detail.dispute_amount?.value ?? null,
      detail.dispute_amount?.currency_code ?? null,
      detail.seller_response_due_date ?? null,
      JSON.stringify(detail),
    ],
  );
}

export async function getLocalState(db: Db, disputeId: string): Promise<LocalState | null> {
  const { rows } = await db.query<{ local_state: LocalState }>(
    'select local_state from disputes where paypal_dispute_id = $1',
    [disputeId],
  );
  return rows[0]?.local_state ?? null;
}

export async function setLocalState(
  db: Db,
  disputeId: string,
  state: LocalState,
  manualReason?: string,
): Promise<void> {
  await db.query(
    `update disputes set local_state = $2, manual_reason = $3, updated_at = now() where paypal_dispute_id = $1`,
    [disputeId, state, manualReason ?? null],
  );
}

/** Primary: disputed_transactions[*].invoice_number is our order id. Fallback: seller_transaction_id is our capture id. */
export async function matchOrderId(db: Db, detail: DisputeDetail): Promise<string | null> {
  const txs = detail.disputed_transactions ?? [];
  for (const t of txs) {
    if (!t.invoice_number) continue;
    const { rows } = await db.query('select 1 from orders where id = $1', [t.invoice_number]);
    if (rows.length > 0) return t.invoice_number;
  }
  for (const t of txs) {
    if (!t.seller_transaction_id) continue;
    const order = await findOrderByCaptureId(db, t.seller_transaction_id);
    if (order) return order.id;
  }
  return null;
}

/** Atomically moves a dispute to ACTION_PENDING only if it is still READY_FOR_REVIEW or NEEDS_MANUAL. Returns false when another request got there first. */
export async function claimForAction(tx: Db, disputeId: string): Promise<boolean> {
  const { rows } = await tx.query(
    `update disputes set local_state = 'ACTION_PENDING', manual_reason = null, updated_at = now()
     where paypal_dispute_id = $1 and local_state in ('READY_FOR_REVIEW', 'NEEDS_MANUAL') returning 1`,
    [disputeId],
  );
  return rows.length > 0;
}

/** Moves a dispute from `from` to `to` only if it is still in `from`. Returns false when it had already moved on. */
export async function setLocalStateIf(
  db: Db,
  disputeId: string,
  from: LocalState,
  to: LocalState,
  manualReason?: string,
): Promise<boolean> {
  const res = await db.query(
    `update disputes set local_state = $3, manual_reason = $4, updated_at = now()
     where paypal_dispute_id = $1 and local_state = $2 returning 1`,
    [disputeId, from, to, manualReason ?? null],
  );
  return res.rows.length > 0;
}
