import { describe, expect, test } from 'vitest';
import { captureOrder, createOrder } from '../../src/paypal/orders.js';
import { fakeClient } from './fake.js';

const input = { invoiceId: 'DEMO-1', amount: '10.00', currency: 'USD' as const, description: 'Demo' };

describe('createOrder', () => {
  test('sends invoice_id and returns approve link', async () => {
    const { client, calls } = fakeClient({
      id: 'ORD-1',
      links: [
        { rel: 'self', href: 'https://x/self' },
        { rel: 'payer-action', href: 'https://x/approve' },
      ],
    });
    const out = await createOrder(client, input);
    expect(out).toEqual({ id: 'ORD-1', approveUrl: 'https://x/approve' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.path).toBe('/v2/checkout/orders');
    const body = calls[0]!.body as any;
    expect(body.intent).toBe('CAPTURE');
    expect(body.purchase_units[0].invoice_id).toBe('DEMO-1');
    expect(body.purchase_units[0].description).toBe('Demo');
    expect(body.purchase_units[0].amount).toEqual({ currency_code: 'USD', value: '10.00' });
  });

  test('accepts rel=approve', async () => {
    const { client } = fakeClient({ id: 'ORD-2', links: [{ rel: 'approve', href: 'https://x/a' }] });
    expect((await createOrder(client, input)).approveUrl).toBe('https://x/a');
  });

  test('throws when no approve link is returned', async () => {
    const { client } = fakeClient({ id: 'ORD-3', links: [{ rel: 'self', href: 'https://x/s' }] });
    await expect(createOrder(client, input)).rejects.toThrow(/no approve link/i);
  });
});

describe('captureOrder', () => {
  test('returns capture id', async () => {
    const { client, calls } = fakeClient({
      status: 'COMPLETED',
      purchase_units: [{ payments: { captures: [{ id: 'CAP-1' }] } }],
    });
    expect(await captureOrder(client, 'ORD-1')).toEqual({ status: 'COMPLETED', captureId: 'CAP-1' });
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/v2/checkout/orders/ORD-1/capture' });
  });

  test('throws when capture id is missing', async () => {
    const { client } = fakeClient({ status: 'COMPLETED', purchase_units: [{}] });
    await expect(captureOrder(client, 'ORD-1')).rejects.toThrow(/capture id/i);
  });
});
