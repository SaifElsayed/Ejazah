// T029 of specs/004-sessions/tasks.md — a make-up's booking over the real tables as the application
// role (FR-423, FR-468, FR-469; research R-311, "Booking a make-up"; R-321 «The deferred overlap check
// and a deadlock»; contracts/kernel.md, the row «make-up booking»; the note under `003:T026`, nit 5).
//
// THE BOOKING. A remedy's proposal (the enrollment's slot's local start on `proposed_date`, in the
// enrollment's zone) or its pending counter (its own date, start and zone) becomes one `scheduled`
// session numbered after the last, `makeup_for_session_id` naming the session made up, the local
// fields as the fact and the instants from `packages/time`; the remedy `booked` with `decided_at`; one
// `makeup_booked` row; the enrollment's last session date moves to the make-up's (its end and its
// slot's release, FR-BOOK-10).
//
// THE REFUSALS, each writing nothing (FR-468): a make-up overlapping another session of the teacher,
// or of the student, refused by the database's exclusion and answered `MAKEUP_REFUSED` naming it;
// a time another remedy reserves (R-320), refused before any write.
//
// THE SLOT EDIT (`003:T019`, the note under T029). The edit takes the teacher's account, then
// `lockKey('teacher-slots')`, then the slot; the booking takes both accounts, the same key, then the
// slots. Staged both ways, the order the database's, as `teacher-slots.spec.ts` stages its races:
// the booking first, the edit waits and then reads the make-up, its slot in use (`SLOT_IN_USE`); the
// edit (a deactivation, which asks no use, FR-314) first, the booking waits and then books.
//
// THE FORCED DEADLOCK (L5). A second connection holds a sentinel account row; the booking's insert,
// through a narrowed store, waits on it; the second connection then asks for the remedy's row the
// booking holds, so the database refuses the booking `40P01` (the one waiting longer runs the check).
// Once: the booking runs again in a new transaction and is kept, one `warn` line. Twice: `MAKEUP_REFUSED`,
// the remedy open, nothing written, the two deadlock lines and the refusal's.
//
// Committed rows, each probe a world of its own; the single-transaction probes roll back.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createCatalogUse,
  createEnrollmentSide,
} from '../../apps/api/src/modules/booking/index.js';
import { createCatalogServices } from '../../apps/api/src/modules/catalog/index.js';
import {
  createMakeupBooking,
  lastSessionDateOf,
  type MakeupBookingStore,
  makeupBookingStore,
  makeupRefusalOf,
} from '../../apps/api/src/modules/sessions/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import { DomainError } from '../../apps/api/src/platform/errors/domain-error.js';
import type { Logger } from '../../apps/api/src/platform/logging/logger.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
import {
  connectAsApplication,
  type Db,
  enrollmentValues,
  insertRow,
  makeOffer,
  makeUser,
} from './harness';

const OPTIONS = { maxWait: 5_000, timeout: 20_000 };

let db: Db;
let other: Db;
let watcher: Db;
let database: Database;

const settings: SettingsReader = {
  read: async (key, schema) => {
    if (key === 'slot_release_buffer_weeks') return schema.parse(0);
    throw new Error(`unexpected setting ${key}`);
  },
};
const enrollments = createEnrollmentSide({ settings });

/** The lines a booking wrote, by level. */
function recorder() {
  const lines: { level: string; fields: unknown; message: unknown }[] = [];
  const log = {
    info: (fields: unknown, message: unknown) => lines.push({ level: 'info', fields, message }),
    warn: (fields: unknown, message: unknown) => lines.push({ level: 'warn', fields, message }),
  } as unknown as Pick<Logger, 'info' | 'warn'>;
  return { lines, log };
}

function bookingOver(store?: MakeupBookingStore, log = recorder().log) {
  return createMakeupBooking({
    transactions: {
      run: (work) => database.$transaction(work, OPTIONS),
    },
    enrollments,
    log,
    ...(store === undefined ? {} : { store }),
  });
}

