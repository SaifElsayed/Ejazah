// T029 of specs/004-sessions/tasks.md (FR-423, FR-468, FR-469; research R-311, "Booking a make-up";
// ADR 0018 D3; contracts/kernel.md, the row «make-up booking»; the note under `003:T026`, nit 5) —
// `createMakeupBooking` over a recorded store: the remedy read with no lock for its parties; both
// accounts (one call, id order) and the teacher's `lockKey('teacher-slots')`; the remedy read again
// for the counter's slot; the slots it touches in one call in id order (one when they are the same,
// L2); the enrollment, the session and the remedy; the remedy read again for the decision; another
// remedy's reserved time refused (R-320, Q7 (a): its own dropped); one `scheduled` session numbered
// after the last, `makeup_for_session_id`, the local date, start and zone as the fact and the instants
// from `packages/time`; the remedy `booked` at the database's clock; one `makeup_booked` row. An
// exclusion refusal answers `MAKEUP_REFUSED` naming the constraint for the caller (T032's A7 line),
// with one refusal line unless the sweep books (its own warn line, Q11 (a)). Over the real tables, the
// overlap, the slot edit's serialisation and the forced deadlock: `tests/db-integrity/makeup-booking.spec.ts`.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { isRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { Logger } from '../../platform/logging/logger.js';
import type { EnrollmentTerms } from './enrollment-side.port.js';
import type { RemedyToBook } from './makeup-booking.repository.js';
import {
  createMakeupBooking,
  type MakeupBookingInput,
  type MakeupBookingStore,
  makeupRefusalOf,
} from './makeup-booking.service.js';

const tx = {} as Transaction;
const REMEDY = '0199d0a0-0000-7000-8000-0000000000f1';
const OTHER_REMEDY = '0199d0a0-0000-7000-8000-0000000000f2';
const SESSION = '0199d0a0-0000-7000-8000-000000000051';
const MAKEUP = '0199d0a0-0000-7000-8000-000000000059';
const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000000e1';
const TEACHER = '0199d0a0-0000-7000-8000-0000000000a1';
const STUDENT = '0199d0a0-0000-7000-8000-0000000000b1';
// The counter's slot sorts before the enrollment's, so «one call, id order» is seen.
const COUNTER_SLOT = '0199d0a0-0000-7000-8000-0000000000c1';
const ENROLLMENT_SLOT = '0199d0a0-0000-7000-8000-0000000000d1';
const AT = new Date('2026-11-10T09:00:00Z');

const TERMS: EnrollmentTerms = {
  id: ENROLLMENT,
  status: 'confirmed',
  slotId: ENROLLMENT_SLOT,
  track: 'recitation',
  timezone: 'Africa/Cairo',
  durationMinutes: 60,
  sessionCount: 4,
};

/** A Sunday in December, Cairo at +02:00: 09:00 local is 07:00Z. */
const PROPOSED = new Date('2026-12-06T00:00:00Z');
/** The counter: Tuesday 2026-12-08 at 10:30 in Cairo, 08:30Z. */
const COUNTER = {
  slotId: COUNTER_SLOT,
  date: new Date('2026-12-08T00:00:00Z'),
  startTimeLocal: new Date('1970-01-01T10:30:00Z'),
  timezone: 'Africa/Cairo',
};

type Status = RemedyToBook['status'];

function remedyIn(status: Status, counter = status === 'counter_proposed'): RemedyToBook {
  return {
    id: REMEDY,
    sessionId: SESSION,
    enrollmentId: ENROLLMENT,
    studentUserId: STUDENT,
    teacherUserId: TEACHER,
    status,
    proposedDate: PROPOSED,
    counter: counter ? COUNTER : null,
  };
}

interface Options {
  readonly first?: RemedyToBook | null;
  readonly decided?: RemedyToBook | null;
  readonly reserved?: readonly {
    remedyId: string;
    sessionId: string;
    startsAt: Date;
    endsAt: Date;
  }[];
  readonly insertThrows?: unknown;
}

