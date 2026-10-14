import type { PayPalClient } from '../../src/paypal/client.js';

export type RecordedCall = { method: string; path: string; body?: unknown };

export function fakeClient(response: unknown) {
  const calls: RecordedCall[] = [];
  const client: PayPalClient = {
    async request<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown) {
      calls.push({ method, path, body });
      return response as T;
    },
  };
  return { client, calls };
}
