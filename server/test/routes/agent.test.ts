import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { COOKIE_NAME, signSession } from '../../src/auth/session.js';
import type { Config } from '../../src/config.js';
import { makeTestDeps, testConfig } from '../helpers.js';

const SECRET = 'x'.repeat(40);
const ORIGIN = 'http://localhost:3000';
const config: Config = {
  ...testConfig,
  auth: {
    owner: { email: 'owner@x.test', passwordHash: 'x' },
    judge: { email: 'judge@x.test', passwordHash: 'x' },
    sessionSecret: SECRET,
  },
  llm: { gemini: { apiKey: 'gk', model: 'gm' }, groq: { apiKey: 'qk', model: 'qm' }, timeoutMs: 5_000 },
};
const NOW = Date.parse('2026-10-28T12:00:00Z');

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ok = (message: unknown) => json(200, { choices: [{ index: 0, message, finish_reason: 'stop' }] });

type Reply = Response | Error | (() => Response);
function setup(replies: Reply[] | ((n: number) => Reply) = () => ok({ role: 'assistant', content: 'Done.' })) {
  const calls: { url: string; body: string }[] = [];
  const warns: string[] = [];
  const infos: string[] = [];
  let clock = NOW;
  const llmFetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), body: String(init.body) });
    const r = typeof replies === 'function' ? replies(calls.length) : replies[calls.length - 1];
    if (!r) throw new Error('unexpected extra call');
    if (r instanceof Error) throw r;
    return typeof r === 'function' ? r() : r;
  }) as unknown as typeof fetch;
  const app = createApp(
    makeTestDeps({
      config,
      now: () => clock,
      llmFetch,
      logger: { info: (m: string) => infos.push(m), warn: (m: string) => warns.push(m) },
    }),
  );
  const cookie = (role: 'owner' | 'judge') => `${COOKIE_NAME}=${signSession({ role, email: `${role}@x.test` }, SECRET, NOW)}`;
  const advance = (ms: number) => {
    clock += ms;
  };
  return { app, calls, warns, infos, cookie, advance };
}

const turn = {
  instructions: 'You are the analyst.',
  input: [{ id: 'u1', kind: 'input', type: 'message', role: 'user', status: 'completed', content: [{ type: 'text', text: 'Which buyer is carol@buyer.test?' }] }],
  tools: [],
  responseFormat: { type: 'text' },
};

const post = (app: ReturnType<typeof setup>['app'], cookie: string, body: unknown = turn) =>
  request(app).post('/api/agent/turn').set('Cookie', cookie).set('Origin', ORIGIN).send(body as object);

