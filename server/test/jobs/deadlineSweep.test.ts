import { afterEach, describe, expect, it } from 'vitest';
import { deadlineSweepJob, ensureDeadlineSweepQueued } from '../../src/jobs/deadlineSweep.js';
import { enqueue } from '../../src/jobs/queue.js';
import { makeTestDb } from '../helpers.js';

const opened: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((d) => d.close()));
});

const NOW = new Date('2026-10-28T12:00:00Z');
const hours = (h: number) => new Date(NOW.getTime() + h * 3600_000).toISOString();

async function setup() {
  const db = await makeTestDb();
  opened.push(db);
  const add = (id: string, due: string | null, state = 'READY_FOR_REVIEW') =>
    db.query('insert into disputes (paypal_dispute_id, response_due_at, local_state) values ($1,$2,$3)', [id, due, state]);
  const flags = async () =>
    Object.fromEntries(
      (await db.query<{ id: string; f: string | null }>('select paypal_dispute_id id, deadline_flag f from disputes')).rows.map(
        (r) => [r.id, r.f],
      ),
    );
  return { db, add, flags };
}

describe('deadlineSweepJob', () => {
  it('flags overdue and due_soon (71 h) and leaves later or undated disputes unflagged', async () => {
    const { db, add, flags } = await setup();
    await add('past', hours(-1));
    await add('h71', hours(71));
    await add('h73', hours(73));
    await add('none', null);
    const job = { id: 1, type: 'deadlineSweep', payload: {}, attempts: 1 };
    await deadlineSweepJob({ db, now: () => NOW })(job);
    expect(await flags()).toEqual({ past: 'overdue', h71: 'due_soon', h73: null, none: null });
  });

  it('clears the flag for RESOLVED disputes and for ones whose due date moved out', async () => {
    const { db, add, flags } = await setup();
    await add('done', hours(-5), 'RESOLVED');
    await add('moved', hours(200));
    await db.query("update disputes set deadline_flag = 'overdue'");
    await deadlineSweepJob({ db, now: () => NOW })({ id: 1, type: 'deadlineSweep', payload: {}, attempts: 1 });
    expect(await flags()).toEqual({ done: null, moved: null });
  });

  it('reschedules exactly one job at now + 1 h', async () => {
    const { db } = await setup();
    const id = await enqueue(db, 'deadlineSweep', {});
    await db.query("update jobs set state = 'running' where id = $1", [id]);
    const job = { id, type: 'deadlineSweep', payload: {}, attempts: 1 };
    await deadlineSweepJob({ db, now: () => NOW })(job);
    await deadlineSweepJob({ db, now: () => NOW })(job);
    const { rows } = await db.query<{ run_at: Date }>(
      "select run_at from jobs where type = 'deadlineSweep' and state = 'queued'",
    );
    expect(rows).toHaveLength(1);
    expect(new Date(rows[0]!.run_at).toISOString()).toBe(hours(1));
  });

  it('does not reschedule when another sweep is already queued', async () => {
    const { db } = await setup();
    const id = await enqueue(db, 'deadlineSweep', {});
    await db.query("update jobs set state = 'running' where id = $1", [id]);
    await enqueue(db, 'deadlineSweep', {}, { runAt: new Date(NOW.getTime() + 1000) });
    await deadlineSweepJob({ db, now: () => NOW })({ id, type: 'deadlineSweep', payload: {}, attempts: 1 });
    const { rows } = await db.query("select 1 from jobs where type = 'deadlineSweep' and state = 'queued'");
    expect(rows).toHaveLength(1);
  });
});

describe('ensureDeadlineSweepQueued', () => {
  it('enqueues when none exists and is a no-op when one is queued', async () => {
    const { db } = await setup();
    expect(await ensureDeadlineSweepQueued(db, NOW)).toBe(true);
    expect(await ensureDeadlineSweepQueued(db, NOW)).toBe(false);
    const { rows } = await db.query("select 1 from jobs where type = 'deadlineSweep' and state = 'queued'");
    expect(rows).toHaveLength(1);
  });
});
