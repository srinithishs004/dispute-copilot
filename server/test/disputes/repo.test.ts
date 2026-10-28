import { afterEach, describe, expect, it } from 'vitest';
import { upsertDispute } from '../../src/disputes/repo.js';
import type { DisputeDetail } from '../../src/paypal/disputes.js';
import { makeTestDb } from '../helpers.js';

const opened: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((d) => d.close()));
});

const detail = (value: string): DisputeDetail =>
  ({
    dispute_id: 'PP-R-ORIG-1',
    reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
    status: 'WAITING_FOR_SELLER_RESPONSE',
    dispute_amount: { currency_code: 'USD', value },
  }) as DisputeDetail;

describe('upsertDispute original amount', () => {
  it('sets original_amount on insert and never overwrites it', async () => {
    const db = await makeTestDb();
    opened.push(db);
    await upsertDispute(db, detail('25.00'), null);
    await upsertDispute(db, detail('12.50'), null);
    const { rows } = await db.query<{ amount: string; original_amount: string }>(
      'select amount::text, original_amount::text from disputes',
    );
    expect(rows[0]).toEqual({ amount: '12.50', original_amount: '25.00' });
  });
});
