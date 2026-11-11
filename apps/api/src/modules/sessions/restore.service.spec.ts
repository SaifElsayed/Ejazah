// T061 of specs/004-sessions/tasks.md — `sessions.restore`'s rules over a recorded store (FR-454,
// FR-455; SRS FR-CANCEL-8; research R-322, «The restore»; R-320's two rows of 2026-11-05;
// contracts/kernel.md, the restore row; ADR 0023 D4). What the database holds (the race with a hold
// on the slot, SC-416) is `tests/db-integrity/restore.spec.ts`'.
//
// Keyed on the call's transaction (`runOn`, scope `sessions.restore`, the administrator as actor);
// the locks in the row's order (both accounts in one call, the teacher's slots' key, the slot, the
// enrollment, its sessions, their remedies) and everything decided read under them; then the
// refusals in R-322's order, each `RESTORE_REFUSED` with its cause, writing nothing, in one line;
// else the enrollment restored, the K sessions still owed generated after the last number from the
// first week at least L after the restore, each remedy the closing's case held offered again, and
// the case closed `dismissed` `restored`.
import { dateColumnOf } from '@ijazah/time';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { isRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { CaseRecord } from '../moderation/index.js';
import type {
  EnrollmentEventEntry,
  EnrollmentStatus,
  EnrollmentTerms,
  HeldTime,
} from './enrollment-side.port.js';
import type { RestoreSession } from './restore.repository.js';
import { createRestore, type RestoreStore } from './restore.service.js';
import type { PartyStanding } from './sessions.service.js';

const tx = {} as Transaction;
const ADMIN = '0199d0a0-0000-7000-8000-00000000b001';
const STUDENT = '0199d0a0-0000-7000-8000-00000000b002';
const TEACHER = '0199d0a0-0000-7000-8000-00000000b003';
const ENROLLMENT = '0199d0a0-0000-7000-8000-00000000b0e1';
const SLOT = '0199d0a0-0000-7000-8000-00000000b051';
const CASE = '0199d0a0-0000-7000-8000-00000000b0c1';
const REMEDY = '0199d0a0-0000-7000-8000-00000000b0r1';
const KEY = 'restore-key-0000000001';
const REASON = 'قرار الإنهاء كان خطأ';
const CAIRO = 'Africa/Cairo';
/** The restore's instant, a Tuesday: the first Thursday at least 24 h after it is Nov 12. */
const NOW = new Date('2026-11-10T08:00:00Z');

/** The four Thursdays the enrollment's sessions were generated on. */
const THURSDAYS = ['2026-11-05', '2026-11-12', '2026-11-19', '2026-11-26'] as const;

const sid = (n: number) => `0199d0a0-0000-7000-8000-00000000b0${String(n).padStart(2, '0')}`;

function session(
  sequenceNumber: number,
  status: string,
  extra: Partial<RestoreSession> = {},
): RestoreSession {
  const thursday = THURSDAYS[Math.min(sequenceNumber, 4) - 1] ?? '2026-11-05';
  return {
    id: sid(sequenceNumber),
    sequenceNumber,
    status,
    makeupForSessionId: null,
    scheduledDateLocal: dateColumnOf(thursday),
    scheduledStartTimeLocal: new Date('1970-01-01T09:00:00Z'),
    timezone: CAIRO,
    remedy: null,
    ...extra,
  };
}

/** Four Thursdays and a make-up: one consumed, one owed through the case, two to recreate. */
function closedSessions(): RestoreSession[] {
  return [
    session(1, 'done'),
    session(2, 'teacher_no_show', {
      remedy: { id: sid(52), status: 'booked', kind: 'makeup', caseId: null },
    }),
    session(3, 'teacher_no_show', {
      remedy: { id: REMEDY, status: 'refund_case', kind: 'makeup', caseId: CASE },
    }),
    session(4, 'cancelled_by_admin'),
    // The make-up of session 2, which the closing cancelled: among the K, owed nothing twice.
    session(5, 'cancelled_by_admin', {
      makeupForSessionId: sid(2),
      scheduledDateLocal: new Date('2026-12-03T00:00:00Z'),
    }),
  ];
}

const terms = (status: EnrollmentStatus = 'terminated_no_show'): EnrollmentTerms => ({
  id: ENROLLMENT,
  status,
  slotId: SLOT,
  track: 'recitation',
  timezone: CAIRO,
  durationMinutes: 60,
  sessionCount: 4,
  studentUserId: STUDENT,
  teacherUserId: TEACHER,
});

const record = (overrides: Partial<CaseRecord> = {}): CaseRecord => ({
  caseId: CASE,
  kind: 'compensation_case',
  enrollmentId: ENROLLMENT,
  reason: 'absence_termination',
  status: 'open',
  resolution: null,
  resolutionNotes: null,
  createdAt: new Date('2026-11-06T08:00:00Z'),
  resolvedAt: null,
  ...overrides,
});

const party = (overrides: Partial<PartyStanding> = {}): PartyStanding => ({
  gender: 'female',
  accountStatus: 'active',
  teacherApproved: false,
  displayName: 'Probe',
  ...overrides,
});

let calls: unknown[][];
let lines: Record<string, unknown>[];
let given: {
  terms: EnrollmentTerms | null;
  events: EnrollmentEventEntry[];
  sessions: RestoreSession[];
  endCase: string | null;
  record: CaseRecord | null;
  parties: Map<string, PartyStanding>;
  slot: { dayOfWeek: number; startTimeLocal: string; timezone: string; isActive: boolean } | null;
  takenDates: Set<string>;
  own: { startsAt: Date; endsAt: Date }[];
  held: HeldTime[];
  reserved: { remedyId: string; sessionId: string; startsAt: Date; endsAt: Date }[];
  generateFails?: unknown;
  restored: boolean;
  offered: boolean;
  replayed: boolean;
};

beforeEach(() => {
  calls = [];
  lines = [];
  given = {
    terms: terms(),
    events: [{ kind: 'terminated_no_show', occurredAt: new Date('2026-11-06T08:00:00Z') }],
    sessions: closedSessions(),
    endCase: CASE,
    record: record(),
    parties: new Map([
      [STUDENT, party()],
      [TEACHER, party({ teacherApproved: true })],
    ]),
    slot: { dayOfWeek: 4, startTimeLocal: '09:00:00', timezone: CAIRO, isActive: true },
    takenDates: new Set(),
    own: [],
    held: [],
    reserved: [],
    restored: true,
    offered: true,
    replayed: false,
  };
});

const store: RestoreStore = {
  lockAccounts: async (_tx, ids) => void calls.push(['lockAccounts', ids]),
  lockTeacherSlots: async (_tx, id) => void calls.push(['lockTeacherSlots', id]),
  lockSlot: async (_tx, id) => void calls.push(['lockSlot', id]),
  lockSessions: async (_tx, ids) => void calls.push(['lockSessions', ids]),
  lockRemedies: async (_tx, ids) => void calls.push(['lockRemedies', ids]),
  sessionsOf: async () => {
    calls.push(['sessionsOf']);
    return given.sessions;
  },
  endCaseOf: async () => {
    calls.push(['endCaseOf']);
    return given.endCase;
  },
  caseRecordOf: async () => {
    calls.push(['caseRecordOf']);
    return given.record;
  },
  partiesOf: async (_tx, ids) => {
    calls.push(['partiesOf', ids]);
    return given.parties;
  },
  slotOf: async () => {
    calls.push(['slotOf']);
    return given.slot === null
      ? null
      : { id: SLOT, durationMinutes: 60, createdAt: NOW, ...given.slot };
  },
  sessionsBetween: async () => given.own,
  reservedTimesOf: async () => given.reserved,
  generate: async (_tx, enrollment, at, lead, plan) => {
    calls.push(['generate', enrollment.snapshotSessionCount, at, lead, plan]);
    if (given.generateFails !== undefined) throw given.generateFails;
    return [];
  },
  sessionIdsFrom: async (_tx, _enrollmentId, from) =>
    new Map([0, 1, 2, 3].map((step) => [from + step, sid(from + step)])),
  closeCase: async (_tx, caseId, closing) => {
    calls.push(['closeCase', caseId, closing]);
    return NOW;
  },
};

function restoreOf() {
  return createRestore({
    enrollments: {
      enrollmentFor: async () => {
        calls.push(['enrollmentFor']);
        return given.terms;
      },
      lockEnrollments: async (_tx, ids) => void calls.push(['lockEnrollments', ids]),
      eventsOf: async () => given.events,
      restore: async () => {
        calls.push(['restore']);
        return given.restored;
      },
      slotWeekTaken: async (_tx, _slot, date) => given.takenDates.has(date),
      heldTimesOf: async () => given.held,
    },
    idempotency: {
      runOn: async (_tx, request, effect) => {
        calls.push(['runOn', request]);
        if (given.replayed) {
          return { outcome: { replayed: true } as never, replayed: true };
        }
        return { outcome: await effect(tx), replayed: false };
      },
    },
    offers: {
      offerLocked: async (_tx, sessionId, options) => {
        calls.push(['offerLocked', sessionId, options]);
        return given.offered
          ? {
              remedyId: REMEDY,
              sessionId,
              enrollmentId: ENROLLMENT,
              status: 'awaiting_choice',
              proposedDate: '2026-12-31',
              reoffered: true,
            }
          : null;
      },
    },
    settings: {
      read: async (key, schema) =>
        schema.parse({ first_session_lead_hours: 24, enrollment_restore_window_days: 7 }[key]),
    },
    log: {
      info: ((fields: object, msg: string) => void lines.push({ ...fields, msg })) as never,
      warn: ((fields: object, msg: string) => void lines.push({ ...fields, msg })) as never,
    },
    clock: async () => NOW,
    store,
  });
}

const restore = () =>
  restoreOf().restore(tx, ADMIN, { enrollmentId: ENROLLMENT, reason: REASON, idempotencyKey: KEY });

const WRITES = new Set(['restore', 'generate', 'offerLocked', 'closeCase']);
const writes = () => calls.filter(([name]) => WRITES.has(String(name)));

async function causeOf(): Promise<{ code: string; cause: unknown; logged: boolean }> {
  const thrown: unknown = await restore().then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(thrown instanceof DomainError))
    throw new Error(`expected a refusal, got ${String(thrown)}`);
  return {
    code: thrown.code,
    cause: thrown.details?.find(({ path }) => path === 'cause')?.code,
    logged: isRefusalLogged(thrown),
  };
}

