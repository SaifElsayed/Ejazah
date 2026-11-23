// 003:T105: the releases an enrollment owes and when each falls due (`share-release.rules.ts`).
// The worked example throughout: a 10,000 EGP package of 10 sessions, the teacher's share at 70%
// (7,000 EGP, 700,000 piasters, 700 EGP a session), the ijazah half at 25% (1,750 EGP), the dispute
// window 72 hours.
import { type Piasters, piasters, toPlainNumber } from '@ijazah/money';
import { addDays, addHours } from '@ijazah/time';
import { describe, expect, it } from 'vitest';

import {
  complaintCloseAmount,
  halfReached,
  halfWindowHours,
  type PlannedRelease,
  plannedReleases,
  programmeRowMissing,
  type ReleaseFacts,
  type ReleaseOrder,
  type ReleaseProgramme,
  type ReleaseSession,
  refundShareOf,
  takenOffAtEnd,
} from './share-release.rules.js';

const WINDOW = 72;
const ENROLLMENT = '0199d0a0-0000-7000-8000-000000000001';
const TEACHER = '0199d0a0-0000-7000-8000-000000000002';
const STUDENT = '0199d0a0-0000-7000-8000-000000000003';
const PAYMENT = '0199d0a0-0000-7000-8000-000000000004';

/** Session `n` ends on 2026-10-0n at 10:00 UTC (n ≤ 9), then 2026-10-10 and on. */
const FIRST_END = new Date('2026-10-01T10:00:00Z');
const endOf = (n: number): Date => new Date(addDays(FIRST_END, n - 1));
const at = (n: number, outcome: string | undefined): ReleaseSession => ({
  sequenceNumber: n,
  endsAt: endOf(n),
  outcome,
});
/** Ten sessions, the first `done` of them delivered, the rest still `scheduled`. */
const sessionsWith = (done: number, count = 10): ReleaseSession[] =>
  Array.from({ length: count }, (_, index) => at(index + 1, index < done ? 'done' : 'scheduled'));

/** Long after every session's window. */
const LATER = new Date('2026-12-01T00:00:00Z');

function facts(
  overrides: Partial<ReleaseFacts> & {
    readonly track?: 'recitation' | 'ijazah_track';
    readonly status?: ReleaseFacts['enrollment']['status'];
    readonly count?: number;
  } = {},
): ReleaseFacts {
  const { track = 'recitation', status = 'completed', count = 10, ...rest } = overrides;
  const order = rest.order ?? {
    paymentId: PAYMENT,
    kind: 'package' as const,
    instalmentMonth: null,
    paid_piasters: piasters(1_000_000),
    share_piasters: piasters(700_000),
    sharePercent: 70,
    halfPercent: track === 'ijazah_track' ? 25 : null,
    refunded_piasters: piasters(0),
  };
  return {
    enrollment: {
      enrollmentId: ENROLLMENT,
      teacherUserId: TEACHER,
      studentUserId: STUDENT,
      track,
      status,
      sessionCount: count,
      cancellationReason: null,
      programme: null,
    },
    order,
    orders: [order],
    sessions: sessionsWith(count, count),
    caseReasons: [],
    caseOpen: false,
    written: [],
    ...rest,
  };
}

const plain = (plan: readonly PlannedRelease[]) =>
  plan.map(({ milestone, amount_piasters, dueAt, due, waitsForCase }) => ({
    milestone,
    amount: toPlainNumber(amount_piasters),
    dueAt: dueAt?.toISOString(),
    due,
    waitsForCase,
  }));

const plan = (input: ReleaseFacts, now: Date = LATER) =>
  plain(plannedReleases(input, { windowHours: WINDOW, now }));

/** The instant 72 hours after session `n` ends. */
const windowAfter = (n: number): string => new Date(addHours(endOf(n), 72)).toISOString();

/**
 * PR #149's review, round 1, Minor 2 (Saif's case): ten sessions, session 3 a teacher no-show, its
 * make-up (#11) booked from the teacher's free times inside the package and ending on day 4, and
 * session 10 ending on day 10. The make-up has the highest sequence number; session 10 ends last.
 */
const madeUpMidPackage = (): ReleaseSession[] => [
  ...Array.from({ length: 10 }, (_, index) =>
    at(index + 1, index === 2 ? 'teacher_no_show' : 'done'),
  ),
  {
    sequenceNumber: 11,
    endsAt: new Date(addHours(endOf(4), 6)),
    outcome: 'done',
    madeUpSequence: 3,
  },
];

describe('recitation_end (ADR 0025 D2: the whole share at the package’s end)', () => {
  it('falls due for the whole share once the package completed and its last session’s window passed', () => {
    expect(plan(facts())).toEqual([
      {
        milestone: 'recitation_end',
        amount: 700_000,
        dueAt: windowAfter(10),
        due: true,
        waitsForCase: false,
      },
    ]);
  });

  it('is held, with when it falls due, inside the last session’s window', () => {
    const inside = new Date(addHours(endOf(10), 71));
    expect(plan(facts(), inside)).toEqual([
      {
        milestone: 'recitation_end',
        amount: 700_000,
        dueAt: windowAfter(10),
        due: false,
        waitsForCase: false,
      },
    ]);
  });

  it('is held while a case is open on the enrollment', () => {
    expect(plan(facts({ caseOpen: true }))).toEqual([
      {
        milestone: 'recitation_end',
        amount: 700_000,
        dueAt: windowAfter(10),
        due: false,
        waitsForCase: true,
      },
    ]);
  });

  it('is held, with its estimate, while the package runs', () => {
    expect(plan(facts({ status: 'confirmed', sessions: sessionsWith(4) }))).toEqual([
      {
        milestone: 'recitation_end',
        amount: 700_000,
        dueAt: windowAfter(10),
        due: false,
        waitsForCase: false,
      },
    ]);
  });

  it('falls due 72 h after the last session to end, not after a make-up with the highest number (#149 r1, Minor 2): 2026-10-13T10:00Z', () => {
    expect(plan(facts({ sessions: madeUpMidPackage() }))).toMatchObject([
      { milestone: 'recitation_end', dueAt: '2026-10-13T10:00:00.000Z' },
    ]);
  });

  it('is owed once: a written release is not planned again', () => {
    expect(
      plan(
        facts({ written: [{ milestone: 'recitation_end', amount_piasters: piasters(700_000) }] }),
      ),
    ).toEqual([]);
  });

  it('takes off the teacher’s share of a refund recorded outside a case (Q-B1-1 (a)): 1,000 EGP refunded, 700 EGP off', () => {
    const refunded = facts();
    expect(
      plan({ ...refunded, order: { ...refunded.order, refunded_piasters: piasters(100_000) } }),
    ).toMatchObject([{ milestone: 'recitation_end', amount: 630_000 }]);
  });

  it('owes nothing once the whole order was refunded (never below nothing)', () => {
    const refunded = facts();
    expect(
      plan({ ...refunded, order: { ...refunded.order, refunded_piasters: piasters(1_000_000) } }),
    ).toEqual([]);
  });
});

