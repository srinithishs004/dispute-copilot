import type { AppDeps } from '../src/app.js';
import type { Config } from '../src/config.js';
import { createEventLog } from '../src/webhooks/eventLog.js';
import { fakeClient } from './paypal/fake.js';

export const testConfig: Config = {
  port: 3000,
  paypal: {
    clientId: 'id',
    clientSecret: 'sec',
    baseUrl: 'https://api-m.sandbox.paypal.com',
    webhookId: 'WH-TEST',
  },
  debugToken: 'dbg',
};

export function makeTestDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  return {
    config: testConfig,
    paypal: fakeClient({ verification_status: 'SUCCESS' }).client,
    eventLog: createEventLog(),
    logger: { info: () => {}, warn: () => {} },
    ...overrides,
  };
}
