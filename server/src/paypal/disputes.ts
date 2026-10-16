import type { PayPalClient } from './client.js';

export type DisputeSummary = {
  dispute_id: string;
  reason: string;
  status: string;
  dispute_amount?: { currency_code: string; value: string };
  create_time: string;
};

type Money = { currency_code: string; value: string };

// Typed from the Phase 0 sandbox payload; unknown extra fields stay accessible.
export type DisputeDetail = DisputeSummary & {
  dispute_life_cycle_stage?: string;
  seller_response_due_date?: string;
  disputed_transactions?: {
    invoice_number?: string;
    seller_transaction_id?: string;
    gross_amount?: Money;
  }[];
  messages?: { posted_by?: string; time_posted?: string; content?: string }[];
  evidences?: { evidence_type?: string; source?: string; notes?: string; date?: string }[];
  allowed_response_options?: Record<string, unknown>;
} & Record<string, unknown>;

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
