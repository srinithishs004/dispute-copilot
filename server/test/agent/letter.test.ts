import { describe, expect, it } from 'vitest';
import { draftLetter, LetterRejectedError } from '../../src/agent/letter.js';
import type { EvidencePack } from '../../src/agent/evidence.js';
import type { Llm } from '../../src/ai/llm.js';

const pack: EvidencePack = {
  disputeId: 'PP-R-ICQ-00000001',
  reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
  amount: '49.00',
  currency: 'USD',
  facts: [
    { id: 'order.id', label: 'Order ID', value: 'DEMO-HIST-02' },
    { id: 'shipment.0.tracking', label: 'Tracking number', value: '1Z999AA10123456784' },
    { id: 'shipment.0.delivered_at', label: 'Delivered at', value: '2026-09-20' },
  ],
  checklist: [],
  missing: [],
};
const good =
  'Dear PayPal dispute team, the order was delivered on 2026-09-20 with tracking number 1Z999AA10123456784, as recorded in our shipment facts. We respectfully ask that the dispute be resolved in our favour. Thank you.';

function fakeLlm(data: unknown, calls: { user: string }[] = []): Llm {
  return {
    async generateJson(prompt, schema) {
      calls.push({ user: prompt.user });
      return { data: schema.parse(data), model: 'fake:model' };
    },
  };
}

describe('draftLetter', () => {
  it('accepts a valid draft and lists facts in the prompt', async () => {
    const calls: { user: string }[] = [];
    const out = await draftLetter(fakeLlm({ letter: good, citedFactIds: ['shipment.0.tracking'] }, calls), pack);
    expect(out.model).toBe('fake:model');
    expect(out.draft.citedFactIds).toEqual(['shipment.0.tracking']);
    expect(calls[0]!.user).toContain('[shipment.0.tracking] Tracking number: 1Z999AA10123456784');
  });

  it('rejects an unknown cited fact id', async () => {
    await expect(draftLetter(fakeLlm({ letter: good, citedFactIds: ['nope'] }), pack)).rejects.toBeInstanceOf(
      LetterRejectedError,
    );
  });

  it('rejects zero citations', async () => {
    await expect(draftLetter(fakeLlm({ letter: good, citedFactIds: [] }), pack)).rejects.toBeInstanceOf(
      LetterRejectedError,
    );
  });

  it('rejects an invented tracking number', async () => {
    const letter = good.replace('1Z999AA10123456784', '999999999');
    await expect(draftLetter(fakeLlm({ letter, citedFactIds: ['order.id'] }), pack)).rejects.toBeInstanceOf(
      LetterRejectedError,
    );
  });

  it('rejects too short and too long letters', async () => {
    await expect(draftLetter(fakeLlm({ letter: 'short', citedFactIds: ['order.id'] }), pack)).rejects.toBeInstanceOf(
      LetterRejectedError,
    );
    await expect(
      draftLetter(fakeLlm({ letter: 'x'.repeat(1501), citedFactIds: ['order.id'] }), pack),
    ).rejects.toBeInstanceOf(LetterRejectedError);
  });

  it('accepts long digit runs from the dispute id or order id', async () => {
    const letter = `${good} Reference PP-R-ICQ-00000001 and order DEMO-1234567.`;
    const out = await draftLetter(fakeLlm({ letter, citedFactIds: ['order.id'] }), pack, 'FIGHT', ['DEMO-1234567']);
    expect(out.draft.letter).toContain('1234567');
  });
});

describe('draftLetter email redaction', () => {
  it('keeps email addresses out of the prompt', async () => {
    const withEmail: EvidencePack = {
      ...pack,
      facts: [...pack.facts, { id: 'dispute.buyer_message.0', label: 'Buyer message in dispute', value: 'Contact me at jane.doe+x@example.com please' }],
    };
    const calls: { user: string }[] = [];
    await draftLetter(fakeLlm({ letter: good, citedFactIds: ['order.id'] }, calls), withEmail);
    expect(calls[0]!.user).not.toContain('jane.doe');
    expect(calls[0]!.user).not.toContain('example.com');
    expect(calls[0]!.user).toContain('Contact me at [email] please');
  });
});
