import { describe, expect, it } from 'vitest';
import { claimNext, completeJob, enqueue, failJob, MAX_ATTEMPTS, RETRY_DELAY_MS } from '../../src/jobs/queue.js';
import { makeTestDb } from '../helpers.js';

const T0 = new Date('2026-01-01T00:00:00Z');

describe('job queue', () => {
  it('enqueue then claim returns the job with attempts 1; second claim is null', async () => {
    const db = await makeTestDb();
    const id = await enqueue(db, 'a', { x: 1 });
    expect(typeof id).toBe('number');
    const job = await claimNext(db, new Date(Date.now() + 1000));
    expect(job).toEqual({ id, type: 'a', payload: { x: 1 }, attempts: 1 });
    expect(await claimNext(db, new Date(Date.now() + 1000))).toBeNull();
  });

  it('does not claim a future runAt job until now passes it', async () => {
    const db = await makeTestDb();
    const runAt = new Date(T0.getTime() + 60_000);
    await enqueue(db, 'a', {}, { runAt });
    expect(await claimNext(db, T0)).toBeNull();
    expect(await claimNext(db, runAt)).not.toBeNull();
  });

  it('claims oldest due job first', async () => {
    const db = await makeTestDb();
    const late = await enqueue(db, 'a', {}, { runAt: new Date(T0.getTime() + 10) });
    const early = await enqueue(db, 'a', {}, { runAt: T0 });
    const now = new Date(T0.getTime() + 1000);
    expect((await claimNext(db, now))?.id).toBe(early);
    expect((await claimNext(db, now))?.id).toBe(late);
  });

  it('completeJob marks done', async () => {
    const db = await makeTestDb();
    const id = await enqueue(db, 'a', {}, { runAt: T0 });
    await claimNext(db, T0);
    await completeJob(db, id);
    const r = await db.query<{ state: string }>('select state from jobs where id=$1', [id]);
    expect(r.rows[0]?.state).toBe('done');
  });

  it('failJob retries with backoff on attempt 1 and fails on MAX_ATTEMPTS', async () => {
    const db = await makeTestDb();
    const id = await enqueue(db, 'a', {}, { runAt: T0 });
    const job = (await claimNext(db, T0))!;
    expect(job.attempts).toBe(1);
    expect(await failJob(db, job, new TypeError('boom'), T0)).toBe('retry');
    const r = await db.query<{ state: string; run_at: Date; last_error: string }>(
      'select state, run_at, last_error from jobs where id=$1',
      [id],
    );
    expect(r.rows[0]?.state).toBe('queued');
    expect(new Date(r.rows[0]!.run_at).getTime()).toBe(T0.getTime() + RETRY_DELAY_MS);
    expect(r.rows[0]?.last_error).toBe('TypeError: boom');

    const last = { ...job, attempts: MAX_ATTEMPTS };
    expect(await failJob(db, last, new Error('x'.repeat(1000)), T0)).toBe('failed');
    const r2 = await db.query<{ state: string; last_error: string }>('select state, last_error from jobs where id=$1', [id]);
    expect(r2.rows[0]?.state).toBe('failed');
    expect(r2.rows[0]?.last_error.length).toBe(500);
  });
});
