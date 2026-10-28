import { describe, expect, it } from 'vitest';
import { titleCase } from '../../lib/format';
import { ANALYST_INSTRUCTIONS } from './analyst';

describe('analyst instructions', () => {
  it('names evidence strength labels exactly as the data shows them', () => {
    for (const code of ['STRONG', 'MEDIUM', 'WEAK']) {
      expect(ANALYST_INSTRUCTIONS).toContain(titleCase(code));
    }
    expect(ANALYST_INSTRUCTIONS).not.toContain('Moderate');
  });
});
