import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { makeLoginLimiter } from '../../src/auth/routes.js';
import { hashPassword } from '../../src/auth/session.js';
import type { Config } from '../../src/config.js';
import { makeTestDb, makeTestDeps, testConfig } from '../helpers.js';

const SECRET = 'x'.repeat(40);
let config: Config;

beforeAll(async () => {
  config = {
    ...testConfig,
    auth: {
      owner: { email: 'owner@x.test', passwordHash: await hashPassword('owner-pw') },
      judge: { email: 'judge@x.test', passwordHash: await hashPassword('judge-pw') },
      sessionSecret: SECRET,
    },
  };
});

const opened: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((d) => d.close()));
});

async function appWith(over: Partial<Config> = {}, now?: () => number) {
  const db = await makeTestDb();
  opened.push(db);
  return createApp(makeTestDeps({ db, config: { ...config, ...over }, ...(now ? { now } : {}) }));
}

async function login(app: ReturnType<typeof createApp>, email: string, password: string) {
  return request(app).post('/auth/login').send({ email, password });
}
async function cookieFor(app: ReturnType<typeof createApp>, who: 'owner' | 'judge') {
  const res = await login(app, `${who}@x.test`, `${who}-pw`);
  expect(res.status).toBe(200);
  return (res.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
}

describe('POST /auth/login', () => {
  it('logs in with an httpOnly SameSite=Lax cookie', async () => {
    const app = await appWith();
    const res = await login(app, 'Owner@x.test', 'owner-pw');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ email: 'owner@x.test', role: 'owner' });
    const cookie = (res.headers['set-cookie'] as unknown as string[])[0]!;
    expect(cookie).toMatch(/^dc_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Max-Age=28800/);
    expect(cookie).not.toMatch(/Secure/);
  });

  it('judge account gets the judge role', async () => {
    const res = await login(await appWith(), 'judge@x.test', 'judge-pw');
    expect(res.body).toEqual({ email: 'judge@x.test', role: 'judge' });
  });

  it('gives identical 401 bodies for unknown email and wrong password', async () => {
    const app = await appWith();
    const a = await login(app, 'nobody@x.test', 'whatever');
    const b = await login(app, 'owner@x.test', 'wrong');
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body).toEqual({ error: 'invalid email or password' });
    expect(b.body).toEqual(a.body);
    expect(a.headers['set-cookie']).toBeUndefined();
  });

  it('400 on a malformed body', async () => {
    const res = await request(await appWith()).post('/auth/login').send({ email: 1 });
    expect(res.status).toBe(400);
  });

  it('503 when no session secret is configured', async () => {
    const app = await appWith({ auth: { ...config.auth, sessionSecret: null } });
    expect((await login(app, 'owner@x.test', 'owner-pw')).status).toBe(503);
  });

  it('a disabled account cannot log in', async () => {
    const app = await appWith({ auth: { ...config.auth, judge: null } });
    expect((await login(app, 'judge@x.test', 'judge-pw')).status).toBe(401);
  });

  it('rate limits the 11th failure per IP within 15 minutes, then recovers', async () => {
    let t = 1_800_000_000_000;
    const app = await appWith({}, () => t);
    for (let i = 0; i < 10; i++) expect((await login(app, 'owner@x.test', 'bad')).status).toBe(401);
    const blocked = await login(app, 'owner@x.test', 'bad');
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: 'too many attempts, try again later' });
    t += 15 * 60_000 + 1;
    expect((await login(app, 'owner@x.test', 'owner-pw')).status).toBe(200);
  });

  it('parallel wrong-password attempts cannot bypass the limit', async () => {
    const app = await appWith();
    const results = await Promise.all(Array.from({ length: 15 }, () => login(app, 'owner@x.test', 'bad')));
    expect(results.filter((r) => r.status === 429).length).toBeGreaterThanOrEqual(5);
    expect(results.filter((r) => r.status === 401).length).toBeLessThanOrEqual(10);
  });

  it('with trust proxy, different X-Forwarded-For clients get separate buckets', async () => {
    const app = await appWith({ trustProxy: 1 });
    const from = (ip: string) => request(app).post('/auth/login').set('X-Forwarded-For', ip).send({ email: 'owner@x.test', password: 'bad' });
    for (let i = 0; i < 10; i++) expect((await from('1.1.1.1')).status).toBe(401);
    expect((await from('1.1.1.1')).status).toBe(429);
    expect((await from('2.2.2.2')).status).toBe(401);
  });

  it('without trust proxy, X-Forwarded-For is ignored', async () => {
    const app = await appWith({ trustProxy: 0 });
    const from = (ip: string) => request(app).post('/auth/login').set('X-Forwarded-For', ip).send({ email: 'owner@x.test', password: 'bad' });
    for (let i = 0; i < 10; i++) await from(`9.9.9.${i}`);
    expect((await from('3.3.3.3')).status).toBe(429);
  });

  it('limiter caps its key count by evicting the oldest', () => {
    const l = makeLoginLimiter(() => 1000);
    for (let i = 0; i < 10_050; i++) l.reserve(`k${i}`);
    expect(l.size()).toBeLessThanOrEqual(10_000);
  });

  it('successful logins do not count toward the limit', async () => {
    const app = await appWith();
    for (let i = 0; i < 12; i++) expect((await login(app, 'owner@x.test', 'owner-pw')).status).toBe(200);
  });

  it('never logs emails or passwords', async () => {
    const lines: string[] = [];
    const db = await makeTestDb();
    opened.push(db);
    const app = createApp(
      makeTestDeps({ db, config, logger: { info: (m) => lines.push(String(m)), warn: (m) => lines.push(String(m)) } }),
    );
    await login(app, 'owner@x.test', 'owner-pw');
    await login(app, 'owner@x.test', 'bad-pw');
    expect(lines).toEqual(['auth: login ok role=owner', 'auth: login failed']);
  });
});

