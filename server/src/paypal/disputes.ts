import type { PayPalClient } from './client.js';

export type DisputeSummary = {
  dispute_id: string;
  reason: string;
  status: string;
  dispute_amount?: { currency_code: string; value: string };
  create_time: string;
};

export type Money = { currency_code: string; value: string };

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
  links?: { href?: string; rel?: string; method?: string }[];
  dispute_outcome?: { outcome_code?: string };
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

export type DisputeAction = 'FIGHT' | 'OFFER' | 'ACCEPT';

export function allowedActions(detail: DisputeDetail): {
  fight: boolean;
  offer: boolean;
  accept: boolean;
  message: boolean;
  escalate: boolean;
  adjudicate: boolean;
} {
  const rels = new Set((detail.links ?? []).map((l) => l.rel));
  return {
    fight: rels.has('provide_evidence'),
    offer: rels.has('make_offer'),
    accept: rels.has('accept_claim'),
    message: rels.has('send_message'),
    escalate: rels.has('escalate'),
    adjudicate: rels.has('adjudicate'),
  };
}

function post(c: PayPalClient, id: string, action: string, body: unknown, requestId: string): Promise<unknown> {
  return c.request('POST', `/v1/customer/disputes/${encodeURIComponent(id)}/${action}`, body, {
    'PayPal-Request-Id': requestId,
  });
}

export function sendMessage(c: PayPalClient, id: string, message: string, requestId: string): Promise<unknown> {
  return post(c, id, 'send-message', { message }, requestId);
}

export function makeOffer(
  c: PayPalClient,
  id: string,
  input: { note: string; amount: Money },
  requestId: string,
): Promise<unknown> {
  return post(c, id, 'make-offer', { note: input.note, offer_amount: input.amount, offer_type: 'REFUND' }, requestId);
}

export function acceptClaim(
  c: PayPalClient,
  id: string,
  input: { note: string; amount?: Money },
  requestId: string,
): Promise<unknown> {
  const body = input.amount
    ? { note: input.note, accept_claim_type: 'PARTIAL_REFUND', refund_amount: input.amount }
    : { note: input.note, accept_claim_type: 'REFUND' };
  return post(c, id, 'accept-claim', body, requestId);
}

export function provideEvidence(
  c: PayPalClient,
  id: string,
  input: { notes: string; tracking?: { carrier: string; number: string }[] },
  requestId: string,
): Promise<unknown> {
  const evidence: Record<string, unknown> = { evidence_type: 'PROOF_OF_FULFILLMENT' };
  if (input.tracking && input.tracking.length > 0) {
    evidence.evidence_info = {
      tracking_info: input.tracking.map((t) => ({ carrier_name: t.carrier, tracking_number: t.number })),
    };
  }
  evidence.notes = input.notes;
  const form = new FormData();
  form.append(
    'input',
    new Blob([JSON.stringify({ evidences: [evidence] })], { type: 'application/json' }),
    'input.json',
  );
  return post(c, id, 'provide-evidence', form, requestId);
}

export function escalate(c: PayPalClient, id: string, note: string, requestId: string): Promise<unknown> {
  return post(c, id, 'escalate', { note }, requestId);
}

export function adjudicate(
  c: PayPalClient,
  id: string,
  outcome: 'SELLER_FAVOR' | 'BUYER_FAVOR',
  requestId: string,
): Promise<unknown> {
  return post(c, id, 'adjudicate', { adjudication_outcome: outcome }, requestId);
}

export function requireEvidence(
  c: PayPalClient,
  id: string,
  action: 'SELLER_EVIDENCE' | 'BUYER_EVIDENCE',
  requestId: string,
): Promise<unknown> {
  return post(c, id, 'require-evidence', { action }, requestId);
}
