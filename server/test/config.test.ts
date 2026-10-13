import { expect, test } from 'vitest';
import { loadConfig } from '../src/config.js';

test('loads required values and defaults', () => {
  const c = loadConfig({ PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 'sec' });
  expect(c.port).toBe(3000);
  expect(c.paypal.baseUrl).toBe('https://api-m.sandbox.paypal.com');
  expect(c.paypal.webhookId).toBeNull();
  expect(c.debugToken).toBeNull();
});

test('names the missing variable', () => {
  expect(() => loadConfig({ PAYPAL_CLIENT_ID: 'id' })).toThrow(/PAYPAL_CLIENT_SECRET/);
});

test('treats empty strings as missing for required keys', () => {
  expect(() => loadConfig({ PAYPAL_CLIENT_ID: '', PAYPAL_CLIENT_SECRET: 's' })).toThrow(
    /PAYPAL_CLIENT_ID/,
  );
});

test('empty optional values become null or default', () => {
  const c = loadConfig({
    PAYPAL_CLIENT_ID: 'id',
    PAYPAL_CLIENT_SECRET: 's',
    PAYPAL_WEBHOOK_ID: '',
    DEBUG_TOKEN: '',
    PORT: '',
    PAYPAL_BASE_URL: '',
  });
  expect(c.paypal.webhookId).toBeNull();
  expect(c.debugToken).toBeNull();
  expect(c.port).toBe(3000);
  expect(c.paypal.baseUrl).toBe('https://api-m.sandbox.paypal.com');
});