function world({
  first = remedyIn('proposed'),
  decided = first,
  reserved = [],
  insertThrows,
}: Options) {
  const journal: string[] = [];
  const logged: { fields: Record<string, unknown>; message: string }[] = [];
  const inserted: unknown[] = [];
  let reads = 0;
  const store: MakeupBookingStore = {
    remedyToBook: async (_tx, remedyId) => {
      expect(remedyId).toBe(REMEDY);
      reads += 1;
      journal.push(`read ${String(reads)}`);
      return reads < 3 ? first : decided;
    },
    lockAccounts: async (_tx, ids) => {
      journal.push(`lock users ${ids.join(',')}`);
    },
    lockTeacherSlots: async (_tx, teacherUserId) => {
      journal.push(`lock teacher-slots ${teacherUserId}`);
    },
    lockSlots: async (_tx, ids) => {
      journal.push(`lock slots ${ids.join(',')}`);
    },
    lockSessions: async (_tx, ids) => {
      journal.push(`lock sessions ${ids.join(',')}`);
    },
    lockRemedies: async (_tx, ids) => {
      journal.push(`lock remedies ${ids.join(',')}`);
    },
    slotOf: async (_tx, slotId) => {
      expect(slotId).toBe(ENROLLMENT_SLOT);
      return {
        id: ENROLLMENT_SLOT,
        dayOfWeek: 0,
        startTimeLocal: '09:00:00',
        durationMinutes: 60,
        timezone: 'Africa/Cairo',
        isActive: true,
        createdAt: new Date('2026-09-01T00:00:00Z'),
      };
    },
    reservedTimesOf: async (_tx, userIds, window) => {
      journal.push(
        `reservations ${userIds.join(',')} ${window.from.toISOString()}..${window.to.toISOString()}`,
      );
      return reserved;
    },
    lastSequenceOf: async (_tx, enrollmentId) => {
      expect(enrollmentId).toBe(ENROLLMENT);
      return 4;
    },
    insertMakeup: async (_tx, row) => {
      journal.push('insert');
      inserted.push(row);
      if (insertThrows !== undefined) throw insertThrows;
      return MAKEUP;
    },
    markBooked: async (_tx, remedyId, from, at) => {
      journal.push(`booked ${remedyId} from ${from.join('|')}`);
      expect(at).toEqual(AT);
      return true;
    },
    recordEvents: async (_tx, events) => {
      journal.push(
        `events ${events.map((event) => `${event.kind}:${event.sessionId ?? ''}`).join(',')}`,
      );
      for (const event of events) {
        expect(event.enrollmentId).toBe(ENROLLMENT);
        expect(event.occurredAt).toEqual(AT);
      }
    },
  };
  const booking = createMakeupBooking({
    transactions: { run: (work) => work(tx) },
    enrollments: {
      enrollmentFor: async (_tx, id) => {
        expect(id).toBe(ENROLLMENT);
        return TERMS;
      },
      lockEnrollments: async (_tx, ids) => {
        journal.push(`lock enrollments ${ids.join(',')}`);
      },
    },
    log: {
      info: (...args: unknown[]) => {
        logged.push({ fields: args[0] as Record<string, unknown>, message: args[1] as string });
      },
      warn: (...args: unknown[]) => {
        logged.push({ fields: args[0] as Record<string, unknown>, message: args[1] as string });
      },
    } as unknown as Pick<Logger, 'info' | 'warn'>,
    clock: async () => {
      journal.push('clock');
      return AT;
    },
    store,
  });
  return { booking, journal, logged, inserted, store };
}

async function refusalOf(call: Promise<unknown>): Promise<DomainError> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(thrown instanceof DomainError))
    throw new Error(`expected a DomainError: ${String(thrown)}`);
  expect(isRefusalLogged(thrown), `${thrown.code} marked «logged»`).toBe(true);
  return thrown;
}

/** The locks before the decision, with the slots `slots` names. */
const locksWith = (slots: string) => [
  'read 1',
  `lock users ${TEACHER},${STUDENT}`,
  `lock teacher-slots ${TEACHER}`,
  'read 2',
  `lock slots ${slots}`,
  `lock enrollments ${ENROLLMENT}`,
  `lock sessions ${SESSION}`,
  `lock remedies ${REMEDY}`,
  'read 3',
];

