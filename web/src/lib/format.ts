import type { DisputeAction, LocalState } from './types';

const DAY_MS = 86_400_000;

/** "DUPLICATE_TRANSACTION" -> "Duplicate Transaction". */
export function titleCase(code: string): string {
  return code
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');
}

/** "SOME_NEW_CODE" -> "Some new code". */
export function sentenceCase(code: string): string {
  const words = code.toLowerCase().split(/[_\s]+/).filter(Boolean).join(' ');
  return words ? words[0]!.toUpperCase() + words.slice(1) : words;
}

/** Every PayPal dispute reason code, in plain sentence case (US spelling). */
const REASONS: Record<string, string> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: 'Item not received',
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: 'Not as described',
  UNAUTHORISED: 'Unauthorized payment',
  CREDIT_NOT_PROCESSED: 'Credit not processed',
  DUPLICATE_TRANSACTION: 'Duplicate transaction',
  INCORRECT_AMOUNT: 'Incorrect amount',
  PAYMENT_BY_OTHER_MEANS: 'Paid by other means',
  CANCELED_RECURRING_BILLING: 'Canceled recurring billing',
  PROBLEM_WITH_REMITTANCE: 'Problem with remittance',
  OTHER: 'Other',
};

export function reasonLabel(code: string | null): string {
  if (!code) return 'Unknown reason';
  return REASONS[code] ?? sentenceCase(code);
}

const STATES: Record<LocalState, string> = {
  NEW: 'New',
  ANALYZING: 'Analyzing',
  READY_FOR_REVIEW: 'Ready for review',
  NEEDS_MANUAL: 'Needs you',
  ACTION_PENDING: 'Sending',
  ACTION_SENT: 'Sent',
  RESOLVED: 'Resolved',
};

export function stateLabel(s: LocalState | string): string {
  return STATES[s as LocalState] ?? titleCase(s);
}

/** Badge tone for a local state. */
export function stateTone(s: LocalState | string): 'secondary' | 'warning' | 'info' | 'success' | 'plain' {
  switch (s) {
    case 'READY_FOR_REVIEW':
      return 'secondary';
    case 'NEEDS_MANUAL':
      return 'warning';
    case 'ANALYZING':
    case 'ACTION_PENDING':
    case 'NEW':
      return 'info';
    case 'ACTION_SENT':
      return 'success';
    default:
      return 'plain';
  }
}

const STATUSES: Record<string, string> = {
  OPEN: 'Open',
  WAITING_FOR_SELLER_RESPONSE: 'Waiting for your response',
  WAITING_FOR_BUYER_RESPONSE: 'Waiting for the buyer',
  UNDER_REVIEW: 'Under review by PayPal',
  RESOLVED: 'Resolved',
};

export function paypalStatusLabel(s: string | null): string {
  if (!s) return 'Unknown';
  return STATUSES[s] ?? titleCase(s);
}

const ACTIONS: Record<DisputeAction, string> = {
  FIGHT: 'Fight',
  OFFER: 'Offer a partial refund',
  ACCEPT: 'Accept',
};

export function actionLabel(a: DisputeAction | string | null): string {
  if (!a) return 'No recommendation';
  return ACTIONS[a as DisputeAction] ?? titleCase(a);
}

/** Short labels for the action picker, so three fit at 390px. */
export const ACTION_SHORT: Record<DisputeAction, string> = {
  FIGHT: 'Fight',
  OFFER: 'Partial refund',
  ACCEPT: 'Accept',
};

const OUTCOMES: Record<string, string> = {
  RESOLVED_SELLER_FAVOUR: 'Resolved in your favor',
  RESOLVED_BUYER_FAVOUR: 'Resolved in the buyer’s favor',
  RESOLVED_WITH_PAYOUT: 'Resolved with a PayPal payout',
  CANCELED_BY_BUYER: 'Canceled by the buyer',
  ACCEPTED: 'Claim accepted',
  DENIED: 'Claim denied',
};

export function outcomeLabel(code: string | null): string {
  if (!code) return 'Resolved';
  return OUTCOMES[code] ?? sentenceCase(code);
}

export function money(value: string | number | null | undefined, currency: string | null | undefined): string {
  if (value == null || value === '') return '';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  if (!currency) return n.toFixed(2);
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

/** "3 days left", "Due today", "Overdue by 2 days"; null when there is no deadline. */
export function deadlineText(dueIso: string | null, now: number = Date.now()): string | null {
  if (!dueIso) return null;
  const due = Date.parse(dueIso);
  if (Number.isNaN(due)) return null;
  const diff = due - now;
  if (diff < 0) {
    const days = Math.max(1, Math.floor(-diff / DAY_MS));
    return `Overdue by ${days} ${days === 1 ? 'day' : 'days'}`;
  }
  const days = Math.floor(diff / DAY_MS);
  if (days === 0) return 'Due today';
  return `${days} ${days === 1 ? 'day' : 'days'} left`;
}

/** Same rule as the dashboard (server/src/routes/dashboard.ts amountKept). */
export function amountKept(original: string | null, current: string | null, outcome: string | null): number {
  const cur = current == null ? null : Number(current);
  const orig = original == null ? (cur ?? 0) : Number(original);
  if (outcome !== null && (outcome.includes('SELLER_FAVOUR') || outcome === 'CANCELED_BY_BUYER')) return orig;
  return Math.round((orig - (cur ?? 0)) * 100) / 100;
}

export function firstLines(text: string, n: number): { lines: string[]; more: number } {
  const all = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return { lines: all.slice(0, n), more: Math.max(0, all.length - n) };
}

const DATE_TIME = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** "OCT 27 · 14:02" style stamp for the timeline (local time). */
export function stamp(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = DATE_TIME.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('month').toUpperCase()} ${get('day')} · ${get('hour')}:${get('minute')}`;
}

const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export function shortDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : DATE.format(d);
}

/** Sentence case for evidence requirement names ("tracking number" -> "Tracking number"). */
export function sentence(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}
