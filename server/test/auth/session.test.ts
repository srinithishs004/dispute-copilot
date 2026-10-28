import { describe, expect, it } from 'vitest';
import { hashPassword, parseCookies, readSession, signSession, verifyPassword } from '../../src/auth/session.js';

const SECRET = 's'.repeat(32);
const NOW = 1_800_000_000_000;

describe('password hashing', () => {
  it('round-trips and rejects a wrong password', async () => {
    const stored = await hashPassword('correct horse');
    expect(stored).toMatch(/^scrypt\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(await verifyPassword('correct horse', stored)).toBe(true);
    expect(await verifyPassword('wrong', stored)).toBe(false);
  });

  it('uses a fresh salt each time', async () => {
    expect(await hashPassword('x')).not.toBe(await hashPassword('x'));
  });

  it('returns false for malformed stored values', async () => {
    expect(await verifyPassword('x', 'garbage')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$$')).toBe(false);
    expect(await verifyPassword('x', 'bcrypt$a$b')).toBe(false);
  });
});

describe('sessions', () => {
  it('signs and reads back role and email', () => {
    const v = signSession({ role: 'judge', email: 'j@x.test' }, SECRET, NOW);
    expect(readSession(v, SECRET, NOW + 1000)).toEqual({ role: 'judge', email: 'j@x.test' });
  });

  it('rejects a tampered payload or signature', () => {
    const v = signSession({ role: 'judge', email: 'j@x.test' }, SECRET, NOW);
    const [p, s] = v.split('.');
    const forged = Buffer.from(JSON.stringify({ role: 'owner', email: 'j@x.test', exp: NOW + 1e9 })).toString('base64url');
    expect(readSession(`${forged}.${s}`, SECRET, NOW)).toBeNull();
    expect(readSession(`${p}.${s!.slice(0, -2)}AA`, SECRET, NOW)).toBeNull();
    expect(readSession(v, 'o'.repeat(32), NOW)).toBeNull();
  });

  it('rejects expired sessions after 8 hours', () => {
    const v = signSession({ role: 'owner', email: 'o@x.test' }, SECRET, NOW);
    expect(readSession(v, SECRET, NOW + 8 * 3600_000 - 1)).not.toBeNull();
    expect(readSession(v, SECRET, NOW + 8 * 3600_000)).toBeNull();
  });

  it('rejects junk', () => {
    expect(readSession('', SECRET, NOW)).toBeNull();
    expect(readSession('abc', SECRET, NOW)).toBeNull();
    expect(readSession('a.b.c', SECRET, NOW)).toBeNull();
  });
});

describe('parseCookies', () => {
  it('parses a Cookie header', () => {
    expect(parseCookies('a=1; dc_session=x.y; b=%20z')).toEqual({ a: '1', dc_session: 'x.y', b: ' z' });
    expect(parseCookies(undefined)).toEqual({});
  });
});
