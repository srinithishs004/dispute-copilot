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
    expect(res.body.actions).toEqual([]);
    expect(res.body.manualReason).toBeNull();
    expect(res.body.amount).toBe('49.00');
    expect(res.body.originalAmount).toBe('49.00');
    expect(res.body.deadlineFlag).toBeNull();
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

  it('detail includes allowedActions, outcome, actions and the full analysis', async () => {
    const { app, db } = await setup();
    await db.query(
      `insert into analyses (dispute_id, recommendation, confidence, evidence_strength, reasons, missing_evidence, suggested_offer, flags, letter_draft, model_used)
       values ($1,'OFFER',70,'MEDIUM','["r"]','["tracking number"]',24.5,'["f"]','l','m')`,
      [inr.dispute_id],
    );
    await db.query(
      "insert into actions (dispute_id, type, payload, state, created_at) values ($1,'OFFER','{}','FAILED','2026-10-17T10:00:00Z'),($1,'ACCEPT','{}','SENT','2026-10-18T10:00:00Z')",
      [inr.dispute_id],
    );
    await db.query("update actions set error = 'boom', sent_at = '2026-10-18T10:01:00Z' where type = 'ACCEPT'");
    const res = await request(app).get(`/api/disputes/${inr.dispute_id}`).set(H);
    expect(res.body.allowedActions).toMatchObject({ fight: true, offer: true, accept: true });
    expect(res.body.outcome).toBeNull();
    expect(res.body.latestAnalysis).toMatchObject({
      recommendation: 'OFFER',
      confidence: 70,
      evidenceStrength: 'MEDIUM',
      reasons: ['r'],
      missingEvidence: ['tracking number'],
      suggestedOffer: '24.50',
      flags: ['f'],
    });
    expect(res.body.actions.map((a: { type: string }) => a.type)).toEqual(['ACCEPT', 'OFFER']);
    expect(res.body.actions[0]).toMatchObject({
      state: 'SENT',
      error: 'boom',
      createdAt: '2026-10-18T10:00:00.000Z',
      sentAt: '2026-10-18T10:01:00.000Z',
    });
    expect(res.body.actions[1].sentAt).toBeNull();
    expect(typeof res.body.actions[0].id).toBe('number');
  });

  it('outcome comes from a resolved dispute', async () => {
    const { app, db } = await setup();
    await db.query(
      `update disputes set raw = jsonb_set(raw, '{dispute_outcome}', '{"outcome_code":"RESOLVED_SELLER_FAVOUR"}'::jsonb)`,
    );
    const res = await request(app).get(`/api/disputes/${inr.dispute_id}`).set(H);
    expect(res.body.outcome).toBe('RESOLVED_SELLER_FAVOUR');
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
