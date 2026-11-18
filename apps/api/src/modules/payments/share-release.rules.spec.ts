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
  type ReleaseFacts,
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
  return {
    enrollment: {
      enrollmentId: ENROLLMENT,
      teacherUserId: TEACHER,
      studentUserId: STUDENT,
      track,
      status,
      sessionCount: count,
    },
    order: {
      paymentId: PAYMENT,
      share_piasters: piasters(700_000),
      sharePercent: 70,
      halfPercent: track === 'ijazah_track' ? 25 : null,
      refunded_piasters: piasters(0),
    },
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
  { sequenceNumber: 11, endsAt: new Date(addHours(endOf(4), 6)), outcome: 'done', madeUpSequence: 3 },
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
