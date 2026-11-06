import { afterEach, describe, expect, it } from 'vitest';
import { disputeSyncJob, ensureDisputeSyncQueued } from '../../src/jobs/disputeSync.js';
import type { PayPalClient } from '../../src/paypal/client.js';
import { makeTestDb } from '../helpers.js';

const opened: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((d) => d.close()));
});

const NOW = new Date('2026-11-06T12:00:00Z');
const job = { id: 1, type: 'disputeSync', payload: {}, attempts: 1 };

function paypalListing(items: { dispute_id: string; status: string }[] | Error): PayPalClient {
  return {
    request: async () => {
      if (items instanceof Error) throw items;
      return { items };
    },
  } as unknown as PayPalClient;
}

async function jobsOf(db: Awaited<ReturnType<typeof makeTestDb>>, type: string) {
  return (await db.query<{ payload: { disputeId?: string } }>(`select payload from jobs where type = $1 and state = 'queued'`, [type])).rows;
}

describe('disputeSyncJob', () => {
  it('queues a new dispute, skips an unchanged one, requeues one whose status changed', async () => {
    const db = await makeTestDb();
    opened.push(db);
    await db.query(`insert into disputes (paypal_dispute_id, status) values ('SAME','UNDER_REVIEW'), ('MOVED','UNDER_REVIEW')`);
    const paypal = paypalListing([
      { dispute_id: 'NEW', status: 'WAITING_FOR_SELLER_RESPONSE' },
      { dispute_id: 'SAME', status: 'UNDER_REVIEW' },
      { dispute_id: 'MOVED', status: 'RESOLVED' },
    ]);
    await disputeSyncJob({ db, paypal, now: () => NOW })(job);
    const ids = (await jobsOf(db, 'processDispute')).map((j) => j.payload.disputeId).sort();
    expect(ids).toEqual(['MOVED', 'NEW']);
  });

  it('schedules the next sync even when PayPal fails, and never twice', async () => {
    const db = await makeTestDb();
    opened.push(db);
    await disputeSyncJob({ db, paypal: paypalListing(new Error('down')), now: () => NOW })(job);
    expect(await jobsOf(db, 'disputeSync')).toHaveLength(1);
    expect(await ensureDisputeSyncQueued(db, NOW)).toBe(false);
  });
});