const PROPOSAL: MakeupBookingInput = {
  remedyId: REMEDY,
  booking: 'proposal',
  operation: 'sessions.remedy.accept',
};
const COUNTER_INPUT: MakeupBookingInput = {
  remedyId: REMEDY,
  booking: 'counter',
  operation: 'sessions.remedy.answerCounter',
};

describe("a make-up's booking (T029, FR-469)", () => {
  it.each<Status>(['awaiting_choice', 'proposed', 'counter_proposed'])(
    "books the proposal of a %s remedy in the kernel row's order, numbered after the last",
    async (status) => {
      const { booking, journal, inserted, logged } = world({ first: remedyIn(status) });
      const booked = await booking.bookOn(tx, PROPOSAL);
      expect(journal).toEqual([
        ...locksWith(ENROLLMENT_SLOT),
        `reservations ${TEACHER},${STUDENT} 2026-12-06T07:00:00.000Z..2026-12-06T08:00:00.000Z`,
        'clock',
        'insert',
        `booked ${REMEDY} from awaiting_choice|proposed|counter_proposed`,
        `events makeup_booked:${SESSION}`,
      ]);
      expect(inserted).toEqual([
        {
          enrollmentId: ENROLLMENT,
          teacherUserId: TEACHER,
          studentUserId: STUDENT,
          sequenceNumber: 5,
          makeupForSessionId: SESSION,
          scheduledDateLocal: new Date('2026-12-06T00:00:00Z'),
          scheduledStartTimeLocal: new Date('1970-01-01T09:00:00Z'),
          timezone: 'Africa/Cairo',
          scheduledStartAt: new Date('2026-12-06T07:00:00Z'),
          scheduledEndAt: new Date('2026-12-06T08:00:00Z'),
        },
      ]);
      expect(booked).toEqual({
        remedyId: REMEDY,
        sessionId: SESSION,
        enrollmentId: ENROLLMENT,
        makeupSessionId: MAKEUP,
        startsAt: new Date('2026-12-06T07:00:00Z'),
        endsAt: new Date('2026-12-06T08:00:00Z'),
      });
      expect(logged).toEqual([]);
    },
  );

  it('books a pending counter on its own date, start and zone, both slots locked in one call', async () => {
    const { booking, journal, inserted } = world({ first: remedyIn('counter_proposed') });
    await booking.bookOn(tx, COUNTER_INPUT);
    expect(journal.slice(0, 9)).toEqual(locksWith(`${COUNTER_SLOT},${ENROLLMENT_SLOT}`));
    expect(journal).toContain(`booked ${REMEDY} from counter_proposed`);
    expect(inserted).toEqual([
      expect.objectContaining({
        scheduledDateLocal: new Date('2026-12-08T00:00:00Z'),
        scheduledStartTimeLocal: new Date('1970-01-01T10:30:00Z'),
        timezone: 'Africa/Cairo',
        scheduledStartAt: new Date('2026-12-08T08:30:00Z'),
        scheduledEndAt: new Date('2026-12-08T09:30:00Z'),
      }),
    ]);
  });

  it("locks one slot when the counter's slot is the enrollment's own", async () => {
    const first = {
      ...remedyIn('counter_proposed'),
      counter: { ...COUNTER, slotId: ENROLLMENT_SLOT },
    };
    const { booking, journal } = world({ first });
    await booking.bookOn(tx, COUNTER_INPUT);
    expect(journal).toContain(`lock slots ${ENROLLMENT_SLOT}`);
  });

  it("drops its own remedy's reserved times and books", async () => {
    const own = {
      remedyId: REMEDY,
      sessionId: SESSION,
      startsAt: new Date('2026-12-06T07:00:00Z'),
      endsAt: new Date('2026-12-06T08:00:00Z'),
    };
    const { booking, journal } = world({ reserved: [own] });
    await booking.bookOn(tx, PROPOSAL);
    expect(journal).toContain('insert');
  });

  it('refuses a time another remedy reserves MAKEUP_REFUSED, one line, nothing written', async () => {
    const other = {
      remedyId: OTHER_REMEDY,
      sessionId: '0199d0a0-0000-7000-8000-000000000052',
      startsAt: new Date('2026-12-06T07:30:00Z'),
      endsAt: new Date('2026-12-06T08:30:00Z'),
    };
    const { booking, journal, logged } = world({ reserved: [other] });
    const refused = await refusalOf(booking.bookOn(tx, PROPOSAL));
    expect(refused.code).toBe('MAKEUP_REFUSED');
    expect(makeupRefusalOf(refused)).toEqual({ cause: 'reserved' });
    expect(journal).not.toContain('insert');
    expect(journal.some((entry) => entry.startsWith('booked') || entry.startsWith('events'))).toBe(
      false,
    );
    expect(logged).toEqual([
      {
        fields: {
          remedyId: REMEDY,
          sessionId: SESSION,
          enrollmentId: ENROLLMENT,
          operation: 'sessions.remedy.accept',
          errorCode: 'MAKEUP_REFUSED',
          reason: 'reserved',
        },
        message: 'A make-up booking was refused',
      },
    ]);
  });

  it.each(['sessions_teacher_no_overlap', 'sessions_student_no_overlap'] as const)(
    'answers an exclusion refusal by %s MAKEUP_REFUSED naming it, nothing written after the insert',
    async (constraint) => {
      const { booking, journal, logged } = world({ insertThrows: exclusion(constraint) });
      const refused = await refusalOf(booking.bookOn(tx, PROPOSAL));
      expect(refused.code).toBe('MAKEUP_REFUSED');
      expect(makeupRefusalOf(refused)).toEqual({ cause: 'overlap', constraint });
      expect(journal.at(-1)).toBe('insert');
      expect(logged).toEqual([
        {
          fields: {
            remedyId: REMEDY,
            sessionId: SESSION,
            enrollmentId: ENROLLMENT,
            operation: 'sessions.remedy.accept',
            errorCode: 'MAKEUP_REFUSED',
            reason: 'overlap',
            constraint,
          },
          message: 'A make-up booking was refused',
        },
      ]);
    },
  );

  it("writes no refusal line when the sweep books: its retry's warn line is T032's (Q11 (a))", async () => {
    const { booking, logged } = world({
      insertThrows: exclusion('sessions_teacher_no_overlap'),
    });
    const refused = await refusalOf(
      booking.bookOn(tx, { ...PROPOSAL, operation: 'advance-remedies' }),
    );
    expect(makeupRefusalOf(refused)).toEqual({
      cause: 'overlap',
      constraint: 'sessions_teacher_no_overlap',
    });
    expect(logged).toEqual([]);
  });

  it('rethrows any other failure of the insert unchanged', async () => {
    const failure = new Error('the connection dropped');
    const { booking } = world({ insertThrows: failure });
    await expect(booking.bookOn(tx, PROPOSAL)).rejects.toBe(failure);
  });

  it.each<[MakeupBookingInput, Status]>([
    [PROPOSAL, 'frozen'],
    [PROPOSAL, 'booked'],
    [PROPOSAL, 'refund_case'],
    [PROPOSAL, 'lapsed'],
    [COUNTER_INPUT, 'proposed'],
    [COUNTER_INPUT, 'awaiting_choice'],
  ])(
    'refuses the %o booking of a remedy %s under the locks REMEDY_NOT_OPEN, nothing written',
    async (input, status) => {
      const { booking, journal, logged } = world({
        first: remedyIn('counter_proposed'),
        decided: remedyIn(status, false),
      });
      const refused = await refusalOf(booking.bookOn(tx, input));
      expect(refused.code).toBe('REMEDY_NOT_OPEN');
      expect(journal.at(-1)).toBe('read 3');
      expect(logged).toEqual([
        {
          fields: {
            remedyId: REMEDY,
            sessionId: SESSION,
            enrollmentId: ENROLLMENT,
            operation: input.operation,
            errorCode: 'REMEDY_NOT_OPEN',
            reason: 'not_open',
          },
          message: 'A make-up booking was refused',
        },
      ]);
    },
  );

  it('refuses a remedy that does not exist NOT_FOUND, no lock taken', async () => {
    const { booking, journal, logged } = world({ first: null });
    const refused = await refusalOf(booking.bookOn(tx, PROPOSAL));
    expect(refused.code).toBe('NOT_FOUND');
    expect(journal).toEqual(['read 1']);
    expect(logged).toEqual([
      {
        fields: {
          remedyId: REMEDY,
          operation: 'sessions.remedy.accept',
          errorCode: 'NOT_FOUND',
          reason: 'not_found',
        },
        message: 'A make-up booking was refused',
      },
    ]);
  });
});

