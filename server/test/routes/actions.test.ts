import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createApp } from '../../src/app.js';
import { processDispute } from '../../src/jobs/processDispute.js';
import { seedStore } from '../../src/store/seed.js';
import { PayPalError } from '../../src/paypal/client.js';
import type { PayPalClient } from '../../src/paypal/client.js';
import type { DisputeDetail } from '../../src/paypal/disputes.js';
import { makeTestDb, makeTestDeps, testConfig } from '../helpers.js';
import { fakeClient } from '../paypal/fake.js';

const inr = JSON.parse(
  readFileSync(new URL('../fixtures/dispute-inr-sandbox.json', import.meta.url), 'utf8'),
) as DisputeDetail;
const H = { 'x-debug-token': 'dbg' };
const URL_ = `/api/disputes/${inr.dispute_id}/approve`;
const NOTE = 'Customer received the parcel on time.';

const opened: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((d) => d.close()));
});

async function setup(opts: { state?: string; fresh?: unknown; paypal?: PayPalClient } = {}) {
  const db = await makeTestDb();
  opened.push(db);
  await seedStore(db);
  await processDispute({ db, paypal: fakeClient(inr).client, now: () => new Date() })({
    id: 1,
    type: 'processDispute',
    payload: { disputeId: inr.dispute_id },
    attempts: 1,
  });
  await db.query('update disputes set local_state = $1', [opts.state ?? 'READY_FOR_REVIEW']);
  const paypal = opts.paypal ?? fakeClient(opts.fresh ?? inr).client;
  return { db, app: createApp(makeTestDeps({ db, paypal })) };
}

async function counts(db: Awaited<ReturnType<typeof setup>>['db']) {
  const a = await db.query<{ n: string }>('select count(*) as n from actions');
  const j = await db.query<{ n: string }>("select count(*) as n from jobs where type = 'executeAction'");
  return { actions: Number(a.rows[0]!.n), jobs: Number(j.rows[0]!.n) };
}

