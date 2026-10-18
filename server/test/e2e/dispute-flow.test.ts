import request from 'supertest';
import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createApp } from '../../src/app.js';
import { buildHandlers } from '../../src/jobs/handlers.js';
import { runWorkerOnce } from '../../src/jobs/worker.js';
import { seedStore } from '../../src/store/seed.js';
import type { DisputeDetail } from '../../src/paypal/disputes.js';
import type { Llm } from '../../src/ai/llm.js';
import { makeTestDb, makeTestDeps } from '../helpers.js';
import { fakeClient } from '../paypal/fake.js';

const inr = JSON.parse(
  readFileSync(new URL('../fixtures/dispute-inr-sandbox.json', import.meta.url), 'utf8'),
) as DisputeDetail;

const opened: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((d) => d.close()));
});

it('webhook -> worker -> READY_FOR_REVIEW with evidence and a letter', async () => {
  const db = await makeTestDb();
  opened.push(db);
  await seedStore(db);
  const { client, calls } = fakeClient((call) =>
    call.path.includes('verify-webhook-signature') ? { verification_status: 'SUCCESS' } : inr,
  );
  const letter =
    'Dear PayPal dispute team, the order was shipped with tracking number 1Z999AA10123456784 as recorded in our shipment facts. We respectfully ask that the dispute be resolved in our favour. Thank you.';
  const llm: Llm = {
    async generateJson(p, schema) {
      const data = p.system.includes('recommendation')
        ? {
            recommendation: 'FIGHT',
            confidence: 85,
            evidence_strength: 'STRONG',
            reasons: ['Delivered with tracking'],
            missing_evidence: [],
            suggested_offer_amount: null,
          }
        : { letter, citedFactIds: ['shipment.0.tracking'] };
      return { data: schema.parse(data), model: 'fake:m' };
    },
  };
  const deps = makeTestDeps({ db, paypal: client });
  const app = createApp(deps);

  const res = await request(app)
    .post('/webhooks/paypal')
    .set({
      'paypal-auth-algo': 'SHA256withRSA',
      'paypal-cert-url': 'https://api.sandbox.paypal.com/cert.pem',
      'paypal-transmission-id': 'tid-1',
      'paypal-transmission-sig': 'sig',
      'paypal-transmission-time': '2026-10-13T00:00:00Z',
    })
    .send({ id: 'WH-E2E-1', event_type: 'CUSTOMER.DISPUTE.CREATED', resource: { dispute_id: inr.dispute_id } });
  expect(res.status).toBe(200);

  let clock = new Date();
  const now = () => clock;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const wd = {
    db,
    handlers: buildHandlers({ db, paypal: client, llm, now, storeName: 'Test Store' }),
    now,
    logger,
  };
  let ran = 0;
  while (await runWorkerOnce(wd)) ran++;
  expect(ran).toBe(1); // processDispute; analyzeDispute is delayed
  clock = new Date(clock.getTime() + 61_000);
  while (await runWorkerOnce(wd)) ran++;
  expect(ran).toBe(2);

  const detail = await request(app).get(`/api/disputes/${inr.dispute_id}`).set('x-debug-token', 'dbg');
  expect(detail.status).toBe(200);
  expect(detail.body.localState).toBe('READY_FOR_REVIEW');
  expect(detail.body.evidence.missing).toEqual([]);
  expect(detail.body.latestAnalysis.letterDraft).toBe(letter);
  expect(detail.body.latestAnalysis.recommendation).toBe('FIGHT');

  // Seller approves an OFFER; the executeAction job sends it to PayPal.
  const approve = await request(app)
    .post(`/api/disputes/${inr.dispute_id}/approve`)
    .set('x-debug-token', 'dbg')
    .send({ action: 'OFFER', offerAmount: '10.00', note: 'Offering a partial refund to settle this.' });
  expect(approve.status).toBe(202);
  const actionId = approve.body.actionId as number;
  const before = calls.length;
  let more = 0;
  while (await runWorkerOnce(wd)) more++;
  expect(more).toBeGreaterThanOrEqual(1);
  const offer = calls.slice(before).find((c) => c.path.endsWith('/make-offer'));
  expect(offer).toBeDefined();
  expect(offer!.body).toEqual({
    note: 'Offering a partial refund to settle this.',
    offer_amount: { currency_code: 'USD', value: '10.00' },
    offer_type: 'REFUND',
  });
  expect(offer!.headers).toEqual({ 'PayPal-Request-Id': `dc-action-${actionId}` });
  const after = await request(app).get(`/api/disputes/${inr.dispute_id}`).set('x-debug-token', 'dbg');
  expect(after.body.localState).toBe('ACTION_SENT');
  const act = await db.query<{ state: string }>('select state from actions where id = $1', [actionId]);
  expect(act.rows[0]!.state).toBe('SENT');
});
