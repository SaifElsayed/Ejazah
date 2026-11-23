// 003:T110: what a compensation case that closes an enrollment shows (`case-amount.rules.ts`).
// The worked example throughout: a 10,000 EGP package of 10 sessions (1,000,000 piasters, 1,000 EGP
// a session), the teacher's share at 70% (7,000 EGP, 700 EGP a session), the ijazah half at 25%
// (1,750 EGP).
import { type Piasters, piasters } from '@ijazah/money';
import { addDays } from '@ijazah/time';
import { describe, expect, it } from 'vitest';

import {
  type CaseAmountFacts,
  caseAmountOf,
  type CaseOrder,
  type CaseRelease,
} from './case-amount.rules.js';
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
        kind: 'package',
        instalmentMonth: null,
        paid_piasters: EGP(10_000),
        share_piasters: EGP(7_000),
        refunded_piasters: EGP(0),
      },
    ],
    sessions: tenWith(),
    releases: [],
    coversSuspension: false,
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
            kind: 'package',
            instalmentMonth: null,
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
        kind: 'package',
        instalmentMonth: null,
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

// ---------------------------------------------------------------------------------------------
// 006:T012 (FR-729, FR-730; R-512 «the closes' amounts per session»; G-3, G-4; DEC-85, DEC-86, DEC-91,
// DEC-94). The worked example: an offer of 40 sessions × 250 EGP = 10,000 EGP, the assessment's fee
// 500 EGP, the share 70 %; the snapshot's count N + 1 = 41, the assessment session 1. Each session
// is valued by its own order: the assessment 500 EGP (share 350); in full (10,000 − 500) ÷ 40 =
// 237.50 EGP (share 166.25); by months a 1,000 EGP month ÷ its 4 sessions = 250 EGP (share 175).

const programmeOrder = (
  n: number,
  kind: CaseOrder['kind'],
  paid: number,
  share: number,
  instalmentMonth: number | null = null,
): CaseOrder => ({
  paymentId: `0199d0a0-0000-7000-8000-0000000006${String(n).padStart(2, '0')}`,
  kind,
  instalmentMonth,
  paid_piasters: piasters(paid),
  share_piasters: piasters(share),
  refunded_piasters: piasters(0),
});
const ASSESSMENT = programmeOrder(0, 'assessment', 50_000, 35_000);
const REST_IN_FULL = programmeOrder(1, 'rest_in_full', 950_000, 665_000);
const monthOrder = (month: number): CaseOrder =>
  programmeOrder(month + 1, 'instalment', 100_000, 70_000, month);

/**
 * A programme's sessions: session 1 the assessment (no month), then the offer's sessions 2 to
 * `last`, session k + 1 in month ⌈k ÷ 4⌉; `outcomes[i]` for session i + 1, the rest cancelled at
 * the close.
 */
const MONTHS = [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5];
const programmeSessions = (last: number, ...outcomes: string[]): ReleaseSession[] =>
  Array.from({ length: last }, (_, index) => {
    const month = index === 0 ? undefined : (MONTHS[index - 1] ?? 10);
    return {
      ...at(index + 1, outcomes[index] ?? 'cancelled_by_admin'),
      ...(month === undefined ? {} : { programmeMonth: month }),
    };
  });

const done = (count: number): string[] => Array.from({ length: count }, () => 'done');

const programme = (overrides: Partial<CaseAmountFacts>): CaseAmountFacts =>
  facts({ track: 'ijazah_track', sessionCount: 41, ...overrides });

