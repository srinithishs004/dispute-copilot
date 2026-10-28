import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyzeDisputeJob } from '../../src/jobs/analyzeDispute.js';
import { buildHandlers } from '../../src/jobs/handlers.js';
import { processDispute } from '../../src/jobs/processDispute.js';
import { LlmUnavailableError, type Llm } from '../../src/ai/llm.js';
import { seedStore } from '../../src/store/seed.js';
import type { DisputeDetail } from '../../src/paypal/disputes.js';
import { makeTestDb } from '../helpers.js';
import { fakeClient } from '../paypal/fake.js';

const inr = JSON.parse(
  readFileSync(new URL('../fixtures/dispute-inr-sandbox.json', import.meta.url), 'utf8'),
) as DisputeDetail;
const letter =
  'Dear PayPal dispute team, the order was shipped with tracking number 1Z999AA10123456784 as recorded in our shipment facts. We respectfully ask that the dispute be resolved in our favour. Thank you.';
const STORE = 'Test Store';
const advice = (over: Record<string, unknown> = {}) => ({
  recommendation: 'FIGHT',
  confidence: 80,
  evidence_strength: 'STRONG',
  reasons: ['Tracking shows delivery'],
  missing_evidence: [],
  suggested_offer_amount: null,
  ...over,
});
/** Answers the advisor call (system mentions "recommendation") or the letter call. */
function fakeLlm(adviceJson: Record<string, unknown>, letterJson: Record<string, unknown>, models = ['fake:m', 'fake:m']): Llm {
  return {
    async generateJson(p, schema) {
      const isAdvisor = p.system.includes('recommendation');
      return { data: schema.parse(isAdvisor ? adviceJson : letterJson), model: models[isAdvisor ? 0 : 1]! };
    },
  };
}
const okLlm = fakeLlm(advice(), { letter, citedFactIds: ['shipment.0.tracking'] });

const downLlm: Llm = {
  async generateJson() {
    throw new LlmUnavailableError(['gemini:network']);
  },
};
const badLlm = fakeLlm(advice(), { letter, citedFactIds: ['nope'] });

async function setup(detail: DisputeDetail = inr) {
  const db = await makeTestDb();
  await seedStore(db);
  await processDispute({ db, paypal: fakeClient(detail).client, now: () => new Date() })({
    id: 1,
    type: 'processDispute',
    payload: { disputeId: detail.dispute_id },
    attempts: 1,
  });
  return db;
}
const job = (attempts: number, disputeId = inr.dispute_id) => ({
  id: 2,
  type: 'analyzeDispute',
  payload: { disputeId },
  attempts,
});
const row = async (db: Awaited<ReturnType<typeof makeTestDb>>) =>
  (await db.query<{ local_state: string; manual_reason: string | null }>('select local_state, manual_reason from disputes')).rows[0]!;

