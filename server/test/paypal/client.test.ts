import { describe, expect, test } from 'vitest';
import { createPayPalClient, PayPalError, RawBody } from '../../src/paypal/client.js';

type Call = { url: string; init: RequestInit };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const tokenRes = (expires_in = 3600) => json(200, { access_token: 'tok-abc', expires_in });

function setup(responses: (Response | Error)[], extra: { gate?: Promise<void> } = {}) {
  const calls: Call[] = [];
  const delays: number[] = [];
  let time = 1_000_000;
  const queue = [...responses];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = queue.shift();
    if (extra.gate) await extra.gate;
    if (!next) throw new Error('no more queued responses');
    if (next instanceof Error) throw next;
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

describe('hardening', () => {
  const netErr = () => Object.assign(new Error('connect ECONNRESET https://secret.example/x'), { name: 'TypeError' });

  test('network error then 200 succeeds after one 500 ms sleep', async () => {
    const { client, delays } = setup([tokenRes(), netErr(), json(200, { ok: 1 })]);
    await expect(client.request('GET', '/a')).resolves.toEqual({ ok: 1 });
    expect(delays).toEqual([500]);
  });

  test('three network errors throw NETWORK_ERROR status 0 with only the error name', async () => {
    const { client, delays } = setup([tokenRes(), netErr(), netErr(), netErr()]);
    const err = await client.request('GET', '/a').catch((e) => e);
    expect(err).toBeInstanceOf(PayPalError);
    expect(err.status).toBe(0);
    expect(err.name).toBe('NETWORK_ERROR');
    expect(err.message).toBe('network error: TypeError');
    expect(err.message).not.toContain('secret.example');
    expect(delays).toEqual([500, 1000]);
  });

  test('timeout (TimeoutError) is retried like a network error', async () => {
    const t = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const { client, delays } = setup([tokenRes(), t, json(200, {})]);
    await client.request('GET', '/a');
    expect(delays).toEqual([500]);
  });

  test('token endpoint 503 then 200 succeeds', async () => {
    const { client, delays, calls } = setup([json(503, {}), tokenRes(), json(200, { ok: 1 })]);
    await expect(client.request('GET', '/a')).resolves.toEqual({ ok: 1 });
    expect(delays).toEqual([500]);
    expect(tokenCalls(calls)).toHaveLength(2);
  });

  test('token endpoint network errors exhaust to NETWORK_ERROR', async () => {
    const { client } = setup([netErr(), netErr(), netErr()]);
    const err = await client.request('GET', '/a').catch((e) => e);
    expect(err.name).toBe('NETWORK_ERROR');
    expect(err.status).toBe(0);
  });

  test('failed token fetch is not cached: next call retries', async () => {
    const { client, calls } = setup([json(401, { name: 'invalid_client' }), tokenRes(), json(200, { ok: 1 })]);
    await client.request('GET', '/a').catch(() => {});
    await expect(client.request('GET', '/a')).resolves.toEqual({ ok: 1 });
    expect(tokenCalls(calls)).toHaveLength(2);
  });

  test('concurrent requests share one token fetch', async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const { client, calls } = setup([tokenRes(), json(200, { n: 1 }), json(200, { n: 2 })], { gate });
    const a = client.request('GET', '/a');
    const b = client.request('GET', '/b');
    open();
    await Promise.all([a, b]);
    expect(tokenCalls(calls)).toHaveLength(1);
  });

  test('401 clears only the token the failing request used', async () => {
    // A and B both use tok-1. A's 401 refreshes to tok-2; B's later 401 must not discard tok-2.
    let tokenN = 0;
    const seen: string[] = [];
    const rel: Record<string, () => void> = {};
    const gates: Record<string, Promise<void>> = {
      a: new Promise((r) => (rel.a = r)),
      b: new Promise((r) => (rel.b = r)),
    };
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      const auth = (init?.headers as Record<string, string>)['Authorization'];
      if (u.endsWith('/v1/oauth2/token')) {
        tokenN++;
        return json(200, { access_token: `tok-${tokenN}`, expires_in: 3600 });
      }
      const which = u.endsWith('/a') ? 'a' : 'b';
      seen.push(`${which}:${auth}`);
      if (auth === 'Bearer tok-1') {
        await gates[which];
        return json(401, {});
      }
      return json(200, { ok: true });
    }) as typeof fetch;
    const client = createPayPalClient({
      clientId: 'c', clientSecret: 's', baseUrl: 'https://api-m.sandbox.paypal.com',
      fetchImpl, sleep: async () => {}, now: () => 1_000_000,
    });
    const a = client.request('GET', '/a');
    const b = client.request('GET', '/b');
    await new Promise((r) => setTimeout(r, 0));
    rel.a!();
    await a; // refreshed to tok-2
    rel.b!(); // B's stale 401 arrives after
    await b;
    expect(tokenN).toBe(2);
    expect(seen).toContain('b:Bearer tok-2');
  });

  test('429 Retry-After seconds waits that long', async () => {
    const r = new Response('{}', { status: 429, headers: { 'retry-after': '2', 'content-type': 'application/json' } });
    const { client, delays } = setup([tokenRes(), r, json(200, {})]);
    await client.request('GET', '/a');
    expect(delays).toEqual([2000]);
  });

  test('429 Retry-After is capped at 5 s', async () => {
    const r = new Response('{}', { status: 429, headers: { 'retry-after': '60' } });
    const { client, delays } = setup([tokenRes(), r, json(200, {})]);
    await client.request('GET', '/a');
    expect(delays).toEqual([5000]);
  });

  test('invalid Retry-After falls back to normal backoff', async () => {
    const r = new Response('{}', { status: 429, headers: { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' } });
    const { client, delays } = setup([tokenRes(), r, json(200, {})]);
    await client.request('GET', '/a');
    expect(delays).toEqual([500]);
  });

  test('every fetch, token call included, carries an abort signal', async () => {
    const { client, calls } = setup([tokenRes(), json(200, {})]);
    await client.request('GET', '/a');
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
    expect(calls[1]!.init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('request bodies', () => {
  test('FormData is passed to fetch unchanged with no Content-Type set by us', async () => {
    const { client, calls } = setup([tokenRes(), json(200, {})]);
    const fd = new FormData();
    fd.append('input', new Blob(['{"a":1}'], { type: 'application/json' }), 'input.json');
    await client.request('POST', '/v1/x', fd, { 'PayPal-Request-Id': 'r1' });
    const init = calls[1]!.init;
    expect(init.body).toBe(fd);
    const h = init.headers as Record<string, string>;
    expect(h['Content-Type']).toBeUndefined();
    expect(h.Authorization).toBe('Bearer tok-abc');
    expect(h['PayPal-Request-Id']).toBe('r1');
  });

  test('RawBody is sent as-is with its own Content-Type', async () => {
    const { client, calls } = setup([tokenRes(), json(200, {})]);
    await client.request('POST', '/v1/x', new RawBody('multipart/form-data; boundary=b', '--b--\r\n'), { 'PayPal-Request-Id': 'r1' });
    const init = calls[1]!.init;
    expect(init.body).toBe('--b--\r\n');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('multipart/form-data; boundary=b');
  });

  test('JSON POST still gets Content-Type application/json', async () => {
    const { client, calls } = setup([tokenRes(), json(200, {})]);
    await client.request('POST', '/v1/x', { a: 1 });
    expect((calls[1]!.init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(calls[1]!.init.body).toBe('{"a":1}');
  });
});
