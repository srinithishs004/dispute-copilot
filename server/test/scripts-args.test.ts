import { describe, expect, it } from 'vitest';
import { parseAmount } from '../scripts/_bootstrap.js';

describe('parseAmount', () => {
  it.each(['25.00', '25', '0.5', '100.99'])('accepts %s', (v) => {
    expect(parseAmount(v)).toBe(v);
  });
  it.each([undefined, '', '0', '0.00', '-5', '1.234', 'abc', '1e3', '.5'])('rejects %s', (v) => {
    expect(parseAmount(v)).toBeNull();
  });
});
