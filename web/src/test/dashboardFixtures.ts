import type { DashboardDispute, DashboardFeed } from '../lib/types';

const DAY = 86_400_000;

/** The real Oct 27 sandbox run: $25 Logo T-Shirt, OFFER at 80, resolved for the buyer, $12.50 kept. */
export const OCT27: DashboardDispute = {
  disputeId: 'PP-R-NZM-10194801',
  reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
  status: 'RESOLVED',
  localState: 'RESOLVED',
  originalAmount: 25,
  finalAmount: 12.5,
  amountKept: 12.5,
  currency: 'USD',
  responseDueAt: '2026-11-06T13:58:00.000Z',
  daysLeft: null,
  deadlineFlag: null,
  recommendation: 'OFFER',
  confidence: 80,
  evidenceStrength: 'WEAK',
  outcome: 'RESOLVED_BUYER_FAVOUR',
  createdAt: '2026-10-27T13:58:00.000Z',
};

/** Test fixture rows (not real disputes). */
export function openDispute(over: Partial<DashboardDispute>): DashboardDispute {
  return {
    disputeId: 'PP-D-TEST',
    reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
    status: 'WAITING_FOR_SELLER_RESPONSE',
    localState: 'READY_FOR_REVIEW',
    originalAmount: 40,
    finalAmount: null,
    amountKept: null,
    currency: 'USD',
    responseDueAt: new Date(Date.now() + 5 * DAY).toISOString(),
    daysLeft: 5,
    deadlineFlag: null,
    recommendation: 'FIGHT',
    confidence: 70,
    evidenceStrength: 'STRONG',
    outcome: null,
    createdAt: '2026-10-25T10:00:00.000Z',
    ...over,
  };
}

export function feed(disputes: DashboardDispute[], extra: Partial<DashboardFeed['sources']> = {}): DashboardFeed {
  return {
    generatedAt: '2026-10-28T12:00:00.000Z',
    sources: { disputes, actions: [], evidence_gaps: [], ...extra },
  };
}
