// 006:T007 (FR-705; R-506, R-507; K-5): payments' entry answers `packages/money`'s amounts of an
// offer, unchanged. The DEC-94 example: 40 sessions at 250 EGP a session, 10,000 EGP in 10 months.
import { piasters, programmeOfferAmounts, toPlainNumber } from '@ijazah/money';
import { describe, expect, it } from 'vitest';

import { programmeOfferAmountsOf } from './index.js';

describe('programmeOfferAmountsOf (006:T007, K-5)', () => {
  it('answers the count × the price for the length, the price, and the months (DEC-94)', () => {
    const amounts = programmeOfferAmountsOf(piasters(25_000), 40);
    expect(toPlainNumber(amounts.total_piasters)).toBe(1_000_000);
    expect(toPlainNumber(amounts.sessionPrice_piasters)).toBe(25_000);
    expect(amounts.monthCount).toBe(10);
  });

  it('answers exactly what packages/money answers, the remainder month included', () => {
    for (const count of [1, 3, 4, 5, 42, 200]) {
      expect(programmeOfferAmountsOf(piasters(30_001), count)).toEqual(
        programmeOfferAmounts(piasters(30_001), count),
      );
    }
  });
});
