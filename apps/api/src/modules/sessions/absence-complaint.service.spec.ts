// T060 of specs/004-sessions/tasks.md — `sessions.complaint.raise`'s rules over a recorded store
// (FR-452, FR-495; research R-322, «The complaint»; contracts/app-surface.md, "`sessions.complaint`";
// contracts/kernel.md, the row «a student's complaint raised»). What the database holds (two raised
// at once leaving one open) is `tests/db-integrity/absence-complaint.spec.ts`'.
//
// The enrollment read with no lock to learn its student; then the student's `users` row and the
// enrollment, in that order, and the enrollment read again under them (rule 1); then the refusals
// (not the caller's as its student, or a teacher of the other gender by the server's records,
// NOT_FOUND; not `confirmed`, CONFLICT `enrollment_not_confirmed`), each writing nothing and one
// line marked «logged»; else the complaint opened through moderation and one `complaint_raised`
// event naming it, with no session. A second, refused by the one-open rule, rolls its transaction
// back and answers COMPLAINT_OPEN with the open one's id, read in a new transaction.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { isRefusalLogged } from '../../platform/errors/logged-refusal.js';
import { createLogger } from '../../platform/logging/logger.js';
import {
  type AbsenceComplaintStore,
  createAbsenceComplaint,
} from './absence-complaint.service.js';
import type { EnrollmentStatus, EnrollmentTerms } from './enrollment-side.port.js';
import type { PartyStanding } from './sessions.service.js';

const STUDENT = '0199d0a0-0000-7000-8000-00000000f001';
const TEACHER = '0199d0a0-0000-7000-8000-00000000f002';
const STRANGER = '0199d0a0-0000-7000-8000-00000000f003';
const ENROLLMENT = '0199d0a0-0000-7000-8000-00000000f0e1';
const COMPLAINT = '0199d0a0-0000-7000-8000-00000000f0d1';
const AT = new Date('2026-11-11T08:00:00Z');
const REASON = 'غاب المعلم عن حصتين متتاليتين';

function terms(status: EnrollmentStatus = 'confirmed'): EnrollmentTerms {
  return {
    id: ENROLLMENT,
    status,
    slotId: '0199d0a0-0000-7000-8000-00000000f051',
    track: 'recitation',
    timezone: 'Africa/Cairo',
    durationMinutes: 60,
    sessionCount: 4,
    studentUserId: STUDENT,
    teacherUserId: TEACHER,
  };
}

const standing = (gender: 'male' | 'female' = 'female'): PartyStanding => ({
  gender,
  accountStatus: 'active',
  teacherApproved: false,
  displayName: 'Probe',
});

interface Given {
  /** The enrollment as the first and the second read answer it. */
  readonly reads?: readonly (EnrollmentTerms | null)[];
  readonly teacherGender?: 'male' | 'female';
  /** The insert's answer: the id, or null when one is open. */
  readonly opened?: string | null;
  readonly openFound?: string | null;
  readonly insertFails?: Error;
}

function world(given: Given = {}) {
  const calls: unknown[][] = [];
  const lines: Record<string, unknown>[] = [];
  const outcomes: ('committed' | 'rolled back')[] = [];
  const reads = [...(given.reads ?? [terms(), terms()])];
  const store: AbsenceComplaintStore = {
    lockStudent: async (_tx, userId) => void calls.push(['lockStudent', userId]),
    partiesOf: async (_tx, ids) => {
      calls.push(['partiesOf', ids]);
      return new Map([
        [STUDENT, standing()],
        [TEACHER, { ...standing(given.teacherGender ?? 'female'), teacherApproved: true }],
      ]);
    },
    openComplaint: async (_tx, enrollmentId, studentUserId, reason) => {
      calls.push(['openComplaint', enrollmentId, studentUserId, reason]);
      if (given.insertFails !== undefined) throw given.insertFails;
      return given.opened === undefined ? COMPLAINT : given.opened;
    },
    openComplaintOf: async (_tx, enrollmentId) => {
      calls.push(['openComplaintOf', enrollmentId]);
      return given.openFound === undefined ? COMPLAINT : given.openFound;
    },
    recordEvents: async (_tx, events) => void calls.push(['recordEvents', events]),
  };
  const raise = createAbsenceComplaint({
    transactions: {
      run: async <T>(work: (tx: Transaction) => Promise<T>): Promise<T> => {
        calls.push(['transaction']);
        try {
          const result = await work({} as Transaction);
          outcomes.push('committed');
          return result;
        } catch (error) {
          outcomes.push('rolled back');
          throw error;
        }
      },
    },
    enrollments: {
      enrollmentFor: async (_tx, id) => {
        calls.push(['enrollmentFor', id]);
        return reads.shift() ?? null;
      },
      lockEnrollments: async (_tx, ids) => void calls.push(['lockEnrollments', ids]),
    },
    clock: async () => {
      calls.push(['clock']);
      return AT;
    },
    store,
  });
  const log = createLogger({
    level: 'info',
    destination: { write: (line) => lines.push(JSON.parse(line) as Record<string, unknown>) },
  });
  const raiseAs = (userId: string, reason = REASON) =>
    raise.raise({ userId }, { enrollmentId: ENROLLMENT, reason }, log);
  const writes = () =>
    calls.filter(([name]) => name === 'openComplaint' || name === 'recordEvents');
  const ownFields = (record: Record<string, unknown>) => {
    const { level, time, pid, hostname, msg, ...own } = record;
    void [level, time, pid, hostname, msg];
    return own;
  };
  return { calls, lines, outcomes, raiseAs, writes, ownFields };
}