describe('/auth/me and logout', () => {
  it('401 without a cookie, identity with one', async () => {
    const app = await appWith();
    expect((await request(app).get('/auth/me')).status).toBe(401);
    const c = await cookieFor(app, 'judge');
    const res = await request(app).get('/auth/me').set('Cookie', c);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ email: 'judge@x.test', role: 'judge' });
    expect((await request(app).get('/auth/me').set('Cookie', 'dc_session=junk')).status).toBe(401);
  });

  it('a session is revoked when its account is removed or its email changes', async () => {
    const app = await appWith();
    const c = await cookieFor(app, 'judge');
    const gone = await appWith({ auth: { ...config.auth, judge: null } });
    expect((await request(gone).get('/auth/me').set('Cookie', c)).status).toBe(401);
    expect((await request(gone).get('/api/disputes').set('Cookie', c)).status).toBe(401);
    const renamed = await appWith({ auth: { ...config.auth, judge: { ...config.auth.judge!, email: 'other@x.test' } } });
    expect((await request(renamed).get('/auth/me').set('Cookie', c)).status).toBe(401);
    const cased = await appWith({ auth: { ...config.auth, judge: { ...config.auth.judge!, email: 'JUDGE@x.test' } } });
    expect((await request(cased).get('/auth/me').set('Cookie', c)).status).toBe(200);
  });

  it('logout clears the cookie', async () => {
    const app = await appWith();
    const res = await request(app).post('/auth/logout');
    expect(res.status).toBe(204);
    expect((res.headers['set-cookie'] as unknown as string[])[0]).toMatch(/^dc_session=;/);
  });
});

