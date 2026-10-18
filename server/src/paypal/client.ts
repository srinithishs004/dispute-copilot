export class PayPalError extends Error {
  status: number;
  override name: string;
  debugId: string | null;
  body: unknown;

  constructor(status: number, name: string, message: string, debugId: string | null, body: unknown) {
    super(message);
    this.status = status;
    this.name = name;
    this.debugId = debugId;
    this.body = body;
  }
}

/** A pre-encoded request body (e.g. hand-built multipart); sent as-is with its own Content-Type. */
export class RawBody {
  constructor(
    readonly contentType: string,
    readonly data: string | Uint8Array,
  ) {}
}

export type PayPalClient = {
  request<T>(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<T>;
};

export type PayPalClientOptions = {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Per-fetch timeout in ms (default 10000). */
  timeoutMs?: number;
};

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [500, 1000];
const MAX_RETRY_AFTER_S = 5;

/** Integer seconds only (HTTP-date and junk are ignored), capped. */
function retryAfterMs(res: Response): number | null {
  const raw = res.headers.get('retry-after');
  if (raw === null || !/^\d+$/.test(raw.trim())) return null;
  return Math.min(Number(raw.trim()), MAX_RETRY_AFTER_S) * 1000;
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text === '') return undefined;
  if ((res.headers.get('content-type') ?? '').includes('application/json')) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

function toError(res: Response, body: unknown): PayPalError {
  const obj = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const name = typeof obj.name === 'string' ? obj.name : 'PayPalError';
  const debugId = typeof obj.debug_id === 'string' ? obj.debug_id : null;
  const detail = typeof obj.message === 'string' ? `: ${obj.message}` : '';
  return new PayPalError(res.status, name, `PayPal request failed with status ${res.status}${detail}`, debugId, body);
}

export function createPayPalClient(opts: PayPalClientOptions): PayPalClient {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const baseUrl = opts.baseUrl.replace(/\/+$/, '');
  const timeoutMs = opts.timeoutMs ?? 10_000;

  let token: string | null = null;
  let tokenExpiresAt = 0;
  let tokenInFlight: Promise<string> | null = null;

  /**
   * One fetch with timeout, retried (same 3-attempt budget) on network errors, 429 and 5xx.
   * Never puts an underlying error message in the thrown error (it can contain URLs).
   */
  async function send(url: string, init: RequestInit): Promise<{ res: Response; body: unknown }> {
    for (let attempt = 0; ; attempt++) {
      const last = attempt >= MAX_ATTEMPTS - 1;
      let res: Response;
      let body: unknown;
      try {
        res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
        body = await parseBody(res);
      } catch (err) {
        if (last) {
          const name = err instanceof Error ? err.name : 'Error';
          throw new PayPalError(0, 'NETWORK_ERROR', `network error: ${name}`, null, null);
        }
        await sleep(BACKOFF_MS[attempt]!);
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && !last) {
        await sleep((res.status === 429 ? retryAfterMs(res) : null) ?? BACKOFF_MS[attempt]!);
        continue;
      }
      return { res, body };
    }
  }

  async function fetchToken(): Promise<string> {
    const basic = Buffer.from(`${opts.clientId}:${opts.clientSecret}`).toString('base64');
    const { res, body } = await send(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw toError(res, body);
    const parsed = body as { access_token?: unknown; expires_in?: unknown } | undefined;
    if (typeof parsed?.access_token !== 'string' || typeof parsed.expires_in !== 'number') {
      throw new PayPalError(res.status, 'PayPalError', 'PayPal token response was malformed', null, undefined);
    }
    token = parsed.access_token;
    tokenExpiresAt = now() + (parsed.expires_in - 60) * 1000;
    return token;
  }

  function getToken(): Promise<string> {
    if (token !== null && now() < tokenExpiresAt) return Promise.resolve(token);
    // Concurrent callers share one fetch; a failure clears it so the next call retries.
    tokenInFlight ??= fetchToken().finally(() => {
      tokenInFlight = null;
    });
    return tokenInFlight;
  }

  async function request<T>(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    let refreshed = false;
    for (;;) {
      const bearer = await getToken();
      const reqHeaders: Record<string, string> = { Authorization: `Bearer ${bearer}` };
      // PayPal rejects POST/PATCH without this header (415) even when there is no body.
      // FormData: fetch sets the multipart Content-Type (with boundary) itself.
      const isForm = body instanceof FormData;
      const isRaw = body instanceof RawBody;
      if (isRaw) reqHeaders['Content-Type'] = body.contentType;
      else if (!isForm && (body !== undefined || method !== 'GET')) reqHeaders['Content-Type'] = 'application/json';
      Object.assign(reqHeaders, headers);
      const init: RequestInit = { method, headers: reqHeaders };
      if (isRaw) init.body = body.data as BodyInit;
      else if (body !== undefined) init.body = isForm ? body : JSON.stringify(body);

      const { res, body: parsed } = await send(`${baseUrl}${path}`, init);
      if (res.ok) return parsed as T;

      if (res.status === 401 && !refreshed) {
        refreshed = true;
        // Only drop the token this request used; a concurrent refresh may already have replaced it.
        if (token === bearer) token = null;
        continue;
      }
      throw toError(res, parsed);
    }
  }

  return { request };
}