describe('the ijazah track (ADR 0025 D2: 25% at half the sessions, the rest at the end; Q-4 (a))', () => {
  it('falls due for the half (1,750 EGP) after the window of the 5th of 10 delivered, and holds the rest (5,250 EGP)', () => {
    expect(
      plan(facts({ track: 'ijazah_track', status: 'confirmed', sessions: sessionsWith(5) })),
    ).toEqual([
      {
        milestone: 'ijazah_half',
        amount: 175_000,
        dueAt: windowAfter(5),
        due: true,
        waitsForCase: false,
      },
      {
        milestone: 'ijazah_end',
        amount: 525_000,
        dueAt: windowAfter(10),
        due: false,
        waitsForCase: false,
      },
    ]);
  });

  it('holds the half at 4 of 10, with the half-th session’s end as its estimate', () => {
    expect(
      plan(facts({ track: 'ijazah_track', status: 'confirmed', sessions: sessionsWith(4) })),
    ).toEqual([
      {
        milestone: 'ijazah_half',
        amount: 175_000,
        dueAt: windowAfter(5),
        due: false,
        waitsForCase: false,
      },
      {
        milestone: 'ijazah_end',
        amount: 525_000,
        dueAt: windowAfter(10),
        due: false,
        waitsForCase: false,
      },
    ]);
  });

  // 003:T112 (SRS FR-POSTPONE-2, DEC-81; Q-6 (a)): a postponed session counts toward the half only once
  // delivered, through its make-up; postponed itself it is nothing delivered. A pin of T105's rule.
  it('never counts a postponed session toward the half: 4 done and 1 postponed hold it (003:T112)', () => {
    const sessions = sessionsWith(4).map((one) =>
      one.sequenceNumber === 5 ? { ...one, outcome: 'postponed' } : one,
    );
    expect(plan(facts({ track: 'ijazah_track', status: 'confirmed', sessions }))).toMatchObject([
      { milestone: 'ijazah_half', due: false },
      { milestone: 'ijazah_end', due: false },
    ]);
  });

  it('holds the half inside the 72-hour window of the session that reached it (Q-B1-3 (a))', () => {
    const inside = new Date(addHours(endOf(5), 71));
    expect(
      plan(
        facts({ track: 'ijazah_track', status: 'confirmed', sessions: sessionsWith(5) }),
        inside,
      ),
    ).toMatchObject([
      { milestone: 'ijazah_half', due: false },
      { milestone: 'ijazah_end', due: false },
    ]);
  });

  it('takes the refund’s share off the rest at the end (Q-B1-1 (a)): 5,250 − 700 EGP', () => {
    const base = facts({
      track: 'ijazah_track',
      written: [{ milestone: 'ijazah_half', amount_piasters: piasters(175_000) }],
    });
    expect(
      plan({ ...base, order: { ...base.order, refunded_piasters: piasters(100_000) } }),
    ).toMatchObject([{ milestone: 'ijazah_end', amount: 455_000 }]);
  });

  it('holds the half while a case is open', () => {
    expect(
      plan(
        facts({
          track: 'ijazah_track',
          status: 'confirmed',
          sessions: sessionsWith(6),
          caseOpen: true,
        }),
      ),
    ).toMatchObject([
      { milestone: 'ijazah_half', due: false, waitsForCase: true },
      { milestone: 'ijazah_end', due: false },
    ]);
  });

  it('counts a disputed session by its frozen outcome, and one with none written as nothing', () => {
    // Sessions 1 to 4 delivered; session 5 disputed, its outcome frozen or not yet written.
    const sessions = sessionsWith(4);
    const frozen = sessions.map((one) =>
      one.sequenceNumber === 5 ? { ...one, outcome: 'done' } : one,
    );
    const unwritten = sessions.map((one) =>
      one.sequenceNumber === 5 ? { ...one, outcome: undefined } : one,
    );
    expect(
      plan(facts({ track: 'ijazah_track', status: 'confirmed', sessions: frozen })),
    ).toMatchObject([{ milestone: 'ijazah_half', due: true }, { milestone: 'ijazah_end' }]);
    expect(
      plan(facts({ track: 'ijazah_track', status: 'confirmed', sessions: unwritten })),
    ).toMatchObject([{ milestone: 'ijazah_half', due: false }, { milestone: 'ijazah_end' }]);
  });

  it('falls due for the rest at the end, the share less the half already released', () => {
    expect(
      plan(
        facts({
          track: 'ijazah_track',
          written: [{ milestone: 'ijazah_half', amount_piasters: piasters(175_000) }],
        }),
      ),
    ).toEqual([
      {
        milestone: 'ijazah_end',
        amount: 525_000,
        dueAt: windowAfter(10),
        due: true,
        waitsForCase: false,
      },
    ]);
  });

  it('falls due at the end 72 h after the last session to end, not after a make-up with the highest number (#149 r1, Minor 2): 2026-10-13T10:00Z', () => {
    expect(
      plan(
        facts({
          track: 'ijazah_track',
          sessions: madeUpMidPackage(),
          written: [{ milestone: 'ijazah_half', amount_piasters: piasters(175_000) }],
        }),
      ),
    ).toMatchObject([{ milestone: 'ijazah_end', dueAt: '2026-10-13T10:00:00.000Z' }]);
  });

  it('falls due for both at once when the half was never written before the end', () => {
    expect(plan(facts({ track: 'ijazah_track' }))).toMatchObject([
      { milestone: 'ijazah_half', amount: 175_000, due: true },
      { milestone: 'ijazah_end', amount: 525_000, due: true },
    ]);
  });

  it('owes no half when the package completed short of it: the end releases the whole share', () => {
    const sessions = sessionsWith(10).map((one) =>
      one.sequenceNumber > 3 ? { ...one, outcome: 'student_no_show' } : one,
    );
    expect(plan(facts({ track: 'ijazah_track', sessions }))).toEqual([
      {
        milestone: 'ijazah_end',
        amount: 700_000,
        dueAt: windowAfter(10),
        due: true,
        waitsForCase: false,
      },
    ]);
  });

  it('owes no half on an ijazah order with no kept percent: the end releases the whole share', () => {
    const base = facts({ track: 'ijazah_track' });
    expect(plan({ ...base, order: { ...base.order, halfPercent: null } })).toEqual([
      {
        milestone: 'ijazah_end',
        amount: 700_000,
        dueAt: windowAfter(10),
        due: true,
        waitsForCase: false,
      },
    ]);
  });

  it('releases nothing more on an ijazah dropout (DEC-85)', () => {
    expect(
      plan(
        facts({
          track: 'ijazah_track',
          status: 'cancelled',
          sessions: sessionsWith(6),
          caseReasons: ['teacher_ended'],
        }),
      ),
    ).toEqual([]);
  });
});

