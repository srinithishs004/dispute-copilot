import { Router } from 'express';
import type { AppDeps } from '../app.js';
import { listActions } from '../actions/repo.js';
import { buildEvidencePack } from '../agent/evidence.js';
import { allowedActions, type DisputeDetail } from '../paypal/disputes.js';
import { findOrderBundle } from '../store/repo.js';
import { requireSeller } from '../auth/guards.js';

type Row = {
  paypal_dispute_id: string;
  reason: string | null;
  status: string | null;
  amount: string | null;
  currency: string | null;
  response_due_at: Date | string | null;
  local_state: string;
  manual_reason: string | null;
  order_id: string | null;
  raw: DisputeDetail | null;
};

const iso = (v: Date | string | null) => (v == null ? null : new Date(v).toISOString());

function summary(r: Row) {
  return {
    disputeId: r.paypal_dispute_id,
    reason: r.reason,
    status: r.status,
    amount: r.amount == null ? null : String(r.amount),
    currency: r.currency,
    responseDueAt: iso(r.response_due_at),
    localState: r.local_state,
  };
}

const COLS =
  'paypal_dispute_id, reason, status, amount, currency, response_due_at, local_state, manual_reason, order_id, raw';

export function disputeRoutes(deps: AppDeps): Router {
  const { db } = deps;
  const router = Router();
  const guard = requireSeller(deps);

  router.get('/api/disputes', guard, async (_req, res) => {
    const { rows } = await db.query<Row>(
      `select ${COLS} from disputes order by raw->>'create_time' desc nulls last, paypal_dispute_id desc`,
    );
    res.json(rows.map(summary));
  });

  router.get('/api/disputes/:id', guard, async (req, res) => {
    const { rows } = await db.query<Row>(`select ${COLS} from disputes where paypal_dispute_id = $1`, [
      req.params.id,
    ]);
    const r = rows[0];
    if (!r) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const bundle = r.order_id && r.raw ? await findOrderBundle(db, r.order_id) : null;
    const evidence = bundle && r.raw ? buildEvidencePack(r.raw, bundle) : null;
    const a = (
      await db.query<{
        recommendation: string | null;
        confidence: number | null;
        evidence_strength: string | null;
        reasons: string[] | null;
        missing_evidence: string[] | null;
        suggested_offer: string | null;
        flags: string[] | null;
        letter_draft: string | null;
        model_used: string | null;
        created_at: Date | string | null;
      }>(
        `select recommendation, confidence, evidence_strength, reasons, missing_evidence,
                suggested_offer::text as suggested_offer, flags, letter_draft, model_used, created_at from analyses
         where dispute_id = $1 order by created_at desc, id desc limit 1`,
        [r.paypal_dispute_id],
      )
    ).rows[0];
    const actions = await listActions(db, r.paypal_dispute_id);
    res.json({
      ...summary(r),
      allowedActions: r.raw ? allowedActions(r.raw) : null,
      outcome: r.raw?.dispute_outcome?.outcome_code ?? null,
      actions: actions.map((x) => ({
        id: x.id,
        type: x.type,
        state: x.state,
        error: x.error,
        createdAt: x.createdAt,
        sentAt: x.sentAt,
      })),
      manualReason: r.manual_reason,
      evidence,
      latestAnalysis: a
        ? {
            recommendation: a.recommendation,
            confidence: a.confidence ?? null,
            evidenceStrength: a.evidence_strength,
            reasons: a.reasons ?? [],
            missingEvidence: a.missing_evidence ?? [],
            suggestedOffer: a.suggested_offer,
            flags: a.flags ?? [],
            letterDraft: a.letter_draft,
            modelUsed: a.model_used,
            createdAt: iso(a.created_at),
          }
        : null,
    });
  });

  return router;
}
