import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildEvidencePack, formatFactDate } from '../../src/agent/evidence.js';
import { findOrderBundle } from '../../src/store/repo.js';
import { seedStore } from '../../src/store/seed.js';
import type { DisputeDetail } from '../../src/paypal/disputes.js';
import { makeTestDb } from '../helpers.js';

const inr = JSON.parse(
  readFileSync(new URL('../fixtures/dispute-inr-sandbox.json', import.meta.url), 'utf8'),
) as DisputeDetail;

describe('formatFactDate', () => {
  it('formats ISO strings and Dates as UTC short dates, passing junk through', () => {
    expect(formatFactDate('2026-10-16T23:30:00.000Z')).toBe('Oct 16, 2026');
    expect(formatFactDate(new Date('2026-10-16T00:00:00Z'))).toBe('Oct 16, 2026');
    expect(formatFactDate('not a date')).toBe('not a date');
  });
});

describe('buildEvidencePack', () => {
  it('renders order and shipment dates readably', async () => {
    const db = await makeTestDb();
    await seedStore(db);
    const pack = buildEvidencePack(inr, (await findOrderBundle(db, 'DEMO-HIST-02'))!);
    const re = /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/;
    for (const id of ['order.created_at', 'shipment.0.shipped_at', 'shipment.0.delivered_at']) {
      expect(pack.facts.find((f) => f.id === id)!.value).toMatch(re);
    }
  });

  it('DEMO-HIST-02 INR: everything present, nothing missing, unique fact ids', async () => {
    const db = await makeTestDb();
    await seedStore(db);
    const pack = buildEvidencePack(inr, (await findOrderBundle(db, 'DEMO-HIST-02'))!);
    expect(pack.checklist).toEqual([
      { requirement: 'tracking number', present: true },
      { requirement: 'delivery confirmation', present: true },
      { requirement: 'signature on delivery', present: true },
    ]);
    expect(pack.missing).toEqual([]);
    expect(pack).toMatchObject({ disputeId: 'PP-R-ICQ-00000001', amount: '49.00', currency: 'USD' });
    const ids = pack.facts.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining(['order.id', 'shipment.0.tracking', 'shipment.0.delivered_at', 'policy.text']),
    );
    expect(ids).toContain('dispute.buyer_message.0');
    expect(ids).toContain('dispute.requested_evidence.0');
  });

  it('DEMO-HIST-07 (no shipment) is missing tracking and delivery', async () => {
    const db = await makeTestDb();
    await seedStore(db);
    const pack = buildEvidencePack(inr, (await findOrderBundle(db, 'DEMO-HIST-07'))!);
    expect(pack.missing).toEqual(['tracking number', 'delivery confirmation', 'signature on delivery']);
  });

  it('uses the not-as-described and default checklists', async () => {
    const db = await makeTestDb();
    await seedStore(db);
    const b = (await findOrderBundle(db, 'DEMO-HIST-02'))!;
    const nad = buildEvidencePack({ ...inr, reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED' }, b);
    expect(nad.checklist.map((c) => c.requirement)).toEqual([
      'item description',
      'buyer communication',
      'refund policy',
    ]);
    expect(nad.missing).toEqual([]); // buyer message comes from the dispute itself
    const other = buildEvidencePack({ ...inr, reason: 'UNAUTHORISED', messages: [] }, b);
    expect(other.checklist).toEqual([
      { requirement: 'order record', present: true },
      { requirement: 'buyer communication', present: false },
    ]);
    expect(other.missing).toEqual(['buyer communication']);
  });
});
