import request from 'supertest';
import { describe, expect, test } from 'vitest';
import { createApp } from '../src/app.js';
import { PayPalError, type PayPalClient } from '../src/paypal/client.js';
import { maskId } from '../src/log.js';
import { disputeIdFromEvent } from '../src/webhooks/disputeEvent.js';
import { fakeClient } from './paypal/fake.js';
import type { AppDeps } from '../src/app.js';
import type { Db } from '../src/db/db.js';
import { makeTestDb, makeTestDeps, testConfig } from './helpers.js';

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
  resource: { dispute_id: 'PP-R-VYQ-10191597' },
};

async function dbDeps(overrides: Partial<AppDeps> = {}): Promise<AppDeps & { db: Db }> {
  const db = await makeTestDb();
  return { ...makeTestDeps({ db, ...overrides }), db };
}
const count = async (db: Db, table: string) =>
  Number((await db.query<{ n: string }>(`select count(*) as n from ${table}`)).rows[0]!.n);


function post(app: ReturnType<typeof createApp>, hdrs: Record<string, string> = headers, body: unknown = event) {
  let r = request(app).post('/webhooks/paypal');
  for (const [k, v] of Object.entries(hdrs)) r = r.set(k, v);
  return r.send(body as object);
}

describe('POST /webhooks/paypal', () => {
  test('verified event → 200 and recorded', async () => {
    const { client, calls } = fakeClient({ verification_status: 'SUCCESS' });
    const deps = await dbDeps({ paypal: client });
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
    const rows = (await deps.db.query<Record<string, unknown>>('select * from webhook_events')).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      paypal_event_id: 'WH-EVT-1',
      event_type: 'CUSTOMER.DISPUTE.CREATED',
      resource_id: 'PP-R-VYQ-10191597',
      raw: event,
    });
    const jobs = (await deps.db.query<{ type: string; payload: unknown }>('select type, payload from jobs')).rows;
    expect(jobs).toEqual([{ type: 'processDispute', payload: { disputeId: 'PP-R-VYQ-10191597' } }]);
  });

  test('verification FAILURE → 400 and not recorded', async () => {
    const deps = await dbDeps({ paypal: fakeClient({ verification_status: 'FAILURE' }).client });
    const res = await post(createApp(deps));
    expect(res.status).toBe(400);
    expect(await count(deps.db, 'webhook_events')).toBe(0);
    expect(await count(deps.db, 'jobs')).toBe(0);
  });

  test('missing transmission headers → 400, verify API not called', async () => {
    const { client, calls } = fakeClient({ verification_status: 'SUCCESS' });
    const { 'paypal-transmission-sig': _omit, ...partial } = headers;
    const res = await post(createApp(makeTestDeps({ paypal: client })), partial);
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test('same event id twice → 200 both times, one row and one job', async () => {
    const deps = await dbDeps();
    const app = createApp(deps);
    expect((await post(app)).status).toBe(200);
    expect((await post(app)).status).toBe(200);
    expect(await count(deps.db, 'webhook_events')).toBe(1);
    expect(await count(deps.db, 'jobs')).toBe(1);
  });

  test('non-dispute event is stored but queues no job', async () => {
    const deps = await dbDeps();
    const res = await post(createApp(deps), headers, {
      id: 'WH-PAY-1',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: { id: 'CAP-1' },
    });
    expect(res.status).toBe(200);
    const rows = (await deps.db.query<{ resource_id: string }>('select resource_id from webhook_events')).rows;
    expect(rows).toEqual([{ resource_id: 'CAP-1' }]);
    expect(await count(deps.db, 'jobs')).toBe(0);
  });

  test('logged line masks the dispute id', async () => {
    const logs: string[] = [];
    const rec = (m: unknown) => void logs.push(String(m));
    const deps = await dbDeps({ logger: { info: rec, warn: rec } });
    const app = createApp(deps);
    await post(app);
    await post(app);
    expect(logs).toEqual([
      'webhook received: CUSTOMER.DISPUTE.CREATED PP-R…1597',
      'webhook duplicate: CUSTOMER.DISPUTE.CREATED PP-R…1597',
    ]);
    expect(logs.join('\n')).not.toContain('PP-R-VYQ-10191597');
  });

  test('event and job are written atomically: enqueue failure leaves no event row', async () => {
    const deps = await dbDeps();
    await deps.db.exec('drop table jobs');
    const res = await post(createApp(deps));
    expect(res.status).toBe(500);
    expect(await count(deps.db, 'webhook_events')).toBe(0);
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
    const deps = await dbDeps({ paypal });
    const res = await post(createApp(deps));
    expect(res.status).toBe(500);
    expect(await count(deps.db, 'webhook_events')).toBe(0);
  });

  test('verify call throws PayPalError → logs status, name and debug_id only', async () => {
    const paypal: PayPalClient = {
      async request() {
        throw new PayPalError(401, 'AUTHENTICATION_FAILURE', 'Bearer SECRET-TOKEN rejected', 'dbg-123', {
          token: 'SECRET-TOKEN',
        });
      },
    };
    const warns: string[] = [];
    const deps = makeTestDeps({ paypal, logger: { info: () => {}, warn: (m: unknown) => void warns.push(String(m)) } });
    const res = await post(createApp(deps));
    expect(res.status).toBe(500);
    const logged = warns.join('\n');
    expect(logged).toContain('status=401');
    expect(logged).toContain('name=AUTHENTICATION_FAILURE');
    expect(logged).toContain('debug_id=dbg-123');
    expect(logged).not.toContain('SECRET-TOKEN');
    expect(logged).not.toContain(testConfig.paypal.clientSecret);
  });

  test('verify call throws generic error → logs name only', async () => {
    const paypal: PayPalClient = {
      async request() {
        throw new TypeError('secret detail');
      },
    };
    const warns: string[] = [];
    const deps = makeTestDeps({ paypal, logger: { info: () => {}, warn: (m: unknown) => void warns.push(String(m)) } });
    await post(createApp(deps));
    const logged = warns.join('\n');
    expect(logged).toContain('TypeError');
    expect(logged).not.toContain('secret detail');
  });

  test('malformed JSON → 400 JSON error, no stack, body not logged', async () => {
    const logs: string[] = [];
    const rec = (m: unknown) => void logs.push(String(m));
    const deps = makeTestDeps({ logger: { info: rec, warn: rec } });
    const res = await request(createApp(deps))
      .post('/webhooks/paypal')
      .set('content-type', 'application/json')
      .send('{"secret": oops');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ error: 'invalid JSON' });
    expect(res.text).not.toMatch(/<html|at \w|node_modules/i);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join('\n')).not.toContain('oops');
    expect(logs.join('\n')).toContain('entity.parse.failed');
  });

  test('verified body without string id → 400', async () => {
    const deps = await dbDeps();
    const res = await post(createApp(deps), headers, { event_type: 'X' });
    expect(res.status).toBe(400);
    expect(await count(deps.db, 'webhook_events')).toBe(0);
  });

  test('resource without id records resourceId null', async () => {
    const deps = await dbDeps();
    await post(createApp(deps), headers, { id: 'E2', event_type: 'X' });
    const rows = (await deps.db.query<{ resource_id: string | null }>('select resource_id from webhook_events')).rows;
    expect(rows).toEqual([{ resource_id: null }]);
  });
});

