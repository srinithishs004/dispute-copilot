import { createHmac, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

export type Role = 'owner' | 'judge';
export interface SessionUser {
  role: Role;
  email: string;
}

export const COOKIE_NAME = 'dc_session';
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

const KEY_LEN = 32;
const SCRYPT: ScryptOptions = { N: 16384, r: 8, p: 1 };

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LEN, SCRYPT, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** `scrypt$<saltB64>$<hashB64>` (N=16384, r=8, p=1, 32-byte key). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt' || !parts[1] || !parts[2]) return false;
  const salt = Buffer.from(parts[1], 'base64');
  const expected = Buffer.from(parts[2], 'base64');
  if (salt.length === 0 || expected.length !== KEY_LEN) return false;
  const actual = await derive(password, salt);
  return timingSafeEqual(actual, expected);
}

function mac(payload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(payload).digest();
}

/** Cookie value: `base64url(json).base64url(hmacSha256)`, expiring 8 h after `now` (epoch ms). */
export function signSession(user: SessionUser, secret: string, now: number): string {
  const payload = Buffer.from(JSON.stringify({ role: user.role, email: user.email, exp: now + SESSION_TTL_MS })).toString(
    'base64url',
  );
  return `${payload}.${mac(payload, secret).toString('base64url')}`;
}

export function readSession(value: string, secret: string, now: number): SessionUser | null {
  const parts = value.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const given = Buffer.from(parts[1], 'base64url');
  const want = mac(parts[0], secret);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  let data: unknown;
  try {
    data = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if ((d.role !== 'owner' && d.role !== 'judge') || typeof d.email !== 'string' || typeof d.exp !== 'number') return null;
  if (now >= d.exp) return null;
  return { role: d.role, email: d.email };
}

/** Minimal Cookie header parser (no dependency). */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (!name || name in out) continue;
    const raw = part.slice(i + 1).trim();
    try {
      out[name] = decodeURIComponent(raw);
    } catch {
      out[name] = raw;
    }
  }
  return out;
}