describe('the closes that release (Q-5 (a))', () => {
  const closed = (reason: string, sessions: ReleaseSession[] = sessionsWith(3)) =>
    facts({ status: 'cancelled', sessions, caseReasons: [reason] });

  it('releases the delivered sessions’ share on a recitation teacher’s dropout (3 × 700 EGP)', () => {
    for (const reason of ['teacher_ended', 'absence_termination']) {
      expect(plan(closed(reason))).toEqual([
        {
          milestone: 'teacher_dropout',
          amount: 210_000,
          dueAt: windowAfter(3),
          due: true,
          waitsForCase: false,
        },
      ]);
    }
  });

  it('releases a missed session’s share too on a recitation dropout (003:T110, Q-C3 (b): 4 done + 1 missed = 5 × 700 EGP)', () => {
    const sessions = sessionsWith(4).map((one) =>
      one.sequenceNumber === 5
        ? { ...one, outcome: 'student_no_show' }
        : one.sequenceNumber > 5
          ? { ...one, outcome: 'cancelled_by_admin' }
          : one,
    );
    expect(plan(closed('teacher_ended', sessions))).toEqual([
      {
        milestone: 'teacher_dropout',
        amount: 350_000,
        dueAt: windowAfter(5),
        due: true,
        waitsForCase: false,
      },
    ]);
  });

  it('releases the delivered and missed sessions’ share on a complaint against the student', () => {
    const sessions = [
      at(1, 'done'),
      at(2, 'done'),
      at(3, 'student_no_show'),
      ...sessionsWith(10)
        .slice(3)
        .map((one) => ({ ...one, outcome: 'cancelled_by_admin' })),
    ];
    for (const reason of ['student_fault_confirmed', 'student_banned']) {
      expect(
        plan(facts({ status: 'terminated_no_show', sessions, caseReasons: [reason] })),
      ).toEqual([
        {
          milestone: 'student_complaint_close',
          amount: 210_000,
          dueAt: windowAfter(3),
          due: true,
          waitsForCase: false,
        },
      ]);
    }
  });

  // 003:T112 (SRS FR-POSTPONE-6, DEC-90; Q-4 (a)): the administrator's end on a teacher's complaint
  // against the student closes as a complaint close: the same release.
  it('releases the delivered and missed sessions’ share on the end on a complaint against the student (003:T112)', () => {
    const sessions = [
      at(1, 'done'),
      at(2, 'done'),
      at(3, 'student_no_show'),
      ...sessionsWith(10)
        .slice(3)
        .map((one) => ({ ...one, outcome: 'cancelled_by_admin' })),
    ];
    expect(
      plan(facts({ status: 'cancelled', sessions, caseReasons: ['student_complaint_ended'] })),
    ).toEqual([
      {
        milestone: 'student_complaint_close',
        amount: 210_000,
        dueAt: windowAfter(3),
        due: true,
        waitsForCase: false,
      },
    ]);
  });

  it('holds a close’s release while its case is open, and inside the last counted window', () => {
    expect(plan({ ...closed('teacher_ended'), caseOpen: true })).toMatchObject([
      { milestone: 'teacher_dropout', due: false, waitsForCase: true },
    ]);
    expect(plan(closed('teacher_ended'), new Date(addHours(endOf(3), 1)))).toMatchObject([
      { milestone: 'teacher_dropout', due: false, waitsForCase: false },
    ]);
  });

  it('values a delivered make-up as the session it makes up (Q-B1-4 (a))', () => {
    // Sessions 1 and 2 delivered, 3 the teacher missed, made up as session 11 and delivered.
    const sessions = [
      at(1, 'done'),
      at(2, 'done'),
      at(3, 'teacher_no_show'),
      ...sessionsWith(10)
        .slice(3)
        .map((one) => ({ ...one, outcome: 'cancelled_by_admin' })),
      { sequenceNumber: 11, endsAt: endOf(11), outcome: 'done', madeUpSequence: 3 },
    ];
    expect(plan(facts({ status: 'cancelled', sessions, caseReasons: ['teacher_ended'] }))).toEqual([
      {
        milestone: 'teacher_dropout',
        amount: 210_000,
        dueAt: windowAfter(11),
        due: true,
        waitsForCase: false,
      },
    ]);
  });

  it('gives a make-up of the last session the last one’s value, remainder included', () => {
    const base = facts({
      status: 'cancelled',
      count: 3,
      caseReasons: ['teacher_ended'],
      sessions: [
        at(1, 'done'),
        at(2, 'done'),
        at(3, 'teacher_no_show'),
        { sequenceNumber: 4, endsAt: endOf(4), outcome: 'done', madeUpSequence: 3 },
      ],
    });
    expect(
      plan({ ...base, order: { ...base.order, share_piasters: piasters(1_000) } }),
    ).toMatchObject([{ milestone: 'teacher_dropout', amount: 1_000 }]);
  });

  it('releases nothing on any other reason, a gender correction included', () => {
    for (const reason of [
      'gender_correction',
      'admin_ended',
      'admin_cancellation',
      'makeup_refused',
    ]) {
      expect(plan(closed(reason))).toEqual([]);
    }
  });

  it('releases nothing on a dropout before any delivered session', () => {
    expect(plan(closed('teacher_ended', sessionsWith(0)))).toEqual([]);
  });

  it('takes the newest reason that releases', () => {
    expect(
      plan(
        facts({
          status: 'cancelled',
          sessions: sessionsWith(3),
          caseReasons: ['gender_correction', 'student_banned', 'teacher_ended'],
        }),
      ),
    ).toMatchObject([{ milestone: 'student_complaint_close' }]);
  });

  it('takes the half already released off a close after it (Q-B1-5 (a)): 4,200 − 1,750 EGP', () => {
    expect(
      plan(
        facts({
          track: 'ijazah_track',
          status: 'cancelled',
          sessions: sessionsWith(6),
          caseReasons: ['student_banned'],
          written: [{ milestone: 'ijazah_half', amount_piasters: piasters(175_000) }],
        }),
      ),
    ).toMatchObject([{ milestone: 'student_complaint_close', amount: 245_000 }]);
  });
});