describe('maskId', () => {
  test('masks ids', () => {
    expect(maskId(null)).toBe('-');
    expect(maskId(undefined)).toBe('-');
    expect(maskId('')).toBe('-');
    expect(maskId('12345678')).toBe('****');
    expect(maskId('PP-D-12345678')).toBe('PP-D…5678');
  });
});

describe('disputeIdFromEvent', () => {
  test('prefers resource.dispute_id, falls back to resource.id for dispute events', () => {
    expect(disputeIdFromEvent({ event_type: 'X', resource: { dispute_id: 'D1', id: 'R' } })).toBe('D1');
    expect(disputeIdFromEvent({ event_type: 'CUSTOMER.DISPUTE.UPDATED', resource: { id: 'D2' } })).toBe('D2');
    expect(disputeIdFromEvent({ event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'C' } })).toBeNull();
    expect(disputeIdFromEvent({ event_type: 'CUSTOMER.DISPUTE.CREATED', resource: { dispute_id: 5 } })).toBeNull();
    expect(disputeIdFromEvent(null)).toBeNull();
    expect(disputeIdFromEvent('x')).toBeNull();
  });
});

describe('GET /debug/events', () => {
  test('without token → 401; with wrong token → 401; with token → DB rows newest first', async () => {
    const deps = await dbDeps();
    await deps.db.query(
      `insert into webhook_events (paypal_event_id, event_type, resource_id, raw, received_at)
       values ('old', 't1', 'r1', '{"a":1}', '2026-01-01T00:00:00Z'), ('new', 't2', null, '{"b":2}', '2026-01-02T00:00:00Z')`,
    );
    const app = createApp(deps);
    expect((await request(app).get('/debug/events')).status).toBe(401);
    expect((await request(app).get('/debug/events').set('x-debug-token', 'nope')).status).toBe(401);
    expect((await request(app).get('/debug/events').set('x-debug-token', 'dbg-long')).status).toBe(401);
    const ok = await request(app).get('/debug/events').set('x-debug-token', 'dbg');
    expect(ok.status).toBe(200);
    expect(ok.body.events).toEqual([
      { id: 'new', eventType: 't2', resourceId: null, receivedAt: '2026-01-02T00:00:00.000Z', raw: { b: 2 } },
      { id: 'old', eventType: 't1', resourceId: 'r1', receivedAt: '2026-01-01T00:00:00.000Z', raw: { a: 1 } },
    ]);
  });

  test('returns at most 50 events', async () => {
    const deps = await dbDeps();
    await deps.db.query(
      `insert into webhook_events (paypal_event_id, event_type, raw) select 'e' || g, 't', '{}' from generate_series(1, 60) g`,
    );
    const res = await request(createApp(deps)).get('/debug/events').set('x-debug-token', 'dbg');
    expect(res.body.events).toHaveLength(50);
  });

  test('when DEBUG_TOKEN unset → 404', async () => {
    const deps = makeTestDeps({ config: { ...testConfig, debugToken: null } });
    const res = await request(createApp(deps)).get('/debug/events').set('x-debug-token', 'dbg');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/disputes/sync', () => {
  const items = { items: [{ dispute_id: 'PP-R-AAA-11111111' }, { dispute_id: 'PP-R-BBB-22222222' }] };

  test('requires the debug token (401 / 404)', async () => {
    const deps = await dbDeps({ paypal: fakeClient(items).client });
    const app = createApp(deps);
    expect((await request(app).post('/api/disputes/sync')).status).toBe(401);
    expect((await request(app).post('/api/disputes/sync').set('x-debug-token', 'bad')).status).toBe(401);
    expect(await count(deps.db, 'jobs')).toBe(0);
    const off = makeTestDeps({ config: { ...testConfig, debugToken: null } });
    expect((await request(createApp(off)).post('/api/disputes/sync').set('x-debug-token', 'dbg')).status).toBe(404);
  });

  test('enqueues one processDispute job per listed dispute, no webhook rows', async () => {
    const { client, calls } = fakeClient(items);
    const deps = await dbDeps({ paypal: client });
    const res = await request(createApp(deps)).post('/api/disputes/sync').set('x-debug-token', 'dbg');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ queued: 2 });
    expect(calls[0]!.path).toBe('/v1/customer/disputes?page_size=20');
    const jobs = (await deps.db.query<{ type: string; payload: { disputeId: string } }>(
      'select type, payload from jobs order by id',
    )).rows;
    expect(jobs.map((j) => [j.type, j.payload.disputeId])).toEqual([
      ['processDispute', 'PP-R-AAA-11111111'],
      ['processDispute', 'PP-R-BBB-22222222'],
    ]);
    expect(await count(deps.db, 'webhook_events')).toBe(0);
  });

  test('PayPal failure → 502 and logs status/name/debug_id only', async () => {
    const paypal: PayPalClient = {
      async request() {
        throw new PayPalError(500, 'INTERNAL', 'SECRET detail', 'dbg-9', {});
      },
    };
    const warns: string[] = [];
    const deps = await dbDeps({ paypal, logger: { info: () => {}, warn: (m: unknown) => void warns.push(String(m)) } });
    const res = await request(createApp(deps)).post('/api/disputes/sync').set('x-debug-token', 'dbg');
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'PayPal request failed' });
    const logged = warns.join('\n');
    expect(logged).toContain('status=500');
    expect(logged).toContain('name=INTERNAL');
    expect(logged).toContain('debug_id=dbg-9');
    expect(logged).not.toContain('SECRET');
  });
});