async function refusalOf(attempt: Promise<unknown>) {
  const thrown: unknown = await attempt.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(thrown instanceof DomainError)) throw new Error(`expected a refusal, got ${String(thrown)}`);
  return { code: thrown.code, details: thrown.details, logged: isRefusalLogged(thrown) };
}

describe('sessions.complaint.raise (FR-452)', () => {
  it('locks the student, then the enrollment, reads it again, opens the complaint and writes one complaint_raised event with no session', async () => {
    const given = world();
    expect(await given.raiseAs(STUDENT)).toEqual({ complaintId: COMPLAINT, status: 'open' });
    expect(given.calls).toEqual([
      ['transaction'],
      ['enrollmentFor', ENROLLMENT],
      ['lockStudent', STUDENT],
      ['lockEnrollments', [ENROLLMENT]],
      ['enrollmentFor', ENROLLMENT],
      ['partiesOf', [STUDENT, TEACHER]],
      ['openComplaint', ENROLLMENT, STUDENT, REASON],
      ['clock'],
      [
        'recordEvents',
        [
          {
            enrollmentId: ENROLLMENT,
            sessionId: null,
            kind: 'complaint_raised',
            caseId: COMPLAINT,
            occurredAt: AT,
          },
        ],
      ],
    ]);
    expect(given.outcomes).toEqual(['committed']);
    expect(given.lines.map((line) => line['msg'])).toEqual([
      'A complaint of the teacher’s absence was raised',
    ]);
    expect(given.ownFields(given.lines[0] ?? {})).toEqual({
      enrollmentId: ENROLLMENT,
      complaintId: COMPLAINT,
      userId: STUDENT,
    });
  });

  it.each([
    ['no such enrollment', STUDENT, { reads: [null] }, 'not_the_student'],
    ['the enrollment’s teacher', TEACHER, {}, 'not_the_student'],
    ['another enrollment’s student', STRANGER, {}, 'not_the_student'],
    ['a teacher of the other gender by the records', STUDENT, { teacherGender: 'male' }, 'gender_differs'],
    ['an enrollment gone under the lock', STUDENT, { reads: [terms(), null] }, 'not_the_student'],
  ] as const)('answers %s NOT_FOUND, writing nothing, in one line', async (_name, caller, given, reason) => {
    const one = world(given as Given);
    const refused = await refusalOf(one.raiseAs(caller));
    expect(refused).toEqual({ code: 'NOT_FOUND', details: undefined, logged: true });
    expect(one.writes()).toEqual([]);
    expect(one.outcomes).toEqual(['rolled back']);
    expect(one.lines.map(one.ownFields)).toEqual([
      { enrollmentId: ENROLLMENT, userId: caller, errorCode: 'NOT_FOUND', reason },
    ]);
  });

  it('takes no lock for a caller who is not the enrollment’s student', async () => {
    const one = world();
    await refusalOf(one.raiseAs(TEACHER));
    expect(one.calls).toEqual([['transaction'], ['enrollmentFor', ENROLLMENT]]);
  });

  it.each(['pending_payment', 'completed', 'terminated_no_show', 'cancelled'] as const)(
    'refuses a %s enrollment CONFLICT enrollment_not_confirmed, read under the locks, writing nothing',
    async (status) => {
      const one = world({ reads: [terms(), terms(status)] });
      expect(await refusalOf(one.raiseAs(STUDENT))).toEqual({
        code: 'CONFLICT',
        details: [{ path: 'cause', code: 'enrollment_not_confirmed' }],
        logged: true,
      });
      expect(one.writes()).toEqual([]);
      expect(one.lines.map(one.ownFields)).toEqual([
        {
          enrollmentId: ENROLLMENT,
          userId: STUDENT,
          errorCode: 'CONFLICT',
          reason: 'enrollment_not_confirmed',
        },
      ]);
    },
  );

  it('answers a second COMPLAINT_OPEN with the open one’s id, read in a new transaction after the rollback', async () => {
    const one = world({ opened: null });
    expect(await refusalOf(one.raiseAs(STUDENT))).toEqual({
      code: 'COMPLAINT_OPEN',
      details: [{ path: 'complaintId', code: COMPLAINT }],
      logged: true,
    });
    expect(one.outcomes).toEqual(['rolled back', 'committed']);
    expect(one.calls.slice(-3)).toEqual([
      ['openComplaint', ENROLLMENT, STUDENT, REASON],
      ['transaction'],
      ['openComplaintOf', ENROLLMENT],
    ]);
    expect(one.calls.some(([name]) => name === 'recordEvents')).toBe(false);
    expect(one.lines.map(one.ownFields)).toEqual([
      {
        enrollmentId: ENROLLMENT,
        userId: STUDENT,
        errorCode: 'COMPLAINT_OPEN',
        reason: 'complaint_open',
      },
    ]);
  });

  it('answers COMPLAINT_OPEN with no id when the open one closed before it was read', async () => {
    const one = world({ opened: null, openFound: null });
    expect(await refusalOf(one.raiseAs(STUDENT))).toEqual({
      code: 'COMPLAINT_OPEN',
      details: undefined,
      logged: true,
    });
  });

  it('throws any other failure of the insert as it is, with no refusal line', async () => {
    const failure = new Error('the database went away');
    const one = world({ insertFails: failure });
    await expect(one.raiseAs(STUDENT)).rejects.toBe(failure);
    expect(one.outcomes).toEqual(['rolled back']);
    expect(one.lines).toEqual([]);
  });
});
