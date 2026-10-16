import type { PayPalClient } from './client.js';

type Link = { rel: string; href: string };

export async function createOrder(
  c: PayPalClient,
  input: {
    invoiceId: string;
    amount: string;
    currency: 'USD';
    description: string;
    /** Where PayPal sends the buyer after approving. Without it the approval page may not complete. */
    returnUrl?: string;
    cancelUrl?: string;
    /** Sent as PayPal-Request-Id so a retried create cannot make a second order. */
    requestId?: string;
  },
): Promise<{ id: string; approveUrl: string }> {
  const res = await c.request<{ id: string; links?: Link[] }>('POST', '/v2/checkout/orders', {
    intent: 'CAPTURE',
    ...(input.returnUrl && {
      payment_source: {
        paypal: {
          experience_context: {
            return_url: input.returnUrl,
            cancel_url: input.cancelUrl ?? input.returnUrl,
            user_action: 'PAY_NOW',
            shipping_preference: 'NO_SHIPPING',
          },
        },
      },
    }),
    purchase_units: [
      {
        invoice_id: input.invoiceId,
        description: input.description,
        amount: { currency_code: input.currency, value: input.amount },
      },
    ],
  }, input.requestId ? { 'PayPal-Request-Id': input.requestId } : undefined);
  const link = res.links?.find((l) => l.rel === 'payer-action' || l.rel === 'approve');
  if (!link) throw new Error(`PayPal order ${res.id} returned no approve link`);
  return { id: res.id, approveUrl: link.href };
}

export async function captureOrder(
  c: PayPalClient,
  orderId: string,
  opts?: { requestId?: string },
): Promise<{ status: string; captureId: string }> {
  const res = await c.request<{
    status: string;
    purchase_units?: { payments?: { captures?: { id?: string }[] } }[];
  }>('POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, undefined, opts?.requestId ? { 'PayPal-Request-Id': opts.requestId } : undefined);
  const captureId = res.purchase_units?.[0]?.payments?.captures?.[0]?.id;
  if (!captureId) throw new Error(`PayPal capture response for order ${orderId} has no capture id`);
  return { status: res.status, captureId };
}