// ---------------------------------------------------------------------------------------------
// 006:T011 (FR-703, FR-706b, FR-725, FR-728; R-512; DEC-94; Q-5 (a)): the programme's releases. The
// worked example: an offer of 40 sessions × 250 EGP = 10,000 EGP, the assessment's fee 500 EGP, the
// share 70 %, the half 25 %; the snapshot's count N + 1 = 41, the assessment session 1. Orders: the
// assessment 50,000 pt (share 35,000), the rest in full 950,000 (share 665,000), or a month
// 100,000 (share 70,000).

const programmeOrder = (
  n: number,
  kind: ReleaseOrder['kind'],
  gross: number,
  share: number,
): ReleaseOrder => ({
  paymentId: `0199d0a0-0000-7000-8000-0000000006${String(n).padStart(2, '0')}`,
  kind,
  instalmentMonth: kind === 'instalment' ? n - 1 : null,
  paid_piasters: piasters(gross),
  share_piasters: piasters(share),
  sharePercent: 70,
  halfPercent: 25,
  refunded_piasters: piasters(0),
});
const ASSESSMENT = programmeOrder(0, 'assessment', 50_000, 35_000);
const REST_IN_FULL = programmeOrder(1, 'rest_in_full', 950_000, 665_000);
/** Months 1 to `count` paid, 100,000 pt each (4 × 25,000), share 70,000. */
const months = (count: number): ReleaseOrder[] =>
  Array.from({ length: count }, (_, index) =>
    programmeOrder(index + 2, 'instalment', 100_000, 70_000),
  );

/** The offer sent 2026-10-03 12:00 UTC; its 48 hours end 2026-10-05 12:00 UTC. */
const PAY_BY = new Date('2026-10-05T12:00:00Z');

function programmeFacts({
  orders,
  status = 'confirmed',
  cancellationReason = null,
  programme = {},
  delivered = 1,
  count = 41,
  caseOpen = false,
  written = [],
}: {
  readonly orders: readonly ReleaseOrder[];
  readonly status?: ReleaseFacts['enrollment']['status'];
  readonly cancellationReason?: string | null;
  readonly programme?: Partial<ReleaseProgramme>;
  readonly delivered?: number;
  readonly count?: number;
  readonly caseOpen?: boolean;
  readonly written?: ReleaseFacts['written'];
}): ReleaseFacts {
  const [first = ASSESSMENT] = orders;
  return {
    enrollment: {
      enrollmentId: ENROLLMENT,
      teacherUserId: TEACHER,
      studentUserId: STUDENT,
      track: 'ijazah_track',
      status,
      sessionCount: count,
      cancellationReason,
      programme: {
        state: 'active',
        total_piasters: piasters(1_000_000),
        payByAt: PAY_BY,
        closedAt: null,
        payBlockedOpen: false,
        ...programme,
      },
    },
    order: first,
    orders,
    sessions: sessionsWith(delivered, count),
    caseReasons: [],
    caseOpen,
    written,
  };
}

const milestonesOf = (input: ReleaseFacts, now: Date = LATER) =>
  plan(input, now).map(({ milestone }) => milestone);

