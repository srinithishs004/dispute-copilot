/**
 * Deterministic benchmark over the 12 seeded sample orders: no AI calls, no network.
 * Measures what the code does on its own:
 *   1. Evidence completeness: required evidence items present in the evidence pack.
 *   2. Guardrail effect: how often an over-confident "FIGHT, STRONG" is stopped because required
 *      evidence is missing (applyGuardrails).
 *   3. Manual sources avoided: a MODEL (not a measurement) of how many separate places a seller
 *      would have to check by hand for the same requirements.
 * The dispute reason per order is an assumption (see SCENARIOS). Run: npx tsx scripts/benchmark.ts
 */
import { PGlite } from '@electric-sql/pglite';
import { wrapPglite } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { seedStore, SEED_ORDERS } from '../src/store/seed.js';
import { findOrderBundle } from '../src/store/repo.js';
import { buildEvidencePack } from '../src/agent/evidence.js';
import { applyGuardrails } from '../src/agent/advisor.js';
import type { DisputeDetail } from '../src/paypal/disputes.js';

const NOT_RECEIVED = 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED';
const NOT_AS_DESCRIBED = 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED';

// Assumed buyer claim for each seeded order.
const SCENARIOS: Record<string, string> = {
  'DEMO-HIST-01': NOT_RECEIVED,
  'DEMO-HIST-02': NOT_RECEIVED,
  'DEMO-HIST-03': NOT_RECEIVED,
  'DEMO-HIST-04': NOT_RECEIVED,
  'DEMO-HIST-05': NOT_RECEIVED,
  'DEMO-HIST-06': NOT_RECEIVED,
  'DEMO-HIST-07': NOT_RECEIVED,
  'DEMO-HIST-08': NOT_AS_DESCRIBED,
  'DEMO-HIST-09': NOT_AS_DESCRIBED,
  'DEMO-HIST-10': NOT_AS_DESCRIBED,
  'DEMO-HIST-11': NOT_RECEIVED,
  'DEMO-HIST-12': NOT_RECEIVED,
};

// Where a seller would look by hand for each requirement.
const SOURCE: Record<string, string> = {
  'tracking number': 'carrier site',
  'delivery confirmation': 'carrier site',
  'signature on delivery': 'carrier site',
  'item description': 'store admin',
  'buyer communication': 'email inbox',
  'refund policy': 'store policy page',
  'order record': 'store admin',
};

const db = wrapPglite(new PGlite());
await migrate(db);
await seedStore(db);

type Row = {
  id: string;
  item: string;
  amount: string;
  reason: string;
  required: number;
  present: number;
  missing: string[];
  facts: number;
  fightBlocked: boolean;
  sources: number;
};
const rows: Row[] = [];

for (const o of SEED_ORDERS) {
  const bundle = await findOrderBundle(db, o.id);
  if (!bundle) throw new Error(`seed order ${o.id} missing`);
  const reason = SCENARIOS[o.id]!;
  const detail = {
    dispute_id: `BENCH-${o.id}`,
    reason,
    dispute_amount: { value: o.amount, currency_code: 'USD' },
  } as unknown as DisputeDetail;
  const pack = buildEvidencePack(detail, bundle);
  const advice = applyGuardrails(
    {
      recommendation: 'FIGHT',
      confidence: 90,
      evidence_strength: 'STRONG',
      reasons: ['benchmark: optimistic stance'],
      missing_evidence: [],
      suggested_offer_amount: null,
    },
    { pack, allowed: { fight: true, offer: true, accept: true } as never },
  );
  rows.push({
    id: o.id,
    item: o.item,
    amount: o.amount,
    reason: reason === NOT_RECEIVED ? 'Not received' : 'Not as described',
    required: pack.checklist.length,
    present: pack.checklist.filter((c) => c.present).length,
    missing: pack.missing,
    facts: pack.facts.length,
    fightBlocked: advice.recommendation !== 'FIGHT',
    sources: new Set(pack.checklist.map((c) => SOURCE[c.requirement] ?? 'other')).size,
  });
}

const sum = (f: (r: Row) => number) => rows.reduce((a, r) => a + f(r), 0);
const complete = rows.filter((r) => r.missing.length === 0).length;
const blocked = rows.filter((r) => r.fightBlocked).length;
const pct = (n: number, d: number) => `${Math.round((n / d) * 100)}%`;

const lines: string[] = [];
lines.push('| Order | Item | Claim | Evidence present | Missing | Facts gathered | Naive FIGHT blocked |');
lines.push('|---|---|---|---|---|---|---|');
for (const r of rows)
  lines.push(
    `| ${r.id} | ${r.item} | ${r.reason} | ${r.present}/${r.required} | ${r.missing.join(', ') || 'none'} | ${r.facts} | ${r.fightBlocked ? 'yes' : 'no'} |`,
  );
lines.push('');
lines.push(`Cases: ${rows.length}`);
lines.push(`Evidence items found automatically: ${sum((r) => r.present)}/${sum((r) => r.required)} (${pct(sum((r) => r.present), sum((r) => r.required))})`);
lines.push(`Cases with a complete evidence pack: ${complete}/${rows.length}`);
lines.push(`Facts assembled across all cases: ${sum((r) => r.facts)} (average ${(sum((r) => r.facts) / rows.length).toFixed(1)} per case)`);
lines.push(`Weak fights stopped by the guardrail: ${blocked}/${rows.length} cases would have gone out as FIGHT without it`);
lines.push(`Manual lookups avoided (model): about ${(sum((r) => r.sources) / rows.length).toFixed(1)} separate places per case`);
console.log(lines.join('\n'));
await db.close();
