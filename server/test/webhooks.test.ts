import request from 'supertest';
import { describe, expect, test } from 'vitest';
import { createApp } from '../src/app.js';
import type { PayPalClient } from '../src/paypal/client.js';
import { createEventLog } from '../src/webhooks/eventLog.js';
import { fakeClient } from './paypal/fake.js';
import { makeTestDeps, testConfig } from './helpers.js';

const headers = {
  'paypal-auth-algo': 'SHA256withRSA',
  'paypal-cert-url': 'https://api.sandbox.paypal.com/cert.pem',
  'paypal-transmission-id': 'tid-1',
  'paypal-transmission-sig': 'sig',
  'paypal-transmission-time': '2026-10-13T00:00:00Z',
};
const event = {
  id: 'WH-EVT-1',
  event_type: 'CUSTOMER.DISPUTE.CREATED',
  resource: { id: 'PP-D-1' },
};

function post(app: ReturnType<typeof createApp>, hdrs: Record<string, string> = headers, body: unknown = event) {
  let r = request(app).post('/webhooks/paypal');
  for (const [k, v] of Object.entries(hdrs)) r = r.set(k, v);
  return r.send(body as object);
}

describe('POST /webhooks/paypal', () => {
  test('verified event → 200 and recorded', async () => {
    const { client, calls } = fakeClient({ verification_status: 'SUCCESS' });
    const deps = makeTestDeps({ paypal: client });
    const res = await post(createApp(deps));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe('/v1/notifications/verify-webhook-signature');
    expect(calls[0].body).toMatchObject({
      auth_algo: 'SHA256withRSA',
      cert_url: headers['paypal-cert-url'],
      transmission_id: 'tid-1',
      transmission_sig: 'sig',
      transmission_time: headers['paypal-transmission-time'],
      webhook_id: 'WH-TEST',
      webhook_event: event,
    });
    const [stored] = deps.eventLog.list();
    expect(stored).toMatchObject({ id: 'WH-EVT-1', eventType: 'CUSTOMER.DISPUTE.CREATED', resourceId: 'PP-D-1', raw: event });
    expect(typeof stored.receivedAt).toBe('string');
  });

  test('verification FAILURE → 400 and not recorded', async () => {
    const deps = makeTestDeps({ paypal: fakeClient({ verification_status: 'FAILURE' }).client });
    const res = await post(createApp(deps));
    expect(res.status).toBe(400);
    expect(deps.eventLog.list()).toEqual([]);
  });

  test('missing transmission headers → 400, verify API not called', async () => {
    const { client, calls } = fakeClient({ verification_status: 'SUCCESS' });
    const { 'paypal-transmission-sig': _omit, ...partial } = headers;
    const res = await post(createApp(makeTestDeps({ paypal: client })), partial);
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test('same event id twice → 200 both times, recorded once', async () => {
    const deps = makeTestDeps();
    const app = createApp(deps);
    expect((await post(app)).status).toBe(200);
    expect((await post(app)).status).toBe(200);
    expect(deps.eventLog.list()).toHaveLength(1);
  });

  test('webhookId not configured → 503 with message "PAYPAL_WEBHOOK_ID not set"', async () => {
    const deps = makeTestDeps({ config: { ...testConfig, paypal: { ...testConfig.paypal, webhookId: null } } });
    const res = await post(createApp(deps));
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'PAYPAL_WEBHOOK_ID not set' });
  });

  test('verify call throws → 500 and not recorded', async () => {
    const paypal: PayPalClient = {
      async request() {
        throw new Error('boom');
      },
    };
    const deps = makeTestDeps({ paypal });
    const res = await post(createApp(deps));
    expect(res.status).toBe(500);
    expect(deps.eventLog.list()).toEqual([]);
  });

  test('verified body without string id → 400', async () => {
    const deps = makeTestDeps();
    const res = await post(createApp(deps), headers, { event_type: 'X' });
    expect(res.status).toBe(400);
    expect(deps.eventLog.list()).toEqual([]);
  });

  test('resource without id records resourceId null', async () => {
    const deps = makeTestDeps();
    await post(createApp(deps), headers, { id: 'E2', event_type: 'X' });
    expect(deps.eventLog.list()[0].resourceId).toBeNull();
  });
});

describe('event log', () => {
  test('drops oldest past max', () => {
    const log = createEventLog(2);
    for (const id of ['a', 'b', 'c']) log.add({ id, eventType: 't', resourceId: null, receivedAt: 'x', raw: {} });
    expect(log.list().map((e) => e.id)).toEqual(['b', 'c']);
  });
});

describe('GET /debug/events', () => {
  test('without token → 401; with wrong token → 401; with token → list', async () => {
    const deps = makeTestDeps();
    deps.eventLog.add({ id: 'e', eventType: 't', resourceId: null, receivedAt: 'x', raw: {} });
    const app = createApp(deps);
    expect((await request(app).get('/debug/events')).status).toBe(401);
    expect((await request(app).get('/debug/events').set('x-debug-token', 'nope')).status).toBe(401);
    expect((await request(app).get('/debug/events').set('x-debug-token', 'dbg-long')).status).toBe(401);
    const ok = await request(app).get('/debug/events').set('x-debug-token', 'dbg');
    expect(ok.status).toBe(200);
    expect(ok.body.events).toHaveLength(1);
  });

  test('when DEBUG_TOKEN unset → 404', async () => {
    const deps = makeTestDeps({ config: { ...testConfig, debugToken: null } });
    const res = await request(createApp(deps)).get('/debug/events').set('x-debug-token', 'dbg');
    expect(res.status).toBe(404);
  });
});
