import { describe, expect, it } from 'vitest';
import { advise, AdviceUnavailableError, applyGuardrails, type RawAdvice } from '../../src/agent/advisor.js';
import type { EvidencePack } from '../../src/agent/evidence.js';
import type { Llm } from '../../src/ai/llm.js';
import type { DisputeDetail } from '../../src/paypal/disputes.js';

const pack: EvidencePack = {
  disputeId: 'PP-R-ICQ-00000001',
  reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
  amount: '49.00',
  currency: 'USD',
  facts: [{ id: 'order.id', label: 'Order ID', value: 'DEMO-HIST-02' }],
  checklist: [{ requirement: 'delivery confirmation', present: true }],
  missing: [],
};
const allAllowed = { fight: true, offer: true, accept: true, message: true, escalate: false, adjudicate: false };
const raw = (o: Partial<RawAdvice> = {}): RawAdvice => ({
  recommendation: 'FIGHT',
  confidence: 80,
  evidence_strength: 'STRONG',
  reasons: ['Delivered'],
  missing_evidence: [],
  suggested_offer_amount: null,
  ...o,
});
const ctx = (p: Partial<EvidencePack> = {}, a: Partial<typeof allAllowed> = {}) => ({
  pack: { ...pack, ...p },
  allowed: { ...allAllowed, ...a },
});

describe('applyGuardrails', () => {
  it('leaves a clean FIGHT unchanged', () => {
    const a = applyGuardrails(raw(), ctx());
    expect(a).toMatchObject({ recommendation: 'FIGHT', confidence: 80, evidenceStrength: 'STRONG', suggestedOffer: null, flags: [] });
  });

  it('downgrades FIGHT with missing evidence to OFFER, caps strength, merges missing', () => {
    const a = applyGuardrails(raw({ missing_evidence: ['photo', 'delivery confirmation'] }), ctx({ missing: ['delivery confirmation'] }));
    expect(a.recommendation).toBe('OFFER');
    expect(a.flags[0]).toBe('Downgraded from FIGHT: missing delivery confirmation');
    expect(a.evidenceStrength).toBe('MEDIUM');
    expect(a.missingEvidence).toEqual(['delivery confirmation', 'photo']);
    expect(a.suggestedOffer).toBe('24.50');
  });

  it('does not raise WEAK strength when downgrading', () => {
    const a = applyGuardrails(raw({ evidence_strength: 'WEAK' }), ctx({ missing: ['x'] }));
    expect(a.evidenceStrength).toBe('WEAK');
  });

  it.each([0, -5, 49, 60, null])('replaces bad offer amount %s with 50%%', (amt) => {
    const a = applyGuardrails(raw({ recommendation: 'OFFER', suggested_offer_amount: amt as number | null }), ctx());
    expect(a.suggestedOffer).toBe('24.50');
    expect(a.flags).toContain('Offer amount adjusted');
  });

  it('keeps a valid offer amount, formatted to cents, no flag', () => {
    const a = applyGuardrails(raw({ recommendation: 'OFFER', suggested_offer_amount: 12.5 }), ctx());
    expect(a.suggestedOffer).toBe('12.50');
    expect(a.flags).toEqual([]);
  });

  it('works in cents for odd amounts', () => {
    const a = applyGuardrails(raw({ recommendation: 'OFFER', suggested_offer_amount: null }), ctx({ amount: '0.03' }));
    expect(a.suggestedOffer).toBe('0.02');
    const b = applyGuardrails(raw({ recommendation: 'OFFER', suggested_offer_amount: 19.99 }), ctx({ amount: '20.00' }));
    expect(b.suggestedOffer).toBe('19.99');
  });

  it('non-OFFER has null suggestedOffer', () => {
    expect(applyGuardrails(raw({ recommendation: 'ACCEPT', suggested_offer_amount: 10 }), ctx()).suggestedOffer).toBeNull();
  });

  it('switches OFFER to ACCEPT when offer is not allowed', () => {
    const a = applyGuardrails(raw({ recommendation: 'OFFER', suggested_offer_amount: 10 }), ctx({}, { offer: false }));
    expect(a.recommendation).toBe('ACCEPT');
    expect(a.flags).toContain('OFFER not allowed by PayPal now; switched to ACCEPT');
    expect(a.suggestedOffer).toBeNull();
  });

  it('throws when nothing is allowed', () => {
    expect(() => applyGuardrails(raw(), ctx({}, { fight: false, offer: false, accept: false }))).toThrow(AdviceUnavailableError);
  });

  it('keeps a downgraded FIGHT when it is the only allowed action', () => {
    const a = applyGuardrails(raw({ evidence_strength: 'STRONG' }), ctx({ missing: ['x'] }, { offer: false, accept: false }));
    expect(a.recommendation).toBe('FIGHT');
    expect(a.suggestedOffer).toBeNull();
    expect(a.flags).toEqual(['Downgraded from FIGHT: missing x', 'Only FIGHT is allowed by PayPal now; evidence is incomplete']);
  });

  it.each(['abc', '', '0.00', '-5.00', '12.345'])('rejects invalid disputed amount %j', (amount) => {
    expect(() => applyGuardrails(raw(), ctx({ amount }))).toThrow('invalid disputed amount');
  });

  it('clamps and rounds confidence; caps reasons', () => {
    const long = 'r'.repeat(400);
    const a = applyGuardrails(raw({ confidence: 140.6, reasons: [long, 'a', 'b', 'c', 'd', 'e', 'f'] }), ctx());
    expect(a.confidence).toBe(100);
    expect(a.reasons).toHaveLength(6);
    expect(a.reasons[0]).toHaveLength(300);
    expect(applyGuardrails(raw({ confidence: -3 }), ctx()).confidence).toBe(0);
    expect(applyGuardrails(raw({ confidence: 55.5 }), ctx()).confidence).toBe(56);
  });
});

