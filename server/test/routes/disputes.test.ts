import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createApp } from '../../src/app.js';
import { processDispute } from '../../src/jobs/processDispute.js';
import { seedStore } from '../../src/store/seed.js';
import type { DisputeDetail } from '../../src/paypal/disputes.js';
import { makeTestDb, makeTestDeps, testConfig } from '../helpers.js';
import { fakeClient } from '../paypal/fake.js';

const inr = JSON.parse(
  readFileSync(new URL('../fixtures/dispute-inr-sandbox.json', import.meta.url), 'utf8'),
) as DisputeDetail;
const H = { 'x-debug-token': 'dbg' };

async function setup() {
  const db = await makeTestDb();
  await seedStore(db);
  await processDispute({ db, paypal: fakeClient(inr).client, now: () => new Date() })({
    id: 1,
    type: 'processDispute',
    payload: { disputeId: inr.dispute_id },
    attempts: 1,
  });
  return { db, app: createApp(makeTestDeps({ db })) };
}

describe('dispute routes', () => {
  it('401 without the token', async () => {
    const { app } = await setup();
    expect((await request(app).get('/api/disputes')).status).toBe(401);
    expect((await request(app).get(`/api/disputes/${inr.dispute_id}`)).status).toBe(401);
  });

  it('404 when DEBUG_TOKEN is unset', async () => {
    const { db } = await setup();
    const app = createApp(makeTestDeps({ db, config: { ...testConfig, debugToken: null } }));
    expect((await request(app).get('/api/disputes').set(H)).status).toBe(404);
    expect((await request(app).get(`/api/disputes/${inr.dispute_id}`).set(H)).status).toBe(404);
  });

  it('lists disputes', async () => {
    const { app } = await setup();
    const res = await request(app).get('/api/disputes').set(H);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      disputeId: inr.dispute_id,
      reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
      amount: '49.00',
      currency: 'USD',
      localState: 'ANALYZING',
    });
    expect(Object.keys(res.body[0]).sort()).toEqual(
      ['amount', 'currency', 'disputeId', 'localState', 'reason', 'responseDueAt', 'status'].sort(),
    );
  });

  it('returns detail with evidence and null analysis', async () => {
    const { app } = await setup();
    const res = await request(app).get(`/api/disputes/${inr.dispute_id}`).set(H);
    expect(res.status).toBe(200);
    expect(res.body.evidence.facts.length).toBeGreaterThan(0);
    expect(res.body.evidence.missing).toEqual([]);
    expect(res.body.latestAnalysis).toBeNull();
    expect(res.body.manualReason).toBeNull();
    expect(res.body.amount).toBe('49.00');
  });

  it('maps the newest analysis to camelCase', async () => {
    const { app, db } = await setup();
    await db.query(
      "insert into analyses (dispute_id, recommendation, letter_draft, model_used) values ($1,'FIGHT','old','m0'),($1,'FIGHT','new','m1')",
      [inr.dispute_id],
    );
    const res = await request(app).get(`/api/disputes/${inr.dispute_id}`).set(H);
    expect(res.body.latestAnalysis).toMatchObject({ recommendation: 'FIGHT', letterDraft: 'new', modelUsed: 'm1' });
    expect(typeof res.body.latestAnalysis.createdAt).toBe('string');
  });

  it('evidence is null without a matching order', async () => {
    const { app, db } = await setup();
    await db.query('update disputes set order_id = null');
    const res = await request(app).get(`/api/disputes/${inr.dispute_id}`).set(H);
    expect(res.body.evidence).toBeNull();
  });

  it('404 for an unknown dispute', async () => {
    const { app } = await setup();
    expect((await request(app).get('/api/disputes/nope').set(H)).status).toBe(404);
  });
});
