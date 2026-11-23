// 003:T127 (SRS DEC-98; Q-4 (a)): a refund recorded after an enrollment's end release is the
// platform's. The administrator's «عليه» row carries the part of the teacher's share the platform
// bears, `platformShare_piasters`, optional and additive (R-API-9): absent where none. Written before
// the field, run red first.
import { describe, expect, it } from 'vitest';

import { payoutDeduction } from './payouts.js';

const id = (n: number) => `0199d0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;

// «Due 7,000», then 1,000 EGP refunded: the teacher's 700 EGP share, all of it the platform's.
const ROW = {
  paymentId: id(1),
  enrollmentId: id(2),
  student: { userId: id(3), displayName: 'آمال' },
  refunded_piasters: 100_000,
  share_piasters: 70_000,
};

describe('payoutDeduction: the platform’s part of a refund (003:T127)', () => {
  it('carries the platform’s part when given, and stays valid without it', () => {
    expect(payoutDeduction.parse({ ...ROW, platformShare_piasters: 70_000 })).toEqual({
      ...ROW,
      platformShare_piasters: 70_000,
    });
    expect(payoutDeduction.parse(ROW)).toEqual(ROW);
  });
});
