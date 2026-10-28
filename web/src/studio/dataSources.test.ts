import { describe, expect, it } from 'vitest';
import type { AgFieldDefinition, AgSimpleDataSourceDefinition } from 'ag-studio';
import { requirementShort, toStudioData } from './dataSources';
import { feed, OCT27, openDispute } from '../test/dashboardFixtures';

function source(id: string) {
  const data = toStudioData(
    feed([OCT27, openDispute({ disputeId: 'PP-D-OPEN' })], {
      actions: [{ disputeId: OCT27.disputeId, type: 'OFFER', state: 'SENT', createdAt: '2026-10-27T14:05:00.000Z', sentAt: '2026-10-27T14:05:02.000Z' }],
      evidence_gaps: [{ disputeId: OCT27.disputeId, requirement: 'delivery confirmation' }],
    }),
  );
  return data.sources.find((s) => (s as { id: string }).id === id) as AgSimpleDataSourceDefinition;
}

const fieldOf = (s: AgSimpleDataSourceDefinition, id: string) => s.fields!.find((f: AgFieldDefinition) => f.id === id)!;

describe('toStudioData', () => {
  it('has the three sources', () => {
    const data = toStudioData(feed([OCT27]));
    expect(data.sources.map((s) => (s as { id: string }).id)).toEqual(['disputes', 'actions', 'evidence_gaps']);
    expect(data.description).toMatch(/USD/);
  });

  it('formats amounts as currency and dates as dates', () => {
    const d = source('disputes');
    for (const id of ['originalAmount', 'amountKept', 'amountRefunded']) expect(fieldOf(d, id).format).toBe('currencyFormat');
    expect(fieldOf(d, 'responseDueAt').format).toBe('dateTimeFormat');
    expect(fieldOf(d, 'createdAt').format).toBe('dateFormat');
    expect(fieldOf(d, 'daysLeft').format).toBe('integerFormat');
    expect(fieldOf(d, 'confidence').format).toBe('integerFormat');
    expect(fieldOf(d, 'resolved').format).toBe('booleanFormat');
    expect(fieldOf(source('actions'), 'sentAt').format).toBe('dateTimeFormat');
    expect(fieldOf(source('evidence_gaps'), 'requirement').format).toBe('textFormat');
    // Every row key has a declared field.
    const ids = d.fields!.map((f) => f.id).sort();
    expect(Object.keys(d.data[0]!).sort()).toEqual(ids);
  });

  it('turns the Oct 27 row into labels, dates and real sums', () => {
    const row = source('disputes').data[0]!;
    expect(row).toMatchObject({
      disputeId: 'PP-R-NZM-10194801',
      reason: 'Item not received',
      status: 'Resolved',
      localState: 'Resolved',
      resolved: true,
      originalAmount: 25,
      amountKept: 12.5,
      amountRefunded: 12.5,
      recommendation: 'Partial refund',
      confidence: 80,
      evidenceStrength: 'Weak',
      outcome: 'In buyer’s favor',
    });
    expect(row.createdAt).toBeInstanceOf(Date);
    expect((row.createdAt as Date).toISOString()).toBe('2026-10-27T13:58:00.000Z');
  });

  it('leaves money fields empty while a dispute is open', () => {
    const row = source('disputes').data[1]!;
    expect(row).toMatchObject({ resolved: false, amountKept: null, amountRefunded: null, outcome: null, daysLeft: 5 });
  });

  it('labels actions and evidence gaps', () => {
    expect(source('actions').data[0]).toMatchObject({ type: 'Offer a partial refund', state: 'Sent' });
    expect(source('actions').data[0]!.sentAt).toBeInstanceOf(Date);
    expect(source('evidence_gaps').data[0]).toEqual({
      disputeId: OCT27.disputeId,
      requirement: 'Delivery confirmation',
      requirementShort: 'Delivery proof',
    });
  });

  it('writes the deadline in the Review page words and treats -0 as 0', () => {
    const now = Date.parse('2026-10-28T12:00:00.000Z');
    const rows = toStudioData(
      feed([
        OCT27,
        openDispute({ disputeId: 'A', responseDueAt: '2026-10-28T08:00:00.000Z', daysLeft: -0, deadlineFlag: 'overdue' }),
        openDispute({ disputeId: 'B', responseDueAt: '2026-10-28T20:00:00.000Z', daysLeft: 1, deadlineFlag: 'due_soon' }),
        openDispute({ disputeId: 'C', responseDueAt: '2026-10-31T13:00:00.000Z', daysLeft: 4 }),
      ]),
      now,
    ).sources[0] as AgSimpleDataSourceDefinition;
    expect(rows.data.map((r) => r.deadline)).toEqual(['', 'Overdue by 1 day', 'Due today', '3 days left']);
    expect(Object.is(rows.data[1]!.daysLeft, -0)).toBe(false);
  });

  it('gives evidence a short axis name', () => {
    expect(requirementShort('signature on delivery')).toBe('Signature');
    expect(requirementShort('proof of a separate charge')).toBe('Proof of a…');
    expect(requirementShort('order record')).toBe('Order record');
  });

  it('links actions and gaps to disputes', () => {
    const rel = toStudioData(feed([])).relationships!;
    expect(rel.map((r) => [r.source, r.target])).toEqual([
      [{ tableId: 'disputes', fieldId: 'disputeId' }, { tableId: 'actions', fieldId: 'disputeId' }],
      [{ tableId: 'disputes', fieldId: 'disputeId' }, { tableId: 'evidence_gaps', fieldId: 'disputeId' }],
    ]);
  });
});