beforeAll(async () => {
  [db, other, watcher] = await Promise.all([
    connectAsApplication(),
    connectAsApplication(),
    connectAsApplication(),
  ]);
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 4,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
});

afterAll(async () => {
  await Promise.all([db?.end(), other?.end(), watcher?.end()]);
  if (database !== undefined) await closeDatabase(database);
});

const ROLLED_BACK = Symbol('rolled back');

async function rolledBack(probe: (tx: Transaction) => Promise<void>): Promise<void> {
  try {
    await database.$transaction(async (tx) => {
      await probe(tx);
      throw ROLLED_BACK;
    }, OPTIONS);
  } catch (thrown) {
    if (thrown !== ROLLED_BACK) throw thrown;
  }
}

/** Resolves once backend `pid` waits on a lock; fails after about four seconds. */
async function seenWaiting(pid: () => number): Promise<void> {
  for (let look = 0; look < 200; look += 1) {
    const { rows } = await watcher.query<{ waiting: boolean }>(
      `SELECT wait_event_type = 'Lock' AS waiting FROM pg_stat_activity WHERE pid = $1`,
      [pid()],
    );
    if (rows[0]?.waiting === true) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`backend ${String(pid())} never waited on a lock`);
}

function signal(): { readonly give: () => void; readonly given: Promise<void> } {
  let give = (): void => undefined;
  const given = new Promise<void>((resolve) => {
    give = resolve;
  });
  return { give, given };
}

async function pidOf(tx: Transaction): Promise<number> {
  const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
  return row?.pid ?? 0;
}

/** A committed confirmed enrollment between `studentId` (new if absent) and a new teacher's slot. */
async function confirmed(studentId?: string) {
  const offer = await makeOffer(db);
  const student = studentId ?? (await makeUser(db));
  const id = await insertRow(db, 'enrollments', {
    ...enrollmentValues(offer, student),
    status: 'confirmed',
    confirmed_at: new Date('2026-10-04T07:01:00Z'),
  });
  return { id, studentId: student, teacherId: offer.teacherId, slotId: offer.slotId, offer };
}

type Enrollment = Awaited<ReturnType<typeof confirmed>>;

/** A committed session of the enrollment on `day` (an October day of 2026, or a full date). */
function sessionOn(
  enrollment: Enrollment,
  sequence: number,
  date: string,
  status: string,
  startsAt = `${date}T07:00:00Z`,
  endsAt = `${date}T08:00:00Z`,
): Promise<string> {
  return insertRow(db, 'sessions', {
    enrollment_id: enrollment.id,
    teacher_user_id: enrollment.teacherId,
    student_user_id: enrollment.studentId,
    sequence_number: sequence,
    scheduled_date_local: date,
    scheduled_start_time_local: '09:00:00',
    timezone: 'Africa/Cairo',
    scheduled_start_at: startsAt,
    scheduled_end_at: endsAt,
    status,
  });
}

/**
 * A committed Teacher-No-Show on 2026-10-11 and its remedy, the proposal on Sunday 2026-12-06 at the
 * slot's 09:00 in Cairo (+02:00): 07:00Z to 08:00Z.
 */
async function owedOn(
  enrollment: Enrollment,
  values: Readonly<Record<string, unknown>> = {},
  owedDay = '2026-10-11',
) {
  const sessionId = await sessionOn(
    enrollment,
    1,
    owedDay,
    'teacher_no_show',
    `${owedDay}T06:00:00Z`,
    `${owedDay}T07:00:00Z`,
  );
  const remedyId = await insertRow(db, 'session_remedies', {
    session_id: sessionId,
    kind: 'makeup',
    status: 'proposed',
    offered_at: '2026-11-01T08:00:00Z',
    choice_closes_at: '2026-11-08T08:00:00Z',
    snapshot_answer_window_hours: 72,
    snapshot_first_session_lead_hours: 24,
    proposed_date: '2026-12-06',
    ...values,
  });
  return { sessionId, remedyId };
}

async function codeOf(call: Promise<unknown>): Promise<DomainError> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(thrown instanceof DomainError))
    throw new Error(`expected a DomainError: ${String(thrown)}`);
  return thrown;
}

