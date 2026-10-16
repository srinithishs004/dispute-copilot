import type { PayPalClient } from '../../src/paypal/client.js';

export type RecordedCall = {
  method: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
};

/** Fake PayPal client. `response` is a canned value, or a function of the call for per-path replies. */
export function fakeClient(response: unknown | ((call: RecordedCall) => unknown)) {
  const calls: RecordedCall[] = [];
  const client: PayPalClient = {
    async request<T>(
      method: 'GET' | 'POST' | 'PATCH',
      path: string,
      body?: unknown,
      headers?: Record<string, string>,
    ) {
      const call: RecordedCall = { method, path, body, headers };
      calls.push(call);
      return (typeof response === 'function' ? (response as (c: RecordedCall) => unknown)(call) : response) as T;
    },
  };
  return { client, calls };
}
