// 006:T018 (FU-E1 (a), the owner's «موافق» of 2026-11-23; Q-f5 (a), the owner, 2026-11-24): each
// release lists the paid orders it draws from, with the amount from each. A programme's releases
// draw its orders' shares oldest first, each order less what earlier releases took from it; a
// duplicate month's share is the `duplicate_payment` case's and drawn by none (Q-5 (a)); a package's
// release draws its one order. The worked example: an offer of 10,000 EGP over 10 months, the fee
// 500 EGP, 70 %: `ijazah_half` 1,837.50 = 350 + 700 + 700 + 87.50; `ijazah_end` 5,512.50 =
// 612.50 + 700 × 7.
import { piasters, type Piasters } from '@ijazah/money';
import { describe, expect, it } from 'vitest';

import { releaseLinesOf } from './payouts.service.js';
import type { ReleaseRow } from './share-release.repository.js';
import type { ReleaseFacts, ReleaseOrder } from './share-release.rules.js';
import type { EnrollmentReleases } from './share-release.service.js';

const id = (n: number) => `0199d0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const ENROLLMENT = id(1);
const NOW = new Date('2027-09-30T10:00:00Z');

const order = (
  n: number,
  kind: ReleaseOrder['kind'],
  paid: number,
  share: number,
  month: number | null = null,
): ReleaseOrder => ({
  paymentId: id(100 + n),
  kind,
  instalmentMonth: month,
  paid_piasters: piasters(paid),
  share_piasters: piasters(share),
  sharePercent: 70,
  halfPercent: 25,
  refunded_piasters: piasters(0),
  processedAt: null,
});

const ASSESSMENT = order(0, 'assessment', 50_000, 35_000);
const MONTHS = Array.from({ length: 10 }, (_, index) =>
  order(index + 1, 'instalment', 100_000, 70_000, index + 1),
);

function releasesOf(
  orders: readonly ReleaseOrder[],
  written: readonly { milestone: ReleaseRow['milestone']; amount: number }[],
): EnrollmentReleases {
  const facts: ReleaseFacts = {
    enrollment: {
      enrollmentId: ENROLLMENT,
      teacherUserId: id(2),
      studentUserId: id(3),
      track: 'ijazah_track',
      status: 'completed',
      sessionCount: 41,
      cancellationReason: null,
      programme: {
        state: 'closed',
        total_piasters: piasters(1_000_000),
        payByAt: null,
        closedAt: NOW,
        payBlockedOpen: false,
      },
    },
    order: orders[0] ?? ASSESSMENT,
    orders,
    sessions: [],
    caseReasons: [],
    caseOpen: false,
    coversSuspension: false,
    written: written.map(({ milestone, amount }) => ({
      milestone,
      amount_piasters: piasters(amount),
    })),
  };
  return {
    facts,
    written: written.map(({ milestone, amount }, index) => ({
      id: id(500 + index),
      enrollmentId: ENROLLMENT,
      teacherUserId: id(2),
      milestone,
      amount_piasters: piasters(amount),
      dueAt: NOW,
      markedAt: null,
      refundTakenOff_piasters: piasters(0),
    })),
    cases: [],
  };
}

const drawn = (lines: ReturnType<typeof releaseLinesOf>) =>
  lines.map(({ part, orders }) => ({
    part,
    orders: orders.map(({ paymentId, amount_piasters }) => [paymentId, amount_piasters]),
  }));

const take = (one: ReleaseOrder, amount: number): [string, Piasters] => [
  one.paymentId,
  piasters(amount),
];

describe('the orders a release draws from (006:T018, FU-E1)', () => {
  it('draws the worked example: the half from the assessment and months 1 to 3, the end from months 3 to 10', () => {
    const one = releasesOf(
      [ASSESSMENT, ...MONTHS],
      [
        { milestone: 'ijazah_half', amount: 183_750 },
        { milestone: 'ijazah_end', amount: 551_250 },
      ],
    );
    expect(drawn(releaseLinesOf(one, { windowHours: 72, now: NOW }))).toEqual([
      {
        part: 'ijazah_half',
        orders: [
          take(ASSESSMENT, 35_000),
          take(MONTHS[0]!, 70_000),
          take(MONTHS[1]!, 70_000),
          take(MONTHS[2]!, 8_750),
        ],
      },
      {
        part: 'ijazah_end',
        orders: [take(MONTHS[2]!, 61_250), ...MONTHS.slice(3).map((month) => take(month, 70_000))],
      },
    ]);
  });

  it('never draws from a duplicate month: its share is the duplicate_payment case’s (Q-5 (a))', () => {
    const duplicate = order(20, 'instalment', 100_000, 70_000, 1);
    const one = releasesOf(
      [ASSESSMENT, MONTHS[0]!, duplicate, MONTHS[1]!, MONTHS[2]!],
      [{ milestone: 'ijazah_half', amount: 183_750 }],
    );
    const [half] = drawn(releaseLinesOf(one, { windowHours: 72, now: NOW }));
    expect(half?.orders.map(([paymentId]) => paymentId)).not.toContain(duplicate.paymentId);
    expect(half?.orders).toEqual([
      take(ASSESSMENT, 35_000),
      take(MONTHS[0]!, 70_000),
      take(MONTHS[1]!, 70_000),
      take(MONTHS[2]!, 8_750),
    ]);
  });

  it('draws a package’s release from its one order, whole', () => {
    const pkg = order(30, 'package', 400_000, 280_000);
    const one = releasesOf([pkg], [{ milestone: 'recitation_end', amount: 280_000 }]);
    const [line] = releaseLinesOf(
      {
        ...one,
        facts: {
          ...one.facts,
          enrollment: { ...one.facts.enrollment, track: 'recitation', programme: null },
        },
      },
      { windowHours: 72, now: NOW },
    );
    expect(line?.orders).toEqual([
      { paymentId: pkg.paymentId, amount_piasters: piasters(280_000) },
    ]);
  });
});
