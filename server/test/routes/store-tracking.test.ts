import request from 'supertest';
import { beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../../src/app.js';
import type { Db } from '../../src/db/db.js';
import { seedStore } from '../../src/store/seed.js';
import { fakeClient, type RecordedCall } from '../paypal/fake.js';
import { makeTestDb, makeTestDeps } from '../helpers.js';

function paypalReplies(call: RecordedCall): unknown {
  if (call.path === '/v2/checkout/orders') {
    return { id: 'PP-ORDER-1', links: [{ rel: 'payer-action', href: 'https://paypal.example/approve?token=PP-ORDER-1' }] };
  }
  return { status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'CAP-1' }] } }] };
}

let db: Db;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  db = await makeTestDb();
  await seedStore(db);
  app = createApp(makeTestDeps({ db, paypal: fakeClient(paypalReplies).client }));
});

const checkout = (delivery?: string) =>
  request(app).post('/store/checkout').type('form').send({ productId: 'lamp', ...(delivery ? { delivery } : {}) });

describe('store and the sandbox carrier', () => {
  test('the store lets the buyer pick delivered or lost', async () => {
    const res = await request(app).get('/store');
    expect(res.text.match(/name="delivery"/g)).toHaveLength(3);
    expect(res.text).toContain('Deliver it, with a signature');
    expect(res.text).toContain('Lose the package');
    expect(res.text).toContain('href="/track"');
  });

  test('checkout remembers the choice, defaulting to delivered and ignoring junk', async () => {
    await checkout('LOST');
    await checkout();
    await checkout('EXPLODE');
    const { rows } = await db.query<{ delivery_sim: string }>("select delivery_sim from orders where id like 'ORD-%' order by created_at, id");
    expect(rows.map((r) => r.delivery_sim).sort()).toEqual(['DELIVERED', 'DELIVERED', 'LOST']);
  });

  test('payment creates a simulated shipment with the chosen scenario and links to tracking', async () => {
    await checkout('LOST');
    const res = await request(app).get('/store/return?token=PP-ORDER-1');
    expect(res.status).toBe(200);
    const s = (await db.query<{ simulated: boolean; sim_scenario: string; tracking_number: string; status: string }>(
      "select simulated, sim_scenario, tracking_number, status from shipments where order_id like 'ORD-%'",
    )).rows;
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ simulated: true, sim_scenario: 'LOST', status: 'pre_transit' });
    expect(res.text).toContain(`/track/${s[0]!.tracking_number}`);
    const track = await request(app).get(`/track/${s[0]!.tracking_number}`);
    expect(track.status).toBe(200);
    expect(track.text).toContain('Shipping label created');
  });
});
