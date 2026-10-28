import request from 'supertest';
import { beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../../src/app.js';
import type { Db } from '../../src/db/db.js';
import { errorPage, thankYouPage } from '../../src/store/pages.js';
import { seedStore } from '../../src/store/seed.js';
import { fakeClient, type RecordedCall } from '../paypal/fake.js';
import { makeTestDb, makeTestDeps } from '../helpers.js';

function paypalReplies(call: RecordedCall): unknown {
  if (call.path === '/v2/checkout/orders') {
    return { id: 'PP-ORDER-1', links: [{ rel: 'payer-action', href: 'https://paypal.example/approve?token=PP-ORDER-1' }] };
  }
  return { status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'CAP-1' }] } }] };
}

const squash = (s: string) => s.replace(/\s+/g, ' ');

let db: Db;
let fake: ReturnType<typeof fakeClient>;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  db = await makeTestDb();
  await seedStore(db);
  fake = fakeClient(paypalReplies);
  app = createApp(makeTestDeps({ db, paypal: fake.client }));
});

async function checkout(productId = 'mug') {
  return request(app).post('/store/checkout').type('form').send({ productId });
}

describe('GET /store', () => {
  test('lists the products with a Buy with PayPal button', async () => {
    const res = await request(app).get('/store');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html; charset=utf-8/);
    expect(res.text).toContain('Dispute Copilot Demo Store');
    for (const name of ['Ceramic Mug', 'Logo T-Shirt', 'Desk Lamp']) expect(res.text).toContain(name);
    expect(res.text.match(/Buy with PayPal/g)).toHaveLength(3);
  });

  test('uses the Kaala shell: top bar, sandbox note, footer, theme script and fonts', async () => {
    const res = await request(app).get('/store');
    expect(res.text).toContain('<a class="wordmark" href="/">Dispute Copilot</a>');
    expect(res.text).toContain('Demo store');
    expect(res.text).toContain('Sandbox demo. Pay with the sandbox buyer account from the guide. No real money moves.');
    expect(res.text).toContain('href="/guide"');
    expect(res.text).toContain('href="/privacy"');
    expect(res.text).toContain('href="/terms"');
    expect(res.text).toContain('Sandbox demo, no real money');
    expect(res.text).toContain('<script src="/theme-init.js"></script>');
    expect(res.text).toContain('fonts.googleapis.com/css2?family=');
    expect(res.text).toContain('Manrope');
    expect(res.text).toContain('JetBrains+Mono');
    expect(res.text).toContain('[data-theme="day"]');
    expect(res.text).toContain('prefers-color-scheme: light');
    // The CSP forbids inline scripts: the only script tag is the external theme file.
    expect(res.text.match(/<script/g)).toHaveLength(1);
    expect(res.text).not.toMatch(/[\u2013\u2014]/);
  });

  test('the buy button keeps a visible focus ring', async () => {
    const res = await request(app).get('/store');
    expect(squash(res.text)).toMatch(/\.btn:focus-visible ?\{ ?box-shadow: ?var\(--focus\)/);
  });

  test('each product has a checkout form with a hidden productId', async () => {
    const res = await request(app).get('/store');
    expect(res.text.match(/action="\/store\/checkout"/g)).toHaveLength(3);
    for (const id of ['mug', 'tee', 'lamp']) {
      expect(res.text).toMatch(new RegExp(`<input type="hidden" name="productId" value="${id}">`));
    }
  });

  test('prices render in a mono, tabular element', async () => {
    const res = await request(app).get('/store');
    expect(res.text).toContain('<p class="price">$25.00</p>');
    expect(squash(res.text)).toMatch(/\.price ?\{[^}]*font-variant-numeric: ?tabular-nums/);
  });
});

describe('page HTML escaping', () => {
  test('error pages escape the title and message', () => {
    const html = errorPage('<img src=x onerror=alert(1)>', '"><script>alert(2)</script>');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&quot;&gt;&lt;script&gt;alert(2)&lt;/script&gt;');
  });

  test('the thank-you page escapes the order id', () => {
    const html = thankYouPage('<b>ORD-1</b>');
    expect(html).not.toContain('<b>ORD-1</b>');
    expect(html).toContain('&lt;b&gt;ORD-1&lt;/b&gt;');
  });
});

