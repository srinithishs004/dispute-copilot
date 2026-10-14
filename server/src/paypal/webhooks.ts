import type { PayPalClient } from './client.js';

const REQUIRED = [
  'paypal-auth-algo',
  'paypal-cert-url',
  'paypal-transmission-id',
  'paypal-transmission-sig',
  'paypal-transmission-time',
] as const;

export class MissingHeadersError extends Error {
  constructor(public readonly missing: string[]) {
    super(`Missing webhook headers: ${missing.join(', ')}`);
    this.name = 'MissingHeadersError';
  }
}

export async function verifyWebhook(
  c: PayPalClient,
  webhookId: string,
  headers: Record<string, string | undefined>,
  event: unknown,
): Promise<boolean> {
  const missing = REQUIRED.filter((h) => !headers[h]);
  if (missing.length > 0) throw new MissingHeadersError([...missing]);
  const res = await c.request<{ verification_status?: string }>(
    'POST',
    '/v1/notifications/verify-webhook-signature',
    {
      auth_algo: headers['paypal-auth-algo'],
      cert_url: headers['paypal-cert-url'],
      transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'],
      webhook_id: webhookId,
      webhook_event: event,
    },
  );
  return res?.verification_status === 'SUCCESS';
}