describe('route guards', () => {
  const ORIGIN = 'http://localhost:3000';

  it('seller reads: 401 with nothing, cookie of any role passes, debug token passes', async () => {
    const app = await appWith();
    expect((await request(app).get('/api/disputes')).status).toBe(401);
    expect((await request(app).get('/api/disputes').set('x-debug-token', 'bad')).status).toBe(401);
    for (const who of ['owner', 'judge'] as const) {
      const c = await cookieFor(app, who);
      expect((await request(app).get('/api/disputes').set('Cookie', c)).status).toBe(200);
    }
    expect((await request(app).get('/api/disputes').set('x-debug-token', 'dbg')).status).toBe(200);
  });

  it('keeps 404 for header requests when DEBUG_TOKEN is unset, but a session cookie still works', async () => {
    const app = await appWith({ debugToken: null });
    expect((await request(app).get('/api/disputes').set('x-debug-token', 'dbg')).status).toBe(404);
    expect((await request(app).get('/api/disputes')).status).toBe(404);
    const c = await cookieFor(app, 'owner');
    expect((await request(app).get('/api/disputes').set('Cookie', c)).status).toBe(200);
  });

  it('judge cannot settle, sync or read debug events (403); owner can', async () => {
    const app = await appWith();
    const judge = await cookieFor(app, 'judge');
    const owner = await cookieFor(app, 'owner');
    const settle = { method: 'post', url: '/api/disputes/D1/sandbox/settle' } as const;
    for (const r of [settle, { method: 'post', url: '/api/disputes/sync' } as const, { method: 'get', url: '/debug/events' } as const]) {
      const res = await request(app)[r.method](r.url).set('Cookie', judge).set('Origin', ORIGIN);
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'owner only' });
    }
    expect((await request(app).post(settle.url).set('Cookie', owner).set('Origin', ORIGIN)).status).toBe(404);
    expect((await request(app).get('/debug/events').set('Cookie', owner)).status).toBe(200);
    expect((await request(app).get('/debug/events')).status).toBe(401);
  });

  it('debug token works on owner routes', async () => {
    const app = await appWith();
    expect((await request(app).get('/debug/events').set('x-debug-token', 'dbg')).status).toBe(200);
    expect((await request(app).post('/api/disputes/D1/sandbox/settle').set('x-debug-token', 'dbg')).status).toBe(404);
  });

  it('judge cookie passes the guard on approve with the right Origin', async () => {
    const app = await appWith();
    const c = await cookieFor(app, 'judge');
    const res = await request(app).post('/api/disputes/D1/approve').set('Cookie', c).set('Origin', ORIGIN);
    expect(res.status).toBe(404); // guard passed; dispute does not exist
  });

  it('cookie sessions need a same-origin Origin or Referer on state-changing routes', async () => {
    const app = await appWith();
    const c = await cookieFor(app, 'judge');
    const url = '/api/disputes/D1/approve';
    const evil = await request(app).post(url).set('Cookie', c).set('Origin', 'https://evil.example');
    expect(evil.status).toBe(403);
    expect(evil.body).toEqual({ error: 'bad origin' });
    expect((await request(app).post(url).set('Cookie', c)).status).toBe(403);
    expect((await request(app).post(url).set('Cookie', c).set('Origin', 'null')).status).toBe(403);
    expect((await request(app).post(url).set('Cookie', c).set('Referer', 'https://evil.example/x')).status).toBe(403);
    expect((await request(app).post(url).set('Cookie', c).set('Referer', `${ORIGIN}/disputes/1`)).status).toBe(404);
    // owner settle and sync are protected too
    const owner = await cookieFor(app, 'owner');
    expect((await request(app).post('/api/disputes/D1/sandbox/settle').set('Cookie', owner).set('Origin', 'https://evil.example')).status).toBe(403);
    expect((await request(app).post('/api/disputes/sync').set('Cookie', owner).set('Origin', 'https://evil.example')).status).toBe(403);
  });

  it('debug-token requests skip the origin check', async () => {
    const app = await appWith();
    const res = await request(app).post('/api/disputes/D1/approve').set('x-debug-token', 'dbg').set('Origin', 'https://evil.example');
    expect(res.status).toBe(404);
  });
});