describe('006:T012 a programme’s close on a complaint against the student: each session by its own order', () => {
  it('in full, the assessment and 5 sessions taken: refund 35 × 237.50 = 8,312.50 EGP; release 350 + 5 × 166.25 = 1,181.25 EGP', () => {
    expect(
      caseAmountOf(
        programme({
          reason: 'student_complaint_ended',
          orders: [ASSESSMENT, REST_IN_FULL],
          sessions: programmeSessions(41, ...done(6)),
        }),
      ),
    ).toEqual({
      cause: 'student_complaint_close',
      refund_piasters: piasters(831_250),
      release_piasters: piasters(118_125),
      refunded_piasters: piasters(0),
    });
  });

  it('by months, months 1 and 2 paid, the assessment and 5 sessions taken: refund 3 × 250 EGP; release 350 + 5 × 175 EGP; an unpaid month refunds nothing', () => {
    expect(
      caseAmountOf(
        programme({
          reason: 'student_complaint_ended',
          orders: [ASSESSMENT, monthOrder(1), monthOrder(2)],
          sessions: programmeSessions(9, ...done(6)),
        }),
      ),
    ).toEqual({
      cause: 'student_complaint_close',
      refund_piasters: piasters(75_000),
      release_piasters: piasters(122_500),
      refunded_piasters: piasters(0),
    });
  });

  it('values a delivered make-up as the session it makes up, in that session’s month', () => {
    // Month 1: session 3 the teacher's no-show, made up by session 10 (done); month 2 not taken.
    const sessions = [
      ...programmeSessions(9, 'done', 'done', 'teacher_no_show', 'done', 'done'),
      { ...at(10, 'done'), madeUpSequence: 3 },
    ];
    expect(
      caseAmountOf(
        programme({
          reason: 'student_complaint_ended',
          orders: [ASSESSMENT, monthOrder(1), monthOrder(2)],
          sessions,
        }),
      ),
    ).toMatchObject({ refund_piasters: piasters(100_000), release_piasters: piasters(105_000) });
  });

  it('takes the releases already written off the release, never below nothing', () => {
    expect(
      caseAmountOf(
        programme({
          reason: 'student_complaint_ended',
          orders: [ASSESSMENT, REST_IN_FULL],
          sessions: programmeSessions(41, ...done(6)),
          releases: [
            { milestone: 'ijazah_half', amount_piasters: piasters(100_000), marked: true },
          ],
        }),
      ),
    ).toMatchObject({ release_piasters: piasters(18_125) });
  });

  it('shows the refunds already recorded on every one of the programme’s orders', () => {
    expect(
      caseAmountOf(
        programme({
          reason: 'student_complaint_ended',
          orders: [ASSESSMENT, { ...monthOrder(1), refunded_piasters: piasters(25_000) }],
          sessions: programmeSessions(5, ...done(3)),
        }),
      ),
    ).toMatchObject({ refunded_piasters: piasters(25_000) });
  });
});

describe('006:T012 a programme’s close on the student’s ban or confirmed fault (DEC-91): each session by its own order', () => {
  it('in full, a teacher’s no-show owed 237.50 EGP, the rest not taken the administrator’s decision', () => {
    expect(
      caseAmountOf(
        programme({
          reason: 'student_banned',
          orders: [ASSESSMENT, REST_IN_FULL],
          sessions: programmeSessions(41, 'done', 'done', 'teacher_no_show'),
        }),
      ),
    ).toEqual({
      cause: 'student_fault_close',
      owed_piasters: piasters(23_750),
      decision_piasters: piasters(902_500),
      release_piasters: piasters(51_625),
      refunded_piasters: piasters(0),
    });
  });

  it('by months, an assessment owed is the fee (500 EGP) and a month’s session 250 EGP', () => {
    expect(
      caseAmountOf(
        programme({
          reason: 'student_fault_confirmed',
          orders: [ASSESSMENT, monthOrder(1)],
          sessions: programmeSessions(5, 'teacher_no_show', 'done', 'teacher_no_show'),
        }),
      ),
    ).toEqual({
      cause: 'student_fault_close',
      owed_piasters: piasters(75_000),
      decision_piasters: piasters(50_000),
      release_piasters: piasters(17_500),
      refunded_piasters: piasters(0),
    });
  });
});

describe('006:T012 the dropout set for a programme (FR-729; DEC-85: every order refunded)', () => {
  const ended = (reason: string, coversSuspension = false) =>
    caseAmountOf(
      programme({
        reason,
        coversSuspension,
        orders: [ASSESSMENT, REST_IN_FULL],
        sessions: programmeSessions(41, ...done(6)),
      }),
    );
  const everything = {
    cause: 'ijazah_dropout',
    total_piasters: piasters(1_000_000),
    held_piasters: piasters(700_000),
    platformPart_piasters: piasters(300_000),
    released_piasters: piasters(0),
    refunded_piasters: piasters(0),
  };

  it('an administrator’s end of a suspended programme (`admin_ended` covering its `teacher_suspended` case) refunds every order', () => {
    expect(ended('admin_ended', true)).toEqual(everything);
  });

  it.each(['teacher_ended', 'absence_termination'])('%s refunds every order', (reason) => {
    expect(ended(reason)).toEqual(everything);
  });

  it('an administrator’s direct end of an unsuspended programme is not in the set (T125’s)', () => {
    expect(ended('admin_ended', false)).toBeUndefined();
  });

  it('a suspension shows no refund: its open `teacher_suspended` case is a pause', () => {
    expect(ended('teacher_suspended')).toBeUndefined();
    expect(ended('teacher_suspended', true)).toBeUndefined();
  });

  it('a package’s administrator end covering a suspension stays outside B-P2’s set (T125’s)', () => {
    expect(caseAmountOf(facts({ reason: 'admin_ended', coversSuspension: true }))).toBeUndefined();
    expect(
      caseAmountOf(facts({ track: 'ijazah_track', reason: 'admin_ended', coversSuspension: true })),
    ).toBeUndefined();
  });
});
