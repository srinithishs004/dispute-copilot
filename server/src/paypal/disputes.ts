import type { PayPalClient } from './client.js';

export type DisputeSummary = {
  dispute_id: string;
  reason: string;
  status: string;
  dispute_amount?: { currency_code: string; value: string };
  create_time: string;
};

// Tightened in Phase 1 after the spike shows real payloads.
export type DisputeDetail = DisputeSummary & Record<string, unknown>;

export async function listDisputes(
  c: PayPalClient,
  opts: { pageSize?: number } = {},
): Promise<DisputeSummary[]> {
  const res = await c.request<{ items?: DisputeSummary[] }>(
    'GET',
    `/v1/customer/disputes?page_size=${opts.pageSize ?? 10}`,
  );
  return res.items ?? [];
}

export function getDispute(c: PayPalClient, id: string): Promise<DisputeDetail> {
  return c.request<DisputeDetail>('GET', `/v1/customer/disputes/${encodeURIComponent(id)}`);
}