describe('POST /store/checkout', () => {
  test('creates a pending order and redirects 303 to the approve URL', async () => {
    const res = await checkout('tee');
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('https://paypal.example/approve?token=PP-ORDER-1');
    const { rows } = await db.query<Record<string, unknown>>("select * from orders where id like 'ORD-%'");
    expect(rows).toHaveLength(1);
    const o = rows[0]!;
    expect(o.id).toMatch(/^ORD-[0-9A-Z]{8}$/);
    expect(o.status).toBe('PENDING');
    expect(o.paypal_order_id).toBe('PP-ORDER-1');
    expect(o.buyer_email).toBeNull();
    expect(o.amount).toBe('25.00');
    const call = fake.calls[0]!;
    const body = call.body as any;
    expect(body.purchase_units[0].invoice_id).toBe(o.id);
    expect(body.purchase_units[0].amount.value).toBe('25.00');
    expect(body.payment_source.paypal.experience_context.return_url).toBe('http://localhost:3000/store/return');
    expect(body.payment_source.paypal.experience_context.cancel_url).toBe('http://localhost:3000/store/cancel');
    expect(call.headers).toEqual({ 'PayPal-Request-Id': `create-${o.id}` });
  });

  test('unknown product returns a 400 page and makes no PayPal call', async () => {
    const before = (await db.query('select 1 from orders')).rows.length;
    const res = await checkout('nope');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(fake.calls).toHaveLength(0);
    expect((await db.query('select 1 from orders')).rows).toHaveLength(before);
  });

  test('missing product id returns 400', async () => {
    const res = await request(app).post('/store/checkout').type('form').send({});
    expect(res.status).toBe(400);
  });
});

describe('GET /store/return', () => {
  test('captures once, marks PAID, creates a shipment and thanks the buyer', async () => {
    await checkout();
    const res = await request(app).get('/store/return?token=PP-ORDER-1');
    expect(res.status).toBe(200);
    const o = (await db.query<Record<string, unknown>>("select * from orders where paypal_order_id = 'PP-ORDER-1'")).rows[0]!;
    expect(o.status).toBe('PAID');
    expect(o.paypal_capture_id).toBe('CAP-1');
    expect(res.text).toContain(o.id as string);
    const cap = fake.calls.filter((c) => c.path.endsWith('/capture'));
    expect(cap).toHaveLength(1);
    expect(cap[0]!.path).toBe('/v2/checkout/orders/PP-ORDER-1/capture');
    expect(cap[0]!.headers).toEqual({ 'PayPal-Request-Id': `capture-${o.id}` });
    const ships = (await db.query<Record<string, unknown>>('select * from shipments where order_id = $1', [o.id])).rows;
    expect(ships).toHaveLength(1);
    expect(ships[0]).toMatchObject({ order_id: o.id, carrier: 'USPS', status: 'in_transit' });
    expect(ships[0]!.tracking_number).toMatch(/^9400\d{18}$/);
    expect(ships[0]!.shipped_at).not.toBeNull();
  });

  test('a second return does not capture or ship again', async () => {
    await checkout();
    await request(app).get('/store/return?token=PP-ORDER-1');
    const again = await request(app).get('/store/return?token=PP-ORDER-1');
    expect(again.status).toBe(200);
    expect(again.text).toContain('ORD-');
    expect(fake.calls.filter((c) => c.path.endsWith('/capture'))).toHaveLength(1);
    const o = (await db.query<{ id: string }>("select id from orders where paypal_order_id = 'PP-ORDER-1'")).rows[0]!;
    expect((await db.query('select 1 from shipments where order_id = $1', [o.id])).rows).toHaveLength(1);
  });

  test('missing or unknown token returns 400 without calling PayPal', async () => {
    const a = await request(app).get('/store/return');
    const b = await request(app).get('/store/return?token=UNKNOWN');
    expect(a.status).toBe(400);
    expect(b.status).toBe(400);
    expect(fake.calls).toHaveLength(0);
  });
});

describe('GET /store/cancel', () => {
  test('shows a friendly cancelled page', async () => {
    const res = await request(app).get('/store/cancel');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Payment canceled. Nothing was charged.');
    expect(res.text).toContain('Back to the store');
  });
});
