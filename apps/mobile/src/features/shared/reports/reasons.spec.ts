// T021 of specs/005-certification (B47's Q-R8 (a)): the text a report or a flag carries, the
// category the person chose composed with their details, within the contract's bound
// (`PARTICIPANT_REASON_MAX_LENGTH`, 1 to 500 characters once trimmed).
import { PARTICIPANT_REASON_MAX_LENGTH } from '@ijazah/contracts';
import { describe, expect, it } from '@jest/globals';

import { reportTextOf } from './index';

describe('reportTextOf (005:T021, Q-R8 (a))', () => {
  it('is the category alone when no details are written', () => {
    expect(reportTextOf('سلوك غير لائق', '')).toBe('سلوك غير لائق');
    expect(reportTextOf('سلوك غير لائق', '   ')).toBe('سلوك غير لائق');
  });

  it('is the category, then the details trimmed on the next line', () => {
    expect(reportTextOf('Other', '  late every time  ')).toBe('Other\nlate every time');
  });

  it('holds the whole text within the contract’s bound, and is nothing past it', () => {
    const category = 'Other';
    const room = PARTICIPANT_REASON_MAX_LENGTH - category.length - 1;
    expect(reportTextOf(category, 'x'.repeat(room))).toHaveLength(PARTICIPANT_REASON_MAX_LENGTH);
    expect(reportTextOf(category, 'x'.repeat(room + 1))).toBeUndefined();
  });
});
