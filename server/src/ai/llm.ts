import type { z } from 'zod';

/** Thrown when no provider produced valid output. The message carries reason codes only. */
export class LlmUnavailableError extends Error {
  /** Reason codes only (e.g. `gemini:http_404`), safe to log. */
  readonly logDetail: string;
  constructor(readonly reasons: string[]) {
    super(`all LLM providers failed (${reasons.join(', ')})`);
    this.name = 'LlmUnavailableError';
    this.logDetail = reasons.join(', ');
  }
}

export type LlmPrompt = { system: string; user: string };

export type Llm = {
  generateJson<T>(prompt: LlmPrompt, schema: z.ZodType<T>): Promise<{ data: T; model: string }>;
};

export interface LlmOptions {
  gemini: { apiKey: string | null; model: string };
  groq: { apiKey: string | null; model: string };
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Transport failure (HTTP status or network/timeout): move on to the next provider. */
class TransportError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** The provider answered but the text is missing, not JSON, or fails the schema. */
class InvalidOutputError extends Error {}

function stripFence(text: string): string {
  const m = /^\s*```(?:json)?\s*\n?([\s\S]*?)\n?\s*```\s*$/i.exec(text);
  return (m ? m[1]! : text).trim();
}

function parseOutput<T>(text: unknown, schema: z.ZodType<T>): T {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new InvalidOutputError('response contained no text');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(stripFence(text));
  } catch {
    // Fixed text: the engine's own message quotes the model output.
    throw new InvalidOutputError('output was not valid JSON');
  }
  const res = schema.safeParse(raw);
  if (!res.success) {
    const summary = res.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new InvalidOutputError(`schema validation failed: ${summary}`);
  }
  return res.data;
}

export function createLlm(opts: LlmOptions): Llm {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 20_000;

  async function post(url: string, headers: Record<string, string>, body: unknown): Promise<any> {
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new TransportError('network');
    }
    if (!res.ok) throw new TransportError(`http_${res.status}`);
    try {
      return await res.json();
    } catch {
      throw new InvalidOutputError('response body was not JSON');
    }
  }

  const callGemini = async (apiKey: string, model: string, system: string, user: string) => {
    const data = await post(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      { 'x-goog-api-key': apiKey },
      {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
      },
    );
    return data?.candidates?.[0]?.content?.parts?.[0]?.text as unknown;
  };

  const callGroq = async (apiKey: string, model: string, system: string, user: string) => {
    const data = await post(
      'https://api.groq.com/openai/v1/chat/completions',
      { Authorization: `Bearer ${apiKey}` },
      {
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
      },
    );
    return data?.choices?.[0]?.message?.content as unknown;
  };

  return {
    async generateJson<T>(prompt: LlmPrompt, schema: z.ZodType<T>) {
      const reasons: string[] = [];

      // 1. Gemini, with one retry on invalid output.
      const g = opts.gemini;
      if (!g.apiKey) {
        reasons.push('gemini:no_key');
      } else {
        let user = prompt.user;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const text = await callGemini(g.apiKey, g.model, prompt.system, user);
            return { data: parseOutput(text, schema), model: `gemini:${g.model}` };
          } catch (e) {
            if (e instanceof TransportError) {
              reasons.push(`gemini:${e.code}`);
              break;
            }
            if (!(e instanceof InvalidOutputError)) throw e;
            if (attempt === 0) {
              user = `${prompt.user}\n\nYour previous reply was rejected (${e.message}). Reply again with only valid JSON that matches the required schema.`;
            } else {
              reasons.push('gemini:invalid_output');
            }
          }
        }
      }

      // 2. Groq, one call.
      const q = opts.groq;
      if (!q.apiKey) {
        reasons.push('groq:no_key');
      } else {
        try {
          const text = await callGroq(q.apiKey, q.model, prompt.system, prompt.user);
          return { data: parseOutput(text, schema), model: `groq:${q.model}` };
        } catch (e) {
          if (e instanceof TransportError) reasons.push(`groq:${e.code}`);
          else if (e instanceof InvalidOutputError) reasons.push('groq:invalid_output');
          else throw e;
        }
      }

      throw new LlmUnavailableError(reasons);
    },
  };
}