describe('POST /api/agent/turn', () => {
  it('401 without a session', async () => {
    const { app, calls } = setup();
    const res = await request(app).post('/api/agent/turn').send(turn);
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('403 for a cookie session from another origin', async () => {
    const { app, cookie } = setup();
    const res = await request(app).post('/api/agent/turn').set('Cookie', cookie('judge')).set('Origin', 'https://evil.test').send(turn);
    expect(res.status).toBe(403);
  });

  it('returns an AgLlmResponse; Gemini 500 falls back to Groq and only the reason code is logged', async () => {
    const { app, cookie, calls, warns, infos } = setup([
      json(500, {}),
      ok({ role: 'assistant', content: 'Two disputes.', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'delegate_to', arguments: '{"type":{"id":"page"}}' } }] }),
    ]);
    const res = await post(app, cookie('judge'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'completed', model: 'groq:qm' });
    expect(typeof res.body.id).toBe('string');
    expect(typeof res.body.createdAt).toBe('number');
    expect(res.body.output).toEqual([
      expect.objectContaining({ kind: 'output', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'Two disputes.', annotations: [] }] }),
      expect.objectContaining({ kind: 'output', type: 'function_call', callId: 'call_1', name: 'delegate_to', arguments: '{"type":{"id":"page"}}', status: 'completed' }),
    ]);
    expect(calls.map((c) => new URL(c.url).hostname)).toEqual(['generativelanguage.googleapis.com', 'api.groq.com']);
    const logs = [...warns, ...infos].join('\n');
    expect(logs).toContain('agent fallback: gemini:http_500');
    expect(logs).not.toContain('analyst');
    expect(logs).not.toContain('buyer');
  });

  it('503 when both providers are down', async () => {
    const { app, cookie, warns } = setup([json(500, {}), new Error('down')]);
    const res = await post(app, cookie('owner'));
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'analyst unavailable' });
    expect(warns.join('\n')).toContain('gemini:http_500, groq:network');
    expect(warns.join('\n')).not.toContain('carol');
  });

  it('redacts emails before anything leaves the server', async () => {
    const { app, cookie, calls } = setup();
    const res = await post(app, cookie('owner'));
    expect(res.status).toBe(200);
    expect(calls[0]!.body).not.toContain('carol@buyer.test');
    expect(calls[0]!.body).toContain('[email]');
  });

  it('accepts a 300 KB turn (over the global 100 KB limit) and rejects over 512 KB', async () => {
    const { app } = setup();
    const big = (n: number) => ({ ...turn, instructions: 'x'.repeat(n) });
    const okRes = await request(app).post('/api/agent/turn').set('x-debug-token', 'dbg').send(big(300_000));
    expect(okRes.status).toBe(200);
    const tooBig = await request(app).post('/api/agent/turn').set('x-debug-token', 'dbg').send(big(600_000));
    expect(tooBig.status).toBe(413);
    expect(tooBig.body).toEqual({ error: 'request too large' });
  });

  it.each([
    ['non-array content', { type: 'message', role: 'user', content: { text: 'hi' } }],
    ['numeric content', { type: 'message', role: 'user', content: 5 }],
    ['part without string text', { type: 'message', role: 'user', content: [{ type: 'text', text: 5 }] }],
    ['null part', { type: 'message', role: 'user', content: [null] }],
    ['function_call without callId', { type: 'function_call', name: 't', arguments: '{}' }],
    ['function_call with non-string arguments', { type: 'function_call', callId: 'c', name: 't', arguments: {} }],
    ['function_call without name', { type: 'function_call', callId: 'c', arguments: '{}' }],
    ['function_call_output without callId', { type: 'function_call_output', output: 'x' }],
    ['function_call_output with non-string output', { type: 'function_call_output', callId: 'c', output: 1 }],
  ])('400 for a malformed item (%s), never a provider call', async (_n, item) => {
    const { app, calls, cookie } = setup();
    const res = await post(app, cookie('owner'), { ...turn, input: [item] });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid request' });
    expect(calls).toHaveLength(0);
  });

  it('accepts string content, text parts and tool items', async () => {
    const { app, cookie } = setup();
    const input = [
      { type: 'message', role: 'user', content: 'plain string' },
      { type: 'message', role: 'assistant', content: [{ type: 'text', text: 'ok' }, { type: 'refusal', refusal: 'no' }] },
      { type: 'function_call', callId: 'c', name: 't', arguments: '{}' },
      { type: 'function_call_output', callId: 'c', output: 'done' },
      { type: 'reasoning', summary: [] },
    ];
    const res = await post(app, cookie('owner'), { ...turn, input });
    expect(res.status).toBe(200);
  });

  it('400 for a body without an input array', async () => {
    const { app, calls } = setup();
    const res = await request(app).post('/api/agent/turn').set('x-debug-token', 'dbg').send({ responseFormat: { type: 'text' } });
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('61st turn in a minute for one session gets 429; other sessions and the next minute are fine', async () => {
    const { app, cookie, calls, advance } = setup();
    for (let i = 0; i < 60; i++) expect((await post(app, cookie('owner'))).status).toBe(200);
    const limited = await post(app, cookie('owner'));
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ error: 'analyst busy, try again shortly' });
    expect(calls).toHaveLength(60);
    expect((await post(app, cookie('judge'))).status).toBe(200);
    advance(60_001);
    expect((await post(app, cookie('owner'))).status).toBe(200);
  });

  it('debug token turns are limited per IP', async () => {
    const { app } = setup();
    for (let i = 0; i < 60; i++) {
      expect((await request(app).post('/api/agent/turn').set('x-debug-token', 'dbg').send(turn)).status).toBe(200);
    }
    expect((await request(app).post('/api/agent/turn').set('x-debug-token', 'dbg').send(turn)).status).toBe(429);
  });
});
