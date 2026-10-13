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
};

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [500, 1000];

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

  let token: string | null = null;
  let tokenExpiresAt = 0;

  async function getToken(): Promise<string> {
    if (token !== null && now() < tokenExpiresAt) return token;
    const basic = Buffer.from(`${opts.clientId}:${opts.clientSecret}`).toString('base64');
    const res = await fetchImpl(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const body = await parseBody(res);
    if (!res.ok) throw toError(res, body);
    const parsed = body as { access_token?: unknown; expires_in?: unknown } | undefined;
    if (typeof parsed?.access_token !== 'string' || typeof parsed.expires_in !== 'number') {
      throw new PayPalError(res.status, 'PayPalError', 'PayPal token response was malformed', null, undefined);
    }
    token = parsed.access_token;
    tokenExpiresAt = now() + (parsed.expires_in - 60) * 1000;
    return token;
  }

  async function request<T>(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    let refreshed = false;
    let attempt = 0;
    for (;;) {
      const bearer = await getToken();
      const reqHeaders: Record<string, string> = { Authorization: `Bearer ${bearer}` };
      if (body !== undefined) reqHeaders['Content-Type'] = 'application/json';
      Object.assign(reqHeaders, headers);
      const init: RequestInit = { method, headers: reqHeaders };
      if (body !== undefined) init.body = JSON.stringify(body);

      const res = await fetchImpl(`${baseUrl}${path}`, init);
      const parsed = await parseBody(res);
      if (res.ok) return parsed as T;

      if (res.status === 401 && !refreshed) {
        refreshed = true;
        token = null;
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS - 1) {
        await sleep(BACKOFF_MS[attempt]!);
        attempt++;
        continue;
      }
      throw toError(res, parsed);
    }
  }

  return { request };
}
