import { describe, expect, it } from 'vitest';
import { formatPayPalError, parseAmount } from '../scripts/_bootstrap.js';
import { PayPalError } from '../src/paypal/client.js';

describe('parseAmount', () => {
  it.each(['25.00', '25', '0.5', '100.99'])('accepts %s', (v) => {
    expect(parseAmount(v)).toBe(v);
  });
  it.each([undefined, '', '0', '0.00', '-5', '1.234', 'abc', '1e3', '.5'])('rejects %s', (v) => {
    expect(parseAmount(v)).toBeNull();
  });
});

describe('formatPayPalError', () => {
  it('includes PayPal issue codes so 422s are diagnosable', () => {
    const err = new PayPalError(422, 'UNPROCESSABLE_ENTITY', 'x', 'dbg-1', {
      name: 'UNPROCESSABLE_ENTITY',
      details: [{ issue: 'ORDER_NOT_APPROVED', description: 'Payer has not yet approved the Order for payment.' }],
    });
    expect(formatPayPalError(err)).toBe(
      'PayPal error: status=422 name=UNPROCESSABLE_ENTITY debug_id=dbg-1\n  - ORDER_NOT_APPROVED: Payer has not yet approved the Order for payment.',
    );
  });
  it('works when the body has no details', () => {
    const err = new PayPalError(500, 'INTERNAL', 'x', null, '<html>');
    expect(formatPayPalError(err)).toBe('PayPal error: status=500 name=INTERNAL debug_id=n/a');
  });
});
