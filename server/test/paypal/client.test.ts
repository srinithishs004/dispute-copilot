import { describe, expect, test } from 'vitest';
import { createPayPalClient, PayPalError } from '../../src/paypal/client.js';

type Call = { url: string; init: RequestInit };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const tokenRes = (expires_in = 3600) => json(200, { access_token: 'tok-abc', expires_in });

function setup(responses: Response[]) {
  const calls: Call[] = [];
  const delays: number[] = [];
  let time = 1_000_000;
  const queue = [...responses];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = queue.shift();
    if (!next) throw new Error('no more queued responses');
    return next;
  }) as typeof fetch;
  const client = createPayPalClient({
    clientId: 'cid',
    clientSecret: 'secret',
    baseUrl: 'https://api-m.sandbox.paypal.com',
    fetchImpl,
    sleep: async (ms) => {
      delays.push(ms);
    },
    now: () => time,
  });
  return { client, calls, delays, advance: (ms: number) => (time += ms) };
}

const tokenCalls = (calls: Call[]) => calls.filter((c) => c.url.endsWith('/v1/oauth2/token'));

describe('PayPal client', () => {
  test('sends correct token request and bearer auth', async () => {
    const { client, calls } = setup([tokenRes(), json(200, { ok: true })]);
    await client.request('POST', '/v2/checkout/orders', { a: 1 }, { 'PayPal-Request-Id': 'r1' });
    const t = calls[0]!;
    expect(t.url).toBe('https://api-m.sandbox.paypal.com/v1/oauth2/token');
    const th = t.init.headers as Record<string, string>;
    expect(th['Authorization']).toBe(`Basic ${Buffer.from('cid:secret').toString('base64')}`);
    expect(th['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(t.init.body).toBe('grant_type=client_credentials');
    const h = calls[1]!.init.headers as Record<string, string>;
    expect(h['Authorization']).toBe('Bearer tok-abc');
    expect(h['Content-Type']).toBe('application/json');
    expect(h['PayPal-Request-Id']).toBe('r1');
    expect(calls[1]!.init.body).toBe(JSON.stringify({ a: 1 }));
  });

  test('caches the token across requests', async () => {
    const { client, calls } = setup([tokenRes(), json(200, { n: 1 }), json(200, { n: 2 })]);
    await client.request('GET', '/a');
    await client.request('GET', '/b');
    expect(tokenCalls(calls)).toHaveLength(1);
  });

  test('refreshes the token after expiry', async () => {
    const { client, calls, advance } = setup([
      tokenRes(3600),
      json(200, {}),
      tokenRes(3600),
      json(200, {}),
    ]);
    await client.request('GET', '/a');
    advance((3600 - 60) * 1000 + 1);
    await client.request('GET', '/b');
    expect(tokenCalls(calls)).toHaveLength(2);
  });

  test('on 401 refreshes token and retries once', async () => {
    const { client, calls } = setup([tokenRes(), json(401, {}), tokenRes(), json(200, { ok: 1 })]);
    await expect(client.request('GET', '/a')).resolves.toEqual({ ok: 1 });
    expect(tokenCalls(calls)).toHaveLength(2);
  });

  test('401 retry happens only once', async () => {
    const { client, calls } = setup([
      tokenRes(),
      json(401, { name: 'AUTHENTICATION_FAILURE' }),
      tokenRes(),
      json(401, { name: 'AUTHENTICATION_FAILURE' }),
    ]);
    await expect(client.request('GET', '/a')).rejects.toMatchObject({ status: 401 });
    expect(calls).toHaveLength(4);
  });

  test('retries 503 with 500ms then 1000ms backoff', async () => {
    const { client, delays } = setup([tokenRes(), json(503, {}), json(503, {}), json(200, { ok: 1 })]);
    await expect(client.request('GET', '/a')).resolves.toEqual({ ok: 1 });
    expect(delays).toEqual([500, 1000]);
  });

  test('retries 429', async () => {
    const { client, delays } = setup([tokenRes(), json(429, {}), json(200, { ok: 1 })]);
    await client.request('GET', '/a');
    expect(delays).toEqual([500]);
  });

  test('gives up after 3 attempts', async () => {
    const { client, calls } = setup([tokenRes(), json(503, {}), json(503, {}), json(503, {})]);
    const err = await client.request('GET', '/a').catch((e) => e);
    expect(err).toBeInstanceOf(PayPalError);
    expect(err.status).toBe(503);
    expect(calls).toHaveLength(4);
  });

  test('does not retry 422', async () => {
    const { client, calls, delays } = setup([
      tokenRes(),
      json(422, { name: 'UNPROCESSABLE_ENTITY', debug_id: 'dbg1', message: 'bad' }),
    ]);
    const err = await client.request('POST', '/a', {}).catch((e) => e);
    expect(err).toBeInstanceOf(PayPalError);
    expect(err.status).toBe(422);
    expect(err.name).toBe('UNPROCESSABLE_ENTITY');
    expect(err.debugId).toBe('dbg1');
    expect(calls).toHaveLength(2);
    expect(delays).toEqual([]);
  });

  test('handles non-JSON error body', async () => {
    const html = () => new Response('<html>bad gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } });
    const { client } = setup([tokenRes(), html(), html(), html()]);
    const err = await client.request('GET', '/a').catch((e) => e);
    expect(err).toBeInstanceOf(PayPalError);
    expect(err.status).toBe(502);
    expect(err.body).toBe('<html>bad gateway</html>');
    expect(err.debugId).toBeNull();
  });

  test('empty 204 resolves to undefined', async () => {
    const { client } = setup([tokenRes(), new Response(null, { status: 204 })]);
    await expect(client.request('PATCH', '/a', [])).resolves.toBeUndefined();
  });

  test('token endpoint failure throws PayPalError without leaking secrets', async () => {
    const { client, calls } = setup([json(401, { name: 'invalid_client' })]);
    const err = await client.request('GET', '/a').catch((e) => e);
    expect(err).toBeInstanceOf(PayPalError);
    expect(err.status).toBe(401);
    expect(calls).toHaveLength(1);
    expect(err.message).not.toContain('secret');
  });
});

describe('content-type on requests without a body', () => {
  test('POST without a body still sends Content-Type: application/json (PayPal returns 415 otherwise)', async () => {
    const { client, calls } = setup([tokenRes(), json(201, { id: 'X' })]);
    await client.request('POST', '/v2/checkout/orders/ORD-1/capture');
    const api = calls[1]!;
    expect((api.init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(api.init.body).toBeUndefined();
  });

  test('GET without a body sends no Content-Type', async () => {
    const { client, calls } = setup([tokenRes(), json(200, { items: [] })]);
    await client.request('GET', '/v1/customer/disputes');
    expect((calls[1]!.init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });
});
