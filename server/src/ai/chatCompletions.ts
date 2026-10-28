/**
 * Server side of the AG Studio agent adapter: translates one AgLlmRequest turn into an
 * OpenAI-compatible chat completion (Gemini first, then Groq) and the reply back into an
 * AgLlmResponse. Wire shapes are local minimal copies of ag-studio's types (ag-studio is a web dep).
 */
import { createHash, randomUUID } from 'node:crypto';
import { LlmUnavailableError } from './llm.js';
import { redactEmails } from '../agent/promptText.js';

// ---- AG Studio wire shapes (subset of ag-studio/dist/types/api/ai) ----

type AgInputContent = { type: string; text?: string };
type AgOutputContent = { type: 'text'; text: string; annotations?: unknown[] } | { type: 'refusal'; refusal: string };

export type AgInputMessage = { id?: string; kind?: 'input'; type: 'message'; role: 'user' | 'system'; content: AgInputContent[]; status?: string };
export type AgOutputMessage = { id: string; kind: 'output'; type: 'message'; role: 'assistant'; status: 'completed'; content: AgOutputContent[] };
export type AgToolCall = { id: string; kind: 'output'; type: 'function_call'; callId: string; name: string; arguments: string; status?: string; result?: string };
export type AgToolCallResult = { id?: string; kind?: 'input'; type: 'function_call_output'; callId: string; output: string; status?: string };
export type AgReasoning = { id?: string; kind?: 'output'; type: 'reasoning'; summary?: unknown[]; content?: unknown[] };

export type AgConversationItem = AgInputMessage | (Omit<AgOutputMessage, 'status'> & { status?: string }) | AgToolCall | AgToolCallResult | AgReasoning;
export type AgOutputItem = AgOutputMessage | AgToolCall;

export type AgToolSchema = { name: string; description: string; parameters: unknown; kind?: string; provider?: unknown };

export interface AgLlmRequest {
  input: AgConversationItem[];
  instructions?: string;
  tools?: AgToolSchema[];
  toolChoice?: 'auto' | 'none' | 'required' | { name: string };
  responseFormat?: { type: 'text' } | { type: 'json'; name: string; description?: string; schema: unknown };
  model?: unknown;
}

export interface AgLlmResponse {
  id: string;
  createdAt: number;
  status: 'completed';
  output: AgOutputItem[];
  model: string;
}

// ---- OpenAI chat completion shapes ----

export type ChatToolCall = {
  id?: string;
  type?: 'function';
  function: { name: string; arguments: string };
  extra_content?: { google?: { thought_signature?: string } };
};
export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ChatToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

/** What a provider returns as `choices[0].message`. */
export type ChatReply = { role?: string; content?: string | null; tool_calls?: ChatToolCall[] };

export type Provider = 'gemini' | 'groq';

// ---- call ids ----

/** Studio call ids reach 52 chars; OpenAI-compatible APIs cap tool_call ids at 40. */
export const shortCallId = (callId: string) => `c_${createHash('sha256').update(callId).digest('hex').slice(0, 30)}`;

export type IdMap = { toShort(callId: string): string; toOriginal(id: string): string };

/** Per-request map: every call id goes out short; ids the model invents come back as-is. */
export function makeIdMap(): IdMap {
  const back = new Map<string, string>();
  return {
    toShort(callId) {
      const s = shortCallId(callId);
      back.set(s, callId);
      return s;
    },
    toOriginal: (id) => back.get(id) ?? id,
  };
}

// ---- Gemini thought signatures ----

/**
 * Gemini 3 rejects function-call history without thought signatures. Studio drops unknown fields,
 * so remember the signatures Gemini returns, keyed by the call id Studio will echo back.
 */
export const SKIP_SIGNATURE = 'skip_thought_signature_validator';
const MAX_SIGNATURES = 5_000;

export type SignatureStore = { get(callId: string): string | undefined; set(callId: string, sig: string): void };

export function createSignatureStore(max = MAX_SIGNATURES): SignatureStore {
  const m = new Map<string, string>();
  return {
    get: (k) => m.get(k),
    set(k, v) {
      m.delete(k);
      m.set(k, v);
      // Map iterates in insertion order, so the first key is the oldest.
      while (m.size > max) m.delete(m.keys().next().value as string);
    },
  };
}

