import request from 'supertest';
import { expect, test } from 'vitest';
import { createApp } from '../src/app.js';
import { makeTestDeps } from './helpers.js';

test('GET /health returns ok', async () => {
  const res = await request(createApp(makeTestDeps())).get('/health');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true });
});
