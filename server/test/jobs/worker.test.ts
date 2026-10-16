import { describe, expect, it, vi } from 'vitest';
import { enqueue } from '../../src/jobs/queue.js';
import { runWorkerOnce, startWorker } from '../../src/jobs/worker.js';
import { makeTestDb } from '../helpers.js';

const T0 = new Date('2026-01-01T00:00:00Z');
const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const stateOf = async (db: Awaited<ReturnType<typeof makeTestDb>>, id: number) =>
  (await db.query<{ state: string; last_error: string | null }>('select state, last_error from jobs where id=$1', [id])).rows[0]!;

describe('runWorkerOnce', () => {
  it('returns false when nothing is due', async () => {
    const db = await makeTestDb();
    expect(await runWorkerOnce({ db, handlers: {}, now: () => T0, logger: logger() })).toBe(false);
  });

  it('runs the handler then marks done', async () => {
    const db = await makeTestDb();
    const id = await enqueue(db, 'a', { k: 1 }, { runAt: T0 });
    const handler = vi.fn(async () => {});
    expect(await runWorkerOnce({ db, handlers: { a: handler }, now: () => T0, logger: logger() })).toBe(true);
    expect(handler).toHaveBeenCalledWith({ id, type: 'a', payload: { k: 1 }, attempts: 1 });
    expect((await stateOf(db, id)).state).toBe('done');
  });

  it('requeues a throwing handler without logging the payload', async () => {
    const db = await makeTestDb();
    const id = await enqueue(db, 'a', { secret: 'S3CRET' }, { runAt: T0 });
    const log = logger();
    await runWorkerOnce({ db, handlers: { a: async () => { throw new Error('nope'); } }, now: () => T0, logger: log });
    const s = await stateOf(db, id);
    expect(s.state).toBe('queued');
    expect(s.last_error).toBe('Error: nope');
    expect(JSON.stringify([log.info.mock.calls, log.warn.mock.calls, log.error.mock.calls])).not.toContain('S3CRET');
  });

  it('warns and fails after the last attempt', async () => {
    const db = await makeTestDb();
    const id = await enqueue(db, 'a', {}, { runAt: T0 });
    await db.query('update jobs set attempts = 2 where id=$1', [id]);
    const log = logger();
    await runWorkerOnce({ db, handlers: { a: async () => { throw new Error('nope'); } }, now: () => T0, logger: log });
    expect((await stateOf(db, id)).state).toBe('failed');
    expect(log.warn).toHaveBeenCalled();
  });

  it('fails an unknown type permanently', async () => {
    const db = await makeTestDb();
    const id = await enqueue(db, 'mystery', {}, { runAt: T0 });
    await runWorkerOnce({ db, handlers: {}, now: () => T0, logger: logger() });
    const s = await stateOf(db, id);
    expect(s.state).toBe('failed');
    expect(s.last_error).toBe('UnknownJobType: mystery');
  });
});

describe('startWorker', () => {
  it('sleeps when idle and stops when aborted', async () => {
    const db = await makeTestDb();
    const ac = new AbortController();
    const sleeps: number[] = [];
    const sleep = async (ms: number) => {
      sleeps.push(ms);
      if (sleeps.length === 2) ac.abort();
    };
    await startWorker({ db, handlers: {}, now: () => T0, logger: logger(), sleep, signal: ac.signal });
    expect(sleeps).toEqual([1000, 1000]);
  });

  it('survives a DB error and keeps looping', async () => {
    const db = await makeTestDb();
    const ac = new AbortController();
    const log = logger();
    let n = 0;
    const flaky = { ...db, query: async () => { throw new Error('db down'); } } as typeof db;
    const sleep = async () => { if (++n === 2) ac.abort(); };
    await startWorker({ db: flaky, handlers: {}, now: () => T0, logger: log, sleep, signal: ac.signal, idleMs: 5 });
    expect(n).toBe(2);
    expect(log.error).toHaveBeenCalled();
  });

  it('processes queued jobs without sleeping between them', async () => {
    const db = await makeTestDb();
    const ac = new AbortController();
    await enqueue(db, 'a', {}, { runAt: T0 });
    await enqueue(db, 'a', {}, { runAt: T0 });
    let ran = 0;
    const sleep = async () => ac.abort();
    await startWorker({ db, handlers: { a: async () => { ran++; } }, now: () => T0, logger: logger(), sleep, signal: ac.signal });
    expect(ran).toBe(2);
  });
});
