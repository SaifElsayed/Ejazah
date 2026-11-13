// T071 of specs/004-sessions/tasks.md (FR-504; SRS FR-SESS-16 as amended; research R-313; the two
// notes under T071, Q5 (a) widened and Q6 (a)) — what a teacher's suspension that pauses owes, over
// a recorded store, enrollment side and offer:
//
//   - `closePausedCaseOnEnd`: an end of a paused enrollment closes its open `teacher_suspended`
//     case `resolved`, `compensation_ordered`, the fixed note `ended_meanwhile`, covered by the
//     end's case, by the ending administrator, with one info line of ids; no open case, nothing;
//   - `createTeacherReinstatement`: the paused enrollments' students read with no lock
//     (`studentsOf`); then, the accounts held by identity, the teacher's slots' key, the paused
//     enrollments in one call, each read again under its lock, the sessions the suspension cancelled
//     in one call, their remedies, each offered through T028's `offerLocked` with
//     `clearedSuspension`, then each case closed `resolved` with the note `reinstated`; no free
//     week refuses the whole reinstatement `CONFLICT` `no_free_week`, closing nothing.
// Over the real tables: `tests/db-integrity/teacher-suspension-pause.spec.ts`.
import type { LocalDate } from '@ijazah/time';
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { isRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { CaseClosing } from '../moderation/index.js';
import type {
  EnrollmentPageFilter,
  EnrollmentPageItem,
  EnrollmentStatus,
  EnrollmentTerms,
} from './enrollment-side.port.js';
import type { Offered, OfferOptions } from './remedy-offer.service.js';
import {
  closePausedCaseOnEnd,
  createTeacherReinstatement,
  type PausedCaseStore,
  type TeacherReinstatementStore,
} from './teacher-suspension.service.js';

const tx = {} as Transaction;
const id = (n: number) => `0199d0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const ADMIN = id(1);
const TEACHER = id(900);
const STUDENT_A = id(901);
const STUDENT_B = id(902);
const STUDENT_C = id(903);
const E1 = id(801);
const E2 = id(802);
const E3 = id(803);
const CASE_1 = id(501);
const CASE_2 = id(502);
const END_CASE = id(510);
const CLOSED_AT = new Date('2026-11-13T09:00:00.120Z');

describe('closePausedCaseOnEnd: an end of a paused enrollment closes its teacher_suspended case (Q5 (a) widened)', () => {
  function over(open: string | null, closes = true) {
    const calls: unknown[][] = [];
    const lines: [string, unknown][] = [];
    const store: PausedCaseStore = {
      pausedCaseOf: async (_tx, enrollmentId) => {
        calls.push(['pausedCaseOf', enrollmentId]);
        return open;
      },
      closeCase: async (_tx, caseId, closing) => {
        calls.push(['closeCase', caseId, closing]);
        return closes ? CLOSED_AT : null;
      },
    };
    const log = { info: (fields: unknown, message?: string) => void lines.push([message ?? '', fields]) };
    return { store, log, calls, lines };
  }

  it('closes it resolved, compensation_ordered, ended_meanwhile, covered by the end’s case, by the ending administrator, with one info line of ids', async () => {
    const { store, log, calls, lines } = over(CASE_1);
    expect(
      await closePausedCaseOnEnd(tx, store, log, {
        adminId: ADMIN,
        enrollmentId: E1,
        endCaseId: END_CASE,
        end: 'banned',
      }),
    ).toBe(CASE_1);
    expect(calls).toEqual([
      ['pausedCaseOf', E1],
      [
        'closeCase',
        CASE_1,
        {
          status: 'resolved',
          resolution: 'compensation_ordered',
          note: 'ended_meanwhile',
          adminId: ADMIN,
          coveredBy: END_CASE,
        },
      ],
    ]);
    expect(lines).toEqual([
      [
        'A paused enrollment’s teacher_suspended case closed by its end',
        { adminId: ADMIN, enrollmentId: E1, caseId: CASE_1, coveredByCaseId: END_CASE, end: 'banned' },
      ],
    ]);
  });

  it('writes no link when the end opened no case', async () => {
    const { store, log, calls } = over(CASE_1);
    await closePausedCaseOnEnd(tx, store, log, {
      adminId: ADMIN,
      enrollmentId: E1,
      endCaseId: null,
      end: 'account_deleted',
    });
    expect(calls.at(-1)).toEqual([
      'closeCase',
      CASE_1,
      { status: 'resolved', resolution: 'compensation_ordered', note: 'ended_meanwhile', adminId: ADMIN },
    ]);
  });

  it('closes nothing and writes no line on an enrollment with no open teacher_suspended case', async () => {
    const { store, log, calls, lines } = over(null);
    expect(
      await closePausedCaseOnEnd(tx, store, log, {
        adminId: ADMIN,
        enrollmentId: E1,
        endCaseId: END_CASE,
        end: 'banned',
      }),
    ).toBeNull();
    expect(calls).toEqual([['pausedCaseOf', E1]]);
    expect(lines).toEqual([]);
  });

  it('throws when the case read open under the enrollment’s lock does not close', async () => {
    const { store, log } = over(CASE_1, false);
    await expect(
      closePausedCaseOnEnd(tx, store, log, {
        adminId: ADMIN,
        enrollmentId: E1,
        endCaseId: END_CASE,
        end: 'banned',
      }),
    ).rejects.toThrow(/did not close/);
  });
});

interface Paused {
  readonly id: string;
  readonly studentUserId: string;
  /** The open `teacher_suspended` case as each read answers it; null for none. */
  readonly cases: readonly (string | null)[];
  /** The status as the read under the lock answers it. */
  readonly statusUnderLock?: EnrollmentStatus;
  readonly sessions?: readonly string[];
}

function reinstatementOver(
  paused: readonly Paused[],
  noFreeWeek: readonly string[] = [],
  /** T071, Q-B1 (a): the students whose accounts are suspended. */
  suspendedStudents: readonly string[] = [],
) {
  const calls: unknown[][] = [];
  const lines: [string, string, unknown][] = [];
  const caseReads = new Map(paused.map((one) => [one.id, [...one.cases]]));
  const items: EnrollmentPageItem[] = paused.map((one) => ({
    enrollmentId: one.id,
    studentUserId: one.studentUserId,
    teacherUserId: TEACHER,
    status: 'confirmed',
    track: 'recitation',
    sessionCount: 4,
  }));
  const store: TeacherReinstatementStore = {
    pausedCaseOf: async (_tx, enrollmentId) => {
      calls.push(['pausedCaseOf', enrollmentId]);
      return caseReads.get(enrollmentId)?.shift() ?? null;
    },
    closeCase: async (_tx, caseId, closing: CaseClosing) => {
      calls.push(['closeCase', caseId, closing]);
      return CLOSED_AT;
    },
    lockTeacherSlots: async (_tx, teacher) => void calls.push(['lockTeacherSlots', teacher]),
    lockSessions: async (_tx, ids) => void calls.push(['lockSessions', ids]),
    lockRemediesOfSessions: async (_tx, ids) => void calls.push(['lockRemediesOfSessions', ids]),
    accountStatusOf: async (_tx, userId) => {
      calls.push(['accountStatusOf', userId]);
      return suspendedStudents.includes(userId) ? 'suspended' : 'active';
    },
    sessionsToOffer: async (_tx, caseId) => {
      calls.push(['sessionsToOffer', caseId]);
      return paused.find((one) => one.cases[0] === caseId)?.sessions ?? [];
    },
  };
  const terms = (one: Paused): EnrollmentTerms => ({
    id: one.id,
    status: one.statusUnderLock ?? 'confirmed',
    slotId: id(700),
    track: 'recitation',
    timezone: 'Africa/Cairo',
    durationMinutes: 60,
    sessionCount: 4,
    studentUserId: one.studentUserId,
    teacherUserId: TEACHER,
  });
  const enrollments = {
    enrollmentPage: async (_tx: Transaction, filter: EnrollmentPageFilter, cursor?: string) => {
      calls.push(['enrollmentPage', filter, cursor]);
      // Two pages: the first item, then the rest.
      return cursor === undefined && items.length > 1
        ? { items: items.slice(0, 1), nextCursor: items[0]?.enrollmentId ?? '' }
        : { items: cursor === undefined ? items : items.slice(1) };
    },
    lockEnrollments: async (_tx: Transaction, ids: readonly string[]) =>
      void calls.push(['lockEnrollments', ids]),
    enrollmentFor: async (_tx: Transaction, enrollmentId: string) => {
      calls.push(['enrollmentFor', enrollmentId]);
      const one = paused.find((paused) => paused.id === enrollmentId);
      return one === undefined ? null : terms(one);
    },
  };
  const offers = {
    offerLocked: async (
      _tx: Transaction,
      sessionId: string,
      options?: OfferOptions,
    ): Promise<Offered | null> => {
      calls.push(['offerLocked', sessionId, options]);
      if (noFreeWeek.includes(sessionId)) return null;
      return {
        remedyId: `remedy-of-${sessionId}`,
        sessionId,
        enrollmentId: paused.find((one) => one.sessions?.includes(sessionId))?.id ?? '',
        status: 'awaiting_choice',
        proposedDate: '2026-12-10' as LocalDate,
        reoffered: false,
      };
    },
  };
  const log = {
    info: (fields: unknown, message?: string) => void lines.push(['info', message ?? '', fields]),
    warn: (fields: unknown, message?: string) => void lines.push(['warn', message ?? '', fields]),
  };
  const reinstatement = createTeacherReinstatement({ enrollments, offers, log, store });
  const writes = () =>
    calls.filter(([name]) => name === 'offerLocked' || name === 'closeCase');
  return { reinstatement, calls, lines, writes };
}

const S11 = id(11);
const S12 = id(12);
const S21 = id(21);

const TWO_PAUSED: readonly Paused[] = [
  { id: E2, studentUserId: STUDENT_B, cases: [CASE_2, CASE_2, CASE_2], sessions: [S21] },
  { id: E1, studentUserId: STUDENT_A, cases: [CASE_1, CASE_1, CASE_1], sessions: [S12, S11] },
];

async function refusalOf(call: Promise<unknown>): Promise<DomainError> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(thrown instanceof DomainError)) throw new Error(`expected a DomainError, got ${String(thrown)}`);
  return thrown;
}

describe('the reinstatement’s students, read with no lock (Q6 (a))', () => {
  it('pages the teacher’s confirmed enrollments and answers the students of those with an open teacher_suspended case, sorted and once each', async () => {
    const { reinstatement, calls } = reinstatementOver([
      ...TWO_PAUSED,
      { id: E3, studentUserId: STUDENT_C, cases: [null] },
    ]);
    expect(await reinstatement.studentsOf(tx, TEACHER)).toEqual([STUDENT_A, STUDENT_B]);
    expect(calls.filter(([name]) => name === 'enrollmentPage')).toEqual([
      ['enrollmentPage', { status: 'confirmed', teacherUserIds: [TEACHER] }, undefined],
      ['enrollmentPage', { status: 'confirmed', teacherUserIds: [TEACHER] }, E2],
    ]);
    expect(calls.some(([name]) => /^lock/.test(String(name)))).toBe(false);
  });
});

describe('the reinstatement resumes the paused enrollments (FR-504; kernel.md, the reinstatement’s row)', () => {
  it('takes the key, the enrollments in one call, reads each again, the sessions and their remedies in one call each, offers each in id order with clearedSuspension, then closes each case reinstated', async () => {
    const { reinstatement, calls } = reinstatementOver(TWO_PAUSED);
    await reinstatement.resume(tx, ADMIN, TEACHER, [STUDENT_A, STUDENT_B, TEACHER].sort());
    const closing = { status: 'resolved', resolution: 'compensation_ordered', note: 'reinstated', adminId: ADMIN };
    expect(calls.filter(([name]) => name !== 'enrollmentPage')).toEqual([
      ['pausedCaseOf', E2],
      ['pausedCaseOf', E1],
      ['lockTeacherSlots', TEACHER],
      ['lockEnrollments', [E1, E2]],
      ['enrollmentFor', E1],
      ['pausedCaseOf', E1],
      ['enrollmentFor', E2],
      ['pausedCaseOf', E2],
      // Q-B1 (a): each student's standing, under the accounts' locks, before any offer.
      ['accountStatusOf', STUDENT_A],
      ['accountStatusOf', STUDENT_B],
      ['sessionsToOffer', CASE_1],
      ['sessionsToOffer', CASE_2],
      ['lockSessions', [S11, S12, S21]],
      ['lockRemediesOfSessions', [S11, S12, S21]],
      ['offerLocked', S11, { clearedSuspension: true }],
      ['offerLocked', S12, { clearedSuspension: true }],
      ['offerLocked', S21, { clearedSuspension: true }],
      ['closeCase', CASE_1, closing],
      ['closeCase', CASE_2, closing],
    ]);
  });

  it('writes each offer’s line and one info line of ids and counts', async () => {
    const { reinstatement, lines } = reinstatementOver(TWO_PAUSED);
    await reinstatement.resume(tx, ADMIN, TEACHER, [STUDENT_A, STUDENT_B, TEACHER].sort());
    expect(lines).toEqual([
      ...[S11, S12, S21].map((sessionId) => [
        'info',
        'Remedy offered',
        {
          remedyId: `remedy-of-${sessionId}`,
          sessionId,
          enrollmentId: sessionId === S21 ? E2 : E1,
          action: 'offered',
        },
      ]),
      [
        'info',
        'A teacher’s reinstatement resumed the paused enrollments',
        {
          adminId: ADMIN,
          teacherUserId: TEACHER,
          enrollments: 2,
          offeredSessions: 3,
          closedCaseIds: [CASE_1, CASE_2],
        },
      ],
    ]);
  });

  it('refuses the whole reinstatement CONFLICT no_free_week when an offer finds no free week, closing nothing, one line of ids', async () => {
    const { reinstatement, calls, lines } = reinstatementOver(TWO_PAUSED, [S12]);
    const refused = await refusalOf(
      reinstatement.resume(tx, ADMIN, TEACHER, [STUDENT_A, STUDENT_B, TEACHER].sort()),
    );
    expect(refused.code).toBe('CONFLICT');
    expect(refused.details).toEqual([{ path: 'cause', code: 'no_free_week' }]);
    expect(isRefusalLogged(refused)).toBe(true);
    expect(calls.some(([name]) => name === 'closeCase')).toBe(false);
    expect(calls.filter(([name]) => name === 'offerLocked').map(([, sessionId]) => sessionId)).toEqual([
      S11,
      S12,
    ]);
    expect(lines).toEqual([
      [
        'info',
        'A teacher’s reinstatement was refused',
        {
          adminId: ADMIN,
          teacherUserId: TEACHER,
          enrollmentId: E1,
          sessionId: S12,
          errorCode: 'CONFLICT',
          reason: 'no_free_week',
        },
      ],
    ]);
  });

  it('leaves out an enrollment no longer confirmed, or whose case closed, once its lock is held', async () => {
    const { reinstatement, calls } = reinstatementOver([
      { id: E1, studentUserId: STUDENT_A, cases: [CASE_1, CASE_1, CASE_1], sessions: [S11], statusUnderLock: 'terminated_no_show' },
      // Read open with no lock, closed meanwhile once the enrollment's lock is held.
      { id: E2, studentUserId: STUDENT_B, cases: [CASE_2, null], sessions: [S21] },
    ]);
    await reinstatement.resume(tx, ADMIN, TEACHER, [STUDENT_A, STUDENT_B, TEACHER].sort());
    expect(calls.some(([name]) => name === 'offerLocked' || name === 'closeCase')).toBe(false);
    expect(calls.some(([name]) => name === 'lockSessions')).toBe(false);
  });

  it('throws before any write, with one warn line of ids, on a paused enrollment whose student identity did not lock', async () => {
    const { reinstatement, writes, lines } = reinstatementOver(TWO_PAUSED);
    await expect(
      reinstatement.resume(tx, ADMIN, TEACHER, [STUDENT_A, TEACHER].sort()),
    ).rejects.toThrow(/not locked/);
    expect(writes()).toEqual([]);
    expect(lines).toEqual([
      [
        'warn',
        'A teacher’s reinstatement found a paused enrollment whose student was not locked',
        { adminId: ADMIN, teacherUserId: TEACHER, enrollmentId: E2, studentUserId: STUDENT_B },
      ],
    ]);
  });

  it('with nothing paused takes no lock, writes nothing and one line with zero counts', async () => {
    const { reinstatement, calls, lines } = reinstatementOver([]);
    await reinstatement.resume(tx, ADMIN, TEACHER, [TEACHER]);
    expect(calls.filter(([name]) => name !== 'enrollmentPage')).toEqual([]);
    expect(lines).toEqual([
      [
        'info',
        'A teacher’s reinstatement resumed the paused enrollments',
        { adminId: ADMIN, teacherUserId: TEACHER, enrollments: 0, offeredSessions: 0, closedCaseIds: [] },
      ],
    ]);
  });
});

// T071 (Q-B1 (a), the review session's ruling of 2026-11-13; T036's `STUDENT_SUSPENDED` its
// precedent): a reinstatement while a paused enrollment's student is suspended is refused
// `STUDENT_SUSPENDED`, the student's standing read under the accounts' locks before any offer,
// writing nothing, one info line of ids; it answered `no_free_week` before.
describe('the reinstatement while a paused enrollment’s student is suspended (Q-B1 (a))', () => {
  it('refuses STUDENT_SUSPENDED before any offer, writing nothing, one line of ids', async () => {
    // T028's offer postpones every session of a suspended student (C3).
    const { reinstatement, calls, lines } = reinstatementOver(TWO_PAUSED, [S21], [STUDENT_B]);
    const refused = await refusalOf(
      reinstatement.resume(tx, ADMIN, TEACHER, [STUDENT_A, STUDENT_B, TEACHER].sort()),
    );
    expect(refused.code).toBe('STUDENT_SUSPENDED');
    expect(refused.details).toBeUndefined();
    expect(isRefusalLogged(refused)).toBe(true);
    expect(
      calls.some(([name]) => ['lockSessions', 'offerLocked', 'closeCase'].includes(String(name))),
    ).toBe(false);
    expect(lines).toEqual([
      [
        'info',
        'A teacher’s reinstatement was refused',
        {
          adminId: ADMIN,
          teacherUserId: TEACHER,
          enrollmentId: E2,
          studentUserId: STUDENT_B,
          errorCode: 'STUDENT_SUSPENDED',
          reason: 'student_suspended',
        },
      ],
    ]);
  });
});