describe('006:T011 the assessment while the student has not continued (FR-703, R-512; B-P1 lane e follow-up)', () => {
  it('lists no `ijazah_half` for an assessment-only enrollment (count 1, session 1 delivered)', () => {
    const input = programmeFacts({
      orders: [ASSESSMENT],
      count: 1,
      programme: { state: 'awaiting_offer', total_piasters: piasters(50_000), payByAt: null },
    });
    expect(milestonesOf(input)).not.toContain('ijazah_half');
    expect(plan(input)).toEqual([]);
  });

  it('lists nothing while the offer waits for the student: offered, the 48 hours running', () => {
    expect(plan(programmeFacts({ orders: [ASSESSMENT], programme: { state: 'offered' } }))).toEqual(
      [],
    );
  });

  it('lists no `assessment` release, nor any other, while a `pay_blocked` item is open past pay_by (FR-706b)', () => {
    const input = programmeFacts({
      orders: [ASSESSMENT],
      programme: { state: 'offered', payBlockedOpen: true },
    });
    expect(plan(input)).toEqual([]);
  });

  it('never lets the `assessment` release fall due while a `pay_blocked` item is open (FR-706b)', () => {
    const input = programmeFacts({
      orders: [ASSESSMENT],
      status: 'cancelled',
      cancellationReason: 'offer_lapsed',
      programme: {
        state: 'closed',
        closedAt: new Date('2026-10-07T08:00:00Z'),
        payBlockedOpen: true,
      },
    });
    expect(plan(input)).toEqual([
      {
        milestone: 'assessment',
        amount: 35_000,
        dueAt: '2026-10-07T08:00:00.000Z',
        due: false,
        waitsForCase: false,
      },
    ]);
  });
});

describe('006:T011 the `assessment` release when the student does not continue (DEC-94: 350 of a 500 fee)', () => {
  it('on `offer_declined` falls due at pay_by, the later of the close and pay_by, after session 1’s 72 h', () => {
    const input = programmeFacts({
      orders: [ASSESSMENT],
      status: 'cancelled',
      cancellationReason: 'offer_declined',
      programme: { state: 'closed', closedAt: new Date('2026-10-03T18:00:00Z') },
    });
    expect(plan(input)).toEqual([
      {
        milestone: 'assessment',
        amount: 35_000,
        dueAt: PAY_BY.toISOString(),
        due: true,
        waitsForCase: false,
      },
    ]);
    expect(plan(input, new Date('2026-10-05T11:59:59Z'))).toMatchObject([{ due: false }]);
  });

  it('on `offer_lapsed` falls due at the close when it comes after pay_by (an item approved later)', () => {
    const input = programmeFacts({
      orders: [ASSESSMENT],
      status: 'cancelled',
      cancellationReason: 'offer_lapsed',
      programme: { state: 'closed', closedAt: new Date('2026-10-07T08:00:00Z') },
    });
    expect(plan(input)).toMatchObject([
      { milestone: 'assessment', amount: 35_000, dueAt: '2026-10-07T08:00:00.000Z', due: true },
    ]);
  });

  it('on `assessment_refused` with no offer sent falls due at the close', () => {
    const input = programmeFacts({
      orders: [ASSESSMENT],
      count: 1,
      status: 'cancelled',
      cancellationReason: 'assessment_refused',
      programme: {
        state: 'closed',
        total_piasters: piasters(50_000),
        payByAt: null,
        closedAt: new Date('2026-10-06T09:00:00Z'),
      },
    });
    expect(plan(input)).toMatchObject([
      { milestone: 'assessment', amount: 35_000, dueAt: '2026-10-06T09:00:00.000Z', due: true },
    ]);
  });

  it('waits for session 1’s 72 h when they end after the close and pay_by', () => {
    const input = programmeFacts({
      orders: [ASSESSMENT],
      count: 1,
      status: 'cancelled',
      cancellationReason: 'assessment_refused',
      programme: {
        state: 'closed',
        total_piasters: piasters(50_000),
        payByAt: null,
        closedAt: new Date('2026-10-02T09:00:00Z'),
      },
    });
    expect(plan(input)).toMatchObject([
      { milestone: 'assessment', dueAt: windowAfter(1), due: true },
    ]);
    expect(plan(input, new Date(addHours(endOf(1), 71)))).toMatchObject([{ due: false }]);
  });

  it('waits for an assessment made up: the make-up’s 72 h, not the missed session’s', () => {
    const input = programmeFacts({
      orders: [ASSESSMENT],
      count: 1,
      status: 'cancelled',
      cancellationReason: 'assessment_refused',
      programme: {
        state: 'closed',
        total_piasters: piasters(50_000),
        payByAt: null,
        closedAt: new Date('2026-10-02T09:00:00Z'),
      },
    });
    const madeUp = {
      ...input,
      sessions: [
        at(1, 'teacher_no_show'),
        { sequenceNumber: 2, endsAt: endOf(3), outcome: 'done', madeUpSequence: 1 },
      ],
    };
    expect(plan(madeUp)).toMatchObject([{ milestone: 'assessment', dueAt: windowAfter(3) }]);
  });

  it('is held while a case is open on the enrollment', () => {
    const input = programmeFacts({
      orders: [ASSESSMENT],
      status: 'cancelled',
      cancellationReason: 'offer_declined',
      programme: { state: 'closed', closedAt: new Date('2026-10-03T18:00:00Z') },
      caseOpen: true,
    });
    expect(plan(input)).toMatchObject([
      { milestone: 'assessment', due: false, waitsForCase: true },
    ]);
  });

  it('is owed once: a written `assessment` release is not planned again', () => {
    const input = programmeFacts({
      orders: [ASSESSMENT],
      status: 'cancelled',
      cancellationReason: 'offer_declined',
      programme: { state: 'closed', closedAt: new Date('2026-10-03T18:00:00Z') },
      written: [{ milestone: 'assessment', amount_piasters: piasters(35_000) }],
    });
    expect(plan(input)).toEqual([]);
  });

  it('lists no `assessment` release on any other close (a programme stopped after paying)', () => {
    const input = programmeFacts({
      orders: [ASSESSMENT, ...months(4)],
      status: 'cancelled',
      cancellationReason: 'programme_stopped',
      delivered: 12,
      programme: { state: 'closed', closedAt: new Date('2026-10-20T08:00:00Z') },
    });
    expect(milestonesOf(input)).not.toContain('assessment');
  });
});