/** What is committed for the remedy: its status and kind, its make-ups, its events. */
async function committed(remedyId: string, sessionId: string) {
  const remedy = await db.query<{ status: string; decided: boolean }>(
    `SELECT status::text, decided_at IS NOT NULL AS decided FROM session_remedies WHERE id = $1::uuid`,
    [remedyId],
  );
  const makeups = await db.query<{ id: string }>(
    'SELECT id FROM sessions WHERE makeup_for_session_id = $1::uuid',
    [sessionId],
  );
  const events = await db.query<{ kind: string }>(
    'SELECT kind::text FROM session_events WHERE session_id = $1::uuid ORDER BY id',
    [sessionId],
  );
  return {
    ...remedy.rows[0],
    makeups: makeups.rows.length,
    events: events.rows.map(({ kind }) => kind),
  };
}

const PROPOSAL = { booking: 'proposal', operation: 'sessions.remedy.accept' } as const;

describe("a make-up's booking over the real tables (T029, FR-469)", () => {
  it('books the proposal: one session after the last, its make-up link, the remedy booked, one event, the end moved', async () => {
    const enrollment = await confirmed();
    const { sessionId, remedyId } = await owedOn(enrollment);
    await sessionOn(
      enrollment,
      2,
      '2026-10-18',
      'done',
      '2026-10-18T06:00:00Z',
      '2026-10-18T07:00:00Z',
    );
    await rolledBack(async (tx) => {
      const booked = await bookingOver().bookOn(tx, { remedyId, ...PROPOSAL });
      expect(booked).toMatchObject({
        remedyId,
        sessionId,
        enrollmentId: enrollment.id,
        startsAt: new Date('2026-12-06T07:00:00Z'),
        endsAt: new Date('2026-12-06T08:00:00Z'),
      });
      const made = await tx.session.findUniqueOrThrow({ where: { id: booked.makeupSessionId } });
      expect(made).toMatchObject({
        enrollmentId: enrollment.id,
        teacherUserId: enrollment.teacherId,
        studentUserId: enrollment.studentId,
        sequenceNumber: 3,
        makeupForSessionId: sessionId,
        scheduledDateLocal: new Date('2026-12-06T00:00:00Z'),
        scheduledStartTimeLocal: new Date('1970-01-01T09:00:00Z'),
        timezone: 'Africa/Cairo',
        scheduledStartAt: new Date('2026-12-06T07:00:00Z'),
        scheduledEndAt: new Date('2026-12-06T08:00:00Z'),
        status: 'scheduled',
      });
      const remedy = await tx.sessionRemedy.findUniqueOrThrow({ where: { id: remedyId } });
      expect(remedy).toMatchObject({ status: 'booked', kind: 'makeup', caseId: null });
      expect(remedy.decidedAt).toBeInstanceOf(Date);
      const events = await tx.sessionEvent.findMany({ where: { enrollmentId: enrollment.id } });
      expect(events.map(({ kind, sessionId: of }) => [kind, of])).toEqual([
        ['makeup_booked', sessionId],
      ]);
      expect((await lastSessionDateOf(tx, [enrollment.id])).get(enrollment.id)).toBe('2026-12-06');
    });
  });

  it('books a pending counter on its own slot, date, start and zone, the counter cleared', async () => {
    const enrollment = await confirmed();
    const counterSlot = await insertRow(db, 'availability_slots', {
      teacher_user_id: enrollment.teacherId,
      day_of_week: 2,
      start_time_local: '10:30:00',
      duration_minutes: 60,
      timezone: 'Africa/Cairo',
      is_active: true,
    });
    const { remedyId } = await owedOn(enrollment, {
      status: 'counter_proposed',
      counter_slot_id: counterSlot,
      counter_date: '2026-12-08',
      counter_start_time_local: '10:30:00',
      counter_timezone: 'Africa/Cairo',
      counter_proposed_at: new Date(),
    });
    await rolledBack(async (tx) => {
      const booked = await bookingOver().bookOn(tx, {
        remedyId,
        booking: 'counter',
        operation: 'sessions.remedy.answerCounter',
      });
      expect(booked).toMatchObject({
        startsAt: new Date('2026-12-08T08:30:00Z'),
        endsAt: new Date('2026-12-08T09:30:00Z'),
      });
      const remedy = await tx.sessionRemedy.findUniqueOrThrow({ where: { id: remedyId } });
      expect(remedy).toMatchObject({
        status: 'booked',
        counterSlotId: null,
        counterDate: null,
        counterStartTimeLocal: null,
        counterTimezone: null,
        counterProposedAt: null,
      });
    });
  });

  it.each(['teacher', 'student'] as const)(
    'refuses a make-up overlapping another session of the %s MAKEUP_REFUSED, nothing written (FR-468)',
    async (party) => {
      const enrollment = await confirmed();
      const { sessionId, remedyId } = await owedOn(enrollment);
      // Another enrollment of the same party, its session at the proposal's very time.
      const neighbour =
        party === 'student'
          ? await confirmed(enrollment.studentId)
          : await secondStudentOf(enrollment);
      await sessionOn(neighbour, 1, '2026-12-06', 'scheduled');
      await rolledBack(async (tx) => {
        const refused = await codeOf(bookingOver().bookOn(tx, { remedyId, ...PROPOSAL }));
        expect(refused.code).toBe('MAKEUP_REFUSED');
        expect(makeupRefusalOf(refused)).toEqual({
          cause: 'overlap',
          constraint: `sessions_${party}_no_overlap`,
        });
      });
      expect(await committed(remedyId, sessionId)).toEqual({
        status: 'proposed',
        decided: false,
        makeups: 0,
        events: [],
      });
    },
  );

  it('refuses a time another remedy of the student reserves (R-320), and books over none of its own', async () => {
    const enrollment = await confirmed();
    const { sessionId, remedyId } = await owedOn(enrollment);
    // The student's remedy on another teacher's enrollment, proposed at the same instant.
    const neighbour = await confirmed(enrollment.studentId);
    await owedOn(neighbour, {}, '2026-10-12');
    await rolledBack(async (tx) => {
      const refused = await codeOf(bookingOver().bookOn(tx, { remedyId, ...PROPOSAL }));
      expect(refused.code).toBe('MAKEUP_REFUSED');
      expect(makeupRefusalOf(refused)).toEqual({ cause: 'reserved' });
    });
    expect(await committed(remedyId, sessionId)).toEqual({
      status: 'proposed',
      decided: false,
      makeups: 0,
      events: [],
    });
  });
});

