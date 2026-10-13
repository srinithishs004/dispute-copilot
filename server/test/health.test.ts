import request from 'supertest';
import { expect, test } from 'vitest';
import { createApp } from '../src/app.js';
import type { Config } from '../src/config.js';

const testConfig: Config = {
  port: 3000,
  paypal: {
    clientId: 'id',
    clientSecret: 'sec',
    baseUrl: 'https://api-m.sandbox.paypal.com',
    webhookId: null,
  },
  debugToken: null,
};

test('GET /health returns ok', async () => {
  const res = await request(createApp({ config: testConfig })).get('/health');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true });
});
