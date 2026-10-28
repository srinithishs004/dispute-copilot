import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { COOKIE_NAME, signSession } from '../../src/auth/session.js';
import type { Config } from '../../src/config.js';
import { makeTestDb, makeTestDeps, testConfig } from '../helpers.js';

const SECRET = 'x'.repeat(40);
const config: Config = {
  ...testConfig,
  auth: {
    owner: { email: 'owner@x.test', passwordHash: 'x' },
    judge: { email: 'judge@x.test', passwordHash: 'x' },
    sessionSecret: SECRET,
  },
};
const NOW = Date.parse('2026-10-28T12:00:00Z');
const opened: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((d) => d.close()));
});

async function setup() {
  const db = await makeTestDb();
  opened.push(db);
  const app = createApp(makeTestDeps({ db, config, now: () => NOW }));
  const judge = `${COOKIE_NAME}=${signSession({ role: 'judge', email: 'judge@x.test' }, SECRET, NOW)}`;
  return { db, app, judge };
}

async function addDispute(
  db: Awaited<ReturnType<typeof makeTestDb>>,
  id: string,
  o: { orig: string; amount: string; status: string; state: string; due?: string | null; outcome?: string },
) {
  await db.query(
    `insert into disputes (paypal_dispute_id, reason, status, amount, original_amount, currency, response_due_at, local_state, raw)
     values ($1,'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',$2,$3,$4,'USD',$5,$6,$7::jsonb)`,
    [id, o.status, o.amount, o.orig, o.due ?? null, o.state, JSON.stringify(o.outcome ? { dispute_outcome: { outcome_code: o.outcome } } : {})],
  );
}

describe('GET /api/dashboard/data', () => {
  it('401 without a session', async () => {
    const { app } = await setup();
    expect((await request(app).get('/api/dashboard/data')).status).toBe(401);
  });

  it('lets a judge read numeric feed rows with amountKept for resolved cases', async () => {
    const { app, db, judge } = await setup();
    await addDispute(db, 'D-BUYER', { orig: '25.00', amount: '12.50', status: 'RESOLVED', state: 'RESOLVED', outcome: 'RESOLVED_BUYER_FAVOUR' });
    await addDispute(db, 'D-SELLER', { orig: '25.00', amount: '25.00', status: 'RESOLVED', state: 'RESOLVED', outcome: 'RESOLVED_SELLER_FAVOUR', due: '2026-10-20T00:00:00Z' });
    await addDispute(db, 'D-CANCEL', { orig: '25.00', amount: '25.00', status: 'RESOLVED', state: 'RESOLVED', outcome: 'CANCELED_BY_BUYER' });
    await addDispute(db, 'D-PAYOUT', { orig: '40.00', amount: '30.00', status: 'RESOLVED', state: 'RESOLVED', outcome: 'RESOLVED_WITH_PAYOUT' });
    await addDispute(db, 'D-OPEN', { orig: '49.00', amount: '49.00', status: 'WAITING_FOR_SELLER_RESPONSE', state: 'READY_FOR_REVIEW', due: '2026-10-30T11:00:00Z' });
    await db.query(
      `insert into analyses (dispute_id, recommendation, confidence, evidence_strength, missing_evidence, letter_draft)
       values ('D-OPEN','FIGHT',50,'WEAK','["old gap"]','a'), ('D-OPEN','OFFER',80,'MEDIUM','["Signed proof of delivery","Photos"]','b')`,
    );
    await db.query("insert into actions (dispute_id, type, state, created_at) values ('D-OPEN','OFFER','PENDING','2026-10-28T10:00:00Z')");

    const res = await request(app).get('/api/dashboard/data').set('Cookie', judge);
    expect(res.status).toBe(200);
    expect(typeof res.body.generatedAt).toBe('string');
    const by = Object.fromEntries(res.body.sources.disputes.map((d: { disputeId: string }) => [d.disputeId, d]));

    expect(by['D-BUYER']).toMatchObject({ originalAmount: 25, finalAmount: 12.5, amountKept: 12.5, outcome: 'RESOLVED_BUYER_FAVOUR', daysLeft: null, recommendation: null, confidence: null });
    expect(by['D-SELLER']).toMatchObject({ amountKept: 25, daysLeft: null });
    expect(by['D-CANCEL'].amountKept).toBe(25);
    expect(by['D-PAYOUT'].amountKept).toBe(10);
    expect(by['D-OPEN']).toMatchObject({
      originalAmount: 49,
      finalAmount: null,
      amountKept: null,
      daysLeft: 2,
      recommendation: 'OFFER',
      confidence: 80,
      evidenceStrength: 'MEDIUM',
      currency: 'USD',
      localState: 'READY_FOR_REVIEW',
    });
    expect(typeof by['D-OPEN'].createdAt === 'string' || by['D-OPEN'].createdAt === null).toBe(true);
    expect(res.body.sources.actions).toEqual([
      { disputeId: 'D-OPEN', type: 'OFFER', state: 'PENDING', createdAt: '2026-10-28T10:00:00.000Z', sentAt: null },
    ]);
    expect(res.body.sources.evidence_gaps).toEqual([
      { disputeId: 'D-OPEN', requirement: 'Signed proof of delivery' },
      { disputeId: 'D-OPEN', requirement: 'Photos' },
    ]);
  });

  it('daysLeft rounds up and goes non-positive when overdue', async () => {
    const { app, db, judge } = await setup();
    await addDispute(db, 'A', { orig: '1.00', amount: '1.00', status: 'OPEN', state: 'READY_FOR_REVIEW', due: '2026-10-29T12:00:01Z' });
    await addDispute(db, 'B', { orig: '1.00', amount: '1.00', status: 'OPEN', state: 'READY_FOR_REVIEW', due: '2026-10-26T06:00:00Z' });
    const res = await request(app).get('/api/dashboard/data').set('Cookie', judge);
    const by = Object.fromEntries(res.body.sources.disputes.map((d: { disputeId: string }) => [d.disputeId, d]));
    expect(by.A.daysLeft).toBe(2);
    expect(by.B.daysLeft).toBe(-2);
  });
});
