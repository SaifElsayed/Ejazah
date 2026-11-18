// 003:T110: what a compensation case that closes an enrollment shows (`case-amount.rules.ts`).
// The worked example throughout: a 10,000 EGP package of 10 sessions (1,000,000 piasters, 1,000 EGP
// a session), the teacher's share at 70% (7,000 EGP, 700 EGP a session), the ijazah half at 25%
// (1,750 EGP).
import { type Piasters, piasters } from '@ijazah/money';
import { addDays } from '@ijazah/time';
import { describe, expect, it } from 'vitest';

import { type CaseAmountFacts, caseAmountOf, type CaseRelease } from './case-amount.rules.js';
import type { ReleaseSession } from './share-release.rules.js';

const EGP = (pounds: number): Piasters => piasters(pounds * 100);
const ORDER = '0199d0a0-0000-7000-8000-000000000004';
const SECOND_ORDER = '0199d0a0-0000-7000-8000-000000000005';

/** Session `n` ends on 2026-10-0n at 10:00 UTC, the next day for the next. */
const FIRST_END = new Date('2026-10-01T10:00:00Z');
const at = (n: number, outcome: string | undefined, madeUpSequence?: number): ReleaseSession => ({
  sequenceNumber: n,
  endsAt: new Date(addDays(FIRST_END, n - 1)),
  outcome,
  ...(madeUpSequence === undefined ? {} : { madeUpSequence }),
});

/** Ten sessions: `outcomes[i]` for session i + 1, the rest cancelled at the close. */
const tenWith = (...outcomes: string[]): ReleaseSession[] =>
  Array.from({ length: 10 }, (_, index) => at(index + 1, outcomes[index] ?? 'cancelled_by_admin'));

const HALF_MARKED: CaseRelease = {
  milestone: 'ijazah_half',
  amount_piasters: EGP(1_750),
  marked: true,
};

function facts(overrides: Partial<CaseAmountFacts> = {}): CaseAmountFacts {
  return {
    kind: 'compensation_case',
    reason: 'teacher_ended',
    track: 'recitation',
    sessionCount: 10,
    orders: [
      {
        paymentId: ORDER,
        paid_piasters: EGP(10_000),
        share_piasters: EGP(7_000),
        refunded_piasters: EGP(0),
      },
    ],
    sessions: tenWith(),
    releases: [],
    ...overrides,
  };
}

describe('a teacher’s dropout on the ijazah track (DEC-85)', () => {
  it('shows 10,000 paid as 5,250 held + 3,000 the platform’s part + 1,750 released', () => {
    expect(
      caseAmountOf(
        facts({
          track: 'ijazah_track',
          sessions: tenWith('done', 'done', 'done', 'done', 'done'),
          releases: [HALF_MARKED],
        }),
      ),
    ).toEqual({
      cause: 'ijazah_dropout',
      total_piasters: EGP(10_000),
      held_piasters: EGP(5_250),
      platformPart_piasters: EGP(3_000),
      released_piasters: EGP(1_750),
      refunded_piasters: EGP(0),
    });
  });

  it('counts as released only the releases marked done, a due one still held', () => {
    const amount = caseAmountOf(
      facts({
        track: 'ijazah_track',
        reason: 'absence_termination',
        releases: [{ ...HALF_MARKED, marked: false }],
      }),
    );
    expect(amount).toMatchObject({
      cause: 'ijazah_dropout',
      held_piasters: EGP(7_000),
      released_piasters: EGP(0),
    });
  });

  it('takes every order of the enrollment', () => {
    const amount = caseAmountOf(
      facts({
        track: 'ijazah_track',
        orders: [
          ...facts().orders,
          {
            paymentId: SECOND_ORDER,
            paid_piasters: EGP(2_000),
            share_piasters: EGP(1_400),
            refunded_piasters: EGP(0),
          },
        ],
        releases: [HALF_MARKED],
      }),
    );
    expect(amount).toMatchObject({
      total_piasters: EGP(12_000),
      held_piasters: EGP(6_650),
      platformPart_piasters: EGP(3_600),
      released_piasters: EGP(1_750),
    });
  });
});

describe('a teacher’s dropout on recitation (DEC-85)', () => {
  it('refunds the untaken sessions and releases the delivered ones’ share, a make-up valued as its original', () => {
    // Sessions 1–4 done, 5 a Teacher-No-Show made up by session 11 (done), 6–10 cancelled at the end.
    const sessions = [
      ...tenWith('done', 'done', 'done', 'done', 'teacher_no_show'),
      at(11, 'done', 5),
    ];
    expect(caseAmountOf(facts({ sessions }))).toEqual({
      cause: 'recitation_dropout',
      refund_piasters: EGP(5_000),
      release_piasters: EGP(3_500),
      refunded_piasters: EGP(0),
    });
  });

  it('never refunds a session the student missed, and releases its share (Q-C3 (b))', () => {
    const amount = caseAmountOf(
      facts({ sessions: tenWith('done', 'done', 'done', 'done', 'student_no_show') }),
    );
    expect(amount).toMatchObject({ refund_piasters: EGP(5_000), release_piasters: EGP(3_500) });
  });
});

describe('a close on a complaint against the student (DEC-86)', () => {
  it('refunds the sessions after the close and releases the delivered and the missed ones’ share', () => {
    const sessions = tenWith('done', 'done', 'done', 'student_no_show', 'student_no_show');
    expect(caseAmountOf(facts({ reason: 'student_fault_confirmed', sessions }))).toEqual({
      cause: 'student_complaint_close',
      refund_piasters: EGP(5_000),
      release_piasters: EGP(3_500),
      refunded_piasters: EGP(0),
    });
  });

  it('takes an earlier release off the teacher’s, never its own (Q-B1-5 (a))', () => {
    const sessions = tenWith('done', 'done', 'done', 'done', 'done', 'student_no_show');
    const amount = caseAmountOf(
      facts({
        reason: 'student_banned',
        track: 'ijazah_track',
        sessions,
        releases: [
          HALF_MARKED,
          { milestone: 'student_complaint_close', amount_piasters: EGP(2_450), marked: false },
        ],
      }),
    );
    expect(amount).toMatchObject({
      cause: 'student_complaint_close',
      refund_piasters: EGP(4_000),
      release_piasters: EGP(2_450),
    });
  });
});

describe('the refunds already recorded (Q-C1 (a))', () => {
  it('are shown beside the amount, nothing taken off it', () => {
    const amount = caseAmountOf(
      facts({
        orders: [{ ...facts().orders[0]!, refunded_piasters: EGP(1_000) }],
        sessions: tenWith('done', 'done', 'done', 'done'),
      }),
    );
    expect(amount).toMatchObject({ refund_piasters: EGP(6_000), refunded_piasters: EGP(1_000) });
  });
});

describe('no amount', () => {
  it.each(['admin_ended', 'admin_cancellation', 'gender_correction', 'makeup_refused'])(
    'for a reason outside the map: %s',
    (reason) => {
      expect(caseAmountOf(facts({ reason }))).toBeUndefined();
    },
  );

  it('for a complaint or a session dispute, whatever its text', () => {
    expect(caseAmountOf(facts({ kind: 'absence_complaint' }))).toBeUndefined();
    expect(caseAmountOf(facts({ kind: 'session_dispute' }))).toBeUndefined();
  });

  it('for an enrollment with no paid order carrying a share', () => {
    expect(caseAmountOf(facts({ orders: [] }))).toBeUndefined();
  });
});
