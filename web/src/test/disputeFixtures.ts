import type { DisputeDetail } from '../lib/types';

export const DISPUTE_ID = 'PP-R-NZM-10194801';

export const LETTER = [
  'Hello,',
  'Thank you for your patience with order ORD-11GB76A7 for the Logo T-Shirt.',
  'Our records show the parcel shipped with USPS on Oct 14, 2026 and the carrier still lists it as in transit.',
  'We would like to make this right, so we are offering a partial refund of $12.50 while the parcel is on its way.',
  'Best regards,',
  'Dispute Copilot Demo Store',
].join('\n');

/** The real Oct 27 sandbox run: $25 Logo T-Shirt, item not received, OFFER 12.50, confidence 80, WEAK. */
export function readyDetail(over: Partial<DisputeDetail> = {}): DisputeDetail {
  return {
    disputeId: DISPUTE_ID,
    reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
    status: 'WAITING_FOR_SELLER_RESPONSE',
    amount: '25.00',
    currency: 'USD',
    responseDueAt: new Date(Date.now() + 6 * 86_400_000 + 3_600_000).toISOString(),
    localState: 'READY_FOR_REVIEW',
    originalAmount: '25.00',
    deadlineFlag: null,
    allowedActions: { fight: true, offer: true, accept: true, message: true, escalate: false, adjudicate: false },
    outcome: null,
    actions: [],
    manualReason: null,
    evidence: {
      disputeId: DISPUTE_ID,
      reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
      amount: '25.00',
      currency: 'USD',
      facts: [
        { id: 'order.id', label: 'Order ID', value: 'ORD-11GB76A7' },
        { id: 'order.item', label: 'Item', value: 'Logo T-Shirt' },
        { id: 'order.amount', label: 'Order amount', value: '25.00 USD' },
        { id: 'order.created_at', label: 'Order placed at', value: 'Oct 13, 2026' },
        { id: 'shipment.0.carrier', label: 'Carrier', value: 'USPS' },
        { id: 'shipment.0.tracking', label: 'Tracking number', value: '9400111202555842761234' },
        { id: 'shipment.0.status', label: 'Shipment status', value: 'in_transit' },
        { id: 'shipment.0.shipped_at', label: 'Shipped at', value: 'Oct 14, 2026' },
        { id: 'policy.refund_window_days', label: 'Refund window (days)', value: '30' },
      ],
      checklist: [
        { requirement: 'tracking number', present: true },
        { requirement: 'delivery confirmation', present: false },
        { requirement: 'signature on delivery', present: false },
      ],
      missing: ['delivery confirmation', 'signature on delivery'],
    },
    latestAnalysis: {
      recommendation: 'OFFER',
      confidence: 80,
      evidenceStrength: 'WEAK',
      reasons: [
        'The parcel has tracking but is still in transit.',
        'There is no delivery confirmation or signature on file.',
      ],
      missingEvidence: ['delivery confirmation', 'signature on delivery'],
      suggestedOffer: '12.50',
      flags: ['Downgraded from FIGHT: missing delivery confirmation, signature on delivery'],
      letterDraft: LETTER,
      modelUsed: 'groq:openai/gpt-oss-120b',
      createdAt: '2026-10-27T14:02:11.000Z',
    },
    ...over,
  };
}
