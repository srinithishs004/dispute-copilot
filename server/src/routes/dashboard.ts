import { Router } from 'express';
import type { AppDeps } from '../app.js';
import { requireSeller } from '../auth/guards.js';

const DAY_MS = 86_400_000;

type DisputeQueryRow = {
  paypal_dispute_id: string;
  reason: string | null;
  status: string | null;
  local_state: string;
  amount: string | null;
  original_amount: string | null;
  currency: string | null;
  response_due_at: Date | string | null;
  deadline_flag: 'due_soon' | 'overdue' | null;
  outcome: string | null;
  created_at: Date | string | null;
  recommendation: string | null;
  confidence: number | null;
  evidence_strength: string | null;
};

const iso = (v: Date | string | null) => (v == null ? null : new Date(v).toISOString());
const num = (v: string | null) => (v == null ? null : parseFloat(v));

/**
 * Amount the seller kept on a closed dispute. PayPal lowers `dispute_amount` after an accepted
 * offer, so the original amount is stored separately.
 * - seller-favour outcomes (e.g. RESOLVED_SELLER_FAVOUR) and CANCELED_BY_BUYER: kept = original, refunded 0
 * - buyer-favour (RESOLVED_BUYER_FAVOUR), RESOLVED_WITH_PAYOUT and unknown codes: the amount PayPal
 *   still reports is what was refunded, so kept = original - current amount
 */
export function amountKept(original: number, current: number | null, outcome: string | null): number {
  if (outcome !== null && (outcome.includes('SELLER_FAVOUR') || outcome === 'CANCELED_BY_BUYER')) return original;
  const refunded = current ?? 0;
  return Math.round((original - refunded) * 100) / 100;
}

export function dashboardRoutes(deps: AppDeps): Router {
  const { db } = deps;
  const router = Router();
  const guard = requireSeller(deps);

  router.get('/api/dashboard/data', guard, async (_req, res) => {
    const now = (deps.now ?? Date.now)();
    // Three queries total, none per dispute.
    const disputes = await db.query<DisputeQueryRow>(
      `select d.paypal_dispute_id, d.reason, d.status, d.local_state, d.amount::text as amount,
              d.original_amount::text as original_amount, d.currency, d.response_due_at, d.deadline_flag,
              d.raw->'dispute_outcome'->>'outcome_code' as outcome,
              coalesce((d.raw->>'create_time')::timestamptz, d.updated_at) as created_at,
              a.recommendation, a.confidence, a.evidence_strength
       from disputes d
       left join lateral (
         select recommendation, confidence, evidence_strength from analyses
         where dispute_id = d.paypal_dispute_id order by created_at desc, id desc limit 1
       ) a on true
       order by coalesce((d.raw->>'create_time')::timestamptz, d.updated_at) desc, d.paypal_dispute_id desc`,
    );
    const actions = await db.query<{ dispute_id: string; type: string; state: string; created_at: Date | string; sent_at: Date | string | null }>(
      'select dispute_id, type, state, created_at, sent_at from actions order by created_at, id',
    );
    const gaps = await db.query<{ dispute_id: string; requirement: string }>(
      `select l.dispute_id, g.requirement
       from (select distinct on (dispute_id) dispute_id, missing_evidence from analyses
             order by dispute_id, created_at desc, id desc) l
       cross join lateral jsonb_array_elements_text(
         case when jsonb_typeof(l.missing_evidence) = 'array' then l.missing_evidence else '[]'::jsonb end) with ordinality as g(requirement, ord)
       order by l.dispute_id, g.ord`,
    );

    res.json({
      generatedAt: new Date(now).toISOString(),
      sources: {
        disputes: disputes.rows.map((r) => {
          const resolved = r.local_state === 'RESOLVED' || r.status === 'RESOLVED';
          const current = num(r.amount);
          const original = num(r.original_amount) ?? current ?? 0;
          const due = r.response_due_at == null ? null : new Date(r.response_due_at).getTime();
          return {
            disputeId: r.paypal_dispute_id,
            reason: r.reason,
            status: r.status,
            localState: r.local_state,
            originalAmount: original,
            finalAmount: resolved ? current : null,
            amountKept: resolved ? amountKept(original, current, r.outcome) : null,
            currency: r.currency,
            responseDueAt: iso(r.response_due_at),
            daysLeft: resolved || due === null ? null : Math.ceil((due - now) / DAY_MS),
            deadlineFlag: r.deadline_flag,
            recommendation: r.recommendation,
            confidence: r.confidence,
            evidenceStrength: r.evidence_strength,
            outcome: r.outcome,
            createdAt: iso(r.created_at),
          };
        }),
        actions: actions.rows.map((a) => ({
          disputeId: a.dispute_id,
          type: a.type,
          state: a.state,
          createdAt: iso(a.created_at),
          sentAt: iso(a.sent_at),
        })),
        evidence_gaps: gaps.rows.map((g) => ({ disputeId: g.dispute_id, requirement: g.requirement })),
      },
    });
  });

  return router;
}