describe('POST /api/disputes/:id/approve', () => {
  it('401 without the token, 404 when no token is configured', async () => {
    const { app, db } = await setup();
    expect((await request(app).post(URL_).send({ action: 'ACCEPT', note: NOTE })).status).toBe(401);
    const off = createApp(makeTestDeps({ db, config: { ...testConfig, debugToken: null } }));
    expect((await request(off).post(URL_).set(H).send({ action: 'ACCEPT', note: NOTE })).status).toBe(404);
  });

  it('404 for an unknown dispute', async () => {
    const { app } = await setup();
    const res = await request(app).post('/api/disputes/nope/approve').set(H).send({ action: 'ACCEPT', note: NOTE });
    expect(res.status).toBe(404);
  });

  it('409 not ready outside READY_FOR_REVIEW / NEEDS_MANUAL (checked before body validation)', async () => {
    for (const state of ['NEW', 'ANALYZING', 'ACTION_PENDING', 'ACTION_SENT', 'RESOLVED']) {
      const { app, db } = await setup({ state });
      const res = await request(app).post(URL_).set(H).send({ action: 'bogus' });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: 'not ready' });
      expect(await counts(db)).toEqual({ actions: 0, jobs: 0 });
    }
  });

  it('accepts NEEDS_MANUAL', async () => {
    const { app } = await setup({ state: 'NEEDS_MANUAL' });
    expect((await request(app).post(URL_).set(H).send({ action: 'ACCEPT', note: NOTE })).status).toBe(202);
  });

  it('400 for a bad action, short or long note, non-string note', async () => {
    const { app, db } = await setup();
    const bad = [
      { action: 'REFUND', note: NOTE },
      { note: NOTE },
      { action: 'ACCEPT', note: 'too short' },
      { action: 'ACCEPT', note: `   ${'a'.repeat(10)}   ` },
      { action: 'ACCEPT', note: 'a'.repeat(2001) },
      { action: 'ACCEPT', note: 42 },
      { action: 'ACCEPT' },
    ];
    for (const body of bad) {
      expect((await request(app).post(URL_).set(H).send(body)).status).toBe(400);
    }
    expect(await counts(db)).toEqual({ actions: 0, jobs: 0 });
  });

  it('400 for bad OFFER amounts (missing, format, zero, >= dispute amount)', async () => {
    const { app, db } = await setup();
    for (const offerAmount of [undefined, 'abc', '12.345', '-5', '0', '0.00', '49', '49.00', '49.0', '50', '1e1', 12]) {
      const res = await request(app).post(URL_).set(H).send({ action: 'OFFER', note: NOTE, offerAmount });
      expect(res.status, String(offerAmount)).toBe(400);
    }
    expect(await counts(db)).toEqual({ actions: 0, jobs: 0 });
  });

  it('502 when PayPal cannot be reached for the fresh dispute', async () => {
    const paypal: PayPalClient = {
      request: () => Promise.reject(new PayPalError(500, 'X', 'secret detail', 'dbg-id', { a: 1 })),
    };
    const { app, db } = await setup({ paypal });
    const res = await request(app).post(URL_).set(H).send({ action: 'ACCEPT', note: NOTE });
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'could not reach PayPal' });
    expect(await counts(db)).toEqual({ actions: 0, jobs: 0 });
  });

  it('409 when the fresh dispute no longer allows the action', async () => {
    const fresh = { ...inr, links: (inr.links ?? []).filter((l) => l.rel !== 'make_offer') };
    const { app, db } = await setup({ fresh });
    const res = await request(app).post(URL_).set(H).send({ action: 'OFFER', note: NOTE, offerAmount: '10' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('action not allowed now');
    expect(res.body.allowed).toMatchObject({ offer: false, accept: true });
    expect(await counts(db)).toEqual({ actions: 0, jobs: 0 });
    // the stored raw was refreshed
    const { rows } = await db.query<{ n: string }>(
      "select count(*) as n from disputes where raw->'links' @> '[{\"rel\":\"make_offer\"}]'",
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });

  it('OFFER success: 202, one PENDING row with normalized amount, ACTION_PENDING, one job', async () => {
    const { app, db } = await setup();
    const res = await request(app).post(URL_).set(H).send({ action: 'OFFER', note: `  ${NOTE}  `, offerAmount: '12.5' });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ actionId: expect.any(Number), state: 'PENDING' });
    const { rows } = await db.query<{ id: number; type: string; state: string; payload: unknown; approved_at: Date | null }>(
      'select id, type, state, payload, approved_at from actions',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: res.body.actionId,
      type: 'OFFER',
      state: 'PENDING',
      payload: { note: NOTE, offerAmount: '12.50', currency: 'USD' },
    });
    expect(rows[0]!.approved_at).not.toBeNull();
    expect((await db.query<{ local_state: string }>('select local_state from disputes')).rows[0]!.local_state).toBe(
      'ACTION_PENDING',
    );
    const jobs = await db.query<{ payload: unknown }>("select payload from jobs where type = 'executeAction'");
    expect(jobs.rows.map((j) => j.payload)).toEqual([{ actionId: res.body.actionId }]);
  });

  it('FIGHT payload carries the order tracking, ACCEPT carries none', async () => {
    const { app, db } = await setup();
    const res = await request(app).post(URL_).set(H).send({ action: 'FIGHT', note: NOTE });
    expect(res.status).toBe(202);
    const { rows } = await db.query<{ payload: { tracking?: { carrier: string; number: string }[]; currency: string } }>(
      'select payload from actions',
    );
    const tr = rows[0]!.payload.tracking;
    expect(tr?.length).toBeGreaterThan(0);
    expect(tr![0]).toEqual({ carrier: expect.any(String), number: expect.any(String) });
    expect(rows[0]!.payload.currency).toBe('USD');

    const b = await setup();
    await request(b.app).post(URL_).set(H).send({ action: 'ACCEPT', note: NOTE });
    const p = (await b.db.query<{ payload: Record<string, unknown> }>('select payload from actions')).rows[0]!.payload;
    expect(p).toEqual({ note: NOTE, currency: 'USD' });
  });

  it('FIGHT omits tracking when no shipment has a tracking number', async () => {
    const { app, db } = await setup();
    await db.query('update shipments set tracking_number = null');
    expect((await request(app).post(URL_).set(H).send({ action: 'FIGHT', note: NOTE })).status).toBe(202);
    const p = (await db.query<{ payload: Record<string, unknown> }>('select payload from actions')).rows[0]!.payload;
    expect('tracking' in p).toBe(false);
  });

  it('a second approve while one is pending is 409 (not ready)', async () => {
    const { app, db } = await setup();
    expect((await request(app).post(URL_).set(H).send({ action: 'ACCEPT', note: NOTE })).status).toBe(202);
    const res = await request(app).post(URL_).set(H).send({ action: 'ACCEPT', note: NOTE });
    expect(res.status).toBe(409);
    expect(await counts(db)).toEqual({ actions: 1, jobs: 1 });
  });

  it('409 action already pending when the unique index rejects the insert', async () => {
    const { app, db } = await setup();
    await db.query("insert into actions (dispute_id, type, payload, state) values ($1, 'ACCEPT', '{}', 'PENDING')", [
      inr.dispute_id,
    ]);
    const res = await request(app).post(URL_).set(H).send({ action: 'ACCEPT', note: NOTE });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'action already pending' });
    expect(await counts(db)).toEqual({ actions: 1, jobs: 0 });
    expect((await db.query<{ local_state: string }>('select local_state from disputes')).rows[0]!.local_state).toBe(
      'READY_FOR_REVIEW',
    );
  });

  it('409 not ready when the state changes mid-request (claim inside the transaction)', async () => {
    const { db } = await setup();
    const paypal: PayPalClient = {
      request: async <T,>() => {
        await db.query("update disputes set local_state = 'ACTION_SENT'");
        return inr as T;
      },
    };
    const app = createApp(makeTestDeps({ db, paypal }));
    const res = await request(app).post(URL_).set(H).send({ action: 'ACCEPT', note: NOTE });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'not ready' });
    expect(await counts(db)).toEqual({ actions: 0, jobs: 0 });
    expect((await db.query<{ local_state: string }>('select local_state from disputes')).rows[0]!.local_state).toBe(
      'ACTION_SENT',
    );
  });

  it('400 when the offer is invalid against the fresh PayPal amount', async () => {
    const fresh = { ...inr, dispute_amount: { currency_code: 'USD', value: '10.00' } };
    const { app, db } = await setup({ fresh });
    const res = await request(app).post(URL_).set(H).send({ action: 'OFFER', note: NOTE, offerAmount: '20' });
    expect(res.status).toBe(400);
    expect(await counts(db)).toEqual({ actions: 0, jobs: 0 });
  });

  it('FIGHT skips shipments without a carrier', async () => {
    const { app, db } = await setup();
    await db.query('update shipments set carrier = null');
    expect((await request(app).post(URL_).set(H).send({ action: 'FIGHT', note: NOTE })).status).toBe(202);
    const p = (await db.query<{ payload: Record<string, unknown> }>('select payload from actions')).rows[0]!.payload;
    expect('tracking' in p).toBe(false);
  });

  it('concurrent approves: exactly one 202 and one 409, one row, one job', async () => {
    const { app, db } = await setup();
    const send = () => request(app).post(URL_).set(H).send({ action: 'ACCEPT', note: NOTE });
    // PGlite serializes the requests, so the loser usually sees 'not ready'; the unique-index path is covered by the forced-conflict test above.
    const [a, b] = await Promise.all([send(), send()]);
    expect([a.status, b.status].sort()).toEqual([202, 409]);
    const loser = a.status === 409 ? a : b;
    expect(['not ready', 'action already pending']).toContain(loser.body.error);
    expect(await counts(db)).toEqual({ actions: 1, jobs: 1 });
  });
});
