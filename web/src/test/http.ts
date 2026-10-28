import { vi } from 'vitest';

export type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;

export const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
  });

/** Replace global fetch with a handler; returns the mock for call assertions. */
export function mockFetch(handler: Route) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init));
  vi.stubGlobal('fetch', fn);
  return fn;
}
