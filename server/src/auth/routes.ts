import { Router } from 'express';
import type { AppDeps } from '../app.js';
import { sessionFromCookie } from './guards.js';
import { COOKIE_NAME, SESSION_TTL_MS, signSession, verifyPassword, type Role } from './session.js';

const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;
// A real scrypt hash of nothing in particular, so unknown emails cost the same as bad passwords.
const DUMMY_HASH = 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

const MAX_KEYS = 10_000;

/**
 * In-memory failed-login counter per key. An attempt is reserved before the password is checked
 * (so parallel requests cannot all slip under the limit) and refunded on success.
 */
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
    /** Returns false when the key is over the limit; otherwise counts this attempt. */
    reserve(key: string): boolean {
      const e = live(key);
      if (e) {
        if (e.count >= MAX_FAILURES) return false;
        e.count += 1;
        return true;
      }
      if (hits.size >= MAX_KEYS) {
        for (const k of [...hits.keys()]) live(k);
        // Map iterates in insertion order, so the first keys are the oldest.
        for (const k of hits.keys()) {
          if (hits.size < MAX_KEYS) break;
          hits.delete(k);
        }
      }
      hits.set(key, { count: 1, resetAt: now() + WINDOW_MS });
      return true;
    },
    refund(key: string): void {
      const e = hits.get(key);
      if (!e) return;
      e.count -= 1;
      if (e.count <= 0) hits.delete(key);
    },
    size: () => hits.size,
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
    if (!limiter.reserve(key)) {
      res.status(429).json({ error: 'too many attempts, try again later' });
      return;
    }
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>;
    // Malformed bodies still spend the reservation (cheap to reject, so refund).
    if (typeof body.email !== 'string' || typeof body.password !== 'string' || body.email === '' || body.password === '') {
      limiter.refund(key);
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
      logger.info('auth: login failed');
      res.status(401).json({ error: 'invalid email or password' });
      return;
    }
    limiter.refund(key);
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
    const s = sessionFromCookie(req, config, now());
    if (!s) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    res.json({ email: s.email, role: s.role });
  });

  return router;
}
