import type { AgAiEvent, AgAiOutputItem, AgLlmAdapter, AgLlmRequest, AgLlmResponse, AgLlmResponseHandler } from 'ag-studio';

/**
 * The AG Studio agent adapter for every agent in the dashboard chat (the Dispute Analyst and the
 * built-in data, page, widget and planning agents). Each turn is one same-origin POST of the bare
 * AgLlmRequest to our server, which calls the model; AI keys never reach the browser.
 *
 * The server answers with a complete (non-streamed) AgLlmResponse. Studio's loop runs the tool calls
 * from `complete`, while the chat panel draws from `stream`, so the stream replays the output items
 * as content events (Task 1 spike: without them the chat shows nothing).
 *
 * Failures become a final assistant message instead of a crashed run, and never show server text.
 */

export const TURN_URL = '/api/agent/turn';

export const ANALYST_UNAVAILABLE = 'Analyst unavailable, try again shortly.';
export const SESSION_EXPIRED = 'Your session expired. Sign in again.';
export const GENERIC_FAILURE = 'The Analyst could not answer that. Try again.';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Content events for a complete response, in output order. Run and step events belong to the loop. */
export function eventsFrom(output: AgAiOutputItem[]): AgAiEvent[] {
  const events: AgAiEvent[] = [];
  for (const item of output) {
    if (item.type === 'message') {
      const text = item.content.map((c) => (c.type === 'text' ? c.text : c.refusal)).join('');
      events.push({ type: 'TEXT_MESSAGE_START', messageId: item.id, role: 'assistant' });
      events.push({ type: 'TEXT_MESSAGE_CONTENT', messageId: item.id, delta: text });
      events.push({ type: 'TEXT_MESSAGE_END', messageId: item.id });
    } else if (item.type === 'function_call') {
      events.push({ type: 'TOOL_CALL_START', toolCallId: item.callId, toolCallName: item.name });
      events.push({ type: 'TOOL_CALL_ARGS', toolCallId: item.callId, delta: item.arguments });
      events.push({ type: 'TOOL_CALL_END', toolCallId: item.callId });
    }
  }
  return events;
}

let seq = 0;
const localId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(++seq).toString(36)}`;

/** A completed turn whose only output is one assistant message. */
export function messageResponse(text: string): AgLlmResponse {
  return {
    id: localId('resp'),
    createdAt: Date.now(),
    status: 'completed',
    output: [
      {
        id: localId('msg'),
        kind: 'output',
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'text', text, annotations: [] }],
      },
    ],
  };
}

function failureText(status: number): string {
  if (status === 503 || status === 429) return ANALYST_UNAVAILABLE;
  if (status === 401) return SESSION_EXPIRED;
  return GENERIC_FAILURE;
}

const isAbort = (e: unknown) => e instanceof Error && e.name === 'AbortError';

function isResponse(x: unknown): x is AgLlmResponse {
  if (typeof x !== 'object' || x === null) return false;
  const r = x as Record<string, unknown>;
  return typeof r.id === 'string' && typeof r.status === 'string' && Array.isArray(r.output);
}

async function turn(fetchImpl: FetchLike, request: AgLlmRequest, signal?: AbortSignal): Promise<AgLlmResponse> {
  let res: Response;
  try {
    res = await fetchImpl(TURN_URL, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });
  } catch (e) {
    // A cancelled run must end as cancelled, not with a message the user did not ask for.
    if (isAbort(e) || signal?.aborted) throw e;
    return messageResponse(GENERIC_FAILURE);
  }
  if (!res.ok) return messageResponse(failureText(res.status));
  let body: unknown;
  try {
    body = await res.json();
  } catch (e) {
    if (isAbort(e) || signal?.aborted) throw e;
    return messageResponse(GENERIC_FAILURE);
  }
  return isResponse(body) ? body : messageResponse(GENERIC_FAILURE);
}

/** Wraps a complete response as the stream plus promise Studio's loop expects. */
export function nonStreamed(complete: Promise<AgLlmResponse>): AgLlmResponseHandler {
  // The loop may stop reading after an abort; keep that rejection from being reported as unhandled.
  complete.catch(() => undefined);
  return {
    stream: {
      async *[Symbol.asyncIterator]() {
        yield* eventsFrom((await complete).output);
      },
    },
    complete,
  };
}

export function createProxyAdapter(fetchImpl: FetchLike = (url, init) => fetch(url, init)): AgLlmAdapter {
  return {
    executeTurn(request, options) {
      return nonStreamed(turn(fetchImpl, request, options?.signal));
    },
  };
}