describe('006:T011 `ijazah_half` once the student continued (FR-728, DEC-94: 25 % of the share of the price as paid)', () => {
  it('in full: 1,750 EGP (25 % × 70 % × 10,000) after the window of the 21st of 41 delivered, not the first order’s 87.50', () => {
    const input = programmeFacts({ orders: [ASSESSMENT, REST_IN_FULL], delivered: 21 });
    expect(plan(input)).toEqual([
      {
        milestone: 'ijazah_half',
        amount: 175_000,
        dueAt: windowAfter(21),
        due: true,
        waitsForCase: false,
      },
      {
        milestone: 'ijazah_end',
        amount: 525_000,
        dueAt: windowAfter(41),
        due: false,
        waitsForCase: false,
      },
    ]);
  });

  it('by months: 1,837.50 EGP (25 % × 70 % × (10,000 + the fee 500)), months 1 to 6 paid', () => {
    const input = programmeFacts({ orders: [ASSESSMENT, ...months(6)], delivered: 21 });
    expect(plan(input)).toMatchObject([
      { milestone: 'ijazah_half', amount: 183_750, dueAt: windowAfter(21), due: true },
      // The end held: the shares paid so far (35,000 + 6 × 70,000) less the half.
      { milestone: 'ijazah_end', amount: 271_250, due: false },
    ]);
  });

  it('is capped at the paid orders’ shares: months 1 and 2 paid give 35,000 + 2 × 70,000 = 175,000', () => {
    const input = programmeFacts({ orders: [ASSESSMENT, ...months(2)], delivered: 21 });
    expect(plan(input)).toMatchObject([{ milestone: 'ijazah_half', amount: 175_000 }]);
  });

  it('is capped at the paid orders’ shares less the releases written: 175,000 − a stop’s 105,000', () => {
    const input = programmeFacts({
      orders: [ASSESSMENT, ...months(2)],
      delivered: 21,
      written: [{ milestone: 'programme_stopped', amount_piasters: piasters(105_000) }],
    });
    expect(plan(input)).toMatchObject([{ milestone: 'ijazah_half', amount: 70_000 }]);
  });

  it('is held at 20 of 41 delivered, the assessment counted', () => {
    const input = programmeFacts({ orders: [ASSESSMENT, REST_IN_FULL], delivered: 20 });
    expect(plan(input)).toMatchObject([
      { milestone: 'ijazah_half', amount: 175_000, dueAt: windowAfter(21), due: false },
      { milestone: 'ijazah_end', due: false },
    ]);
  });
});

describe('006:T011 `ijazah_end` and `programme_stopped` (U-4; Q-5 (a): − every release written and the half owed)', () => {
  it('in full: the end is 5,250 EGP after the half 1,750 written', () => {
    const input = programmeFacts({
      orders: [ASSESSMENT, REST_IN_FULL],
      status: 'completed',
      delivered: 41,
      written: [{ milestone: 'ijazah_half', amount_piasters: piasters(175_000) }],
    });
    expect(plan(input)).toEqual([
      {
        milestone: 'ijazah_end',
        amount: 525_000,
        dueAt: windowAfter(41),
        due: true,
        waitsForCase: false,
      },
    ]);
  });

  it('by months, all 10 paid: the half 1,837.50 and the end 5,512.50 due together', () => {
    const input = programmeFacts({
      orders: [ASSESSMENT, ...months(10)],
      status: 'completed',
      delivered: 41,
    });
    expect(plan(input)).toMatchObject([
      { milestone: 'ijazah_half', amount: 183_750, due: true },
      { milestone: 'ijazah_end', amount: 551_250, due: true },
    ]);
  });

  it('takes off every release written, a first stop’s included, so a reopened programme never pays it again', () => {
    // Months 1 to 4 paid, stopped at 12 delivered (315,000 released), reopened, months 5 to 10 paid.
    const input = programmeFacts({
      orders: [ASSESSMENT, ...months(10)],
      status: 'completed',
      delivered: 41,
      written: [{ milestone: 'programme_stopped', amount_piasters: piasters(315_000) }],
    });
    expect(plan(input)).toMatchObject([
      { milestone: 'ijazah_half', amount: 183_750 },
      { milestone: 'ijazah_end', amount: 735_000 - 315_000 - 183_750 },
    ]);
  });

  it('takes off the teacher’s share of a refund: a month of 1,000 EGP refunded, 700 EGP off', () => {
    const [first, ...rest] = months(10);
    const input = programmeFacts({
      orders: [
        ASSESSMENT,
        { ...(first as ReleaseOrder), refunded_piasters: piasters(100_000) },
        ...rest,
      ],
      status: 'completed',
      delivered: 41,
      written: [{ milestone: 'ijazah_half', amount_piasters: piasters(183_750) }],
    });
    expect(plan(input)).toMatchObject([{ milestone: 'ijazah_end', amount: 551_250 - 70_000 }]);
  });

  it('an approved stop releases the paid orders’ shares after the last delivered session’s 72 h', () => {
    const input = programmeFacts({
      orders: [ASSESSMENT, ...months(4)],
      status: 'cancelled',
      cancellationReason: 'programme_stopped',
      delivered: 12,
      programme: { state: 'closed', closedAt: new Date('2026-10-20T08:00:00Z') },
    });
    expect(plan(input)).toEqual([
      {
        milestone: 'programme_stopped',
        amount: 315_000,
        dueAt: windowAfter(12),
        due: true,
        waitsForCase: false,
      },
    ]);
  });

  it('an approved stop after the half takes the half written off: 455,000 − 183,750', () => {
    const input = programmeFacts({
      orders: [ASSESSMENT, ...months(6)],
      status: 'cancelled',
      cancellationReason: 'programme_stopped',
      delivered: 23,
      programme: { state: 'closed', closedAt: new Date('2026-11-02T08:00:00Z') },
      written: [{ milestone: 'ijazah_half', amount_piasters: piasters(183_750) }],
    });
    expect(plan(input)).toMatchObject([
      { milestone: 'programme_stopped', amount: 271_250, dueAt: windowAfter(23), due: true },
    ]);
  });

  it('an approved stop is held while a case is open', () => {
    const input = programmeFacts({
      orders: [ASSESSMENT, ...months(4)],
      status: 'cancelled',
      cancellationReason: 'programme_stopped',
      delivered: 12,
      programme: { state: 'closed', closedAt: new Date('2026-10-20T08:00:00Z') },
      caseOpen: true,
    });
    expect(plan(input)).toMatchObject([
      { milestone: 'programme_stopped', due: false, waitsForCase: true },
    ]);
  });

  it('an approved stop falls due after the last consumed session’s window: a student no-show after the last done (FU-E2 (a))', () => {
    const stopped = programmeFacts({
      orders: [ASSESSMENT, ...months(4)],
      status: 'cancelled',
      cancellationReason: 'programme_stopped',
      delivered: 12,
      programme: { state: 'closed', closedAt: new Date('2026-10-20T08:00:00Z') },
    });
    // Session 13, the student's no-show, ends after session 12, the last done.
    const input = {
      ...stopped,
      sessions: stopped.sessions.map((one) =>
        one.sequenceNumber === 13 ? { ...one, outcome: 'student_no_show' } : one,
      ),
    };
    expect(plan(input)).toEqual([
      {
        milestone: 'programme_stopped',
        amount: 315_000,
        dueAt: windowAfter(13),
        due: true,
        waitsForCase: false,
      },
    ]);
    expect(plan(input, new Date(addHours(endOf(13), 71)))).toMatchObject([{ due: false }]);
  });
});