/** Another committed enrollment of the enrollment's teacher, on the same slot, a new student. */
async function secondStudentOf(enrollment: Enrollment): Promise<Enrollment> {
  const studentId = await makeUser(db);
  const id = await insertRow(db, 'enrollments', {
    ...enrollmentValues(enrollment.offer, studentId),
    status: 'confirmed',
    confirmed_at: new Date('2026-10-04T07:01:00Z'),
  });
  return { ...enrollment, id, studentId };
}

/** The slots service with every transaction it opens being `tx`. */
function slotsOn(tx: Transaction) {
  const on = new Proxy(database, {
    get: (target, member) =>
      member === '$transaction'
        ? (work: (inner: Transaction) => Promise<unknown>) => work(tx)
        : Reflect.get(target, member),
  }) as Database;
  return createCatalogServices({
    database: on,
    use: createCatalogUse({ settings }),
    idempotency: { run: (_request, effect) => on.$transaction(effect) },
  }).slots;
}

describe("the booking against `003:T019`'s slot edit (the note under T029; 003:T026 nit 5)", () => {
  it('the booking first: the edit waits, then finds the slot in use (SLOT_IN_USE)', async () => {
    const enrollment = await confirmed();
    const { sessionId, remedyId } = await owedOn(enrollment);
    const holding = signal();
    const gate = signal();
    let bookingPid = 0;
    let editPid = 0;
    const store: MakeupBookingStore = {
      ...makeupBookingStore,
      recordEvents: async (tx, events) => {
        await makeupBookingStore.recordEvents(tx, events);
        bookingPid = await pidOf(tx);
        holding.give();
        await gate.given;
      },
    };
    const booking = bookingOver(store).book({ remedyId, ...PROPOSAL });
    let editing: Promise<unknown> | undefined;
    try {
      await Promise.race([holding.given, booking]);
      editing = database.$transaction(async (tx) => {
        editPid = await pidOf(tx);
        return slotsOn(tx).update(enrollment.teacherId, {
          slotId: enrollment.slotId,
          startTimeLocal: '10:00',
        });
      }, OPTIONS);
      await seenWaiting(() => editPid);
    } finally {
      gate.give();
    }
    const [booked, edited] = await Promise.allSettled([booking, editing]);
    expect(bookingPid).not.toBe(0);
    expect(booked.status).toBe('fulfilled');
    expect(edited.status).toBe('rejected');
    expect(edited.status === 'rejected' && (edited.reason as DomainError).code).toBe('SLOT_IN_USE');
    expect(await committed(remedyId, sessionId)).toEqual({
      status: 'booked',
      decided: true,
      makeups: 1,
      events: ['makeup_booked'],
    });
    const slot = await db.query<{ start: string }>(
      'SELECT start_time_local::text AS start FROM availability_slots WHERE id = $1::uuid',
      [enrollment.slotId],
    );
    expect(slot.rows[0]?.start).toBe('09:00:00');
  });

  it('the edit first (a deactivation, which asks no use): the booking waits, then books', async () => {
    const enrollment = await confirmed();
    const { sessionId, remedyId } = await owedOn(enrollment);
    const held = signal();
    const gate = signal();
    let bookingPid = 0;
    const editing = database.$transaction(async (tx) => {
      await slotsOn(tx).update(enrollment.teacherId, {
        slotId: enrollment.slotId,
        isActive: false,
      });
      held.give();
      await gate.given;
    }, OPTIONS);
    let booking: Promise<unknown> | undefined;
    try {
      await Promise.race([held.given, editing]);
      const store: MakeupBookingStore = {
        ...makeupBookingStore,
        remedyToBook: async (tx, id) => {
          if (bookingPid === 0) bookingPid = await pidOf(tx);
          return makeupBookingStore.remedyToBook(tx, id);
        },
      };
      booking = bookingOver(store).book({ remedyId, ...PROPOSAL });
      await seenWaiting(() => bookingPid);
    } finally {
      gate.give();
    }
    const [edited, booked] = await Promise.allSettled([editing, booking]);
    expect(edited.status).toBe('fulfilled');
    expect(booked.status).toBe('fulfilled');
    expect(await committed(remedyId, sessionId)).toEqual({
      status: 'booked',
      decided: true,
      makeups: 1,
      events: ['makeup_booked'],
    });
    const slot = await db.query<{ active: boolean; start: string }>(
      'SELECT is_active AS active, start_time_local::text AS start FROM availability_slots WHERE id = $1::uuid',
      [enrollment.slotId],
    );
    expect(slot.rows[0]).toEqual({ active: false, start: '09:00:00' });
  });
});

