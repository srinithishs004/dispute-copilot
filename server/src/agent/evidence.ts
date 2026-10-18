import type { DisputeDetail } from '../paypal/disputes.js';
import type { OrderBundle } from '../store/repo.js';

export type Fact = { id: string; label: string; value: string };

export type EvidencePack = {
  disputeId: string;
  reason: string;
  amount: string;
  currency: string;
  facts: Fact[];
  checklist: { requirement: string; present: boolean }[];
  missing: string[];
};

const REQUIREMENTS: Record<string, string[]> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: ['tracking number', 'delivery confirmation', 'signature on delivery'],
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: ['item description', 'buyer communication', 'refund policy'],
};
const DEFAULT_REQUIREMENTS = ['order record', 'buyer communication'];

const DATE_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** Readable UTC date for facts shown to the AI and the buyer; unparseable input is returned unchanged. */
export function formatFactDate(v: string | Date): string {
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : DATE_FMT.format(d);
}
const fmt = (v: string | Date | null | undefined) => (v == null || v === '' ? v : formatFactDate(v));

export function buildEvidencePack(detail: DisputeDetail, bundle: OrderBundle): EvidencePack {
  const { order, shipments, messages, policy } = bundle;
  const facts: Fact[] = [];
  const add = (id: string, label: string, value: string | null | undefined) => {
    if (value != null && value !== '') facts.push({ id, label, value });
  };

  add('order.id', 'Order ID', order.id);
  add('order.item', 'Item', order.item);
  add('order.amount', 'Order amount', order.amount && `${order.amount} ${order.currency ?? ''}`.trim());
  add('order.created_at', 'Order placed at', fmt(order.createdAt));

  shipments.forEach((s, i) => {
    add(`shipment.${i}.carrier`, 'Carrier', s.carrier);
    add(`shipment.${i}.tracking`, 'Tracking number', s.trackingNumber);
    add(`shipment.${i}.status`, 'Shipment status', s.status);
    add(`shipment.${i}.shipped_at`, 'Shipped at', fmt(s.shippedAt));
    add(`shipment.${i}.delivered_at`, 'Delivered at', fmt(s.deliveredAt));
    if (s.signatureProof) add(`shipment.${i}.signature`, 'Signature on delivery', 'Signature proof on file');
  });

  messages.forEach((m, i) => add(`message.${i}`, `Store message from ${m.sender}`, m.body));
  add('policy.text', 'Refund policy', policy.policyText);
  add('policy.refund_window_days', 'Refund window (days)', String(policy.refundWindowDays));

  const buyerMsgs = (detail.messages ?? []).filter((m) => m.posted_by === 'BUYER');
  buyerMsgs.forEach((m, i) => add(`dispute.buyer_message.${i}`, 'Buyer message in dispute', m.content));
  (detail.evidences ?? [])
    .filter((e) => e.source === 'REQUESTED_FROM_SELLER')
    .forEach((e, i) => add(`dispute.requested_evidence.${i}`, 'Evidence requested by PayPal', e.evidence_type));

  const present: Record<string, boolean> = {
    'tracking number': shipments.some((s) => !!s.trackingNumber),
    'delivery confirmation': shipments.some((s) => !!fmt(s.deliveredAt)),
    'signature on delivery': shipments.some((s) => s.signatureProof),
    'item description': !!order.item?.trim(),
    'buyer communication': messages.some((m) => m.sender === 'buyer') || buyerMsgs.length > 0,
    'refund policy': !!policy.policyText.trim(),
    'order record': true,
  };
  const reqs = REQUIREMENTS[detail.reason] ?? DEFAULT_REQUIREMENTS;
  const checklist = reqs.map((requirement) => ({ requirement, present: present[requirement] ?? false }));

  return {
    disputeId: detail.dispute_id,
    reason: detail.reason,
    amount: detail.dispute_amount?.value ?? '',
    currency: detail.dispute_amount?.currency_code ?? '',
    facts,
    checklist,
    missing: checklist.filter((c) => !c.present).map((c) => c.requirement),
  };
}
