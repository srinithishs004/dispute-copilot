import { describe, expect, test } from 'vitest';
import { getDispute, listDisputes } from '../../src/paypal/disputes.js';
import { fakeClient } from './fake.js';

describe('listDisputes', () => {
  test('defaults page_size=10 and handles missing items', async () => {
    const { client, calls } = fakeClient({});
    expect(await listDisputes(client)).toEqual([]);
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/v1/customer/disputes?page_size=10' });
  });

  test('uses pageSize and returns items', async () => {
    const items = [{ dispute_id: 'PP-D-1', reason: 'X', status: 'OPEN', create_time: 't' }];
    const { client, calls } = fakeClient({ items });
    expect(await listDisputes(client, { pageSize: 5 })).toEqual(items);
    expect(calls[0]!.path).toBe('/v1/customer/disputes?page_size=5');
  });
});

describe('getDispute', () => {
  test('calls the detail path', async () => {
    const d = { dispute_id: 'PP-D-1', reason: 'X', status: 'OPEN', create_time: 't' };
    const { client, calls } = fakeClient(d);
    expect(await getDispute(client, 'PP-D-1')).toEqual(d);
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/v1/customer/disputes/PP-D-1' });
  });

  test('url-encodes the id', async () => {
    const { client, calls } = fakeClient({});
    await getDispute(client, 'a/b?c');
    expect(calls[0]!.path).toBe('/v1/customer/disputes/a%2Fb%3Fc');
  });
});