async function expectRefused(cause: string) {
  expect(await causeOf()).toEqual({ code: 'RESTORE_REFUSED', cause, logged: true });
  expect(writes()).toEqual([]);
  expect(lines).toEqual([
    {
      adminId: ADMIN,
      enrollmentId: ENROLLMENT,
      errorCode: 'RESTORE_REFUSED',
      cause,
      msg: 'An enrollment restore was refused',
    },
  ]);
}

describe('sessions.restore: the restore (FR-455)', () => {
  it('keys on the call’s transaction, takes the row’s locks, restores, recreates the K sessions after the last number and offers the case’s remedy again, then closes the case restored', async () => {
    const { answer, replayed } = await restore();
    expect(replayed).toBe(false);
    expect(answer).toEqual({
      enrollmentId: ENROLLMENT,
      status: 'confirmed',
      sessionsCreated: [
        {
          sessionId: sid(6),
          sequenceNumber: 6,
          localDate: '2026-11-12',
          startTimeLocal: '09:00',
          timezone: CAIRO,
          startsAt: '2026-11-12T07:00:00.000Z',
        },
        {
          sessionId: sid(7),
          sequenceNumber: 7,
          localDate: '2026-11-19',
          startTimeLocal: '09:00',
          timezone: CAIRO,
          startsAt: '2026-11-19T07:00:00.000Z',
        },
      ],
      remediesOffered: 1,
      caseId: CASE,
    });
    expect(calls).toEqual([
      [
        'runOn',
        {
          scope: 'sessions.restore',
          key: KEY,
          actorId: ADMIN,
          input: { enrollmentId: ENROLLMENT, reason: REASON },
        },
      ],
      ['enrollmentFor'],
      ['lockAccounts', [STUDENT, TEACHER]],
      ['lockTeacherSlots', TEACHER],
      ['lockSlot', SLOT],
      ['lockEnrollments', [ENROLLMENT]],
      ['sessionsOf'],
      ['lockSessions', [sid(1), sid(2), sid(3), sid(4), sid(5)]],
      ['sessionsOf'],
      ['lockRemedies', [sid(52), REMEDY].sort()],
      ['enrollmentFor'],
      ['sessionsOf'],
      ['endCaseOf'],
      ['caseRecordOf'],
      ['partiesOf', [STUDENT, TEACHER]],
      ['slotOf'],
      ['restore'],
      ['generate', 4, NOW, 24, { count: 2, firstSequenceNumber: 6 }],
      ['offerLocked', sid(3), { restoredCase: CASE }],
      [
        'closeCase',
        CASE,
        { status: 'dismissed', resolution: null, note: 'restored', adminId: ADMIN },
      ],
    ]);
    expect(lines.map(({ msg }) => msg)).toEqual(['Remedy offered', 'An enrollment was restored']);
    expect(lines[1]).toEqual({
      adminId: ADMIN,
      enrollmentId: ENROLLMENT,
      caseId: CASE,
      sessionsCreated: 2,
      remediesOffered: 1,
      msg: 'An enrollment was restored',
    });
  });

  it('counts K with a session owed never offered left out, and restores a confirmed fault’s cancellation', async () => {
    given.sessions = closedSessions().map((one) =>
      one.sequenceNumber === 3 ? { ...one, remedy: null } : one,
    );
    given.terms = terms('cancelled');
    given.events = [{ kind: 'cancelled', cancellationReason: 'admin', occurredAt: NOW }];
    given.record = record({ reason: 'student_fault_confirmed' });
    const { answer } = await restore();
    expect(answer.remediesOffered).toBe(0);
    expect(calls.find(([name]) => name === 'generate')).toEqual([
      'generate',
      4,
      NOW,
      24,
      { count: 2, firstSequenceNumber: 6 },
    ]);
    expect(calls.some(([name]) => name === 'offerLocked')).toBe(false);
  });

  it('leaves out an unsettled session and a refund chosen, and counts a session cancelled by agreement with its remedy booked among the K', async () => {
    given.sessions = [
      session(1, 'disputed'),
      session(2, 'cancelled_by_agreement', {
        remedy: { id: sid(52), status: 'booked', kind: 'makeup', caseId: null },
      }),
      session(3, 'teacher_no_show', {
        remedy: { id: REMEDY, status: 'refund_case', kind: 'refund', caseId: sid(90) },
      }),
      session(4, 'cancelled_by_admin'),
    ];
    await restore();
    expect(calls.find(([name]) => name === 'generate')?.[4]).toEqual({
      count: 2,
      firstSequenceNumber: 5,
    });
    expect(calls.some(([name]) => name === 'offerLocked')).toBe(false);
  });

  it('passes a replay through, writing nothing', async () => {
    given.replayed = true;
    expect(await restore()).toEqual({ answer: { replayed: true }, replayed: true });
    expect(writes()).toEqual([]);
  });

  it('answers an enrollment that does not exist NOT_FOUND, taking no lock', async () => {
    given.terms = null;
    expect((await causeOf()).code).toBe('NOT_FOUND');
    expect(calls.map(([name]) => name)).toEqual(['runOn', 'enrollmentFor']);
  });
});

