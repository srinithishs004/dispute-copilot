import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { executeActionJob } from '../../src/jobs/executeAction.js';
import { processDispute } from '../../src/jobs/processDispute.js';
import { createPendingAction, getAction, type ActionPayload } from '../../src/actions/repo.js';
import { setLocalState } from '../../src/disputes/repo.js';
import { PayPalError } from '../../src/paypal/client.js';
import type { PayPalClient } from '../../src/paypal/client.js';
import type { DisputeAction, DisputeDetail } from '../../src/paypal/disputes.js';
import { seedStore } from '../../src/store/seed.js';
import { makeTestDb } from '../helpers.js';
import { fakeClient } from '../paypal/fake.js';

const inr = JSON.parse(
  readFileSync(new URL('../fixtures/dispute-inr-sandbox.json', import.meta.url), 'utf8'),
) as DisputeDetail;
const NOTE = 'Customer received the parcel on time.';

const opened: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((d) => d.close()));
});

async function setup(type: DisputeAction, payload: Partial<ActionPayload> = {}, paypal?: PayPalClient) {
  const db = await makeTestDb();
  opened.push(db);
  await seedStore(db);
  await processDispute({ db, paypal: fakeClient(inr).client, now: () => new Date() })({
    id: 1,
    type: 'processDispute',
    payload: { disputeId: inr.dispute_id },
    attempts: 1,
  });
  await db.query("delete from jobs");
  await setLocalState(db, inr.dispute_id, 'ACTION_PENDING');
  const actionId = await createPendingAction(
    db,
    inr.dispute_id,
    type,
    { note: NOTE, currency: 'USD', ...payload },
    new Date(),
  );
  const fake = fakeClient({ id: 'ok' });
  const handler = executeActionJob({ db, paypal: paypal ?? fake.client, now: () => new Date('2026-10-18T12:00:00Z') });
  const run = (attempts = 1) => handler({ id: 9, type: 'executeAction', payload: { actionId }, attempts });
  return { db, actionId, run, calls: fake.calls };
}

const failing = (err: unknown): PayPalClient => ({
  async request() {
    throw err;
  },
});
const disputeRow = async (db: Awaited<ReturnType<typeof makeTestDb>>) =>
  (await db.query<{ local_state: string; manual_reason: string | null }>('select local_state, manual_reason from disputes')).rows[0]!;

describe('executeAction', () => {
  it('FIGHT calls provide-evidence with dc-action-<id>', async () => {
    const { run, calls, actionId } = await setup('FIGHT', { tracking: [{ carrier: 'UPS', number: '1Z' }] });
    await run();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toContain('/provide-evidence');
    expect(calls[0]!.headers).toEqual({ 'PayPal-Request-Id': `dc-action-${actionId}` });
  });

  it('OFFER calls make-offer with the amount', async () => {
    const { run, calls, actionId } = await setup('OFFER', { offerAmount: '12.50' });
    await run();
    expect(calls[0]!.path).toContain('/make-offer');
    expect(calls[0]!.body).toEqual({
      note: NOTE,
      offer_amount: { currency_code: 'USD', value: '12.50' },
      offer_type: 'REFUND',
    });
    expect(calls[0]!.headers).toEqual({ 'PayPal-Request-Id': `dc-action-${actionId}` });
  });

  it('ACCEPT calls accept-claim as a full refund', async () => {
    const { run, calls } = await setup('ACCEPT');
    await run();
    expect(calls[0]!.path).toContain('/accept-claim');
    expect(calls[0]!.body).toEqual({ note: NOTE, accept_claim_type: 'REFUND' });
  });

  it('success marks SENT, ACTION_SENT and queues a processDispute refresh', async () => {
    const { run, db, actionId } = await setup('ACCEPT');
    await run();
    const a = await getAction(db, actionId);
    expect(a!.state).toBe('SENT');
    expect(a!.sentAt).toBe('2026-10-18T12:00:00.000Z');
    expect((await disputeRow(db)).local_state).toBe('ACTION_SENT');
    const jobs = await db.query<{ payload: unknown }>("select payload from jobs where type = 'processDispute'");
    expect(jobs.rows).toEqual([{ payload: { disputeId: inr.dispute_id } }]);
  });

  it('422 -> FAILED, NEEDS_MANUAL, job completes', async () => {
    const err = new PayPalError(422, 'UNPROCESSABLE_ENTITY', 'Not allowed', 'dbg', {});
    const { run, db, actionId } = await setup('ACCEPT', {}, failing(err));
    await run();
    const a = await getAction(db, actionId);
    expect(a).toMatchObject({ state: 'FAILED', error: 'UNPROCESSABLE_ENTITY: Not allowed' });
    expect(await disputeRow(db)).toEqual({
      local_state: 'NEEDS_MANUAL',
      manual_reason: 'PayPal rejected the action (UNPROCESSABLE_ENTITY)',
    });
  });

  it('503 on attempt 1 rethrows and leaves the action PENDING', async () => {
    const err = new PayPalError(503, 'SERVICE_UNAVAILABLE', 'down', null, {});
    const { run, db, actionId } = await setup('ACCEPT', {}, failing(err));
    await expect(run(1)).rejects.toBe(err);
    expect((await getAction(db, actionId))!.state).toBe('PENDING');
    expect((await disputeRow(db)).local_state).toBe('ACTION_PENDING');
  });

  it('503 on the final attempt marks FAILED + NEEDS_MANUAL and rethrows', async () => {
    const err = new PayPalError(503, 'SERVICE_UNAVAILABLE', 'down', null, {});
    const { run, db, actionId } = await setup('ACCEPT', {}, failing(err));
    await expect(run(3)).rejects.toBe(err);
    expect((await getAction(db, actionId))!.state).toBe('FAILED');
    expect(await disputeRow(db)).toEqual({ local_state: 'NEEDS_MANUAL', manual_reason: 'Could not reach PayPal' });
  });

  it('network error (status 0) and 429 are retried', async () => {
    for (const status of [0, 429]) {
      const err = new PayPalError(status, 'X', 'y', null, {});
      const { run, db, actionId } = await setup('ACCEPT', {}, failing(err));
      await expect(run(1)).rejects.toBe(err);
      expect((await getAction(db, actionId))!.state).toBe('PENDING');
    }
  });

  it('does not overwrite a dispute that left ACTION_PENDING', async () => {
    const err = new PayPalError(422, 'UNPROCESSABLE_ENTITY', 'Not allowed', null, {});
    const { run, db } = await setup('ACCEPT', {}, failing(err));
    await setLocalState(db, inr.dispute_id, 'RESOLVED');
    await run();
    expect((await disputeRow(db)).local_state).toBe('RESOLVED');
  });

  it('skips a non-PENDING action without calling PayPal', async () => {
    const { run, db, actionId, calls } = await setup('ACCEPT');
    await db.query("update actions set state = 'SENT' where id = $1", [actionId]);
    await run();
    expect(calls).toHaveLength(0);
  });

  it('truncates long error text to 500 chars', async () => {
    const err = new PayPalError(400, 'INVALID', 'x'.repeat(900), null, {});
    const { run, db, actionId } = await setup('ACCEPT', {}, failing(err));
    await run();
    expect((await getAction(db, actionId))!.error).toHaveLength(500);
  });
});
