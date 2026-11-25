// T021 (FR-311, R-MONEY-1): the editor's typed numbers: a price in pounds read as whole piasters,
// a count of one to 52, the digits an Arabic keyboard types read as the Western ones.
import { describe, expect, it } from '@jest/globals';
import { piasters } from '@ijazah/money';

import { offerCountOf, piastersOfPounds, poundsOf, sessionCountOf } from './price';

describe('piastersOfPounds', () => {
  it('reads pounds with up to two decimals as whole piasters', () => {
    expect(piastersOfPounds('1200')).toBe(120_000);
    expect(piastersOfPounds('1200.5')).toBe(120_050);
    expect(piastersOfPounds(' 0.05 ')).toBe(5);
    expect(piastersOfPounds('١٢٠٠٫٥٠')).toBe(120_050);
  });

  it('refuses zero, a third decimal, a sign, grouping and anything not a number', () => {
    for (const text of ['', '0', '0.00', '1.234', '-5', '+5', '1,200', '12a', '.5', '5.']) {
      expect(piastersOfPounds(text)).toBeNull();
    }
  });
});

describe('poundsOf', () => {
  it('writes piasters back as the pounds the editor shows', () => {
    expect(poundsOf(piasters(120_000))).toBe('1200');
    expect(poundsOf(piasters(120_050))).toBe('1200.50');
    expect(poundsOf(piasters(5))).toBe('0.05');
  });
});

describe('sessionCountOf', () => {
  it('reads a whole count of one to 52', () => {
    expect(sessionCountOf('1')).toBe(1);
    expect(sessionCountOf('٥٢')).toBe(52);
    for (const text of ['', '0', '53', '8.5', '-1', 'ثمانية']) {
      expect(sessionCountOf(text)).toBeNull();
    }
  });
});

// 006:T020 (FR-705, R-506): the offer's count, one to 200, as the editor reads its own count.
describe('offerCountOf', () => {
  it('reads a whole count of one to 200, Arabic digits too', () => {
    expect(offerCountOf('1')).toBe(1);
    expect(offerCountOf('60')).toBe(60);
    expect(offerCountOf('٢٠٠')).toBe(200);
    for (const text of ['', '0', '201', '8.5', '-1', 'ستون']) {
      expect(offerCountOf(text)).toBeNull();
    }
  });
});
