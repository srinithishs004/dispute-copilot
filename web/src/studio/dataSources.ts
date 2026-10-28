import type { AgDataSourcesDefinition, AgFieldDefinition } from 'ag-studio';
import { ACTION_SHORT, actionLabel, paypalStatusLabel, reasonLabel, sentence, stateLabel, titleCase } from '../lib/format';
import type { DashboardFeed, DisputeAction } from '../lib/types';

/**
 * Turns GET /api/dashboard/data into AG Studio sources. Codes become plain labels here, so charts,
 * the grid and (Task 9) the Dispute Analyst all read the same words the rest of the app uses.
 * Dates become Date objects because Studio's date formats hold Date values.
 */

const OUTCOME_SHORT: Record<string, string> = {
  RESOLVED_SELLER_FAVOUR: 'In your favor',
  RESOLVED_BUYER_FAVOUR: 'In buyer’s favor',
  RESOLVED_WITH_PAYOUT: 'PayPal payout',
  CANCELED_BY_BUYER: 'Canceled by buyer',
  ACCEPTED: 'Claim accepted',
  DENIED: 'Claim denied',
};

export function outcomeShort(code: string | null): string | null {
  if (!code) return null;
  return OUTCOME_SHORT[code] ?? titleCase(code);
}

function toDate(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

const cents = (n: number) => Math.round(n * 100) / 100;

export type StudioDisputeRow = {
  disputeId: string;
  reason: string;
  status: string;
  localState: string;
  resolved: boolean;
  originalAmount: number;
  amountKept: number | null;
  amountRefunded: number | null;
  currency: string | null;
  responseDueAt: Date | null;
  daysLeft: number | null;
  deadlineFlag: string | null;
  recommendation: string | null;
  confidence: number | null;
  evidenceStrength: string | null;
  outcome: string | null;
  createdAt: Date | null;
};

export function studioDisputeRows(feed: DashboardFeed): StudioDisputeRow[] {
  return feed.sources.disputes.map((d) => {
    const resolved = d.amountKept !== null;
    return {
      disputeId: d.disputeId,
      reason: reasonLabel(d.reason),
      status: paypalStatusLabel(d.status),
      localState: stateLabel(d.localState),
      resolved,
      originalAmount: d.originalAmount,
      amountKept: d.amountKept,
      amountRefunded: resolved ? cents(d.originalAmount - (d.amountKept ?? 0)) : null,
      currency: d.currency,
      responseDueAt: toDate(d.responseDueAt),
      daysLeft: d.daysLeft,
      deadlineFlag: d.deadlineFlag || null,
      recommendation: d.recommendation ? (ACTION_SHORT[d.recommendation as DisputeAction] ?? titleCase(d.recommendation)) : null,
      confidence: d.confidence,
      evidenceStrength: d.evidenceStrength ? titleCase(d.evidenceStrength) : null,
      outcome: outcomeShort(d.outcome),
      createdAt: toDate(d.createdAt),
    };
  });
}

/** The feed's currency (all PayPal sandbox disputes share one); USD when there are no rows. */
export function feedCurrency(feed: DashboardFeed): string {
  return feed.sources.disputes.find((d) => d.currency)?.currency ?? 'USD';
}

type Field = AgFieldDefinition;

// Empty cells stay empty (Studio's default blank text is "N/A" or "(Blanks)").
const text = (id: string, name: string, description: string): Field => ({ id, name, description, format: 'textFormat', blankValue: '' });
const int = (id: string, name: string, description: string): Field => ({ id, name, description, format: 'integerFormat', blankValue: '' });
const date = (id: string, name: string, description: string): Field => ({
  id,
  name,
  description,
  format: 'dateFormat',
  blankValue: '',
  formatOptions: { format: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) },
});
const dateTime = (id: string, name: string, description: string): Field => ({
  id,
  name,
  description,
  format: 'dateTimeFormat',
  blankValue: '',
  formatOptions: {
    format: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
  },
});