describe('analyzeDisputeJob', () => {
  it('writes the analysis and sets READY_FOR_REVIEW', async () => {
    const db = await setup();
    await analyzeDisputeJob({ db, llm: okLlm, storeName: STORE })(job(1));
    expect((await row(db)).local_state).toBe('READY_FOR_REVIEW');
    const a = (await db.query<Record<string, unknown>>('select * from analyses')).rows;
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ recommendation: 'FIGHT', letter_draft: letter, model_used: 'fake:m' });
  });

  it('logs fallback reason codes only, once, when a provider fell back', async () => {
    const db = await setup();
    const fallbackLlm: Llm = {
      async generateJson(p, schema) {
        const isAdvisor = p.system.includes('recommendation');
        const data = schema.parse(isAdvisor ? advice() : { letter, citedFactIds: ['shipment.0.tracking'] });
        return { data, model: 'groq:m', fallbackReasons: isAdvisor ? ['gemini:http_400'] : ['gemini:http_400', 'x:y'] };
      },
    };
    const warns: string[] = [];
    await analyzeDisputeJob({ db, llm: fallbackLlm, storeName: STORE, logger: { warn: (m: string) => warns.push(m) } })(job(1));
    expect(warns).toEqual(['ai fallback: gemini:http_400, x:y']);
    await db.close();
  });

  it('logs nothing when there was no fallback', async () => {
    const db = await setup();
    const warns: string[] = [];
    await analyzeDisputeJob({ db, llm: okLlm, storeName: STORE, logger: { warn: (m: string) => warns.push(m) } })(job(1));
    expect(warns).toEqual([]);
    await db.close();
  });

  it('rethrows LlmUnavailableError on attempt 1 and leaves state unchanged', async () => {
    const db = await setup();
    await expect(analyzeDisputeJob({ db, llm: downLlm, storeName: STORE })(job(1))).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(await row(db)).toEqual({ local_state: 'ANALYZING', manual_reason: null });
  });

  it('sets NEEDS_MANUAL on the final attempt and rethrows', async () => {
    const db = await setup();
    await expect(analyzeDisputeJob({ db, llm: downLlm, storeName: STORE })(job(3))).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(await row(db)).toEqual({ local_state: 'NEEDS_MANUAL', manual_reason: 'AI draft unavailable (gemini:network)' });
  });

  it('treats a rejected letter like an AI failure on the final attempt', async () => {
    const db = await setup();
    await expect(analyzeDisputeJob({ db, llm: badLlm, storeName: STORE })(job(3))).rejects.toThrow();
    expect((await row(db)).manual_reason).toBe('AI draft unavailable');
    expect((await db.query('select 1 from analyses')).rows).toHaveLength(0);
  });

  it('unexpected error: NEEDS_MANUAL processing failed on the final attempt, unchanged on attempt 1', async () => {
    const boom: Llm = {
      async generateJson() {
        throw new Error('kaboom');
      },
    };
    const db = await setup();
    await expect(analyzeDisputeJob({ db, llm: boom, storeName: STORE })(job(1))).rejects.toThrow('kaboom');
    expect(await row(db)).toEqual({ local_state: 'ANALYZING', manual_reason: null });
    await expect(analyzeDisputeJob({ db, llm: boom, storeName: STORE })(job(3))).rejects.toThrow('kaboom');
    expect(await row(db)).toEqual({ local_state: 'NEEDS_MANUAL', manual_reason: 'processing failed' });
  });

  it('rethrows the original error even if setting NEEDS_MANUAL fails', async () => {
    const db = await setup();
    const failing = {
      ...db,
      query: async (sql: string, params?: unknown[]) => {
        if (/update disputes/i.test(sql)) throw new Error('db down');
        return db.query(sql, params);
      },
    } as typeof db;
    await expect(analyzeDisputeJob({ db: failing, llm: downLlm, storeName: STORE })(job(3))).rejects.toBeInstanceOf(LlmUnavailableError);
  });

  it('does nothing when the dispute is no longer ANALYZING (e.g. RESOLVED)', async () => {
    const db = await setup();
    await db.query("update disputes set local_state = 'RESOLVED'");
    let called = 0;
    const spy: Llm = {
      async generateJson() {
        called++;
        throw new Error('should not be called');
      },
    };
    await analyzeDisputeJob({ db, llm: spy, storeName: STORE })(job(3));
    expect(called).toBe(0);
    expect((await row(db)).local_state).toBe('RESOLVED');
    expect((await db.query('select 1 from analyses')).rows).toHaveLength(0);
  });

  it('throws when the dispute row is missing', async () => {
    const db = await makeTestDb();
    await expect(analyzeDisputeJob({ db, llm: okLlm, storeName: STORE })(job(1, 'PP-R-NOPE-1'))).rejects.toThrow();
  });

  it('marks NEEDS_MANUAL (no matching order) and completes when there is no order', async () => {
    const db = await setup();
    await db.query('update disputes set order_id = null');
    await analyzeDisputeJob({ db, llm: okLlm, storeName: STORE })(job(1));
    expect(await row(db)).toEqual({ local_state: 'NEEDS_MANUAL', manual_reason: 'no matching order' });
  });

  it('stores advice fields, flags and joins differing models with +', async () => {
    const db = await setup();
    const llm = fakeLlm(advice({ reasons: ['r1'] }), { letter, citedFactIds: ['shipment.0.tracking'] }, ['adv:1', 'let:2']);
    await analyzeDisputeJob({ db, llm, storeName: STORE })(job(1));
    const a = (await db.query<Record<string, unknown>>('select * from analyses')).rows[0]!;
    expect(a).toMatchObject({
      recommendation: 'FIGHT',
      confidence: 80,
      evidence_strength: 'STRONG',
      reasons: ['r1'],
      missing_evidence: [],
      suggested_offer: null,
      flags: [],
      model_used: 'adv:1+let:2',
    });
  });

  it('downgrades FIGHT with missing evidence to OFFER and the letter states the amount', async () => {
    const db = await setup();
    await db.query('delete from shipments');
    const offerLetter =
      'Hello, we are sorry about the trouble with your order. We would like to offer you a partial refund of 24.50 to settle this dispute. Thank you.';
    const llm = fakeLlm(advice(), { letter: offerLetter, citedFactIds: ['order.item'] });
    await analyzeDisputeJob({ db, llm, storeName: STORE })(job(1));
    const a = (await db.query<Record<string, unknown>>('select * from analyses')).rows[0]!;
    expect(a.recommendation).toBe('OFFER');
    expect(a.suggested_offer).toBe('24.50');
    expect(a.letter_draft).toContain('24.50');
    expect((a.flags as string[]).length).toBeGreaterThan(0);
    expect((await row(db)).local_state).toBe('READY_FOR_REVIEW');
  });

  it('NEEDS_MANUAL on attempt 1 when PayPal allows no action, without rethrowing', async () => {
    const db = await setup();
    await db.query("update disputes set raw = jsonb_set(raw, '{links}', '[]'::jsonb)");
    await analyzeDisputeJob({ db, llm: okLlm, storeName: STORE })(job(1));
    expect(await row(db)).toEqual({
      local_state: 'NEEDS_MANUAL',
      manual_reason: 'No PayPal action is open for this dispute',
    });
    expect((await db.query('select 1 from analyses')).rows).toHaveLength(0);
  });

  it('buildHandlers maps both analyzeDispute and draftLetter to the same handler', async () => {
    const db = await setup();
    const h = buildHandlers({ db, paypal: fakeClient(inr).client, llm: okLlm, now: () => new Date(), storeName: STORE });
    expect(h.draftLetter).toBe(h.analyzeDispute);
    await h.draftLetter!({ ...job(1), type: 'draftLetter' });
    expect((await row(db)).local_state).toBe('READY_FOR_REVIEW');
  });
});
