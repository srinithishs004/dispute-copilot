import type { Db } from '../db/db.js';

export type Job = { id: number; type: string; payload: unknown; attempts: number };

export const MAX_ATTEMPTS = 3;
export const RETRY_DELAY_MS = 30_000;
/** A running job not touched for this long is presumed orphaned by a crashed worker. */
export const LEASE_MS = 5 * 60_000;
const MAX_ERROR_LENGTH = 500;

export async function enqueue(
  db: Db,
  type: string,
  payload: unknown,
  opts: { runAt?: Date } = {},
): Promise<number> {
  const runAt = opts.runAt ?? new Date();
  const res = await db.query<{ id: number | string }>(
    'INSERT INTO jobs (type, payload, run_at) VALUES ($1, $2::jsonb, $3) RETURNING id',
    [type, JSON.stringify(payload) ?? 'null', runAt.toISOString()],
  );
  return Number(res.rows[0]!.id);
}

/**
 * Atomically moves the oldest due queued job (or a job whose worker lease expired)
 * to running and counts the attempt. Stale running jobs that already used all
 * attempts are failed first.
 */
export async function claimNext(db: Db, now: Date): Promise<Job | null> {
  const nowIso = now.toISOString();
  const staleBefore = new Date(now.getTime() - LEASE_MS).toISOString();
  await db.query(
    `UPDATE jobs SET state = 'failed', last_error = 'LeaseExpired: worker did not finish', updated_at = $1
     WHERE state = 'running' AND updated_at < $2 AND attempts >= $3`,
    [nowIso, staleBefore, MAX_ATTEMPTS],
  );
  const res = await db.query<{ id: number | string; type: string; payload: unknown; attempts: number }>(
    `UPDATE jobs SET state = 'running', attempts = attempts + 1, updated_at = $1
     WHERE id = (
       SELECT id FROM jobs
       WHERE (state = 'queued' AND run_at <= $1)
          OR (state = 'running' AND updated_at < $2)
       ORDER BY run_at, id
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     RETURNING id, type, payload, attempts`,
    [nowIso, staleBefore],
  );
  const row = res.rows[0];
  if (!row) return null;
  return { id: Number(row.id), type: row.type, payload: row.payload, attempts: row.attempts };
}

export async function completeJob(db: Db, id: number, now: Date): Promise<void> {
  await db.query("UPDATE jobs SET state = 'done', updated_at = $2 WHERE id = $1", [id, now.toISOString()]);
}

export async function failJob(
  db: Db,
  job: Job,
  err: Error,
  now: Date,
): Promise<'retry' | 'failed'> {
  const lastError = `${err.name}: ${err.message}`.slice(0, MAX_ERROR_LENGTH);
  if (job.attempts >= MAX_ATTEMPTS) {
    await db.query(
      "UPDATE jobs SET state = 'failed', last_error = $2, updated_at = $3 WHERE id = $1",
      [job.id, lastError, now.toISOString()],
    );
    return 'failed';
  }
  const runAt = new Date(now.getTime() + job.attempts * RETRY_DELAY_MS);
  await db.query(
    "UPDATE jobs SET state = 'queued', run_at = $2, last_error = $3, updated_at = $4 WHERE id = $1",
    [job.id, runAt.toISOString(), lastError, now.toISOString()],
  );
  return 'retry';
}

/** Marks a job failed immediately, regardless of attempts remaining. */
export async function failJobPermanently(db: Db, job: Job, lastError: string, now: Date): Promise<void> {
  await db.query(
    "UPDATE jobs SET state = 'failed', last_error = $2, updated_at = $3 WHERE id = $1",
    [job.id, lastError.slice(0, MAX_ERROR_LENGTH), now.toISOString()],
  );
}
