import { describe, expect, it } from 'vitest';
import { api, ApiError, UnauthorizedError, WakingUpError } from './api';
import { json, mockFetch } from '../test/http';

describe('api', () => {
  it('returns parsed JSON and sends same-origin credentials', async () => {
    const fetch = mockFetch(() => json(200, { ok: true }));
    await expect(api<{ ok: boolean }>('/health')).resolves.toEqual({ ok: true });
    expect(fetch.mock.calls[0]![1]!.credentials).toBe('same-origin');
  });

  it('sends a JSON body', async () => {
    const fetch = mockFetch(() => json(200, {}));
    await api('/auth/login', { method: 'POST', json: { email: 'a@b.c', password: 'x' } });
    const init = fetch.mock.calls[0]![1]!;
    expect(init.body).toBe(JSON.stringify({ email: 'a@b.c', password: 'x' }));
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
  });

  it('returns undefined for 204', async () => {
    mockFetch(() => new Response(null, { status: 204 }));
    await expect(api('/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('throws UnauthorizedError on 401', async () => {
    mockFetch(() => json(401, { error: 'invalid email or password' }));
    const err = await api('/auth/me').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedError);
    expect((err as ApiError).message).toBe('invalid email or password');
  });

  it('throws ApiError with status and server message', async () => {
    mockFetch(() => json(429, { error: 'too many attempts, try again later' }));
    const err = await api('/auth/login').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(429);
  });

  it('treats a JSON 503 from our server as an ApiError', async () => {
    mockFetch(() => json(503, { error: 'login is not configured' }));
    const err = await api('/auth/login').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).not.toBeInstanceOf(WakingUpError);
  });

  it('throws WakingUpError on a network failure or a non-JSON 502/503', async () => {
    mockFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    await expect(api('/health')).rejects.toBeInstanceOf(WakingUpError);
    mockFetch(() => new Response('<html>Bad gateway</html>', { status: 502 }));
    await expect(api('/health')).rejects.toBeInstanceOf(WakingUpError);
  });
});
