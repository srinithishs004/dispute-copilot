import type { Db } from '../db/db.js';
import type { Llm } from '../ai/llm.js';
import { LlmUnavailableError } from '../ai/llm.js';
import { advise, AdviceUnavailableError } from '../agent/advisor.js';
import { buildEvidencePack } from '../agent/evidence.js';
import { draftLetter, LetterRejectedError } from '../agent/letter.js';
import { setLocalState } from '../disputes/repo.js';
import type { DisputeDetail } from '../paypal/disputes.js';
import { findOrderBundle } from '../store/repo.js';
import { MAX_ATTEMPTS } from './queue.js';
import type { JobHandler } from './worker.js';

export interface AnalyzeDisputeDeps {
  db: Db;
  llm: Llm;
  storeName: string;
}

export function analyzeDisputeJob(deps: AnalyzeDisputeDeps): JobHandler {
  const { db, llm, storeName } = deps;
  return async (job) => {
    const disputeId = (job.payload as { disputeId?: unknown } | null)?.disputeId;
    if (typeof disputeId !== 'string' || !disputeId) throw new Error('analyzeDispute: payload.disputeId missing');

    const { rows } = await db.query<{ order_id: string | null; raw: DisputeDetail; local_state: string }>(
      'select order_id, raw, local_state from disputes where paypal_dispute_id = $1',
      [disputeId],
    );
    const dispute = rows[0];
    if (!dispute) throw new Error('analyzeDispute: dispute not found');
    // Only analyze while still being analyzed; a later state (e.g. RESOLVED) must not be overwritten.
    if (dispute.local_state !== 'ANALYZING') return;
    try {
      const bundle = dispute.order_id ? await findOrderBundle(db, dispute.order_id) : null;
      if (!dispute.order_id || !bundle) {
        await setLocalState(db, disputeId, 'NEEDS_MANUAL', 'no matching order');
        return;
      }

      const pack = buildEvidencePack(dispute.raw, bundle);
      const { advice, model: adviceModel } = await advise(llm, pack, dispute.raw);
      const { draft, model: letterModel } = await draftLetter(
        llm,
        pack,
        advice.recommendation,
        [disputeId, dispute.order_id],
        { storeName, ...(advice.recommendation === 'OFFER' && advice.suggestedOffer ? { offerAmount: advice.suggestedOffer } : {}) },
      );
      const modelUsed = adviceModel === letterModel ? adviceModel : `${adviceModel}+${letterModel}`;
      await db.transaction(async (tx) => {
        await tx.query(
          `insert into analyses (dispute_id, recommendation, confidence, evidence_strength, reasons, missing_evidence, suggested_offer, flags, letter_draft, model_used)
           values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8::jsonb, $9, $10)`,
          [
            disputeId,
            advice.recommendation,
            advice.confidence,
            advice.evidenceStrength,
            JSON.stringify(advice.reasons),
            JSON.stringify(advice.missingEvidence),
            advice.suggestedOffer,
            JSON.stringify(advice.flags),
            draft.letter,
            modelUsed,
          ],
        );
        await setLocalState(tx, disputeId, 'READY_FOR_REVIEW');
      });
    } catch (e) {
      if (e instanceof AdviceUnavailableError) {
        await setLocalState(db, disputeId, 'NEEDS_MANUAL', 'No PayPal action is open for this dispute');
        return;
      }
      if (job.attempts >= MAX_ATTEMPTS) {
        const reason =
          e instanceof LlmUnavailableError
            ? `AI draft unavailable (${e.logDetail})`
            : e instanceof LetterRejectedError
              ? 'AI draft unavailable'
              : 'processing failed';
        try {
          await setLocalState(db, disputeId, 'NEEDS_MANUAL', reason);
        } catch {
          // Surface the original error, not the failure to record it.
        }
      }
      throw e;
    }
  };
}