describe("the booking's transaction (T029, L5: runRetryingDeadlockOnce)", () => {
  it('retries once on a deadlock with the operation and the remedy, and keeps the second', async () => {
    const lines: { fields: unknown; message: unknown }[] = [];
    let attempts = 0;
    const booking = createMakeupBooking({
      transactions: {
        run: async (work) => {
          attempts += 1;
          if (attempts === 1) throw deadlock();
          return work(tx);
        },
      },
      enrollments: { enrollmentFor: async () => TERMS, lockEnrollments: async () => undefined },
      log: {
        info: () => undefined,
        warn: (...args: unknown[]) => {
          lines.push({ fields: args[0], message: args[1] });
        },
      } as unknown as Pick<Logger, 'info' | 'warn'>,
      clock: async () => AT,
      store: world({}).store,
    });
    await booking.book(PROPOSAL);
    expect(attempts).toBe(2);
    expect(lines).toEqual([
      {
        fields: { operation: 'sessions.remedy.accept', attempt: 1, remedyId: REMEDY },
        message: 'Transaction deadlocked',
      },
    ]);
  });

  it('answers a second deadlock MAKEUP_REFUSED, its cause the deadlock, with T002 lines only', async () => {
    const lines: { fields: unknown; message: unknown }[] = [];
    const booking = createMakeupBooking({
      transactions: {
        run: async () => {
          throw deadlock();
        },
      },
      enrollments: { enrollmentFor: async () => TERMS, lockEnrollments: async () => undefined },
      log: {
        info: (...args: unknown[]) => {
          lines.push({ fields: args[0], message: args[1] });
        },
        warn: (...args: unknown[]) => {
          lines.push({ fields: args[0], message: args[1] });
        },
      } as unknown as Pick<Logger, 'info' | 'warn'>,
      clock: async () => AT,
    });
    const refused = await refusalOf(booking.book(COUNTER_INPUT));
    expect(refused.code).toBe('MAKEUP_REFUSED');
    expect(makeupRefusalOf(refused)).toEqual({ cause: 'deadlock' });
    expect(lines).toEqual([
      {
        fields: { operation: 'sessions.remedy.answerCounter', attempt: 1, remedyId: REMEDY },
        message: 'Transaction deadlocked',
      },
      {
        fields: { operation: 'sessions.remedy.answerCounter', attempt: 2, remedyId: REMEDY },
        message: 'Transaction deadlocked',
      },
      {
        fields: { operation: 'sessions.remedy.answerCounter', attempts: 2, remedyId: REMEDY },
        message: 'Refused after a second deadlock',
      },
    ]);
  });

  it('reads no refusal from an error that is not a make-up refusal', () => {
    expect(makeupRefusalOf(new DomainError('REMEDY_NOT_OPEN'))).toBeNull();
    expect(makeupRefusalOf(new Error('other'))).toBeNull();
  });
});

/** The adapter's refusal under Prisma's `meta`, as a write throws it. */
function adapterError(code: string, message: string): Error {
  return Object.assign(new Error(`Code: \`${code}\`.`), {
    name: 'PrismaClientKnownRequestError',
    code: 'P2010',
    meta: {
      driverAdapterError: {
        name: 'DriverAdapterError',
        cause: { originalCode: code, originalMessage: message, kind: 'postgres', code },
      },
    },
  });
}

function exclusion(constraint: string): Error {
  return adapterError(
    '23P01',
    `conflicting key value violates exclusion constraint "${constraint}"`,
  );
}

function deadlock(): Error {
  return adapterError('40P01', 'deadlock detected');
}
