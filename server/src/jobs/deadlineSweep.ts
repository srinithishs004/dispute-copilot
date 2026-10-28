import type { Db } from '../db/db.js';
import { enqueue } from './queue.js';
import type { JobHandler } from './worker.js';

export const SWEEP_INTERVAL_MS = 60 * 60_000;
const DUE_SOON_MS = 72 * 3600_000;

export interface DeadlineSweepDeps {
  db: Db;
  now: () => Date;
}

/** Enqueues a sweep at `runAt` unless one is already queued or running (other than `exceptJobId`). */
async function enqueueSweepIfNone(db: Db, runAt: Date, exceptJobId?: number): Promise<boolean> {
  return db.transaction(async (tx) => {
    // Serialise concurrent callers so two workers cannot both see "none" and both enqueue.
    await tx.query('select pg_advisory_xact_lock(727301)');
    const { rows } = await tx.query(
      `select 1 from jobs where type = 'deadlineSweep' and state in ('queued','running') and id <> $1 limit 1`,
      [exceptJobId ?? -1],
    );
    if (rows.length > 0) return false;
    await enqueue(tx, 'deadlineSweep', {}, { runAt });
    return true;
  });
}

/** Startup hook: make sure the hourly sweep chain exists. */
export async function ensureDeadlineSweepQueued(db: Db, now: Date): Promise<boolean> {
  return enqueueSweepIfNone(db, now);
}

/** Flags open disputes `overdue` or `due_soon` (within 72 h), clears the flag otherwise, then schedules the next sweep in 1 h. */
export function deadlineSweepJob(deps: DeadlineSweepDeps): JobHandler {
  const { db, now } = deps;
  return async (job) => {
    const at = now();
    await db.query(
      `update disputes set deadline_flag = case
         when local_state = 'RESOLVED' or response_due_at is null then null
         when response_due_at < $1::timestamptz then 'overdue'
         when response_due_at <= $2::timestamptz then 'due_soon'
         else null end
       where deadline_flag is distinct from (case
         when local_state = 'RESOLVED' or response_due_at is null then null
         when response_due_at < $1::timestamptz then 'overdue'
         when response_due_at <= $2::timestamptz then 'due_soon'
         else null end)`,
      [at.toISOString(), new Date(at.getTime() + DUE_SOON_MS).toISOString()],
    );
    await enqueueSweepIfNone(db, new Date(at.getTime() + SWEEP_INTERVAL_MS), job.id);
  };
}
