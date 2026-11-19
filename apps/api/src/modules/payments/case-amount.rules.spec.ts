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

// 003:T112 (Q-4 (a), rule d): the complaint close is the administrator's end on a teacher's complaint
// against the student, `student_complaint_ended`; a ban's and a confirmed fault's close is T124's below.
describe('a close on a complaint against the student (DEC-86)', () => {
  it('refunds the sessions after the close and releases the delivered and the missed ones’ share', () => {
    const sessions = tenWith('done', 'done', 'done', 'student_no_show', 'student_no_show');
    expect(caseAmountOf(facts({ reason: 'student_complaint_ended', sessions }))).toEqual({
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
        reason: 'student_complaint_ended',
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

// 003:T124 (SRS DEC-91, FR-ADMIN-5, FR-AUTH-11; ADR 0018 D5; Q-7 (a), Q-7a (a), Q-7b (a)): a close on
// the student's ban or confirmed fault shows no refund for the sessions the close took. The sessions
// owed before it are a refund due; the rest not taken is the administrator's decision; the teacher's
// release is the complaint close's, unchanged. Written before the rule, run red first.
describe('a close on a student’s ban or confirmed fault (003:T124, DEC-91)', () => {
  /** 8 sessions of a 1,000 EGP package (125 EGP each), the teacher's share 70 % (87.50 EGP each). */
  const eight = (sessions: ReleaseSession[]): Partial<CaseAmountFacts> => ({
    sessionCount: 8,
    orders: [
      {
        paymentId: ORDER,
        paid_piasters: EGP(1_000),
        share_piasters: EGP(700),
        refunded_piasters: EGP(0),
      },
    ],
    sessions,
  });

  it.each(['student_banned', 'student_fault_confirmed'])(
    'the task’s example on %s: 3 delivered, 1 missed by each party, 3 cancelled: owed 125, decision 375, release 350 EGP',
    (reason) => {
      const sessions = [
        at(1, 'done'),
        at(2, 'done'),
        at(3, 'done'),
        at(4, 'student_no_show'),
        at(5, 'teacher_no_show'),
        at(6, 'cancelled_by_admin'),
        at(7, 'cancelled_by_admin'),
        at(8, 'cancelled_by_admin'),
      ];
      expect(caseAmountOf(facts({ reason, ...eight(sessions) }))).toEqual({
        cause: 'student_fault_close',
        owed_piasters: EGP(125),
        decision_piasters: EGP(375),
        release_piasters: EGP(350),
        refunded_piasters: EGP(0),
      });
    },
  );

  it('owes a both-parties absence, an agreed cancellation and a postponement not made up, never one taken through its make-up (Q-7b (a))', () => {
    const sessions = [
      at(1, 'done'),
      at(2, 'teacher_no_show'),
      at(3, 'both_no_show'),
      at(4, 'cancelled_by_agreement'),
      at(5, 'postponed'),
      at(6, 'cancelled_by_admin'),
      at(7, 'cancelled_by_admin'),
      at(8, 'cancelled_by_admin'),
      // Session 2's make-up, delivered: session 2 was taken.
      at(9, 'done', 2),
    ];
    expect(caseAmountOf(facts({ reason: 'student_banned', ...eight(sessions) }))).toEqual({
      cause: 'student_fault_close',
      owed_piasters: EGP(375),
      decision_piasters: EGP(375),
      release_piasters: EGP(175),
      refunded_piasters: EGP(0),
    });
  });

  it('takes an earlier release off the teacher’s, as a complaint close does (Q-B1-5 (a))', () => {
    const sessions = tenWith('done', 'done', 'done', 'done', 'done', 'student_no_show');
    expect(
      caseAmountOf(
        facts({
          reason: 'student_fault_confirmed',
          track: 'ijazah_track',
          sessions,
          releases: [HALF_MARKED],
        }),
      ),
    ).toMatchObject({ cause: 'student_fault_close', release_piasters: EGP(2_450) });
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
