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

test('LLM settings default to no keys and the default models', () => {
  const c = loadConfig({ PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 's', GEMINI_API_KEY: '', GROQ_MODEL: '' });
  expect(c.llm.gemini).toEqual({ apiKey: null, model: 'gemini-3.6-flash' });
  expect(c.llm.groq).toEqual({ apiKey: null, model: 'llama-3.3-70b-versatile' });
  const d = loadConfig({ PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 's', GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q', GEMINI_MODEL: 'm1' });
  expect(d.llm.gemini).toEqual({ apiKey: 'g', model: 'm1' });
  expect(d.llm.groq.apiKey).toBe('q');
});

test('runWorkerInline defaults to true only without DATABASE_URL, and can be overridden', () => {
  const base = { PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 's' };
  expect(loadConfig(base).runWorkerInline).toBe(true);
  expect(loadConfig({ ...base, DATABASE_URL: 'postgres://x' }).runWorkerInline).toBe(false);
  expect(loadConfig({ ...base, DATABASE_URL: 'postgres://x', RUN_WORKER_INLINE: 'true' }).runWorkerInline).toBe(true);
  expect(loadConfig({ ...base, RUN_WORKER_INLINE: 'false' }).runWorkerInline).toBe(false);
  expect(() => loadConfig({ ...base, RUN_WORKER_INLINE: 'maybe' })).toThrow(/RUN_WORKER_INLINE/);
});

test('storeName defaults and can be overridden', () => {
  const base = { PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 's' };
  expect(loadConfig(base).storeName).toBe('Dispute Copilot Demo Store');
  expect(loadConfig({ ...base, STORE_NAME: '' }).storeName).toBe('Dispute Copilot Demo Store');
  expect(loadConfig({ ...base, STORE_NAME: 'Acme' }).storeName).toBe('Acme');
});