export function toStudioData(feed: DashboardFeed): AgDataSourcesDefinition {
  const currency = feedCurrency(feed);
  const money = (id: string, name: string, description: string): Field => ({
    id,
    name,
    description,
    format: 'currencyFormat',
    blankValue: '',
    formatOptions: { format: new Intl.NumberFormat('en-US', { style: 'currency', currency }) },
  });

  const disputeFields: Field[] = [
    text('disputeId', 'Dispute', 'PayPal dispute id. The Review page for a dispute is /disputes/<id>.'),
    text('reason', 'Reason', 'Why the buyer opened the dispute, in plain words.'),
    text('status', 'PayPal status', 'Status PayPal reports for the dispute.'),
    text('localState', 'State', 'Where the dispute is in this app: New, Analyzing, Ready for review, Needs you, Sending, Sent, Resolved.'),
    { id: 'resolved', name: 'Resolved', description: 'True once PayPal closed the dispute.', format: 'booleanFormat' },
    money('originalAmount', 'Disputed amount', 'Amount the buyer disputed, before any refund.'),
    money('amountKept', 'Amount kept', 'Resolved disputes only: what the seller kept after the outcome. Empty while open.'),
    money('amountRefunded', 'Amount refunded', 'Resolved disputes only: disputed amount minus amount kept. Empty while open.'),
    text('currency', 'Currency', 'ISO currency code.'),
    dateTime('responseDueAt', 'Response due', 'Deadline for the seller to respond to PayPal.'),
    int('daysLeft', 'Days left', 'Whole days until the response deadline. Negative when overdue, empty when resolved.'),
    text('deadlineFlag', 'Deadline flag', 'due_soon when under 3 days are left, overdue after the deadline, otherwise empty.'),
    text('recommendation', 'AI recommendation', 'What the AI suggested: Fight, Partial refund or Accept. Empty before analysis.'),
    int('confidence', 'AI confidence', 'Confidence of the latest AI analysis, 0 to 100.'),
    text('evidenceStrength', 'Evidence strength', 'How strong the seller evidence is: Strong, Moderate or Weak.'),
    text('outcome', 'Outcome', 'Resolved disputes only: who PayPal decided for.'),
    date('createdAt', 'Opened', 'When the buyer opened the dispute.'),
  ];

  const actionFields: Field[] = [
    text('disputeId', 'Dispute', 'PayPal dispute id.'),
    text('type', 'Action', 'What the seller approved: Fight, Offer a partial refund or Accept.'),
    text('state', 'Action state', 'Pending, Sent or Failed.'),
    dateTime('createdAt', 'Approved', 'When the seller approved the action.'),
    dateTime('sentAt', 'Sent to PayPal', 'When the action reached PayPal. Empty until sent.'),
  ];

  const gapFields: Field[] = [
    text('disputeId', 'Dispute', 'PayPal dispute id.'),
    text('requirement', 'Missing evidence', 'One evidence item the latest analysis found missing.'),
  ];

  return {
    description:
      'Seller PayPal disputes (sandbox) handled by Dispute Copilot. One row per dispute in Disputes, one row per approved action in Actions, one row per missing evidence item in Evidence gaps. Amounts are in ' +
      currency +
      '.',
    sources: [
      {
        id: 'disputes',
        name: 'Disputes',
        description: 'One row per PayPal dispute with the latest AI recommendation.',
        fields: disputeFields,
        data: studioDisputeRows(feed),
      },
      {
        id: 'actions',
        name: 'Actions',
        description: 'Actions the seller approved and sent to PayPal.',
        fields: actionFields,
        data: feed.sources.actions.map((a) => ({
          disputeId: a.disputeId,
          type: actionLabel(a.type),
          state: titleCase(a.state),
          createdAt: toDate(a.createdAt),
          sentAt: toDate(a.sentAt),
        })),
      },
      {
        id: 'evidence_gaps',
        name: 'Evidence gaps',
        description: 'Evidence the latest AI analysis found missing, one row per item.',
        fields: gapFields,
        data: feed.sources.evidence_gaps.map((g) => ({ disputeId: g.disputeId, requirement: sentence(g.requirement) })),
      },
    ],
    relationships: [
      {
        id: 'actions-dispute',
        source: { tableId: 'disputes', fieldId: 'disputeId' },
        target: { tableId: 'actions', fieldId: 'disputeId' },
        type: 'one-to-many',
      },
      {
        id: 'gaps-dispute',
        source: { tableId: 'disputes', fieldId: 'disputeId' },
        target: { tableId: 'evidence_gaps', fieldId: 'disputeId' },
        type: 'one-to-many',
      },
    ],
  };
}