describe('006:T011 `package` orders keep today’s rules', () => {
  it('an ijazah package with a duplicate paid order is still judged on its first order alone (Q-B1-10 (a))', () => {
    const first = facts({ track: 'ijazah_track', status: 'confirmed', count: 10 });
    const duplicate = { ...first.order, paymentId: '0199d0a0-0000-7000-8000-000000000699' };
    const input = {
      ...first,
      orders: [first.order, duplicate],
      sessions: sessionsWith(5),
    };
    expect(plan(input)).toEqual([
      {
        milestone: 'ijazah_half',
        amount: 175_000,
        dueAt: windowAfter(5),
        due: true,
        waitsForCase: false,
      },
      {
        milestone: 'ijazah_end',
        amount: 525_000,
        dueAt: windowAfter(10),
        due: false,
        waitsForCase: false,
      },
    ]);
  });

  it('a recitation package with a duplicate paid order releases its first order’s share alone', () => {
    const first = facts();
    const duplicate = { ...first.order, paymentId: '0199d0a0-0000-7000-8000-000000000699' };
    expect(plan({ ...first, orders: [first.order, duplicate] })).toMatchObject([
      { milestone: 'recitation_end', amount: 700_000 },
    ]);
  });
});

describe('006:T012 a programme’s close on a complaint against the student releases each session by its own order (R-512, G-3)', () => {
  /**
   * Session 1 the assessment, then sessions 2 to `last` with their months (`months[k]` for session
   * k + 2); the first `taken` delivered, the rest cancelled at the close.
   */
  const closedSessions = (
    last: number,
    taken: number,
    months: readonly number[],
  ): ReleaseSession[] =>
    Array.from({ length: last }, (_, index) => {
      const month = index === 0 ? undefined : months[index - 1];
      return {
        ...at(index + 1, index < taken ? 'done' : 'cancelled_by_admin'),
        ...(month === undefined ? {} : { programmeMonth: month }),
      };
    });
  const closedOn = (
    orders: readonly ReleaseOrder[],
    sessions: readonly ReleaseSession[],
  ): ReleaseFacts => {
    const [first = ASSESSMENT] = orders;
    return {
      enrollment: {
        enrollmentId: ENROLLMENT,
        teacherUserId: TEACHER,
        studentUserId: STUDENT,
        track: 'ijazah_track',
        status: 'cancelled',
        sessionCount: sessions.length,
        cancellationReason: 'admin',
        programme: {
          state: 'closed',
          total_piasters: piasters(1_000_000),
          payByAt: PAY_BY,
          closedAt: new Date('2026-11-01T08:00:00Z'),
          payBlockedOpen: false,
        },
      },
      order: first,
      orders,
      sessions,
      caseReasons: ['student_complaint_ended'],
      caseOpen: false,
      written: [],
    };
  };
  /** Months of 4: offer session k in month ⌈k ÷ 4⌉. */
  const inMonthsOf4 = (count: number): number[] =>
    Array.from({ length: count }, (_, index) => Math.floor(index / 4) + 1);

  it('in full, the assessment and 5 sessions taken: 350 + 5 × 166.25 = 1,181.25 EGP, not the first order’s 51.22', () => {
    expect(
      plan(closedOn([ASSESSMENT, REST_IN_FULL], closedSessions(41, 6, inMonthsOf4(40)))),
    ).toEqual([
      {
        milestone: 'student_complaint_close',
        amount: 118_125,
        dueAt: windowAfter(6),
        due: true,
        waitsForCase: false,
      },
    ]);
  });

  it('a second paid order for month 1 shifts no later month (FR-718): month 2, the last of 2 sessions, is valued by its own order', () => {
    // An offer of 6 sessions: month 1 four (1,000 EGP, share 700), month 2 two (500 EGP, share 350).
    const month1 = programmeOrder(2, 'instalment', 100_000, 70_000);
    const duplicate = { ...month1, paymentId: '0199d0a0-0000-7000-8000-000000000698' };
    const month2 = programmeOrder(3, 'instalment', 50_000, 35_000);
    expect(
      plan(
        closedOn([ASSESSMENT, month1, duplicate, month2], closedSessions(7, 6, [1, 1, 1, 1, 2, 2])),
      ),
    ).toMatchObject([
      // 350 + 4 × 175 + 1 × 175 EGP: month 2's session is 350 ÷ 2, not the duplicate's 700 ÷ 2.
      { milestone: 'student_complaint_close', amount: 35_000 + 70_000 + 17_500 },
    ]);
  });
});

