import type { Db } from '../db/db.js';
import { listAllDisputes } from '../paypal/disputes.js';
import type { PayPalClient } from '../paypal/client.js';
import { enqueue } from './queue.js';
import type { JobHandler } from './worker.js';

/** PayPal sandbox webhooks can take many minutes, so we also look for new disputes ourselves. */
export const DISPUTE_SYNC_INTERVAL_MS = 60_000;

export interface DisputeSyncDeps {
  db: Db;
  paypal: PayPalClient;
  now: () => Date;
  logger?: Pick<Console, 'warn'>;
}

/** Enqueues a sync at `runAt` unless one is already queued or running (other than `exceptJobId`). */
async function enqueueSyncIfNone(db: Db, runAt: Date, exceptJobId?: number): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.query('select pg_advisory_xact_lock(727302)');
    const { rows } = await tx.query(
      `select 1 from jobs where type = 'disputeSync' and state in ('queued','running') and id <> $1 limit 1`,
      [exceptJobId ?? -1],
    );
    if (rows.length > 0) return false;
    await enqueue(tx, 'disputeSync', {}, { runAt });
    return true;
  });
}

/** Startup hook: make sure the one-minute sync chain exists. */
export function ensureDisputeSyncQueued(db: Db, now: Date): Promise<boolean> {
  return enqueueSyncIfNone(db, now);
}

/**
 * Lists recent disputes from PayPal and queues processDispute for any we have not seen, or whose
 * PayPal status changed since we stored it. The next run is scheduled first, so a PayPal outage
 * never breaks the chain.
 */
export function disputeSyncJob(deps: DisputeSyncDeps): JobHandler {
  const { db, paypal, now } = deps;
  return async (job) => {
    await enqueueSyncIfNone(db, new Date(now().getTime() + DISPUTE_SYNC_INTERVAL_MS), job.id);
    let listed;
    try {
      listed = await listAllDisputes(paypal, { pageSize: 20 });
    } catch (err) {
      deps.logger?.warn(`dispute sync skipped: ${err instanceof Error ? err.name : 'Error'}`);
      return;
    }
    if (listed.length === 0) return;
    const known = new Map(
      (
        await db.query<{ id: string; status: string | null }>(
          'select paypal_dispute_id id, status from disputes where paypal_dispute_id = any($1::text[])',
          [listed.map((d) => d.dispute_id)],
        )
      ).rows.map((r) => [r.id, r.status]),
    );
    const changed = listed.filter((d) => !known.has(d.dispute_id) || known.get(d.dispute_id) !== d.status);
    if (changed.length === 0) return;
    await db.transaction(async (tx) => {
      for (const d of changed) await enqueue(tx, 'processDispute', { disputeId: d.dispute_id });
    });
  };
}