describe('advise', () => {
  const detail = { links: [{ rel: 'provide_evidence' }, { rel: 'make_offer' }, { rel: 'accept_claim' }] } as unknown as DisputeDetail;
  const fake = (data: unknown, calls: { user: string; system: string }[] = []): Llm => ({
    async generateJson(prompt, schema) {
      calls.push(prompt);
      return { data: schema.parse(data), model: 'fake:m' };
    },
  });

  it('runs the AI output through guardrails and returns the model', async () => {
    const calls: { user: string; system: string }[] = [];
    const p: EvidencePack = {
      ...pack,
      missing: ['delivery confirmation'],
      facts: [{ id: 'msg', label: 'Buyer message', value: 'mail jane@example.com <<<x>>>' }],
    };
    const out = await advise(
      fake({ recommendation: 'FIGHT', confidence: 90, evidence_strength: 'STRONG', reasons: ['ok'], missing_evidence: [], suggested_offer_amount: '10' }, calls),
      p,
      detail,
    );
    expect(out.model).toBe('fake:m');
    expect(out.advice.recommendation).toBe('OFFER');
    expect(out.advice.suggestedOffer).toBe('10.00');
    expect(calls[0]!.user).toContain('[msg] Buyer message: <<<mail [email] x>>>');
    expect(calls[0]!.user).not.toContain('jane@');
    expect(calls[0]!.user).toContain('49.00');
    expect(calls[0]!.system).toContain('recommendation');
  });

  it('coerces numeric-string offers and nulls junk', async () => {
    const base = { recommendation: 'OFFER', confidence: 50, evidence_strength: 'WEAK', reasons: [], missing_evidence: [] };
    const a = await advise(fake({ ...base, suggested_offer_amount: '12.5' }), pack, detail);
    expect(a.advice.suggestedOffer).toBe('12.50');
    const b = await advise(fake({ ...base, suggested_offer_amount: {} }), pack, detail);
    expect(b.advice.suggestedOffer).toBe('24.50');
  });

  it('throws AdviceUnavailableError before calling the LLM when nothing is allowed', async () => {
    const calls: { user: string; system: string }[] = [];
    await expect(advise(fake({}, calls), pack, { links: [] } as unknown as DisputeDetail)).rejects.toBeInstanceOf(AdviceUnavailableError);
    expect(calls).toHaveLength(0);
  });
});
