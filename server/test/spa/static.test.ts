import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { makeTestDeps } from '../helpers.js';

const root = mkdtempSync(join(tmpdir(), 'spa-'));
const dist = join(root, 'web');
mkdirSync(join(dist, 'assets'), { recursive: true });
writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Dispute Copilot</title><div id="root"></div>');
writeFileSync(join(dist, 'assets', 'app-abc123.js'), 'console.log(1)');
writeFileSync(join(dist, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
afterAll(() => rmSync(root, { recursive: true, force: true }));

const mk = (webDistDir?: string, warns: string[] = []) =>
  createApp(makeTestDeps({ ...(webDistDir ? { webDistDir } : {}), logger: { info: (m: string) => warns.push(m), warn: (m: string) => warns.push(m) } }));

describe('serving the web app', () => {
  const app = mk(dist);

  it('serves index.html for client routes that accept HTML', async () => {
    for (const path of ['/', '/dashboard', '/disputes/ABC-1']) {
      const res = await request(app).get(path).set('Accept', 'text/html');
      expect(res.status).toBe(200);
      expect(res.text).toContain('<div id="root">');
    }
  });

  it('does not use the fallback for a non-HTML request', async () => {
    const res = await request(app).get('/dashboard').set('Accept', 'application/json');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not found' });
  });

  it('unknown API-ish paths get a JSON 404, not index.html', async () => {
    for (const path of ['/api/x', '/auth/nope', '/webhooks/nope', '/debug/nope']) {
      const res = await request(app).get(path).set('Accept', 'text/html');
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'not found' });
    }
  });

  it('leaves real routes alone', async () => {
    expect((await request(app).get('/health').set('Accept', 'text/html')).body).toEqual({ ok: true });
    const store = await request(app).get('/store').set('Accept', 'text/html');
    expect(store.text).not.toContain('<div id="root">');
  });

  it('serves assets with a long immutable cache and other files for an hour', async () => {
    const a = await request(app).get('/assets/app-abc123.js');
    expect(a.status).toBe(200);
    expect(a.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const f = await request(app).get('/favicon.svg');
    expect(f.status).toBe(200);
    expect(f.headers['cache-control']).toBe('public, max-age=3600');
  });

  it('a missing asset is a 404, not index.html', async () => {
    const res = await request(app).get('/assets/missing.js').set('Accept', '*/*');
    expect(res.status).toBe(404);
  });

  it('only GET falls back', async () => {
    const res = await request(app).post('/dashboard').set('Accept', 'text/html').send({});
    expect(res.status).toBe(404);
  });

  it('sets security headers on every response', async () => {
    for (const res of [await request(app).get('/'), await request(app).get('/health'), await request(app).get('/api/x')]) {
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['content-security-policy']).toBe(
        "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
      );
    }
  });
});

describe('API-only runs', () => {
  it('skips serving with one log line when the directory is missing', async () => {
    const logs: string[] = [];
    const app = mk(join(root, 'does-not-exist'), logs);
    const res = await request(app).get('/dashboard').set('Accept', 'text/html');
    expect(res.status).toBe(404);
    expect(logs.filter((l) => l.startsWith('web app not served'))).toHaveLength(1);
    expect((await request(app).get('/health')).body).toEqual({ ok: true });
  });

  it('serves nothing when no directory is configured', async () => {
    const res = await request(mk()).get('/dashboard').set('Accept', 'text/html');
    expect(res.status).toBe(404);
  });
});
