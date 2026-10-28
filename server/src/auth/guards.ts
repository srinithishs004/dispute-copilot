import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Config } from '../config.js';
import { COOKIE_NAME, parseCookies, readSession, type Role } from './session.js';

export interface Seller {
  role: Role;
  email: string;
}
type Via = 'cookie' | 'token';

declare module 'express-serve-static-core' {
  interface Locals {
    seller?: Seller;
    sellerVia?: Via;
  }
}

type Deps = { config: Config; now?: () => number };

/** Cookie session still valid: signed, unexpired, and its account is still configured with the same email. */
export function sessionFromCookie(req: Request, config: Config, now: number): Seller | null {
  const raw = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (raw === undefined || config.auth.sessionSecret === null) return null;
  const s = readSession(raw, config.auth.sessionSecret, now);
  if (!s) return null;
  const account = config.auth[s.role];
  if (!account || account.email.trim().toLowerCase() !== s.email.trim().toLowerCase()) return null;
  return { role: s.role, email: s.email };
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function tokenMatches(provided: string | undefined, expected: string): boolean {
  if (provided === undefined) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Identify the caller: valid debug token (owner) or valid session cookie (any role). Sets res.locals. */
export function requireSeller({ config, now = Date.now }: Deps): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (res.locals.seller) {
      next();
      return;
    }
    const token = first(req.headers['x-debug-token']);
    if (config.debugToken !== null && tokenMatches(token, config.debugToken)) {
      res.locals.seller = { role: 'owner', email: 'debug-token' };
      res.locals.sellerVia = 'token';
      next();
      return;
    }
    const raw = parseCookies(req.headers.cookie)[COOKIE_NAME];
    const s = sessionFromCookie(req, config, now());
    if (s) {
      res.locals.seller = s;
      res.locals.sellerVia = 'cookie';
      next();
      return;
    }
    // Debug-token path keeps its original behaviour: 404 when none is configured and no session was offered.
    if (config.debugToken === null && raw === undefined) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.status(401).json({ error: 'unauthorized' });
  };
}

/** Owner only: judge sessions get 403. */
export function requireOwner(deps: Deps): RequestHandler {
  const seller = requireSeller(deps);
  return (req, res, next) => {
    seller(req, res, (err?: unknown) => {
      if (err !== undefined) {
        next(err);
        return;
      }
      if (res.locals.seller?.role !== 'owner') {
        res.status(403).json({ error: 'owner only' });
        return;
      }
      next();
    });
  };
}

/** CSRF defence for state-changing routes: cookie sessions must come from PUBLIC_BASE_URL's origin. */
export function requireSameOrigin(config: Pick<Config, 'publicBaseUrl'>): RequestHandler {
  return (req, res, next) => {
    if (res.locals.sellerVia !== 'cookie') {
      next();
      return;
    }
    const origin = first(req.headers.origin) ?? refererOrigin(first(req.headers.referer));
    let ok = false;
    try {
      ok = origin !== undefined && new URL(origin).origin === new URL(config.publicBaseUrl).origin;
    } catch {
      ok = false;
    }
    if (!ok) {
      res.status(403).json({ error: 'bad origin' });
      return;
    }
    next();
  };
}

function refererOrigin(referer: string | undefined): string | undefined {
  if (referer === undefined) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}
