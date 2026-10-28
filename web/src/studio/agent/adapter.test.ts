import { describe, expect, it, vi } from 'vitest';
import type { AgAiEvent, AgAiOutputItem, AgLlmRequest, AgLlmResponse } from 'ag-studio';
import {
  ANALYST_UNAVAILABLE,
  GENERIC_FAILURE,
  SESSION_EXPIRED,
  TURN_URL,
  createProxyAdapter,
  eventsFrom,
} from './adapter';

const request: AgLlmRequest = {
  input: [{ id: 'u1', status: 'completed', kind: 'input', type: 'message', role: 'user', content: [{ type: 'text', text: 'Which disputes are due this week?' }] }],
  instructions: 'Be brief.',
  tools: [],
  responseFormat: { type: 'text' },
};

const message = (id: string, text: string): AgAiOutputItem => ({
  id,
  kind: 'output',
  type: 'message',
  role: 'assistant',
  status: 'completed',
  content: [{ type: 'text', text, annotations: [] }],
});

const call = (id: string, callId: string, name: string, args: unknown): AgAiOutputItem => ({
  id,
  kind: 'output',
  type: 'function_call',
  callId,
  name,
  arguments: JSON.stringify(args),
  status: 'completed',
});

const envelope = (output: AgAiOutputItem[]): AgLlmResponse & { model: string } => ({
  id: 'resp_1',
  createdAt: 1_700_000_000_000,
  status: 'completed',
  output,
  model: 'gemini:test',
});

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function collect(stream: { [Symbol.asyncIterator](): AsyncIterator<AgAiEvent> }): Promise<AgAiEvent[]> {
  const out: AgAiEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

/** The text of the one assistant message in a completed turn. */
function onlyText(res: AgLlmResponse): string {
  expect(res.status).toBe('completed');
  expect(res.output).toHaveLength(1);
  const item = res.output[0];
  if (item.type !== 'message') throw new Error(`expected a message, got ${item.type}`);
  return item.content.map((c) => (c.type === 'text' ? c.text : c.refusal)).join('');
}

describe('eventsFrom', () => {
  it('replays a text-only response as one text message', () => {
    expect(eventsFrom([message('m1', 'Two disputes are due this week.')])).toEqual([
      { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Two disputes are due this week.' },
      { type: 'TEXT_MESSAGE_END', messageId: 'm1' },
    ]);
  });

  it('replays text and tool calls in output order, each call as START, ARGS, END', () => {
    const callId = 'run-0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0-preflight-0'; // 52 characters, as Studio makes them
    expect(callId).toHaveLength(52);
    const out = eventsFrom([
      message('m1', 'Let me check.'),
      call('f1', callId, 'execute_query', { query: { variant: 'projection' } }),
      call('f2', 'c2', 'view_schema', {}),
    ]);
    expect(out).toEqual([
      { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Let me check.' },
      { type: 'TEXT_MESSAGE_END', messageId: 'm1' },
      { type: 'TOOL_CALL_START', toolCallId: callId, toolCallName: 'execute_query' },
      { type: 'TOOL_CALL_ARGS', toolCallId: callId, delta: '{"query":{"variant":"projection"}}' },
      { type: 'TOOL_CALL_END', toolCallId: callId },
      { type: 'TOOL_CALL_START', toolCallId: 'c2', toolCallName: 'view_schema' },
      { type: 'TOOL_CALL_ARGS', toolCallId: 'c2', delta: '{}' },
      { type: 'TOOL_CALL_END', toolCallId: 'c2' },
    ]);
  });

  it('skips reasoning items', () => {
    const reasoning = { id: 'r1', kind: 'output', type: 'reasoning', summary: [] } as unknown as AgAiOutputItem;
    expect(eventsFrom([reasoning])).toEqual([]);
  });
});

describe('createProxyAdapter', () => {
  it('POSTs the bare request same-origin with credentials and the abort signal', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, envelope([message('m1', 'Hi')])));
    const ctrl = new AbortController();
    const turn = createProxyAdapter(fetchImpl).executeTurn(request, { signal: ctrl.signal });
    await turn.complete;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(TURN_URL);
    expect(TURN_URL).toBe('/api/agent/turn');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    expect(init.signal).toBe(ctrl.signal);
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(JSON.parse(String(init.body))).toEqual(request);
  });

  it('resolves complete with the server envelope and streams the text-only events', async () => {
    const body = envelope([message('m1', 'Nothing is due this week.')]);
    const turn = createProxyAdapter(async () => jsonResponse(200, body)).executeTurn(request);
    const res = await turn.complete;
    expect(res).toEqual(body);
    expect((await collect(turn.stream)).map((e) => e.type)).toEqual(['TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END']);
  });

  it('streams text then tool calls for a mixed response, and complete carries the calls for the loop', async () => {
    const out = [message('m1', 'Checking.'), call('f1', 'c1', 'execute_query', { q: 1 }), call('f2', 'c2', 'delegate_to', { type: { id: 'page' } })];
    const turn = createProxyAdapter(async () => jsonResponse(200, envelope(out))).executeTurn(request);
    const events = await collect(turn.stream);
    expect(events.map((e) => e.type)).toEqual([
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_END',
      'TOOL_CALL_START',
      'TOOL_CALL_ARGS',
      'TOOL_CALL_END',
      'TOOL_CALL_START',
      'TOOL_CALL_ARGS',
      'TOOL_CALL_END',
    ]);
    expect((await turn.complete).output).toEqual(out);
  });

  it.each([
    [503, { error: 'analyst unavailable' }],
    [429, { error: 'analyst busy, try again shortly' }],
  ])('turns a %s into the final message "Analyst unavailable, try again shortly."', async (status, body) => {
    const turn = createProxyAdapter(async () => jsonResponse(status, body)).executeTurn(request);
    const res = await turn.complete;
    expect(onlyText(res)).toBe('Analyst unavailable, try again shortly.');
    expect(ANALYST_UNAVAILABLE).toBe('Analyst unavailable, try again shortly.');
    const events = await collect(turn.stream);
    expect(events).toHaveLength(3);
    expect(events[1]).toMatchObject({ type: 'TEXT_MESSAGE_CONTENT', delta: ANALYST_UNAVAILABLE });
  });

  it('turns a 401 into "Your session expired. Sign in again."', async () => {
    const turn = createProxyAdapter(async () => jsonResponse(401, { error: 'sign in required' })).executeTurn(request);
    expect(onlyText(await turn.complete)).toBe('Your session expired. Sign in again.');
    expect(SESSION_EXPIRED).toBe('Your session expired. Sign in again.');
  });

  it.each([400, 403, 413, 500, 502])('turns a %s into the generic message, never the server text', async (status) => {
    const turn = createProxyAdapter(async () => jsonResponse(status, { error: 'secret server detail' })).executeTurn(request);
    const text = onlyText(await turn.complete);
    expect(text).toBe('The Analyst could not answer that. Try again.');
    expect(GENERIC_FAILURE).toBe(text);
    expect(text).not.toContain('secret');
  });

  it('turns a network failure or a malformed body into the generic message', async () => {
    const down = createProxyAdapter(async () => {
      throw new TypeError('Failed to fetch');
    }).executeTurn(request);
    expect(onlyText(await down.complete)).toBe(GENERIC_FAILURE);

    const notJson = createProxyAdapter(async () => new Response('<html>oops</html>', { status: 200 })).executeTurn(request);
    expect(onlyText(await notJson.complete)).toBe(GENERIC_FAILURE);

    const noOutput = createProxyAdapter(async () => jsonResponse(200, { id: 'x', status: 'completed' })).executeTurn(request);
    expect(onlyText(await noOutput.complete)).toBe(GENERIC_FAILURE);

    const badItem = createProxyAdapter(async () =>
      jsonResponse(200, { id: 'x', status: 'completed', output: [{ id: 'm', type: 'message', role: 'assistant' }] }),
    ).executeTurn(request);
    expect(onlyText(await badItem.complete)).toBe(GENERIC_FAILURE);
    await expect(collect(badItem.stream)).resolves.toBeTruthy();
  });

  it('rejects with the abort error when the run is cancelled, instead of posting a message', async () => {
    const ctrl = new AbortController();
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
        }),
    );
    const turn = createProxyAdapter(fetchImpl).executeTurn(request, { signal: ctrl.signal });
    ctrl.abort();
    await expect(turn.complete).rejects.toMatchObject({ name: 'AbortError' });
    await expect(collect(turn.stream)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('gives each fallback message its own id', async () => {
    const adapter = createProxyAdapter(async () => jsonResponse(503, {}));
    const a = (await adapter.executeTurn(request).complete).output[0];
    const b = (await adapter.executeTurn(request).complete).output[0];
    expect(a.id).not.toBe(b.id);
  });
});