describe('sessions.restore: each cause writes nothing (FR-454, SC-416)', () => {
  it.each([
    ['a confirmed enrollment', () => (given.terms = terms('confirmed'))],
    ['a completed enrollment', () => (given.terms = terms('completed'))],
    [
      'a teacher’s end',
      () => {
        given.terms = terms('cancelled');
        given.events = [
          { kind: 'cancelled', cancellationReason: 'teacher_suspended', occurredAt: NOW },
        ];
      },
    ],
    [
      'a ban (cancelled admin, its latest end case student_banned)',
      () => {
        given.terms = terms('cancelled');
        given.events = [{ kind: 'cancelled', cancellationReason: 'admin', occurredAt: NOW }];
        given.record = record({ reason: 'student_banned' });
      },
    ],
    ['no end case', () => (given.endCase = null)],
    [
      'a refused move',
      () => {
        given.restored = false;
      },
    ],
  ])('not_restorable: %s', async (_name, arrange) => {
    arrange();
    if (given.restored) {
      await expectRefused('not_restorable');
      return;
    }
    expect((await causeOf()).cause).toBe('not_restorable');
    expect(writes()).toEqual([['restore']]);
  });

  it('case_closed: the closing’s case resolved or dismissed', async () => {
    given.record = record({ status: 'dismissed' });
    await expectRefused('case_closed');
  });

  it('window_closed: the case opened enrollment_restore_window_days or more before the database’s clock', async () => {
    given.record = record({ createdAt: new Date('2026-11-03T08:00:00Z') });
    await expectRefused('window_closed');
  });

  it.each([
    ['the student suspended', STUDENT, party({ accountStatus: 'suspended' })],
    ['the teacher no longer approved', TEACHER, party({ teacherApproved: false })],
    [
      'the teacher verification_required',
      TEACHER,
      party({ accountStatus: 'verification_required', teacherApproved: true }),
    ],
    ['the student deleted', STUDENT, undefined],
  ] as const)('party_restricted: %s', async (_name, userId, standing) => {
    if (standing === undefined) given.parties.delete(userId);
    else given.parties.set(userId, standing);
    await expectRefused('party_restricted');
  });

  it('slot_inactive: the slot deactivated', async () => {
    given.slot = { dayOfWeek: 4, startTimeLocal: '09:00:00', timezone: CAIRO, isActive: false };
    await expectRefused('slot_inactive');
  });

  it.each([
    ['its time of day', { startTimeLocal: '10:00:00' }],
    ['its day', { dayOfWeek: 3 }],
    ['its zone', { timezone: 'Asia/Riyadh' }],
  ])('slot_changed: %s changed since the closing', async (_name, change) => {
    given.slot = {
      dayOfWeek: 4,
      startTimeLocal: '09:00:00',
      timezone: CAIRO,
      isActive: true,
      ...change,
    };
    await expectRefused('slot_changed');
  });

  it('reads the lowest-numbered session that is not a make-up, so a make-up at another time changes nothing', async () => {
    given.sessions = [
      session(1, 'cancelled_by_admin', {
        makeupForSessionId: sid(9),
        scheduledStartTimeLocal: new Date('1970-01-01T15:00:00Z'),
      }),
      ...closedSessions().slice(1),
    ];
    expect((await restore()).replayed).toBe(false);
  });

  it('slot_taken: a week the slot is held or occupied by another student', async () => {
    given.takenDates = new Set(['2026-11-19']);
    await expectRefused('slot_taken');
  });

  it.each([
    ['a session of either party', 'own'],
    ['an open hold', 'held'],
    ['a reservation', 'reserved'],
  ] as const)('time_taken: a recreated session overlapping %s', async (_name, kind) => {
    const time = {
      startsAt: new Date('2026-11-19T07:30:00Z'),
      endsAt: new Date('2026-11-19T08:30:00Z'),
    };
    if (kind === 'reserved') given.reserved = [{ remedyId: sid(80), sessionId: sid(81), ...time }];
    else given[kind] = [time];
    await expectRefused('time_taken');
  });

  it('time_taken: the database’s exclusion refusing the insert, rolled back with the call', async () => {
    given.generateFails = {
      name: 'DriverAdapterError',
      cause: {
        originalCode: '23P01',
        originalMessage:
          'conflicting key value violates exclusion constraint "sessions_teacher_no_overlap"',
      },
    };
    expect(await causeOf()).toEqual({ code: 'RESTORE_REFUSED', cause: 'time_taken', logged: true });
  });

  it('throws a deadlock at the insert as the database’s own, for the kind to retry', async () => {
    const deadlock = {
      name: 'DriverAdapterError',
      cause: { originalCode: '40P01', originalMessage: 'deadlock detected' },
    };
    given.generateFails = deadlock;
    await expect(restore()).rejects.toBe(deadlock);
  });
});

// The note under T061 (B40, settled by the review session on B39 Q5 (a)'s precedent, rule d): a
// remedy the closing's case held for which T028's offer finds no free week refuses the whole
// restore `CONFLICT` `no_free_week` (no ninth `RESTORE_REFUSED` cause), the case left open; the
// offer writes its own warn line, the refusal one line of ids and its cause, marked «logged».
describe('sessions.restore: no free week for a held remedy (the note under T061)', () => {
  it('answers CONFLICT no_free_week, logged, closing no case', async () => {
    given.offered = false;
    const thrown: unknown = await restore().then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(DomainError);
    const refusal = thrown as DomainError;
    expect([refusal.code, refusal.details, isRefusalLogged(refusal)]).toEqual([
      'CONFLICT',
      [{ path: 'cause', code: 'no_free_week' }],
      true,
    ]);
    expect(calls.some(([name]) => name === 'closeCase')).toBe(false);
    expect(lines).toEqual([
      {
        adminId: ADMIN,
        enrollmentId: ENROLLMENT,
        sessionId: sid(3),
        errorCode: 'CONFLICT',
        cause: 'no_free_week',
        msg: 'An enrollment restore was refused',
      },
    ]);
  });
});
