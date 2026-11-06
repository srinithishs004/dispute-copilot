import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyGuardrails, type RawAdvice } from '../../src/agent/advisor.js';
import { buildEvidencePack, type EvidencePack } from '../../src/agent/evidence.js';
import { syncOrderTracking } from '../../src/carrier/sandboxCarrier.js';
import { findOrderBundle } from '../../src/store/repo.js';
import type { DisputeDetail } from '../../src/paypal/disputes.js';
import { makeTestDb } from '../helpers.js';

const inr = JSON.parse(readFileSync(new URL('../fixtures/dispute-inr-sandbox.json', import.meta.url), 'utf8')) as DisputeDetail;
const T0 = new Date('2026-11-06T10:00:00Z');

async function packFor(scenario: 'DELIVERED' | 'LOST'): Promise<EvidencePack> {
  const db = await makeTestDb();
  await db.query(`insert into orders (id, item, amount, currency, status) values ('ORD-T1', 'Desk Lamp', '49.00', 'USD', 'PAID')`);
  await db.query(
    `insert into shipments (order_id, carrier, tracking_number, status, shipped_at, simulated, sim_scenario)
     values ('ORD-T1', 'USPS', '9400TRACK0001', 'pre_transit', $1, true, $2)`,
    [T0.toISOString(), scenario],
  );
  await syncOrderTracking(db, 'ORD-T1', new Date(T0.getTime() + 300_000));
  return buildEvidencePack(inr, (await findOrderBundle(db, 'ORD-T1'))!);
}

const raw = (o: Partial<RawAdvice> = {}): RawAdvice => ({
  recommendation: 'FIGHT',
  confidence: 90,
  evidence_strength: 'STRONG',
  reasons: ['x'],
  missing_evidence: [],
  suggested_offer_amount: null,
  ...o,
});
const allowed = { fight: true, offer: true, accept: true, message: true, escalate: false, adjudicate: false };

describe('evidence from the sandbox carrier', () => {
  it('delivered parcel: complete pack with carrier scans, signer and source', async () => {
    const pack = await packFor('DELIVERED');
    expect(pack.missing).toEqual([]);
    expect(pack.carrierException).toBeUndefined();
    const scans = pack.facts.filter((f) => f.id.startsWith('tracking.'));
    expect(scans).toHaveLength(5);
    expect(scans.at(-1)!.value).toMatch(/Delivered/);
    expect(pack.facts.find((f) => f.id === 'shipment.0.signed_by')!.value).toMatch(/Recipient/);
    expect(pack.facts.find((f) => f.id === 'shipment.0.source')!.value).toMatch(/simulated/);
    const ids = pack.facts.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('lost parcel: no delivery confirmation and a carrier exception is flagged', async () => {
    const pack = await packFor('LOST');
    expect(pack.missing).toEqual(expect.arrayContaining(['delivery confirmation', 'signature on delivery']));
    expect(pack.carrierException).toMatch(/delivery exception/i);
    const scans = pack.facts.filter((f) => f.id.startsWith('tracking.'));
    expect(scans.at(-1)!.value).toMatch(/cannot locate/i);
  });
});

describe('guardrail: carrier says the parcel is lost', () => {
  const lost = async () => ({ pack: await packFor('LOST'), allowed });

  it('turns a FIGHT into ACCEPT and says why', async () => {
    const a = applyGuardrails(raw(), await lost());
    expect(a.recommendation).toBe('ACCEPT');
    expect(a.evidenceStrength).toBe('WEAK');
    expect(a.flags.join(' ')).toMatch(/parcel lost/);
    expect(a.suggestedOffer).toBeNull();
  });

  it('turns an OFFER into ACCEPT too', async () => {
    const a = applyGuardrails(raw({ recommendation: 'OFFER', suggested_offer_amount: 20 }), await lost());
    expect(a.recommendation).toBe('ACCEPT');
  });

  it('keeps the AI answer when accepting is not allowed', async () => {
    const { pack } = await lost();
    const a = applyGuardrails(raw({ recommendation: 'OFFER', suggested_offer_amount: 20 }), { pack, allowed: { ...allowed, accept: false } });
    expect(a.recommendation).toBe('OFFER');
  });

  it('does not touch a delivered parcel', async () => {
    const a = applyGuardrails(raw(), { pack: await packFor('DELIVERED'), allowed });
    expect(a.recommendation).toBe('FIGHT');
    expect(a.flags).toEqual([]);
  });
});
