// 003:T127 (SRS DEC-98; Q-4 (a)): a refund recorded after an enrollment's end release is the
// platform's. The administrator's «عليه» row carries the part of the teacher's share the platform
// bears, `platformShare_piasters`, optional and additive (R-API-9): absent where none. Written before
// the field, run red first.
import { describe, expect, it } from 'vitest';

import { payoutDeduction, payoutRelease } from './payouts.js';

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

// 006:T018 (FU-E1 (a), the owner's «موافق» of 2026-11-23): each release lists the paid orders it
// draws from with the amount from each, additive (R-API-9). Example: offer 10,000 EGP by months, fee
// 500: the half, 1,837.50, draws 350 from the assessment and 700 from each of months 1 and 2, then
// 87.50 from month 3.
describe('payoutRelease: the orders a release draws from (006:T018, FU-E1)', () => {
  const RELEASE = {
    part: 'ijazah_half',
    amount_piasters: 183_750,
    state: 'held',
    waitsForCase: false,
    enrollmentId: id(2),
    paymentId: id(4),
    student: { userId: id(3), displayName: 'آمال' },
  } as const;
  const ORDERS = [
    { paymentId: id(4), amount_piasters: 35_000 },
    { paymentId: id(5), amount_piasters: 70_000 },
    { paymentId: id(6), amount_piasters: 70_000 },
    { paymentId: id(7), amount_piasters: 8_750 },
  ];

  it('carries each order and its amount, in the order drawn', () => {
    expect(payoutRelease.parse({ ...RELEASE, orders: ORDERS })).toEqual({
      ...RELEASE,
      orders: ORDERS,
    });
  });

  it('requires the list, each amount a whole number of piasters', () => {
    expect(() => payoutRelease.parse(RELEASE)).toThrow();
    expect(() =>
      payoutRelease.parse({ ...RELEASE, orders: [{ paymentId: id(4), amount_piasters: 1.5 }] }),
    ).toThrow();
  });
});
