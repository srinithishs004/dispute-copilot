import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { createLlm, LlmUnavailableError } from '../../src/ai/llm.js';

const schema = z.object({ answer: z.string() });
const prompt = { system: 'SYS', user: 'USER' };

type Call = { url: string; headers: Record<string, string>; body: any };
const gemini = (text: string) => ({ candidates: [{ content: { parts: [{ text }] } }] });
const groq = (text: string) => ({ choices: [{ message: { content: text } }] });
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function fake(responses: Array<(() => Response) | Response | Error>) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: any, init: any) => {
    calls.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    const r = responses[calls.length - 1];
    if (!r) throw new Error('unexpected extra call');
    if (r instanceof Error) throw r;
    return typeof r === 'function' ? r() : r;
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const mk = (f: typeof fetch, g: string | null = 'gk', q: string | null = 'qk') =>
  createLlm({
    gemini: { apiKey: g, model: 'gm' },
    groq: { apiKey: q, model: 'qm' },
    fetchImpl: f,
  });

describe('createLlm', () => {
  test('valid Gemini JSON returns data and model', async () => {
    const f = fake([json(200, gemini('{"answer":"hi"}'))]);
    const r = await mk(f.fetchImpl).generateJson(prompt, schema);
    expect(r).toEqual({ data: { answer: 'hi' }, model: 'gemini:gm' });
    expect(f.calls).toHaveLength(1);
  });

  test('Gemini request shape', async () => {
    const f = fake([json(200, gemini('{"answer":"hi"}'))]);
    await mk(f.fetchImpl).generateJson(prompt, schema);
    const c = f.calls[0]!;
    expect(c.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gm:generateContent');
    expect(c.headers['x-goog-api-key']).toBe('gk');
    expect(c.body.generationConfig).toEqual({ responseMimeType: 'application/json', temperature: 0.2 });
    expect(c.body.systemInstruction).toEqual({ parts: [{ text: 'SYS' }] });
    expect(c.body.contents).toEqual([{ role: 'user', parts: [{ text: 'USER' }] }]);
  });

  test('strips a json code fence', async () => {
    const f = fake([json(200, gemini('```json\n{"answer":"fenced"}\n```'))]);
    const r = await mk(f.fetchImpl).generateJson(prompt, schema);
    expect(r.data.answer).toBe('fenced');
    expect(f.calls).toHaveLength(1);
  });

  test('invalid JSON then valid: retries once with the error, never the raw response', async () => {
    const f = fake([json(200, gemini('SECRETRAW not json')), json(200, gemini('{"answer":"ok"}'))]);
    const r = await mk(f.fetchImpl).generateJson(prompt, schema);
    expect(r.model).toBe('gemini:gm');
    expect(f.calls).toHaveLength(2);
    const second = f.calls[1]!.body.contents[0].parts[0].text as string;
    expect(second.startsWith('USER')).toBe(true);
    expect(second.length).toBeGreaterThan('USER'.length);
    expect(second).toMatch(/JSON/i);
    expect(second).not.toContain('SECRETRAW');
  });

  test('schema failure retries with a validation summary', async () => {
    const f = fake([json(200, gemini('{"answer":5}')), json(200, gemini('{"answer":"ok"}'))]);
    await mk(f.fetchImpl).generateJson(prompt, schema);
    expect(f.calls[1]!.body.contents[0].parts[0].text).toContain('answer');
  });

  test('Gemini invalid twice falls to Groq', async () => {
    const f = fake([json(200, gemini('nope')), json(200, gemini('nope')), json(200, groq('{"answer":"g"}'))]);
    const r = await mk(f.fetchImpl).generateJson(prompt, schema);
    expect(r).toEqual({ data: { answer: 'g' }, model: 'groq:qm' });
    expect(f.calls.map((c) => c.url.includes('groq'))).toEqual([false, false, true]);
  });

  test('malformed Gemini shape counts as invalid output', async () => {
    const f = fake([json(200, {}), json(200, { candidates: [] }), json(200, groq('{"answer":"g"}'))]);
    const r = await mk(f.fetchImpl).generateJson(prompt, schema);
    expect(r.model).toBe('groq:qm');
    expect(f.calls).toHaveLength(3);
  });

  test('Gemini HTTP 500 goes straight to Groq', async () => {
    const f = fake([json(500, { error: 'x' }), json(200, groq('{"answer":"g"}'))]);
    const r = await mk(f.fetchImpl).generateJson(prompt, schema);
    expect(r.model).toBe('groq:qm');
    expect(f.calls).toHaveLength(2);
  });

  test('Gemini network error goes straight to Groq', async () => {
    const f = fake([new TypeError('fetch failed'), json(200, groq('{"answer":"g"}'))]);
    expect((await mk(f.fetchImpl).generateJson(prompt, schema)).model).toBe('groq:qm');
  });

  test('no Gemini key uses Groq only, with the Groq request shape', async () => {
    const f = fake([json(200, groq('{"answer":"g"}'))]);
    await mk(f.fetchImpl, null).generateJson(prompt, schema);
    expect(f.calls).toHaveLength(1);
    const c = f.calls[0]!;
    expect(c.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(c.headers.Authorization).toBe('Bearer qk');
    expect(c.body).toEqual({
      model: 'qm',
      messages: [
        { role: 'system', content: 'SYS' },
        { role: 'user', content: 'USER' },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    });
  });

  test('Groq invalid output is not retried and ends in LlmUnavailableError', async () => {
    const f = fake([json(200, groq('bad')), json(200, groq('{"answer":"x"}'))]);
    await expect(mk(f.fetchImpl, null).generateJson(prompt, schema)).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(f.calls).toHaveLength(1);
  });

  test('malformed Groq shape is invalid output', async () => {
    const f = fake([json(200, { choices: [] })]);
    await expect(mk(f.fetchImpl, null).generateJson(prompt, schema)).rejects.toBeInstanceOf(LlmUnavailableError);
  });

  test('both fail: error has reason codes and no prompt, response or key', async () => {
    const f = fake([json(500, { error: 'LEAKRESP' }), json(200, groq('LEAKBAD'))]);
    const err = await mk(f.fetchImpl).generateJson(prompt, schema).catch((e) => e);
    expect(err).toBeInstanceOf(LlmUnavailableError);
    expect(err.message).toContain('gemini:http_500');
    expect(err.message).toContain('groq:invalid_output');
    for (const s of ['USER', 'SYS', 'gk', 'qk', 'LEAKRESP', 'LEAKBAD']) expect(err.message).not.toContain(s);
  });

  test('no keys at all', async () => {
    const f = fake([]);
    const err = await mk(f.fetchImpl, null, null).generateJson(prompt, schema).catch((e) => e);
    expect(err).toBeInstanceOf(LlmUnavailableError);
    expect(err.message).toContain('gemini:no_key');
    expect(err.message).toContain('groq:no_key');
    expect(f.calls).toHaveLength(0);
  });

  test('passes an abort signal for the timeout', async () => {
    let signal: AbortSignal | undefined;
    const fetchImpl = (async (_u: any, init: any) => {
      signal = init.signal;
      return json(200, gemini('{"answer":"a"}'));
    }) as unknown as typeof fetch;
    await createLlm({ gemini: { apiKey: 'k', model: 'm' }, groq: { apiKey: null, model: 'q' }, fetchImpl, timeoutMs: 50 }).generateJson(prompt, schema);
    expect(signal).toBeInstanceOf(AbortSignal);
  });
});

describe('LlmUnavailableError', () => {
  test('exposes reason codes as logDetail', () => {
    const e = new LlmUnavailableError(['gemini:http_404', 'groq:no_key']);
    expect(e.reasons).toEqual(['gemini:http_404', 'groq:no_key']);
    expect(e.logDetail).toBe('gemini:http_404, groq:no_key');
  });
});
