import { describe, expect, test } from 'vitest';
import { EMAIL_RE, redactEmails } from '../../src/agent/promptText.js';

const viaRegex = (s: string) => s.replace(EMAIL_RE, '[email]');

describe('redactEmails', () => {
  test.each([
    'mail jane.doe@example.com now',
    '{"buyer":"bob@shop.test","n":1}',
    '<a@b.co>',
    'a@b@c.com',
    'no at sign',
    '@x.com and x@ and x@y and x@.c and x@c. and x@y.z',
    'two: a@b.cd,c@d.ef;e@f.gh',
    "q'u@x.io' tab\tz@w.ab",
  ])('matches the EMAIL_RE semantics: %s', (s) => {
    expect(redactEmails(s)).toBe(viaRegex(s));
  });

  test('is linear on long tokens without whitespace', () => {
    const s = `{"data":"${'x'.repeat(500_000)}","to":"a@b.cd"}`;
    const t = Date.now();
    const out = redactEmails(s);
    expect(Date.now() - t).toBeLessThan(500);
    expect(out.endsWith('"to":"[email]"}')).toBe(true);
  });
});