// ---- request mapping ----

const textOf = (parts: Array<{ type: string; text?: string; refusal?: string }>) =>
  parts
    .map((p) => (p.type === 'text' || p.type === 'input_text' || p.type === 'output_text' ? (p.text ?? '') : p.type === 'refusal' ? (p.refusal ?? '') : ''))
    .filter((t) => t !== '')
    .join('\n');

/**
 * Redact emails from a tool payload without breaking its JSON: parse, redact every string
 * (keys stay as they are), stringify. Text redaction would eat an escaping backslash that
 * touches an address. Anything that is not JSON gets plain text redaction.
 */
function redactJsonText(s: string): string {
  let v: unknown;
  try {
    v = JSON.parse(s);
  } catch {
    return redactEmails(s);
  }
  const walk = (x: unknown): unknown => {
    if (typeof x === 'string') return redactEmails(x);
    if (Array.isArray(x)) return x.map(walk);
    if (typeof x === 'object' && x !== null) return Object.fromEntries(Object.entries(x).map(([k, val]) => [k, walk(val)]));
    return x;
  };
  return JSON.stringify(walk(v));
}

type MapOpts = { provider?: Provider; signatures?: SignatureStore };

/** Studio conversation -> chat messages. Emails are redacted from every text that is sent. */
export function toChatMessages(req: AgLlmRequest, ids: IdMap, opts: MapOpts = {}): ChatMessage[] {
  const out: ChatMessage[] = [];
  if (req.instructions) out.push({ role: 'system', content: redactEmails(req.instructions) });
  for (const item of req.input) {
    switch (item.type) {
      case 'message': {
        const content = redactEmails(typeof item.content === 'string' ? item.content : textOf(item.content as AgInputContent[]));
        if (item.role === 'assistant') out.push({ role: 'assistant', content });
        else out.push({ role: item.role === 'system' ? 'system' : 'user', content });
        break;
      }
      case 'function_call': {
        const call: ChatToolCall = {
          id: ids.toShort(item.callId),
          type: 'function',
          function: { name: item.name, arguments: redactJsonText(item.arguments || '{}') },
        };
        if (opts.provider === 'gemini') {
          call.extra_content = { google: { thought_signature: opts.signatures?.get(item.callId) ?? SKIP_SIGNATURE } };
        }
        // Consecutive calls (and the text the model wrote with them) form one assistant turn.
        const prev = out[out.length - 1];
        if (prev && prev.role === 'assistant') (prev.tool_calls ??= []).push(call);
        else out.push({ role: 'assistant', content: null, tool_calls: [call] });
        break;
      }
      case 'function_call_output':
        out.push({ role: 'tool', tool_call_id: ids.toShort(item.callId), content: redactJsonText(item.output) });
        break;
      default:
        break; // reasoning items are not sent back
    }
  }
  return out;
}

export type ChatRequestBody = {
  model: string;
  messages: any[];
  temperature: number;
  tools?: unknown[];
  tool_choice?: unknown;
  response_format?: { type: 'json_object' };
};

export function toChatRequest(
  req: AgLlmRequest,
  o: { ids: IdMap; provider: Provider; model: string; signatures?: SignatureStore },
): ChatRequestBody {
  const messages: ChatMessage[] = toChatMessages(req, o.ids, { provider: o.provider, signatures: o.signatures });
  const body: ChatRequestBody = { model: o.model, messages, temperature: 0.2 };
  const fmt = req.responseFormat;
  if (fmt?.type === 'json') {
    const note =
      `Reply with a single JSON object only (no prose, no code fences) named "${fmt.name}"` +
      `${fmt.description ? ` (${fmt.description})` : ''}, matching this JSON schema: ${JSON.stringify(fmt.schema)}`;
    const first = messages[0];
    if (first && first.role === 'system') first.content = `${first.content}\n\n${note}`;
    else messages.unshift({ role: 'system', content: note });
    body.response_format = { type: 'json_object' };
  }
  if (req.tools && req.tools.length > 0) {
    body.tools = req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
    const tc = req.toolChoice;
    if (tc === 'auto' || tc === 'none' || tc === 'required') body.tool_choice = tc;
    else if (tc && typeof tc === 'object') body.tool_choice = { type: 'function', function: { name: tc.name } };
  }
  return body;
}

