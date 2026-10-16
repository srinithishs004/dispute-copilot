import { describe, expect, it } from 'vitest';
import { seedStore } from '../../src/store/seed.js';
import { findOrderBundle, findOrderByCaptureId, PRODUCTS } from '../../src/store/repo.js';
import { makeTestDb } from '../helpers.js';

const DAY = 86_400_000;

describe('mock store', () => {
  it('seeding twice yields exactly 12 orders, 1 policy, and no duplicate children', async () => {
    const db = await makeTestDb();
    await seedStore(db);
    const count = async (t: string) =>
      Number((await db.query<{ n: string }>(`select count(*) as n from ${t}`)).rows[0]!.n);
    const before = { s: await count('shipments'), m: await count('messages') };
    await seedStore(db);
    expect(await count('orders')).toBe(12);
    expect(await count('store_policy')).toBe(1);
    expect(await count('shipments')).toBe(before.s);
    expect(await count('messages')).toBe(before.m);
  });

  it('exposes exactly three products', () => {
    expect(PRODUCTS).toEqual([
      { id: 'mug', name: 'Ceramic Mug', price: '18.00' },
      { id: 'tee', name: 'Logo T-Shirt', price: '25.00' },
      { id: 'lamp', name: 'Desk Lamp', price: '49.00' },
    ]);
  });

  it('DEMO-HIST-02 has one delivered, signed shipment and the policy', async () => {
    const db = await makeTestDb();
    await seedStore(db);
    const b = await findOrderBundle(db, 'DEMO-HIST-02');
    expect(b).not.toBeNull();
    expect(b!.order.id).toBe('DEMO-HIST-02');
    expect(b!.order.buyerEmail).toMatch(/@example\.com$/);
    expect(b!.shipments).toHaveLength(1);
    expect(b!.shipments[0]).toMatchObject({ status: 'delivered', signatureProof: true });
    expect(b!.shipments[0]!.deliveredAt).toEqual(expect.any(String));
    expect(b!.policy).toEqual({
      refundWindowDays: 30,
      policyText: 'Returns accepted within 30 days of delivery. Item must be unused.',
    });
  });

  it('DEMO-HIST-07 has no shipments; unknown id is null', async () => {
    const db = await makeTestDb();
    await seedStore(db);
    expect((await findOrderBundle(db, 'DEMO-HIST-07'))!.shipments).toEqual([]);
    expect(await findOrderBundle(db, 'NOPE')).toBeNull();
  });

  it('scenario mix: weak, strong, messages', async () => {
    const db = await makeTestDb();
    await seedStore(db);
    for (const n of ['01', '03']) {
      const b = (await findOrderBundle(db, `DEMO-HIST-${n}`))!;
      expect(b.shipments[0]).toMatchObject({ status: 'delivered', signatureProof: false });
    }
    expect((await findOrderBundle(db, 'DEMO-HIST-04'))!.shipments[0]!.signatureProof).toBe(true);
    for (const n of ['05', '06']) {
      const s = (await findOrderBundle(db, `DEMO-HIST-${n}`))!.shipments[0]!;
      expect(s.status).toBe('in_transit');
      expect(s.deliveredAt).toBeNull();
      expect(s.trackingNumber).toBeTruthy();
    }
    const b10 = (await findOrderBundle(db, 'DEMO-HIST-10'))!;
    const buyerMsg = b10.messages.find((m) => m.sender === 'buyer')!;
    expect(Date.parse(buyerMsg.sentAt) - Date.parse(b10.shipments[0]!.deliveredAt!)).toBe(45 * DAY);
    const b08 = (await findOrderBundle(db, 'DEMO-HIST-08'))!;
    expect(b08.messages.map((m) => m.sender)).toEqual(['buyer', 'seller']);
    expect((await findOrderBundle(db, 'DEMO-HIST-11'))!.messages[0]!.body).toMatch(/arrived, thanks/i);
    const b12 = (await findOrderBundle(db, 'DEMO-HIST-12'))!;
    expect(b12.shipments[0]!.signatureProof).toBe(true);
    expect(b12.messages.some((m) => m.sender === 'buyer')).toBe(true);
  });

  it('orders messages by sentAt and shipments by shippedAt', async () => {
    const db = await makeTestDb();
    await seedStore(db);
    await db.query(
      `insert into messages (order_id, sender, body, sent_at) values ('DEMO-HIST-08','buyer','earlier','2000-01-01T00:00:00Z')`,
    );
    const b = (await findOrderBundle(db, 'DEMO-HIST-08'))!;
    expect(b.messages[0]!.body).toBe('earlier');
  });

  it('findOrderByCaptureId finds an order once its capture id is set', async () => {
    const db = await makeTestDb();
    await seedStore(db);
    expect(await findOrderByCaptureId(db, 'CAP-1')).toBeNull();
    await db.query(`update orders set paypal_capture_id = 'CAP-1' where id = 'DEMO-HIST-03'`);
    const o = await findOrderByCaptureId(db, 'CAP-1');
    expect(o).toMatchObject({ id: 'DEMO-HIST-03', paypalCaptureId: 'CAP-1', currency: 'USD' });
    expect(o!.amount).toMatch(/^\d+\.\d{2}$/);
  });
});
