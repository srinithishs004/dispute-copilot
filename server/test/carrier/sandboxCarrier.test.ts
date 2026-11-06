import { describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/db.js';
import {
  dueSteps,
  getTrackingView,
  stepsFor,
  syncOrderTracking,
  trackingViewsForOrder,
} from '../../src/carrier/sandboxCarrier.js';
import { makeTestDb } from '../helpers.js';

const T0 = new Date('2026-11-06T10:00:00Z');
const at = (sec: number) => new Date(T0.getTime() + sec * 1000);

async function shipment(db: Db, scenario: 'DELIVERED' | 'LOST', orderId = 'ORD-T1', tracking = '9400TRACK0001') {
  await db.query(
    `insert into orders (id, item, amount, currency, status) values ($1, 'Desk Lamp', '49.00', 'USD', 'PAID')`,
    [orderId],
  );
  await db.query(
    `insert into shipments (order_id, carrier, tracking_number, status, shipped_at, simulated, sim_scenario)
     values ($1, 'USPS', $2, 'pre_transit', $3, true, $4)`,
    [orderId, tracking, T0.toISOString(), scenario],
  );
}
const ship = async (db: Db) =>
  (await db.query<Record<string, unknown>>('select status, delivered_at, signature_proof, signed_by, delivered_to from shipments')).rows[0]!;
const eventStatuses = async (db: Db) =>
  (await db.query<{ status: string }>('select status from tracking_events order by occurred_at, id')).rows.map((r) => r.status);

describe('timeline', () => {
  it('delivered parcels end with a delivery, lost parcels end with an exception', () => {
    expect(stepsFor('DELIVERED').at(-1)!.status).toBe('delivered');
    expect(stepsFor('LOST').at(-1)!.status).toBe('delivery_exception');
    expect(stepsFor('LOST').some((s) => s.status === 'delivered')).toBe(false);
  });

  it('only returns steps that have already happened', () => {
    expect(dueSteps('DELIVERED', T0, at(-1))).toEqual([]);
    expect(dueSteps('DELIVERED', T0, at(0)).map((s) => s.status)).toEqual(['label_created']);
    expect(dueSteps('DELIVERED', T0, at(40)).map((s) => s.status)).toEqual(['label_created', 'picked_up', 'in_transit']);
    expect(dueSteps('DELIVERED', T0, at(89)).at(-1)!.status).toBe('out_for_delivery');
    expect(dueSteps('DELIVERED', T0, at(90)).at(-1)!.status).toBe('delivered');
  });
});

describe('syncOrderTracking', () => {
  it('delivered: records proof of delivery with a signature', async () => {
    const db = await makeTestDb();
    await shipment(db, 'DELIVERED');
    await syncOrderTracking(db, 'ORD-T1', at(120));
    expect(await eventStatuses(db)).toEqual(['label_created', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered']);
    const s = await ship(db);
    expect(s.status).toBe('delivered');
    expect(s.signature_proof).toBe(true);
    expect(s.signed_by).toMatch(/Recipient/);
    expect(new Date(s.delivered_at as string).toISOString()).toBe(at(90).toISOString());
  });

  it('lost: records the exception and never a delivery or signature', async () => {
    const db = await makeTestDb();
    await shipment(db, 'LOST');
    await syncOrderTracking(db, 'ORD-T1', at(500));
    expect(await eventStatuses(db)).toEqual(['label_created', 'picked_up', 'in_transit', 'delivery_exception']);
    const s = await ship(db);
    expect(s.status).toBe('delivery_failed');
    expect(s.delivered_at).toBeNull();
    expect(s.signature_proof).toBe(false);
  });

  it('is idempotent and moves forward only as time passes', async () => {
    const db = await makeTestDb();
    await shipment(db, 'DELIVERED');
    await syncOrderTracking(db, 'ORD-T1', at(5));
    expect((await ship(db)).status).toBe('pre_transit');
    await syncOrderTracking(db, 'ORD-T1', at(40));
    expect((await ship(db)).status).toBe('in_transit');
    await syncOrderTracking(db, 'ORD-T1', at(100));
    await syncOrderTracking(db, 'ORD-T1', at(100));
    expect(await eventStatuses(db)).toHaveLength(5);
    expect((await ship(db)).status).toBe('delivered');
  });

  it('leaves non-simulated (seed) shipments untouched', async () => {
    const db = await makeTestDb();
    await db.query(`insert into orders (id, item, amount, currency, status) values ('ORD-S', 'Mug', '18.00', 'USD', 'PAID')`);
    await db.query(
      `insert into shipments (order_id, carrier, tracking_number, status, shipped_at) values ('ORD-S', 'UPS', '1ZSEED000001', 'in_transit', $1)`,
      [T0.toISOString()],
    );
    await syncOrderTracking(db, 'ORD-S', at(1000));
    expect((await ship(db)).status).toBe('in_transit');
    expect(await eventStatuses(db)).toEqual([]);
  });
});

describe('tracking views', () => {
  it('returns the public view without the order id, and null for an unknown number', async () => {
    const db = await makeTestDb();
    await shipment(db, 'DELIVERED');
    const v = await getTrackingView(db, '9400TRACK0001', at(100));
    expect(v).toMatchObject({ status: 'delivered', simulated: true, carrier: 'Sandbox carrier' });
    expect(v!.events).toHaveLength(5);
    expect(JSON.stringify(v)).not.toContain('ORD-T1');
    expect(await getTrackingView(db, 'NOPE000000', at(100))).toBeNull();
  });

  it('derives a short history for parcels without scan events', async () => {
    const db = await makeTestDb();
    await db.query(`insert into orders (id, item, amount, currency, status) values ('ORD-S', 'Mug', '18.00', 'USD', 'PAID')`);
    await db.query(
      `insert into shipments (order_id, carrier, tracking_number, status, shipped_at, delivered_at) values ('ORD-S', 'UPS', '1ZSEED000001', 'delivered', $1, $2)`,
      [T0.toISOString(), at(3600).toISOString()],
    );
    const [v] = await trackingViewsForOrder(db, 'ORD-S', at(7200));
    expect(v!.simulated).toBe(false);
    expect(v!.events.map((e) => e.status)).toEqual(['in_transit', 'delivered']);
  });
});
