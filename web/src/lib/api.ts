/** A response from our server that was not 2xx. `message` is the server's plain error text. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** 401: not signed in, or the session expired. */
export class UnauthorizedError extends ApiError {
  constructor(message = 'unauthorized', body: unknown = null) {
    super(401, message, body);
    this.name = 'UnauthorizedError';
  }
}

/** The server could not be reached, or a proxy answered for it (Render waking the free instance). */
export class WakingUpError extends Error {
  constructor() {
    super('server is starting');
    this.name = 'WakingUpError';
  }
}

export type ApiInit = Omit<RequestInit, 'body'> & { json?: unknown; body?: BodyInit | null };

export async function api<T = unknown>(path: string, init: ApiInit = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const h = new Headers(headers);
  h.set('accept', 'application/json');
  if (json !== undefined) h.set('content-type', 'application/json');

  let res: Response;
  try {
    res = await fetch(path, {
      ...rest,
      headers: h,
      credentials: 'same-origin',
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new WakingUpError();
  }

  const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
  const body: unknown = isJson ? await res.json().catch(() => null) : null;

  if (res.ok) return (res.status === 204 ? undefined : body) as T;

  // Our server always answers errors in JSON; anything else in front of it means it is not up yet.
  if ((res.status === 502 || res.status === 503 || res.status === 504) && !isJson) throw new WakingUpError();

  const message =
    body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : `request failed (${res.status})`;
  if (res.status === 401) throw new UnauthorizedError(message, body);
  throw new ApiError(res.status, message, body);
}
