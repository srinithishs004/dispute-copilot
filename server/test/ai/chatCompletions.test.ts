import { describe, expect, test } from 'vitest';
import {
  callChatCompletions,
  createSignatureStore,
  fromChatCompletion,
  makeIdMap,
  runAgentTurn,
  shortCallId,
  toChatMessages,
  toChatRequest,
  type AgLlmRequest,
} from '../../src/ai/chatCompletions.js';
import { LlmUnavailableError } from '../../src/ai/llm.js';

type Call = { url: string; headers: Record<string, string>; body: any };
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const completion = (message: unknown) => ({ id: 'x', choices: [{ index: 0, message, finish_reason: 'stop' }] });

function fake(responses: Array<Response | Error>) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: any, init: any) => {
    calls.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    const r = responses[calls.length - 1];
    if (!r) throw new Error('unexpected extra call');
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const LONG_A = 'run-0b6c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d-preflight-0'; // 52 chars, like Studio's preflight ids
const LONG_B = 'run-0b6c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d-preflight-1';

const req: AgLlmRequest = {
  instructions: 'You are the page agent.',
  input: [
    { id: 'u1', kind: 'input', type: 'message', role: 'user', status: 'completed', content: [{ type: 'text', text: 'Chart for jane.doe@example.com' }, { type: 'text', text: 'please' }] },
    { id: 'r1', kind: 'output', type: 'reasoning', summary: [{ type: 'summary', text: 'thinking' }] },
    { id: 'm1', kind: 'output', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'text', text: 'Looking.', annotations: [] }] },
    { id: 'f1', kind: 'output', type: 'function_call', callId: LONG_A, name: 'view_page', arguments: '{}', status: 'completed' },
    { id: 'f2', kind: 'output', type: 'function_call', callId: LONG_B, name: 'view_plan', arguments: '{}', status: 'completed' },
    { type: 'function_call_output', callId: LONG_A, output: '{"success":true,"response":"owner bob@shop.test"}', status: 'completed' },
    { type: 'function_call_output', callId: LONG_B, output: '{"success":true}', status: 'completed' },
  ],
  tools: [{ name: 'add_widget', description: 'Add a widget', parameters: { type: 'object', properties: {} }, kind: 'client' }],
  responseFormat: { type: 'text' },
};

describe('call id mapping', () => {
  test('short ids are deterministic, at most 40 chars, and map back', () => {
    const a = shortCallId(LONG_A);
    expect(a).toBe(shortCallId(LONG_A));
    expect(a).not.toBe(shortCallId(LONG_B));
    expect(a.length).toBeLessThanOrEqual(40);
    expect(a).toMatch(/^c_[0-9a-f]{30}$/);
    const ids = makeIdMap();
    expect(ids.toShort(LONG_A)).toBe(a);
    expect(ids.toOriginal(a)).toBe(LONG_A);
    expect(ids.toOriginal('call_invented')).toBe('call_invented');
  });
});

