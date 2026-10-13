import type { PayPalClient } from './client.js';

type Link = { rel: string; href: string };

export async function createOrder(
  c: PayPalClient,
  input: { invoiceId: string; amount: string; currency: 'USD'; description: string },
): Promise<{ id: string; approveUrl: string }> {
  const res = await c.request<{ id: string; links?: Link[] }>('POST', '/v2/checkout/orders', {
    intent: 'CAPTURE',
    purchase_units: [
      {
        invoice_id: input.invoiceId,
        description: input.description,
        amount: { currency_code: input.currency, value: input.amount },
      },
    ],
  });
  const link = res.links?.find((l) => l.rel === 'payer-action' || l.rel === 'approve');
  if (!link) throw new Error(`PayPal order ${res.id} returned no approve link`);
  return { id: res.id, approveUrl: link.href };
}

export async function captureOrder(
  c: PayPalClient,
  orderId: string,
): Promise<{ status: string; captureId: string }> {
  const res = await c.request<{
    status: string;
    purchase_units?: { payments?: { captures?: { id?: string }[] } }[];
  }>('POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`);
  const captureId = res.purchase_units?.[0]?.payments?.captures?.[0]?.id;
  if (!captureId) throw new Error(`PayPal capture response for order ${orderId} has no capture id`);
  return { status: res.status, captureId };
}