describe('006:T011 FU-E3 a programme enrollment with no programme row (should not happen)', () => {
  const withoutRow = (input: ReleaseFacts): ReleaseFacts => ({
    ...input,
    enrollment: { ...input.enrollment, programme: null },
  });

  it('gives no half by months either (not 25 % × 70 % × the fee 500 = 87.50), the end holding every paid share', () => {
    const input = withoutRow(programmeFacts({ orders: [ASSESSMENT, ...months(6)], delivered: 21 }));
    expect(plan(input)).toEqual([
      {
        milestone: 'ijazah_end',
        amount: 455_000,
        dueAt: windowAfter(41),
        due: false,
        waitsForCase: false,
      },
    ]);
  });

  it('gives no half in full either', () => {
    const input = withoutRow(programmeFacts({ orders: [ASSESSMENT, REST_IN_FULL], delivered: 21 }));
    expect(milestonesOf(input)).toEqual(['ijazah_end']);
  });

  it('is told by `programmeRowMissing`: a programme’s orders and no row', () => {
    const programme = programmeFacts({ orders: [ASSESSMENT, REST_IN_FULL] });
    expect(programmeRowMissing(withoutRow(programme))).toBe(true);
    expect(programmeRowMissing(programme)).toBe(false);
    expect(programmeRowMissing(facts({ track: 'ijazah_track' }))).toBe(false);
  });
});

describe('the open points, each behind one function (Q-B1-1 to Q-B1-5)', () => {
  const order = facts().order;
  const refunded = { ...order, refunded_piasters: piasters(100_000) };

  it('Q-B1-1 (a): takes the teacher’s share of the refund off an end', () => {
    expect(toPlainNumber(takenOffAtEnd(refunded))).toBe(70_000);
  });

  it('«عليه»: the teacher’s share of a refund is the refund × the order’s rate, rounded up (Q-6)', () => {
    expect(toPlainNumber(refundShareOf(refunded))).toBe(70_000);
    expect(toPlainNumber(refundShareOf({ ...order, refunded_piasters: piasters(1_001) }))).toBe(
      701,
    );
    expect(toPlainNumber(refundShareOf(order))).toBe(0);
  });

  it('Q-B1-2 (a): the half is reached at 5 of 9 and 5 of 10, not at 4', () => {
    expect([halfReached(4, 9), halfReached(5, 9), halfReached(4, 10), halfReached(5, 10)]).toEqual([
      false,
      true,
      false,
      true,
    ]);
  });

  it('Q-B1-3 (a): the half waits for the dispute window', () => {
    expect(halfWindowHours(WINDOW)).toBe(72);
  });

  it('Q-B1-5 (a): a close’s amount is its sessions’ share less earlier releases, never below nothing', () => {
    const released: Piasters[] = [piasters(175_000)];
    expect(toPlainNumber(complaintCloseAmount(piasters(420_000), released))).toBe(245_000);
    expect(toPlainNumber(complaintCloseAmount(piasters(100_000), released))).toBe(0);
  });
});

// 006:T010 of specs/006-programme (FR-728; research R-501, R-512's trigger; SRS DEC-94): the half
// is counted over the enrollment's N+1 snapshot count, the assessment its session 1 (40 + 1 = 41,
// the half at 21), never over the session rows that exist: a programme's months are generated one
// paid month at a time. A pin of today's rule.
describe('the ijazah half over the N+1 snapshot count (006:T010, DEC-94: 41 → 21)', () => {
  it('reaches the half at 21 of 41, not at 20', () => {
    expect([halfReached(20, 41), halfReached(21, 41)]).toEqual([false, true]);
  });

  it('counts the snapshot’s 41, not the 21 rows of the months generated so far: 11 delivered hold the half, estimated at the 21st', () => {
    const sessions = sessionsWith(11, 21);
    expect(
      plan(facts({ track: 'ijazah_track', status: 'confirmed', count: 41, sessions })),
    ).toMatchObject([
      { milestone: 'ijazah_half', due: false, dueAt: windowAfter(21) },
      { milestone: 'ijazah_end' },
    ]);
  });

  it('falls due at the 21st of 41 delivered, after its window, and not at the 20th', () => {
    const at20 = facts({
      track: 'ijazah_track',
      status: 'confirmed',
      count: 41,
      sessions: sessionsWith(20, 25),
    });
    const at21 = { ...at20, sessions: sessionsWith(21, 25) };
    expect(plan(at20)).toMatchObject([
      { milestone: 'ijazah_half', due: false },
      { milestone: 'ijazah_end' },
    ]);
    expect(plan(at21)).toMatchObject([
      { milestone: 'ijazah_half', due: true, dueAt: windowAfter(21) },
      { milestone: 'ijazah_end' },
    ]);
  });
});
