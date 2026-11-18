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
//
// T066: `enrollment` to both parties, read under the locks, through the administrator kind's list
// bound to the call's transaction, sent once it commits; nothing on a refusal, a rollback or a
// replay; and inside the kind's declared deadlock retry, the committed attempt's event alone, once.
//
// T073 (FR-454 as amended, FR-507; SRS FR-CANCEL-8; research R-322, steps 1, 2 and 4 and the ninth
// cause; the note under T073, Q4 (a), Q8 (a), N3): step 1 reads the one closing rule (`closingOf`)
// over the enrollment's cases read through moderation's entry, a ban's and a teacher's ban or
// revocation closing admitted, a deletion's and a gender correction's not; step 2 retired, no
// restore refused for its time; step 4 counts as taken a session `sessions.cancel` cancelled (its
// `cancelled_by_admin` row naming an `admin_cancellation` case), never one the closing or a
// suspension before a fault cancelled; the ninth cause `refunded` through `EnrollmentPayments`,
// writing nothing; and the core, `restoreClosed`, at the instant handed in, with no key.
import { dateColumnOf } from '@ijazah/time';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { isRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { RateLimiter } from '../../platform/guards/rate-limit.guard.js';
import type { LiveBus, LiveMessage } from '../../platform/live/live-bus.js';
import {
  bindToTransaction,
  type LivePublisher,
  RequestLive,
} from '../../platform/live/live-publisher.js';
import type { LiveRegistry } from '../../platform/live/live-registry.js';
import { createLogger } from '../../platform/logging/logger.js';
import { type AdminSurfaceServices, createAdminContext } from '../../surfaces/context.js';
import { createAdminCallerFactory, createAdminRouter } from '../../surfaces/procedures.js';
import { unusedAdminServices } from '../../surfaces/services.fixtures.js';
import type { EnrollmentCase } from '../moderation/index.js';
import type {
  EnrollmentEventEntry,
  EnrollmentStatus,
  EnrollmentTerms,
  HeldTime,
} from './enrollment-side.port.js';
import type { CancellationCase, RestoreSession } from './restore.repository.js';
import {
  createRestore,
  isRefusedAfterWrite,
  type RestoreDependencies,
  type RestoreStore,
} from './restore.service.js';
import { sessionsAdminRouter } from './sessions-admin.router.js';
import type { PartyStanding } from './sessions.service.js';

const tx = {} as Transaction;
const ADMIN = '0199d0a0-0000-7000-8000-00000000b001';
const STUDENT = '0199d0a0-0000-7000-8000-00000000b002';
const TEACHER = '0199d0a0-0000-7000-8000-00000000b003';
const ENROLLMENT = '0199d0a0-0000-7000-8000-00000000b0e1';
const SLOT = '0199d0a0-0000-7000-8000-00000000b051';
const CASE = '0199d0a0-0000-7000-8000-00000000b0c1';
const REMEDY = '0199d0a0-0000-7000-8000-00000000b0r1';
/** T073: the `admin_cancellation` case `sessions.cancel` opened before the closing. */
const CANCEL_CASE = '0199d0a0-0000-7000-8000-00000000b0c2';
/** T073: the `student_suspended` case a suspension before the fault opened. */
const SUSPENSION_CASE = '0199d0a0-0000-7000-8000-00000000b0c3';
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

/** The closing's case, as moderation's `compensationCasesOf` answers it. */
const closingCase = (overrides: Partial<EnrollmentCase> = {}): EnrollmentCase => ({
  caseId: CASE,
  reason: 'absence_termination',
  status: 'open',
  createdAt: new Date('2026-11-06T08:00:00Z'),
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
  /** The enrollment's compensation cases, newest first (moderation's `compensationCasesOf`). */
  cases: EnrollmentCase[];
  /** T073: each `cancelled_by_admin` row's case, by session (sessions' own `session_events`). */
  cancellations: CancellationCase[];
  /** T073: whether an order of the enrollment is `refunded` (`EnrollmentPayments`). */
  refunded: boolean;
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
    cases: [closingCase()],
    cancellations: [],
    refunded: false,
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
  casesOf: async () => {
    calls.push(['casesOf']);
    return given.cases;
  },
  cancellationCasesOf: async () => {
    calls.push(['cancellationCasesOf']);
    return given.cancellations;
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

function restoreOf(overrides: Partial<RestoreDependencies> = {}) {
  return createRestore({
    enrollments: {
      enrollmentFor: async () => {
        calls.push(['enrollmentFor']);
        // Once `restore` has answered true, the row reads `confirmed`, as the database would.
        const restored = calls.some(([name]) => name === 'restore') && given.restored;
        return restored && given.terms !== null
          ? { ...given.terms, status: 'confirmed' }
          : given.terms;
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
        schema.parse(
          {
            first_session_lead_hours: 24,
            enrollment_restore_window_days: 7,
            ban_restore_window_days: 14,
          }[key],
        ),
    },
    payments: {
      refundedOf: async (_tx, enrollmentId) => {
        calls.push(['refundedOf', enrollmentId]);
        return given.refunded;
      },
    },
    log: {
      info: ((fields: object, msg: string) => void lines.push({ ...fields, msg })) as never,
      warn: ((fields: object, msg: string) => void lines.push({ ...fields, msg })) as never,
    },
    clock: async () => NOW,
    store,
    ...overrides,
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
      ['casesOf'],
      ['cancellationCasesOf'],
      ['refundedOf', ENROLLMENT],
      ['partiesOf', [STUDENT, TEACHER]],
      ['slotOf'],
      ['restore'],
      ['enrollmentFor'],
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
    given.cases = [closingCase({ reason: 'student_fault_confirmed' })];
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
      'a teacher’s end whose latest end case is of another closing',
      () => {
        given.terms = terms('cancelled');
        given.events = [
          { kind: 'cancelled', cancellationReason: 'teacher_suspended', occurredAt: NOW },
        ];
      },
    ],
    [
      // T073: a deletion's closing stays not restorable, its `teacher_ended` case open or not.
      'a deletion’s closing (cancelled account_deleted, its teacher_ended case open)',
      () => {
        given.terms = terms('cancelled');
        given.events = [
          { kind: 'cancelled', cancellationReason: 'account_deleted', occurredAt: NOW },
        ];
        given.cases = [closingCase({ reason: 'teacher_ended' })];
      },
    ],
    [
      // T073 (Q10 (a)): an enrollment a gender correction ended is never restored.
      'a gender correction’s closing (cancelled gender_correction)',
      () => {
        given.terms = terms('cancelled');
        given.events = [
          { kind: 'cancelled', cancellationReason: 'gender_correction', occurredAt: NOW },
        ];
        given.cases = [closingCase({ reason: 'student_banned' })];
      },
    ],
    ['no end case', () => (given.cases = [])],
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
    given.cases = [closingCase({ status: 'dismissed' })];
    await expectRefused('case_closed');
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

  // 005:T014 (FR-617; research R-409, «The restore's pairing check»; DEC-69): a pairing whose two
  // declared genders now differ is refused, whatever closed it, in both directions. Red first.
  it.each([
    ['the student corrected to male', STUDENT, party({ gender: 'male' })],
    ['the teacher corrected to male', TEACHER, party({ gender: 'male', teacherApproved: true })],
  ] as const)('gender_mismatch: %s', async (_name, userId, standing) => {
    given.parties.set(userId, standing);
    await expectRefused('gender_mismatch');
  });

  it('gender_mismatch never logs a gender, only ids and the cause', async () => {
    given.parties.set(STUDENT, party({ gender: 'male' }));
    await restore().catch(() => undefined);
    expect(JSON.stringify(lines)).not.toContain('male');
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

describe('T073: the restore’s amendments (FR-454 as amended, FR-507; R-322 steps 1, 2, 4, the ninth cause)', () => {
  const generated = () => calls.find(([name]) => name === 'generate')?.[4];
  const cancelledBy = (sessionId: string, caseId: string): CancellationCase => ({
    sessionId,
    caseId,
  });

  it('red first: one sessions.cancel’d session, the enrollment ended and restored, K − 1 sessions created', async () => {
    // Session 4, cancelled through `sessions.cancel` before the closing: its row names the
    // enrollment's `admin_cancellation` case, so it is owed through that case, not created again.
    given.cancellations = [cancelledBy(sid(4), CANCEL_CASE)];
    given.cases = [
      closingCase(),
      closingCase({ caseId: CANCEL_CASE, reason: 'admin_cancellation' }),
    ];
    const { answer } = await restore();
    expect(generated()).toEqual({ count: 1, firstSequenceNumber: 6 });
    expect(answer.sessionsCreated.map(({ sequenceNumber }) => sequenceNumber)).toEqual([6]);
  });

  it('never counts as taken a session the closing cancelled, nor one a suspension cancelled before a fault', async () => {
    given.terms = terms('cancelled');
    given.events = [{ kind: 'cancelled', cancellationReason: 'admin', occurredAt: NOW }];
    given.cases = [
      closingCase({ reason: 'student_fault_confirmed' }),
      closingCase({ caseId: SUSPENSION_CASE, reason: 'student_suspended', status: 'resolved' }),
    ];
    given.cancellations = [cancelledBy(sid(4), SUSPENSION_CASE), cancelledBy(sid(5), CASE)];
    await restore();
    expect(generated()).toEqual({ count: 2, firstSequenceNumber: 6 });
  });

  it('step 1 admits a ban’s closing (cancelled admin, its student_banned case open) once both accounts are active', async () => {
    given.terms = terms('cancelled');
    given.events = [{ kind: 'cancelled', cancellationReason: 'admin', occurredAt: NOW }];
    given.cases = [closingCase({ reason: 'student_banned' })];
    const { answer } = await restore();
    expect(answer).toMatchObject({ status: 'confirmed', caseId: CASE });
    expect(calls).toContainEqual([
      'closeCase',
      CASE,
      { status: 'dismissed', resolution: null, note: 'restored', adminId: ADMIN },
    ]);
  });

  it('a ban’s closing is refused party_restricted while the ban stands, writing nothing', async () => {
    given.terms = terms('cancelled');
    given.events = [{ kind: 'cancelled', cancellationReason: 'admin', occurredAt: NOW }];
    given.cases = [closingCase({ reason: 'student_banned' })];
    given.parties.set(STUDENT, party({ accountStatus: 'banned' }));
    await expectRefused('party_restricted');
  });

  it('step 1 admits a teacher’s ban or revocation closing (cancelled teacher_suspended, its teacher_ended case open)', async () => {
    given.terms = terms('cancelled');
    given.events = [
      { kind: 'cancelled', cancellationReason: 'teacher_suspended', occurredAt: NOW },
    ];
    given.cases = [closingCase({ reason: 'teacher_ended' })];
    const { answer } = await restore();
    expect(answer).toMatchObject({ status: 'confirmed', caseId: CASE });
  });

  it('step 2 retired: no restore is refused for its time, window_closed never produced', async () => {
    // Opened a year before the restore: past both windows, the restore still admitted (DEC-69).
    given.cases = [closingCase({ createdAt: new Date('2025-11-06T08:00:00Z') })];
    const { answer } = await restore();
    expect(answer).toMatchObject({ status: 'confirmed', caseId: CASE });
  });

  it('refunded: an order of the enrollment refunded at the gateway, writing nothing', async () => {
    given.refunded = true;
    await expectRefused('refunded');
    expect(calls).toContainEqual(['refundedOf', ENROLLMENT]);
  });

  it('restoreClosed: the core, at the instant handed in, with no key, answers restored', async () => {
    const at = new Date('2026-11-10T09:30:00Z');
    expect(await restoreOf().restoreClosed(tx, ADMIN, ENROLLMENT, at)).toEqual({ restored: true });
    expect(calls.some(([name]) => name === 'runOn')).toBe(false);
    expect(calls.find(([name]) => name === 'generate')?.[2]).toBe(at);
    expect(calls).toContainEqual([
      'closeCase',
      CASE,
      { status: 'dismissed', resolution: null, note: 'restored', adminId: ADMIN },
    ]);
  });

  it('restoreClosed throws the refusal as sessions.restore does, logged, writing nothing', async () => {
    given.refunded = true;
    const thrown: unknown = await restoreOf()
      .restoreClosed(tx, ADMIN, ENROLLMENT, NOW)
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(thrown).toBeInstanceOf(DomainError);
    expect([
      (thrown as DomainError).code,
      (thrown as DomainError).details,
      isRefusalLogged(thrown),
    ]).toEqual(['RESTORE_REFUSED', [{ path: 'cause', code: 'refunded' }], true]);
    expect(writes()).toEqual([]);
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

describe('sessions.restore: the live event (T066)', () => {
  /**
   * The administrator kind's after-commit point as `procedures.ts` runs it: the request's list bound to
   * the call's transaction while it runs, flushed once it has committed, dropped on a rollback.
   * What the call added to the list, sent or not, is kept in `added`.
   */
  let added: LiveMessage[] = [];

  async function asAdministratorKind(commitFails = false): Promise<LiveMessage[]> {
    const published: LiveMessage[] = [];
    const live = new RequestLive(
      { publish: (message) => void published.push(message) },
      { warn: () => undefined },
    );
    added = [];
    const recording: LivePublisher = {
      afterCommit: (to, event, scope) => {
        added.push({ to: [...to], event });
        live.afterCommit(to, event, scope);
      },
    };
    const unbind = bindToTransaction(tx, recording);
    try {
      await restore();
      if (commitFails) throw new Error('the audit write failed');
      live.flush();
    } catch {
      live.drop();
    } finally {
      unbind();
    }
    return published;
  }

  const restoredEvent = {
    to: [STUDENT, TEACHER],
    event: { type: 'enrollment', enrollmentId: ENROLLMENT },
  };

  it('sends enrollment to both parties once, after the commit', async () => {
    expect(await asAdministratorKind()).toEqual([restoredEvent]);
  });

  it('sends nothing on a refusal, a rollback or a replay', async () => {
    given.slot = {
      ...(given.slot ?? { dayOfWeek: 4, startTimeLocal: '09:00:00', timezone: CAIRO }),
      isActive: false,
    };
    expect(await asAdministratorKind()).toEqual([]);
    expect(added).toEqual([]);
    given.slot = { dayOfWeek: 4, startTimeLocal: '09:00:00', timezone: CAIRO, isActive: true };
    expect(await asAdministratorKind(true)).toEqual([]);
    given.replayed = true;
    expect(await asAdministratorKind()).toEqual([]);
    expect(added).toEqual([]);
  });

  it('inside the kind’s declared deadlock retry, sends the committed attempt’s event once', async () => {
    const deadlock = () =>
      Object.assign(new Error('deadlock detected'), {
        name: 'DriverAdapterError',
        cause: { originalCode: '40P01', originalMessage: 'deadlock detected' },
      });
    let attempts = 0;
    // The key's completion, a statement after the effect, deadlocks on the first attempt.
    const service = restoreOf({
      idempotency: {
        runOn: async (attemptTx, _request, effect) => {
          attempts += 1;
          // The first attempt rolled back: nothing it wrote is read by the second.
          calls.length = 0;
          const outcome = await effect(attemptTx);
          if (attempts === 1) throw deadlock();
          return { outcome, replayed: false };
        },
      },
    });
    const published: LiveMessage[] = [];
    const bus: LiveBus = {
      publish: (message) => void published.push(message),
      subscribe: () => () => undefined,
    };
    const context = createAdminContext({
      session: { adminId: ADMIN, sessionId: ADMIN, mfaVerified: true },
      log: createLogger({ level: 'info', destination: { write: () => undefined } }),
      administration: {
        // Each attempt is a transaction of its own.
        transactions: { run: (work) => work({} as Transaction) },
        auditWriter: { write: async () => undefined },
      },
      services: new Proxy(unusedAdminServices, {
        get: (target, name, receiver) =>
          name === 'restore' ? service : Reflect.get(target, name, receiver),
      }) as AdminSurfaceServices,
      rateLimiter: { check: async () => undefined } as unknown as RateLimiter,
      clientAddress: '203.0.113.9',
      live: { bus, registry: {} as LiveRegistry },
    });
    const caller = createAdminCallerFactory(createAdminRouter({ sessions: sessionsAdminRouter }))(
      context,
    );

    const answer = await caller.sessions.restore({
      enrollmentId: ENROLLMENT,
      reason: REASON,
      idempotencyKey: KEY,
    });

    expect(answer.enrollmentId).toBe(ENROLLMENT);
    expect(attempts).toBe(2);
    expect(published).toEqual([restoredEvent]);
  });
});

// T072 of specs/004-sessions (the note under T072, Q7 (a); the owner's word on lane D's Q-D1,
// «موافق», 2026-11-13): a refusal thrown after `EnrollmentSide.restore` has landed carries the mark
// «after a write» (`isRefusedAfterWrite`), so a lift refuses the whole lift `restore_failed`; every
// cause found before the first write carries none. `sessions.restore`'s answers are unchanged.
describe('T072: the mark «refused after a write»', () => {
  async function thrownBy(): Promise<unknown> {
    return restoreOf()
      .restoreClosed(tx, ADMIN, ENROLLMENT, NOW)
      .then(
        () => undefined,
        (error: unknown) => error,
      );
  }

  it.each([
    ['not_restorable', () => (given.terms = terms('confirmed'))],
    ['not_restorable (a refused move)', () => (given.restored = false)],
    ['case_closed', () => (given.cases = [closingCase({ status: 'dismissed' })])],
    ['refunded', () => (given.refunded = true)],
    ['party_restricted', () => given.parties.set(STUDENT, party({ accountStatus: 'banned' }))],
    [
      'slot_inactive',
      () =>
        (given.slot = {
          dayOfWeek: 4,
          startTimeLocal: '09:00:00',
          timezone: CAIRO,
          isActive: false,
        }),
    ],
    [
      'slot_changed',
      () =>
        (given.slot = {
          dayOfWeek: 3,
          startTimeLocal: '09:00:00',
          timezone: CAIRO,
          isActive: true,
        }),
    ],
    ['slot_taken', () => (given.takenDates = new Set(['2026-11-19']))],
    [
      'time_taken before the insert',
      () =>
        (given.own = [
          { startsAt: new Date('2026-11-19T07:30:00Z'), endsAt: new Date('2026-11-19T08:30:00Z') },
        ]),
    ],
  ])('%s carries no mark', async (_name, arrange) => {
    arrange();
    const thrown = await thrownBy();
    expect(thrown).toBeInstanceOf(DomainError);
    expect(isRefusedAfterWrite(thrown)).toBe(false);
  });

  it.each([
    ['no_free_week', 'CONFLICT', () => (given.offered = false)],
    [
      'time_taken from the database’s exclusion at the insert',
      'RESTORE_REFUSED',
      () =>
        (given.generateFails = {
          name: 'DriverAdapterError',
          cause: {
            originalCode: '23P01',
            originalMessage:
              'conflicting key value violates exclusion constraint "sessions_student_no_overlap"',
          },
        }),
    ],
  ])('%s, after the restore landed, carries the mark', async (_name, code, arrange) => {
    arrange();
    const thrown = await thrownBy();
    expect(thrown).toBeInstanceOf(DomainError);
    expect([(thrown as DomainError).code, isRefusedAfterWrite(thrown)]).toEqual([code, true]);
    expect(writes()).toContainEqual(['restore']);
  });

  it('marks nothing else: an error of any other kind, or none', () => {
    expect(isRefusedAfterWrite(new DomainError('RESTORE_REFUSED'))).toBe(false);
    expect(isRefusedAfterWrite(undefined)).toBe(false);
  });
});