// ---- response mapping ----

const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '')}`;

export function fromChatCompletion(reply: ChatReply, model: string, ids: IdMap, signatures?: SignatureStore): AgLlmResponse {
  const output: AgOutputItem[] = [];
  const text = typeof reply.content === 'string' ? reply.content : '';
  if (text !== '') {
    output.push({ id: newId('msg'), kind: 'output', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'text', text, annotations: [] }] });
  }
  for (const tc of reply.tool_calls ?? []) {
    const callId = tc.id ? ids.toOriginal(tc.id) : newId('call').slice(0, 37);
    const args = tc.function?.arguments;
    const sig = tc.extra_content?.google?.thought_signature;
    if (signatures && typeof sig === 'string' && sig !== '') signatures.set(callId, sig);
    output.push({
      id: newId('fc'),
      kind: 'output',
      type: 'function_call',
      callId,
      name: tc.function?.name ?? '',
      arguments: typeof args === 'string' ? args || '{}' : JSON.stringify(args ?? {}),
      status: 'completed',
    });
  }
  return { id: newId('resp'), createdAt: Date.now(), status: 'completed', output, model };
}

// ---- transport ----

const ENDPOINTS: Record<Provider, string> = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
};

export interface ChatOptions {
  gemini: { apiKey: string | null; model: string };
  groq: { apiKey: string | null; model: string };
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

class ProviderFailure extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const isReply = (m: unknown): m is ChatReply => {
  if (typeof m !== 'object' || m === null) return false;
  const r = m as ChatReply;
  const hasText = typeof r.content === 'string' && r.content !== '';
  const hasCalls = Array.isArray(r.tool_calls) && r.tool_calls.length > 0 && r.tool_calls.every((t) => typeof t?.function?.name === 'string');
  return hasText || hasCalls;
};

/**
 * Gemini then Groq. No key: skip. HTTP, network or timeout: next. Malformed reply: next.
 * Both fail: LlmUnavailableError (reason codes only). `reasons` lists the skipped/failed providers.
 */
export async function callChatCompletions(
  opts: ChatOptions,
  build: (provider: Provider, model: string) => unknown,
): Promise<{ data: ChatReply; model: string; provider: Provider; reasons: string[] }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const reasons: string[] = [];
  for (const provider of ['gemini', 'groq'] as const) {
    const { apiKey, model } = opts[provider];
    if (!apiKey) {
      reasons.push(`${provider}:no_key`);
      continue;
    }
    try {
      let res: Response;
      try {
        res = await fetchImpl(ENDPOINTS[provider], {
          method: 'POST',
          headers: { 'content-type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(build(provider, model)),
          signal: AbortSignal.timeout(opts.timeoutMs),
        });
      } catch {
        throw new ProviderFailure('network');
      }
      if (!res.ok) throw new ProviderFailure(`http_${res.status}`);
      let data: any;
      try {
        data = await res.json();
      } catch {
        throw new ProviderFailure('invalid_output');
      }
      const message = data?.choices?.[0]?.message;
      if (!isReply(message)) throw new ProviderFailure('invalid_output');
      return { data: message, model: `${provider}:${model}`, provider, reasons };
    } catch (e) {
      if (!(e instanceof ProviderFailure)) throw e;
      reasons.push(`${provider}:${e.code}`);
    }
  }
  throw new LlmUnavailableError(reasons);
}

/** One Studio agent turn end to end. Throws LlmUnavailableError when no provider answered. */
export async function runAgentTurn(
  opts: ChatOptions & { signatures?: SignatureStore },
  req: AgLlmRequest,
): Promise<{ response: AgLlmResponse; reasons: string[] }> {
  const ids = makeIdMap();
  const r = await callChatCompletions(opts, (provider, model) => toChatRequest(req, { ids, provider, model, signatures: opts.signatures }));
  return { response: fromChatCompletion(r.data, r.model, ids, r.provider === 'gemini' ? opts.signatures : undefined), reasons: r.reasons };
}
