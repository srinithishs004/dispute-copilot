import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  acceptClaim,
  adjudicate,
  allowedActions,
  escalate,
  getDispute,
  listDisputes,
  makeOffer,
  provideEvidence,
  requireEvidence,
  sendMessage,
  type DisputeDetail,
} from '../../src/paypal/disputes.js';
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

describe('dispute actions', () => {
  const base = '/v1/customer/disputes/PP-D-1';
  const hdr = { 'PayPal-Request-Id': 'req-1' };
  const money = { currency_code: 'INR', value: '10.00' };

  test('sendMessage', async () => {
    const { client, calls } = fakeClient({});
    await sendMessage(client, 'PP-D-1', 'hi', 'req-1');
    expect(calls[0]).toEqual({ method: 'POST', path: `${base}/send-message`, body: { message: 'hi' }, headers: hdr });
  });

  test('makeOffer', async () => {
    const { client, calls } = fakeClient({});
    await makeOffer(client, 'PP-D-1', { note: 'n', amount: money }, 'req-1');
    expect(calls[0]).toEqual({
      method: 'POST',
      path: `${base}/make-offer`,
      body: { note: 'n', offer_amount: money, offer_type: 'REFUND' },
      headers: hdr,
    });
  });

  test('acceptClaim full and partial', async () => {
    const { client, calls } = fakeClient({});
    await acceptClaim(client, 'PP-D-1', { note: 'n' }, 'req-1');
    await acceptClaim(client, 'PP-D-1', { note: 'n', amount: money }, 'req-1');
    expect(calls[0]).toMatchObject({ path: `${base}/accept-claim`, body: { note: 'n', accept_claim_type: 'REFUND' }, headers: hdr });
    expect(calls[1]!.body).toEqual({ note: 'n', accept_claim_type: 'PARTIAL_REFUND', refund_amount: money });
  });

  test('provideEvidence sends multipart with input part', async () => {
    const { client, calls } = fakeClient({});
    await provideEvidence(
      client,
      'PP-D-1',
      { notes: 'shipped', tracking: [{ carrier: 'DHL', number: '123' }] },
      'req-1',
    );
    expect(calls[0]).toMatchObject({ method: 'POST', path: `${base}/provide-evidence`, headers: hdr });
    const fd = calls[0]!.body as FormData;
    expect(fd).toBeInstanceOf(FormData);
    const part = fd.get('input') as Blob;
    expect(part.type).toContain('application/json');
    expect(JSON.parse(await part.text())).toEqual({
      evidences: [
        {
          evidence_type: 'PROOF_OF_FULFILLMENT',
          evidence_info: { tracking_info: [{ carrier_name: 'DHL', tracking_number: '123' }] },
          notes: 'shipped',
        },
      ],
    });
  });

  test('provideEvidence omits evidence_info without tracking', async () => {
    const { client, calls } = fakeClient({});
    await provideEvidence(client, 'PP-D-1', { notes: 'x' }, 'req-1');
    const part = (calls[0]!.body as FormData).get('input') as Blob;
    expect(JSON.parse(await part.text())).toEqual({
      evidences: [{ evidence_type: 'PROOF_OF_FULFILLMENT', notes: 'x' }],
    });
  });

  test('escalate, adjudicate, requireEvidence', async () => {
    const { client, calls } = fakeClient({});
    await escalate(client, 'PP-D-1', 'n', 'req-1');
    await adjudicate(client, 'PP-D-1', 'SELLER_FAVOR', 'req-1');
    await requireEvidence(client, 'PP-D-1', 'BUYER_EVIDENCE', 'req-1');
    expect(calls.map((c) => [c.path, c.body, c.headers])).toEqual([
      [`${base}/escalate`, { note: 'n' }, hdr],
      [`${base}/adjudicate`, { adjudication_outcome: 'SELLER_FAVOR' }, hdr],
      [`${base}/require-evidence`, { action: 'BUYER_EVIDENCE' }, hdr],
    ]);
  });

  test('id is url-encoded', async () => {
    const { client, calls } = fakeClient({});
    await escalate(client, 'a/b', 'n', 'r');
    expect(calls[0]!.path).toBe('/v1/customer/disputes/a%2Fb/escalate');
  });

  test('allowedActions from fixture links', () => {
    const d = JSON.parse(readFileSync(new URL('../fixtures/dispute-inr-sandbox.json', import.meta.url), 'utf8')) as DisputeDetail;
    expect(allowedActions(d)).toEqual({ fight: true, offer: true, accept: true, message: true, escalate: true, adjudicate: false });
  });

  test('allowedActions with no links is all false', () => {
    const d = { dispute_id: 'x', reason: 'r', status: 's', create_time: 't' } as DisputeDetail;
    expect(Object.values(allowedActions(d)).every((v) => v === false)).toBe(true);
  });
});