describe('toChatMessages', () => {
  test('maps the Studio conversation to chat messages, redacting emails', () => {
    const ids = makeIdMap();
    const msgs = toChatMessages(req, ids);
    const a = shortCallId(LONG_A);
    const b = shortCallId(LONG_B);
    expect(msgs).toEqual([
      { role: 'system', content: 'You are the page agent.' },
      { role: 'user', content: 'Chart for [email]\nplease' },
      {
        role: 'assistant',
        content: 'Looking.',
        tool_calls: [
          { id: a, type: 'function', function: { name: 'view_page', arguments: '{}' } },
          { id: b, type: 'function', function: { name: 'view_plan', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: a, content: '{"success":true,"response":"owner [email]"}' },
      { role: 'tool', tool_call_id: b, content: '{"success":true}' },
    ]);
    expect(JSON.stringify(msgs)).not.toContain('@');
  });

  test('system input messages, input_text parts, and lone function calls', () => {
    const msgs = toChatMessages(
      {
        responseFormat: { type: 'text' },
        input: [
          { id: 's', kind: 'input', type: 'message', role: 'system', status: 'completed', content: [{ type: 'input_text', text: 'ctx' } as any] },
          { id: 'f', kind: 'output', type: 'function_call', callId: 'abc', name: 't', arguments: '', status: 'completed' },
          { type: 'function_call_output', callId: 'abc', output: 'ok', status: 'completed' },
        ],
      },
      makeIdMap(),
    );
    expect(msgs).toEqual([
      { role: 'system', content: 'ctx' },
      { role: 'assistant', content: null, tool_calls: [{ id: shortCallId('abc'), type: 'function', function: { name: 't', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: shortCallId('abc'), content: 'ok' },
    ]);
  });
});

describe('JSON-safe redaction of tool traffic', () => {
  const call = (args: string, output: string): AgLlmRequest => ({
    responseFormat: { type: 'text' },
    input: [
      { id: 'f', kind: 'output', type: 'function_call', callId: 'abc', name: 't', arguments: args, status: 'completed' },
      { type: 'function_call_output', callId: 'abc', output, status: 'completed' },
    ],
  });

  test('escaped quotes around an email keep arguments and output valid JSON', () => {
    const tricky = '{"r":"say \\"bob@x.com\\" now"}';
    const msgs = toChatMessages(call(tricky, tricky), makeIdMap());
    const a = (msgs[0] as any).tool_calls[0].function.arguments as string;
    const o = (msgs[1] as any).content as string;
    for (const s of [a, o]) {
      expect(() => JSON.parse(s)).not.toThrow();
      expect(s).not.toContain('bob@x.com');
      expect(JSON.parse(s).r).toBe('say "[email]" now');
    }
  });

  test('redacts nested values and keys stay intact', () => {
    const out = '{"rows":[{"email":"a.b@shop.test","n":3,"ok":true,"x":null}],"owner":"c@d.org"}';
    const msgs = toChatMessages(call('{}', out), makeIdMap());
    expect(JSON.parse((msgs[1] as any).content)).toEqual({ rows: [{ email: '[email]', n: 3, ok: true, x: null }], owner: '[email]' });
  });

  test('non-JSON text falls back to text redaction', () => {
    const msgs = toChatMessages(call('not json bob@x.com', 'plain bob@x.com'), makeIdMap());
    expect((msgs[0] as any).tool_calls[0].function.arguments).toBe('not json [email]');
    expect((msgs[1] as any).content).toBe('plain [email]');
  });
});

describe('string message content', () => {
  test('a plain string content is sent as text with emails redacted', () => {
    const msgs = toChatMessages(
      { responseFormat: { type: 'text' }, input: [{ type: 'message', role: 'user', content: 'hi bob@x.com' as any }] },
      makeIdMap(),
    );
    expect(msgs).toEqual([{ role: 'user', content: 'hi [email]' }]);
  });
});

describe('toChatRequest', () => {
  test('tools drop kind; temperature 0.2; no tool_choice when unset', () => {
    const body = toChatRequest(req, { ids: makeIdMap(), provider: 'groq', model: 'qm' });
    expect(body.model).toBe('qm');
    expect(body.temperature).toBe(0.2);
    expect(body.tools).toEqual([{ type: 'function', function: { name: 'add_widget', description: 'Add a widget', parameters: { type: 'object', properties: {} } } }]);
    expect(body).not.toHaveProperty('tool_choice');
    expect(body).not.toHaveProperty('response_format');
  });

  test('toolChoice passthrough and named tool', () => {
    const mk = (toolChoice: AgLlmRequest['toolChoice']) =>
      toChatRequest({ ...req, toolChoice }, { ids: makeIdMap(), provider: 'groq', model: 'qm' }).tool_choice;
    expect(mk('auto')).toBe('auto');
    expect(mk('none')).toBe('none');
    expect(mk('required')).toBe('required');
    expect(mk({ name: 'add_widget' })).toEqual({ type: 'function', function: { name: 'add_widget' } });
  });

  test('json response format becomes json_object and is mentioned in the system message', () => {
    const body = toChatRequest(
      { ...req, instructions: undefined, tools: [], responseFormat: { type: 'json', name: 'plan', schema: { type: 'object' } } },
      { ids: makeIdMap(), provider: 'groq', model: 'qm' },
    );
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toMatch(/JSON/);
    expect(body.messages[0].content).toContain('plan');
    expect(body).not.toHaveProperty('tools');
  });

  test('Gemini tool calls carry thought signatures (cached or the documented skip value); Groq never does', () => {
    const sigs = createSignatureStore();
    sigs.set(LONG_A, 'SIG-A');
    const g = toChatRequest(req, { ids: makeIdMap(), provider: 'gemini', model: 'gm', signatures: sigs });
    const calls = g.messages.find((m: any) => m.tool_calls).tool_calls;
    expect(calls[0].extra_content).toEqual({ google: { thought_signature: 'SIG-A' } });
    expect(calls[1].extra_content).toEqual({ google: { thought_signature: 'skip_thought_signature_validator' } });
    const q = toChatRequest(req, { ids: makeIdMap(), provider: 'groq', model: 'qm', signatures: sigs });
    expect(JSON.stringify(q)).not.toContain('extra_content');
  });
});

describe('fromChatCompletion', () => {
  test('text and tool calls become output items with original call ids', () => {
    const ids = makeIdMap();
    const short = ids.toShort(LONG_A);
    const res = fromChatCompletion(
      {
        role: 'assistant',
        content: 'Placing it.',
        tool_calls: [
          { id: short, type: 'function', function: { name: 'add_widget', arguments: '{"widgetId":"w1"}' } },
          { id: 'call_new', type: 'function', function: { name: 'complete_task', arguments: '{"summary":"s","artifacts":[]}' } },
        ],
      },
      'gemini:gm',
      ids,
    );
    expect(res.status).toBe('completed');
    expect(res.model).toBe('gemini:gm');
    expect(typeof res.id).toBe('string');
    expect(typeof res.createdAt).toBe('number');
    expect(res.output).toHaveLength(3);
    expect(res.output[0]).toMatchObject({ kind: 'output', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'text', text: 'Placing it.', annotations: [] }] });
    expect(res.output[1]).toMatchObject({ kind: 'output', type: 'function_call', callId: LONG_A, name: 'add_widget', arguments: '{"widgetId":"w1"}', status: 'completed' });
    expect(res.output[2]).toMatchObject({ type: 'function_call', callId: 'call_new', name: 'complete_task' });
    expect(new Set(res.output.map((o) => o.id)).size).toBe(3);
  });

  test('a tool call without an id gets one; a call with no text gives no message item', () => {
    const res = fromChatCompletion(
      { role: 'assistant', content: null, tool_calls: [{ type: 'function', function: { name: 't', arguments: '' } }] },
      'groq:qm',
      makeIdMap(),
    );
    expect(res.output).toHaveLength(1);
    const fc = res.output[0] as any;
    expect(fc.callId).toMatch(/^call_/);
    expect(fc.callId.length).toBeLessThanOrEqual(40);
    expect(fc.arguments).toBe('{}');
  });
});

describe('callChatCompletions', () => {
  const opts = (f: typeof fetch, g: string | null = 'gk', q: string | null = 'qk') => ({
    gemini: { apiKey: g, model: 'gm' },
    groq: { apiKey: q, model: 'qm' },
    timeoutMs: 5_000,
    fetchImpl: f,
  });
  const build = (p: 'gemini' | 'groq', model: string) => ({ model, provider: p });
  const msg = { role: 'assistant', content: 'hi' };

  test('Gemini first, via the OpenAI-compatible endpoint with a Bearer key', async () => {
    const f = fake([json(200, completion(msg))]);
    const r = await callChatCompletions(opts(f.fetchImpl), build);
    expect(r).toMatchObject({ data: msg, model: 'gemini:gm', provider: 'gemini', reasons: [] });
    expect(f.calls[0]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
    expect(f.calls[0]!.headers.Authorization).toBe('Bearer gk');
    expect(f.calls[0]!.body).toEqual({ model: 'gm', provider: 'gemini' });
  });

  test('Gemini 500 falls back to Groq', async () => {
    const f = fake([json(500, {}), json(200, completion(msg))]);
    const r = await callChatCompletions(opts(f.fetchImpl), build);
    expect(r).toMatchObject({ model: 'groq:qm', provider: 'groq', reasons: ['gemini:http_500'] });
    expect(f.calls[1]!.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(f.calls[1]!.headers.Authorization).toBe('Bearer qk');
    expect(f.calls[1]!.body).toEqual({ model: 'qm', provider: 'groq' });
  });

  test('no Gemini key skips it; malformed Gemini reply falls back', async () => {
    const f1 = fake([json(200, completion(msg))]);
    expect((await callChatCompletions(opts(f1.fetchImpl, null), build)).reasons).toEqual(['gemini:no_key']);
    const f2 = fake([json(200, { choices: [] }), json(200, completion(msg))]);
    expect((await callChatCompletions(opts(f2.fetchImpl), build)).reasons).toEqual(['gemini:invalid_output']);
  });

  test('both down throws LlmUnavailableError with reason codes', async () => {
    const f = fake([new Error('boom'), json(429, {})]);
    const err = await callChatCompletions(opts(f.fetchImpl), build).catch((e) => e);
    expect(err).toBeInstanceOf(LlmUnavailableError);
    expect(err.reasons).toEqual(['gemini:network', 'groq:http_429']);
  });

  test('no keys at all', async () => {
    const f = fake([]);
    const err = await callChatCompletions(opts(f.fetchImpl, null, null), build).catch((e) => e);
    expect(err.reasons).toEqual(['gemini:no_key', 'groq:no_key']);
  });
});

describe('runAgentTurn', () => {
  test('round trip: long call ids go out short and come back original; Gemini signatures are remembered', async () => {
    const sigs = createSignatureStore();
    const a = shortCallId(LONG_A);
    const f = fake([
      json(200, completion({ role: 'assistant', content: null, tool_calls: [{ id: a, type: 'function', function: { name: 'add_widget', arguments: '{}' }, extra_content: { google: { thought_signature: 'S1' } } }] })),
    ]);
    const { response, reasons } = await runAgentTurn(
      { gemini: { apiKey: 'gk', model: 'gm' }, groq: { apiKey: null, model: 'qm' }, timeoutMs: 5_000, fetchImpl: f.fetchImpl, signatures: sigs },
      req,
    );
    expect(reasons).toEqual([]);
    const sent = JSON.stringify(f.calls[0]!.body);
    expect(sent).not.toContain(LONG_A);
    expect(sent).not.toContain('@');
    expect(response.output[0]).toMatchObject({ type: 'function_call', callId: LONG_A });
    expect(sigs.get(LONG_A)).toBe('S1');
  });
});