describe('a forced deadlock on the booking (T029, L5, kernel.md runRetryingDeadlockOnce)', () => {
  /**
   * The booking's store, its insert first waiting on `sentinel`'s account row for each of the first
   * `times` attempts, each attempt only once `armed(attempt)` resolves; `waiting` hands out its backend.
   */
  function deadlocking(
    sentinel: string,
    times: number,
    armed: (attempt: number) => Promise<void>,
    waiting: (attempt: number, pid: number) => void,
  ): MakeupBookingStore {
    let attempt = 0;
    return {
      ...makeupBookingStore,
      insertMakeup: async (tx, row) => {
        attempt += 1;
        if (attempt <= times) {
          await armed(attempt);
          waiting(attempt, await pidOf(tx));
          await tx.$executeRaw`SELECT 1 FROM users WHERE id = ${sentinel}::uuid FOR UPDATE`;
        }
        return makeupBookingStore.insertMakeup(tx, row);
      },
    };
  }

  /** The second connection: holds the sentinel, then asks for the remedy the booking holds. */
  async function crossOnce(sentinel: string, remedyId: string, bookingPid: () => number) {
    await other.query('BEGIN');
    await other.query('SELECT 1 FROM users WHERE id = $1::uuid FOR UPDATE', [sentinel]);
    return {
      cross: async () => {
        await seenWaiting(bookingPid);
        // Waits on the booking's remedy row until the database refuses the booking (40P01).
        await other.query('SELECT 1 FROM session_remedies WHERE id = $1::uuid FOR UPDATE', [
          remedyId,
        ]);
        await other.query('ROLLBACK');
      },
    };
  }

  it('once: retried in a new transaction and kept, one warn line { operation, attempt: 1, remedyId }', async () => {
    const enrollment = await confirmed();
    const { sessionId, remedyId } = await owedOn(enrollment);
    const sentinel = await makeUser(db);
    let pid = 0;
    const first = signal();
    const { lines, log } = recorder();
    const { cross } = await crossOnce(sentinel, remedyId, () => pid);
    const store = deadlocking(
      sentinel,
      1,
      async () => undefined,
      (_attempt, backend) => {
        pid = backend;
        first.give();
      },
    );
    const booking = bookingOver(store, log).book({ remedyId, ...PROPOSAL });
    await first.given;
    await cross();
    await booking;
    expect(lines).toEqual([
      {
        level: 'warn',
        fields: { operation: 'sessions.remedy.accept', attempt: 1, remedyId },
        message: 'Transaction deadlocked',
      },
    ]);
    expect(await committed(remedyId, sessionId)).toEqual({
      status: 'booked',
      decided: true,
      makeups: 1,
      events: ['makeup_booked'],
    });
  });

  it('twice: MAKEUP_REFUSED, the remedy open, nothing written, the two deadlock lines and the refusal line', async () => {
    const enrollment = await confirmed();
    const { sessionId, remedyId } = await owedOn(enrollment);
    const sentinel = await makeUser(db);
    let pid = 0;
    const reached = [signal(), signal()];
    const secondArmed = signal();
    const { lines, log } = recorder();
    const store = deadlocking(
      sentinel,
      2,
      async (attempt) => {
        if (attempt === 2) await secondArmed.given;
      },
      (attempt, backend) => {
        pid = backend;
        reached[attempt - 1]?.give();
      },
    );
    const firstCross = await crossOnce(sentinel, remedyId, () => pid);
    const booking = bookingOver(store, log).book({
      remedyId,
      booking: 'proposal',
      operation: 'advance-remedies',
    });
    const outcome = booking.then(
      () => undefined,
      (error: unknown) => error,
    );
    await reached[0]?.given;
    await firstCross.cross();
    const secondCross = await crossOnce(sentinel, remedyId, () => pid);
    secondArmed.give();
    await reached[1]?.given;
    await secondCross.cross();
    const refused = await outcome;
    expect(refused).toBeInstanceOf(DomainError);
    expect((refused as DomainError).code).toBe('MAKEUP_REFUSED');
    expect(makeupRefusalOf(refused)).toEqual({ cause: 'deadlock' });
    expect(lines).toEqual([
      {
        level: 'warn',
        fields: { operation: 'advance-remedies', attempt: 1, remedyId },
        message: 'Transaction deadlocked',
      },
      {
        level: 'warn',
        fields: { operation: 'advance-remedies', attempt: 2, remedyId },
        message: 'Transaction deadlocked',
      },
      {
        level: 'warn',
        fields: { operation: 'advance-remedies', attempts: 2, remedyId },
        message: 'Refused after a second deadlock',
      },
    ]);
    expect(await committed(remedyId, sessionId)).toEqual({
      status: 'proposed',
      decided: false,
      makeups: 0,
      events: [],
    });
  });
});
