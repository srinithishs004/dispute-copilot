import { Router } from 'express';
import type { AppDeps } from '../app.js';
import { COOKIE_NAME, SESSION_TTL_MS, parseCookies, readSession, signSession, verifyPassword, type Role } from './session.js';

const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;
// A real scrypt hash of nothing in particular, so unknown emails cost the same as bad passwords.
const DUMMY_HASH = 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

/** In-memory failed-login counter per key. Successes are not counted and do not reset anything. */
export function makeLoginLimiter(now: () => number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  const live = (key: string) => {
    const e = hits.get(key);
    if (e && now() >= e.resetAt) {
      hits.delete(key);
      return undefined;
    }
    return e;
  };
  return {
    blocked(key: string): boolean {
      return (live(key)?.count ?? 0) >= MAX_FAILURES;
    },
    fail(key: string): void {
      const e = live(key);
      if (e) e.count += 1;
      else hits.set(key, { count: 1, resetAt: now() + WINDOW_MS });
      if (hits.size > 10_000) for (const k of hits.keys()) live(k);
    },
  };
}

export function authRoutes(deps: AppDeps): Router {
  const { config } = deps;
  const logger = deps.logger ?? console;
  const now = deps.now ?? Date.now;
  const router = Router();
  const limiter = makeLoginLimiter(now);
  const cookieOpts = () => ({
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: process.env.NODE_ENV === 'production',
  });

  router.post('/auth/login', async (req, res) => {
    const secret = config.auth.sessionSecret;
    if (secret === null) {
      res.status(503).json({ error: 'login is not configured' });
      return;
    }
    const key = req.ip ?? 'unknown';
    if (limiter.blocked(key)) {
      res.status(429).json({ error: 'too many attempts, try again later' });
      return;
    }
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>;
    if (typeof body.email !== 'string' || typeof body.password !== 'string' || body.email === '' || body.password === '') {
      res.status(400).json({ error: 'email and password are required' });
      return;
    }
    const email = body.email.trim().toLowerCase();
    const candidates: [Role, { email: string; passwordHash: string } | null][] = [
      ['owner', config.auth.owner],
      ['judge', config.auth.judge],
    ];
    const match = candidates.find(([, a]) => a !== null && a.email.trim().toLowerCase() === email);
    const ok = await verifyPassword(body.password, match?.[1]?.passwordHash ?? DUMMY_HASH);
    if (!match || !match[1] || !ok) {
      limiter.fail(key);
      logger.info('auth: login failed');
      res.status(401).json({ error: 'invalid email or password' });
      return;
    }
    const [role, account] = match;
    const value = signSession({ role, email: account.email }, secret, now());
    res.cookie(COOKIE_NAME, value, { ...cookieOpts(), maxAge: SESSION_TTL_MS });
    logger.info(`auth: login ok role=${role}`);
    res.json({ email: account.email, role });
  });

  router.post('/auth/logout', (_req, res) => {
    res.clearCookie(COOKIE_NAME, cookieOpts());
    res.status(204).end();
  });

  router.get('/auth/me', (req, res) => {
    const raw = parseCookies(req.headers.cookie)[COOKIE_NAME];
    const s = raw !== undefined && config.auth.sessionSecret !== null ? readSession(raw, config.auth.sessionSecret, now()) : null;
    if (!s) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    res.json({ email: s.email, role: s.role });
  });

  return router;
}
