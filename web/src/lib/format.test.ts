import { describe, expect, it } from 'vitest';
import {
  actionLabel,
  amountKept,
  deadlineText,
  firstLines,
  money,
  outcomeLabel,
  paypalStatusLabel,
  reasonLabel,
  stateLabel,
} from './format';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-28T12:00:00Z');

describe('format', () => {
  it('maps PayPal reason codes to plain words', () => {
    expect(reasonLabel('MERCHANDISE_OR_SERVICE_NOT_RECEIVED')).toBe('Item not received');
    expect(reasonLabel('MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED')).toBe('Not as described');
    expect(reasonLabel('UNAUTHORISED')).toBe('Unauthorized payment');
    expect(reasonLabel('DUPLICATE_TRANSACTION')).toBe('Duplicate transaction');
    expect(reasonLabel('CREDIT_NOT_PROCESSED')).toBe('Credit not processed');
    expect(reasonLabel('INCORRECT_AMOUNT')).toBe('Incorrect amount');
    expect(reasonLabel('PAYMENT_BY_OTHER_MEANS')).toBe('Paid by other means');
    expect(reasonLabel('CANCELED_RECURRING_BILLING')).toBe('Canceled recurring billing');
    expect(reasonLabel('PROBLEM_WITH_REMITTANCE')).toBe('Problem with remittance');
    expect(reasonLabel('OTHER')).toBe('Other');
    expect(reasonLabel('SOME_NEW_REASON')).toBe('Some new reason');
    expect(reasonLabel(null)).toBe('Unknown reason');
  });

  it('labels local states plainly', () => {
    expect(stateLabel('ANALYZING')).toBe('Analyzing');
    expect(stateLabel('READY_FOR_REVIEW')).toBe('Ready for review');
    expect(stateLabel('NEEDS_MANUAL')).toBe('Needs you');
    expect(stateLabel('ACTION_PENDING')).toBe('Sending');
    expect(stateLabel('ACTION_SENT')).toBe('Sent');
    expect(stateLabel('RESOLVED')).toBe('Resolved');
    expect(stateLabel('NEW')).toBe('New');
  });

  it('labels PayPal statuses, actions and outcomes', () => {
    expect(paypalStatusLabel('WAITING_FOR_SELLER_RESPONSE')).toBe('Waiting for your response');
    expect(paypalStatusLabel('SOMETHING_NEW')).toBe('Something New');
    expect(actionLabel('OFFER')).toBe('Offer a partial refund');
    expect(actionLabel('FIGHT')).toBe('Fight');
    expect(actionLabel('ACCEPT')).toBe('Accept');
    expect(outcomeLabel('RESOLVED_SELLER_FAVOUR')).toBe('Resolved in your favor');
    expect(outcomeLabel('RESOLVED_BUYER_FAVOUR')).toBe('Resolved in the buyer’s favor');
    expect(outcomeLabel('CANCELED_BY_BUYER')).toBe('Canceled by the buyer');
    expect(outcomeLabel(null)).toBe('Resolved');
  });

  it('formats money with the currency', () => {
    expect(money('12.5', 'USD')).toBe('$12.50');
    expect(money('25.00', null)).toBe('25.00');
    expect(money(null, 'USD')).toBe('');
  });

  it('counts down to the deadline', () => {
    expect(deadlineText(new Date(NOW + 3 * DAY + 3_600_000).toISOString(), NOW)).toBe('3 days left');
    expect(deadlineText(new Date(NOW + 1 * DAY + 60_000).toISOString(), NOW)).toBe('1 day left');
    expect(deadlineText(new Date(NOW + 5 * 3_600_000).toISOString(), NOW)).toBe('Due today');
    expect(deadlineText(new Date(NOW - 2 * DAY - 60_000).toISOString(), NOW)).toBe('Overdue by 2 days');
    expect(deadlineText(new Date(NOW - 60_000).toISOString(), NOW)).toBe('Overdue by 1 day');
    expect(deadlineText(null, NOW)).toBeNull();
  });

  it('works out the amount kept like the dashboard does', () => {
    expect(amountKept('25.00', '25.00', 'RESOLVED_SELLER_FAVOUR')).toBe(25);
    expect(amountKept('25.00', '12.50', 'RESOLVED_BUYER_FAVOUR')).toBe(12.5);
    expect(amountKept('25.00', '25.00', 'CANCELED_BY_BUYER')).toBe(25);
    expect(amountKept(null, '25.00', 'RESOLVED_BUYER_FAVOUR')).toBe(0);
  });

  it('takes the first two non-empty lines of a letter', () => {
    expect(firstLines('Hello,\n\nLine two\nLine three', 2)).toEqual({ lines: ['Hello,', 'Line two'], more: 1 });
    expect(firstLines('Only one', 2)).toEqual({ lines: ['Only one'], more: 0 });
  });
});
