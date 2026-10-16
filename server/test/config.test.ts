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

test('rejects a non-sandbox PAYPAL_BASE_URL', () => {
  expect(() =>
    loadConfig({ PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 's', PAYPAL_BASE_URL: 'https://api-m.paypal.com' }),
  ).toThrow('PAYPAL_BASE_URL must be the PayPal sandbox URL (https://api-m.sandbox.paypal.com)');
});

test('accepts the sandbox PAYPAL_BASE_URL explicitly', () => {
  const c = loadConfig({
    PAYPAL_CLIENT_ID: 'id',
    PAYPAL_CLIENT_SECRET: 's',
    PAYPAL_BASE_URL: 'https://api-m.sandbox.paypal.com',
  });
  expect(c.paypal.baseUrl).toBe('https://api-m.sandbox.paypal.com');
});

test('PUBLIC_BASE_URL defaults to localhost and drops a trailing slash', () => {
  const base = { PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 's' };
  expect(loadConfig(base).publicBaseUrl).toBe('http://localhost:3000');
  expect(loadConfig({ ...base, PUBLIC_BASE_URL: 'https://demo.example.com/' }).publicBaseUrl).toBe(
    'https://demo.example.com',
  );
});
