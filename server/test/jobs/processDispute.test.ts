import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { processDispute } from '../../src/jobs/processDispute.js';
import { setLocalState } from '../../src/disputes/repo.js';
import { seedStore } from '../../src/store/seed.js';
import type { DisputeDetail } from '../../src/paypal/disputes.js';
import { makeTestDb } from '../helpers.js';
import { fakeClient } from '../paypal/fake.js';

const inr = JSON.parse(
  readFileSync(new URL('../fixtures/dispute-inr-sandbox.json', import.meta.url), 'utf8'),
) as DisputeDetail;

async function setup(detail: DisputeDetail) {
  const db = await makeTestDb();
  await seedStore(db);
  const { client, calls } = fakeClient(detail);
  const run = () =>
    processDispute({ db, paypal: client, now: () => new Date('2026-10-15T00:00:00Z') })({
      id: 1,
      type: 'processDispute',
      payload: { disputeId: detail.dispute_id },
      attempts: 1,
    });
  return { db, run, calls };
}
const n = async (db: Awaited<ReturnType<typeof makeTestDb>>, sql: string) =>
  Number((await db.query<{ n: string }>(sql)).rows[0]!.n);

describe('processDispute', () => {
  it('syncs, links the order, stores evidence, sets ANALYZING, enqueues one draftLetter', async () => {
    const { db, run, calls } = await setup(inr);
    await run();
    expect(calls[0]!.path).toContain('PP-R-ICQ-00000001');
    const d = (await db.query<Record<string, unknown>>('select * from disputes')).rows;
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({
      order_id: 'DEMO-HIST-02',
      local_state: 'ANALYZING',
      stage: 'INQUIRY',
      currency: 'USD',
      reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
    });
    expect(Number(d[0]!.amount)).toBe(49);
    expect((d[0]!.raw as DisputeDetail).allowed_response_options).toBeDefined();
    const ev = await db.query<{ type: string; description: string; file_path: string | null }>(
      "select type, description, file_path from evidence_items where type = 'shipment.0.tracking'",
    );
    expect(ev.rows[0]).toEqual({
      type: 'shipment.0.tracking',
      description: 'Tracking number: 1Z999AA10123456784',
      file_path: null,
    });
    expect(await n(db, "select count(*) as n from jobs where type = 'draftLetter'")).toBe(1);
  });

  it('is idempotent: same evidence count and no second draftLetter while one is queued/running', async () => {
    const { db, run } = await setup(inr);
    await run();
    const count = await n(db, 'select count(*) as n from evidence_items');
    expect(count).toBeGreaterThan(0);
    await run();
    expect(await n(db, 'select count(*) as n from evidence_items')).toBe(count);
    expect(await n(db, "select count(*) as n from jobs where type = 'draftLetter'")).toBe(1);
    await db.query("update jobs set state = 'running'");
    await run();
    expect(await n(db, "select count(*) as n from jobs where type = 'draftLetter'")).toBe(1);
  });

  it('matches by capture id when the invoice is unknown', async () => {
    const detail = structuredClone(inr);
    detail.disputed_transactions![0]!.invoice_number = 'NOPE';
    const { db, run } = await setup(detail);
    await db.query("update orders set paypal_capture_id = 'CAPTURE0000000001' where id = 'DEMO-HIST-02'");
    await run();
    expect((await db.query<{ order_id: string }>('select order_id from disputes')).rows[0]!.order_id).toBe(
      'DEMO-HIST-02',
    );
  });

  it('unknown invoice and capture: NEEDS_MANUAL, no draftLetter', async () => {
    const detail = structuredClone(inr);
    detail.disputed_transactions![0]!.invoice_number = 'NOPE';
    const { db, run } = await setup(detail);
    await run();
    const d = (await db.query<Record<string, unknown>>('select * from disputes')).rows[0]!;
    expect(d).toMatchObject({ local_state: 'NEEDS_MANUAL', manual_reason: 'no matching order', order_id: null });
    expect(await n(db, "select count(*) as n from jobs where type = 'draftLetter'")).toBe(0);
  });

  it('keeps READY_FOR_REVIEW on re-sync', async () => {
    const { db, run } = await setup(inr);
    await run();
    await setLocalState(db, inr.dispute_id, 'READY_FOR_REVIEW');
    await db.query('delete from jobs');
    await run();
    expect((await db.query<{ local_state: string }>('select local_state from disputes')).rows[0]!.local_state).toBe(
      'READY_FOR_REVIEW',
    );
    expect(await n(db, "select count(*) as n from jobs where type = 'draftLetter'")).toBe(0);
  });
});
