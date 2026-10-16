import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { draftLetterJob } from '../../src/jobs/draftLetter.js';
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
const okLlm: Llm = {
  async generateJson(_p, schema) {
    return { data: schema.parse({ letter, citedFactIds: ['shipment.0.tracking'] }), model: 'fake:m' };
  },
};
const downLlm: Llm = {
  async generateJson() {
    throw new LlmUnavailableError(['gemini:network']);
  },
};
const badLlm: Llm = {
  async generateJson(_p, schema) {
    return { data: schema.parse({ letter, citedFactIds: ['nope'] }), model: 'fake:m' };
  },
};

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
  type: 'draftLetter',
  payload: { disputeId },
  attempts,
});
const row = async (db: Awaited<ReturnType<typeof makeTestDb>>) =>
  (await db.query<{ local_state: string; manual_reason: string | null }>('select local_state, manual_reason from disputes')).rows[0]!;

describe('draftLetterJob', () => {
  it('writes the analysis and sets READY_FOR_REVIEW', async () => {
    const db = await setup();
    await draftLetterJob({ db, llm: okLlm })(job(1));
    expect((await row(db)).local_state).toBe('READY_FOR_REVIEW');
    const a = (await db.query<Record<string, unknown>>('select * from analyses')).rows;
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ recommendation: 'FIGHT', letter_draft: letter, model_used: 'fake:m' });
  });

  it('rethrows LlmUnavailableError on attempt 1 and leaves state unchanged', async () => {
    const db = await setup();
    await expect(draftLetterJob({ db, llm: downLlm })(job(1))).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(await row(db)).toEqual({ local_state: 'ANALYZING', manual_reason: null });
  });

  it('sets NEEDS_MANUAL on the final attempt and rethrows', async () => {
    const db = await setup();
    await expect(draftLetterJob({ db, llm: downLlm })(job(3))).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(await row(db)).toEqual({ local_state: 'NEEDS_MANUAL', manual_reason: 'AI draft unavailable' });
  });

  it('treats a rejected letter like an AI failure on the final attempt', async () => {
    const db = await setup();
    await expect(draftLetterJob({ db, llm: badLlm })(job(3))).rejects.toThrow();
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
    await expect(draftLetterJob({ db, llm: boom })(job(1))).rejects.toThrow('kaboom');
    expect(await row(db)).toEqual({ local_state: 'ANALYZING', manual_reason: null });
    await expect(draftLetterJob({ db, llm: boom })(job(3))).rejects.toThrow('kaboom');
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
    await expect(draftLetterJob({ db: failing, llm: downLlm })(job(3))).rejects.toBeInstanceOf(LlmUnavailableError);
  });

  it('throws when the dispute row is missing', async () => {
    const db = await makeTestDb();
    await expect(draftLetterJob({ db, llm: okLlm })(job(1, 'PP-R-NOPE-1'))).rejects.toThrow();
  });

  it('marks NEEDS_MANUAL (no matching order) and completes when there is no order', async () => {
    const db = await setup();
    await db.query('update disputes set order_id = null');
    await draftLetterJob({ db, llm: okLlm })(job(1));
    expect(await row(db)).toEqual({ local_state: 'NEEDS_MANUAL', manual_reason: 'no matching order' });
  });
});
