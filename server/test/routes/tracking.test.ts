import request from 'supertest';
import { beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../../src/app.js';
import type { Db } from '../../src/db/db.js';
import { makeTestDb, makeTestDeps } from '../helpers.js';

const T0 = Date.parse('2026-11-06T10:00:00Z');
let db: Db;
let now = T0 + 120_000;
let app: ReturnType<typeof createApp>;

async function shipment(orderId: string, tracking: string, scenario: 'DELIVERED' | 'LOST') {
  await db.query(
    `insert into orders (id, item, amount, currency, status) values ($1, 'Desk Lamp', '49.00', 'USD', 'PAID')`,
    [orderId],
  );
  await db.query(
    `insert into shipments (order_id, carrier, tracking_number, status, shipped_at, simulated, sim_scenario)
     values ($1, 'USPS', $2, 'pre_transit', $3, true, $4)`,
    [orderId, tracking, new Date(T0).toISOString(), scenario],
  );
}

beforeEach(async () => {
  db = await makeTestDb();
  now = T0 + 120_000;
  app = createApp(makeTestDeps({ db, now: () => now }));
  await shipment('ORD-A', '9400DELIVERED1', 'DELIVERED');
  await shipment('ORD-B', '9400LOSTPARCEL', 'LOST');
});

describe('GET /track', () => {
  test('shows the lookup form', async () => {
    const res = await request(app).get('/track');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Track a parcel');
    expect(res.text).toContain('name="number"');
  });

  test('redirects a submitted number to its page', async () => {
    const res = await request(app).get('/track?number=9400DELIVERED1');
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/track/9400DELIVERED1');
  });
});

describe('GET /track/:number', () => {
  test('a delivered parcel shows proof of delivery and the signature', async () => {
    const res = await request(app).get('/track/9400DELIVERED1');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Proof of delivery');
    expect(res.text).toContain('Signed for by');
    expect(res.text).toContain('Delivered');
    expect(res.text).not.toContain('http-equiv="refresh"');
    expect(res.text).not.toContain('ORD-A');
  });

  test('a lost parcel shows a delivery exception and no proof of delivery', async () => {
    const res = await request(app).get('/track/9400LOSTPARCEL');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Delivery exception');
    expect(res.text).not.toContain('Proof of delivery');
  });

  test('a parcel still moving refreshes by itself', async () => {
    now = T0 + 20_000;
    const res = await request(app).get('/track/9400DELIVERED1');
    expect(res.text).toContain('http-equiv="refresh"');
    expect(res.text).toContain('In transit');
  });

  test('unknown or malformed numbers return 404 with the lookup form', async () => {
    for (const n of ['9400NOTREAL00', 'x', '<script>alert(1)</script>']) {
      const res = await request(app).get(`/track/${encodeURIComponent(n)}`);
      expect(res.status).toBe(404);
      expect(res.text).toContain('We could not find that tracking number');
      expect(res.text).not.toContain('<script>alert(1)</script>');
    }
  });
});

describe('GET /api/tracking/:number', () => {
  test('returns JSON without buyer or order details', async () => {
    const res = await request(app).get('/api/tracking/9400DELIVERED1');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'delivered', simulated: true, trackingNumber: '9400DELIVERED1' });
    expect(res.body.events).toHaveLength(5);
    expect(JSON.stringify(res.body)).not.toMatch(/ORD-|@/);
  });

  test('404 JSON for an unknown number', async () => {
    const res = await request(app).get('/api/tracking/9400NOTREAL00');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not found' });
  });
});
