// T031 of specs/004-sessions/tasks.md — the student's remedy procedures over the real tables as the
// application role, composed as `main.ts` composes them (`createSessionsServices`'s `remedy`): FR-463
// to FR-467; research R-311, "The student"; the notes under T031 (Q5 (a), Q9 (a), Q14 (a)).
//
//   - `choose`: a make-up moves `awaiting_choice` to `proposed` and writes nothing else; a refund
//     `CHOICE_NOT_ALLOWED` on either track, nothing written, no case opened (T111 of
//     specs/003-booking, DEC-84: a make-up only; an `awaiting_choice` row offered before still
//     chooses its make-up).
//   - `counterOptions`: per active slot of the session's length, its first occurrence at or after
//     max(now + A + L, `choice_closes_at`) free of the parties' sessions and the reservations (the
//     remedy's own proposal among them), in the slot's own zone; A and L the row's, never the setting.
//   - `counter`: the five columns, one `counter_proposed` row with the slot, date, start and zone;
//     a retry with the same key answers the first outcome and writes nothing (Q14 (a)); a second
//     `COUNTER_PENDING`; a time not offered `SLOT_NOT_OFFERED`; past `choice_closes_at`
//     `REMEDY_NOT_OPEN` (Q9 (a)); each refusal writing nothing.
//   - `accept` with a counter pending: one `counter_withdrawn` row, never `counter_booking_refused`,
//     the proposal booked, the counter's columns cleared (its time released).
//
// The clock is fixed at 2026-11-03T08:00Z (Q8's `clockTimestamp` stood in for, as T028's spec does):
// the remedy was offered 2026-11-01T08:00Z, its choice window closing 2026-11-08T08:00Z, A = 72 h and
// L = 24 h on the row. Committed rows, each case a world of its own (a new teacher and student).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createEnrollmentSide } from '../../apps/api/src/modules/booking/index.js';
import {
  createSessionsServices,
  type SessionsServices,
  sessionsStore,
} from '../../apps/api/src/modules/sessions/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import { transactionsOver } from '../../apps/api/src/platform/db/transaction.repository.js';
import { DomainError } from '../../apps/api/src/platform/errors/domain-error.js';
import { IdempotencyRepository } from '../../apps/api/src/platform/idempotency/idempotency.repository.js';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service.js';
import { createLogger } from '../../apps/api/src/platform/logging/logger.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
import {
  connectAsApplication,
  type Db,
  enrollmentValues,
  insertRow,
  makeOffer,
  makeUser,
} from './harness';

const SETTINGS: Record<string, number> = {
  idempotency_key_ttl_hours: 24,
  first_session_lead_hours: 24,
  slot_release_buffer_weeks: 0,
  slot_hold_ttl_minutes: 10,
  slot_hold_grace_minutes: 5,
  // A later change of the settings the row snapshots: no bound of the remedy reads them.
  makeup_counter_answer_hours: 1,
  makeup_choice_window_days: 1,
};
const settings: SettingsReader = { read: async (key, schema) => schema.parse(SETTINGS[key]) };
const log = createLogger({ level: 'fatal', destination: { write: () => undefined } });
const AT = new Date('2026-11-03T08:00:00.000Z');

let db: Db;
let database: Database;
let services: SessionsServices;

beforeAll(async () => {
  db = await connectAsApplication();
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 4,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  services = createSessionsServices({
    transactions: transactionsOver(database),
    settings,
    video: {} as never,
    enrollmentSide: createEnrollmentSide({ settings }),
    store: sessionsStore,
    idempotency: new IdempotencyService<Transaction>({
      store: new IdempotencyRepository(database),
      settings,
    }),
    clock: async () => AT,
  });
});

afterAll(async () => {
  if (database !== undefined) await closeDatabase(database);
  await db?.end();
});

/**
 * A student and a teacher (male) with a confirmed enrollment on the teacher's Sunday 09:00 Cairo
 * slot, a Monday 18:00 slot of the same length beside it, the Teacher-No-Show of 2026-10-11 and its
 * remedy (proposal Sunday 2026-11-15, 07:00Z), and the pair's own session on the Monday slot's first
 * week at or after C, 2026-11-09 16:00Z.
 */
async function world(
  remedy: Readonly<Record<string, unknown>> = {},
  enrollment: Readonly<Record<string, unknown>> = {},
) {
  const offer = await makeOffer(db);
  const studentId = await makeUser(db);
  const enrollmentId = await insertRow(db, 'enrollments', {
    ...enrollmentValues(offer, studentId),
    status: 'confirmed',
    confirmed_at: '2026-10-04T07:01:00Z',
    ...enrollment,
  });
  const mondaySlotId = await insertRow(db, 'availability_slots', {
    teacher_user_id: offer.teacherId,
    day_of_week: 1,
    start_time_local: '18:00:00',
    duration_minutes: 60,
    timezone: 'Africa/Cairo',
    is_active: true,
  });
  const session = (
    sequence: number,
    date: string,
    startsAt: string,
    endsAt: string,
    status: string,
  ) =>
    insertRow(db, 'sessions', {
      enrollment_id: enrollmentId,
      teacher_user_id: offer.teacherId,
      student_user_id: studentId,
      sequence_number: sequence,
      scheduled_date_local: date,
      scheduled_start_time_local: '09:00:00',
      timezone: 'Africa/Cairo',
      scheduled_start_at: startsAt,
      scheduled_end_at: endsAt,
      status,
    });
  const sessionId = await session(
    1,
    '2026-10-11',
    '2026-10-11T06:00:00Z',
    '2026-10-11T07:00:00Z',
    'teacher_no_show',
  );
  await session(2, '2026-11-09', '2026-11-09T16:00:00Z', '2026-11-09T17:00:00Z', 'scheduled');
  const remedyId = await insertRow(db, 'session_remedies', {
    session_id: sessionId,
    kind: 'makeup',
    status: 'awaiting_choice',
    offered_at: '2026-11-01T08:00:00Z',
    choice_closes_at: '2026-11-08T08:00:00Z',
    snapshot_answer_window_hours: 72,
    snapshot_first_session_lead_hours: 24,
    proposed_date: '2026-11-15',
    ...remedy,
  });
  return {
    sessionId,
    remedyId,
    enrollmentId,
    studentId,
    teacherId: offer.teacherId,
    ownSlotId: offer.slotId,
    mondaySlotId,
    offer,
  };
}

type World = Awaited<ReturnType<typeof world>>;

/** What is committed of the remedy and its session: the row, the events, the make-ups, the cases. */
async function committed(w: World) {
  const remedy = await db.query<Record<string, unknown>>(
    `SELECT status::text, kind::text, case_id, decided_at, counter_slot_id,
            to_char(counter_date, 'YYYY-MM-DD') AS counter_date,
            counter_start_time_local::text, counter_timezone, counter_proposed_at
       FROM session_remedies WHERE id = $1::uuid`,
    [w.remedyId],
  );
  const events = await db.query<Record<string, unknown>>(
    `SELECT kind::text, counter_slot_id, to_char(counter_date, 'YYYY-MM-DD') AS counter_date,
            counter_start_time_local::text, counter_timezone
       FROM session_events WHERE session_id = $1::uuid ORDER BY id`,
    [w.sessionId],
  );
  const makeups = await db.query<{ date: string; starts: string }>(
    `SELECT to_char(scheduled_date_local, 'YYYY-MM-DD') AS date,
            to_char(scheduled_start_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI') AS starts
       FROM sessions WHERE makeup_for_session_id = $1::uuid`,
    [w.sessionId],
  );
  const cases = await db.query<{ kind: string; reason: string; status: string }>(
    `SELECT kind::text, reason, status::text
       FROM disputes WHERE enrollment_id = $1::uuid ORDER BY id`,
    [w.enrollmentId],
  );
  return {
    remedy: remedy.rows[0],
    events: events.rows,
    makeups: makeups.rows,
    cases: cases.rows,
  };
}

async function codeOf(call: Promise<unknown>): Promise<string> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(thrown instanceof DomainError)) throw new Error(`expected a refusal: ${String(thrown)}`);
  return thrown.code;
}

const counter = (w: World, localDate: string, slotId = w.mondaySlotId, key = randomUUID()) =>
  services.remedy.counter(
    { userId: w.studentId },
    { sessionId: w.sessionId, slotId, localDate, idempotencyKey: `probe-${key}` },
    log,
  );

describe('sessions.remedy.choose over the real tables (T031, FR-463, FR-467)', () => {
  it('a make-up: awaiting_choice → proposed, nothing else written', async () => {
    const w = await world();
    const before = await committed(w);
    const view = await services.remedy.choose(
      { userId: w.studentId },
      { sessionId: w.sessionId, choice: 'makeup' },
      log,
    );
    expect(view).toMatchObject({ status: 'proposed', kind: 'makeup', canChooseRefund: false });
    const after = await committed(w);
    expect(after.remedy).toMatchObject({ status: 'proposed', kind: 'makeup', case_id: null });
    expect({ ...after, remedy: undefined }).toEqual({ ...before, remedy: undefined });
  });

  // T111 of specs/003-booking (DEC-84; ADR 0025 D5): a recitation Teacher-No-Show's
  // `awaiting_choice` row, offered before the change, is refused a refund and keeps its make-up.
  it('a refund on recitation CHOICE_NOT_ALLOWED, nothing written: no case, no row, still awaiting its make-up (T111)', async () => {
    const w = await world();
    const before = await committed(w);
    expect(before.remedy).toMatchObject({ status: 'awaiting_choice', kind: 'makeup' });
    expect(
      await codeOf(
        services.remedy.choose(
          { userId: w.studentId },
          { sessionId: w.sessionId, choice: 'refund' },
          log,
        ),
      ),
    ).toBe('CHOICE_NOT_ALLOWED');
    const after = await committed(w);
    expect(after).toEqual(before);
    expect(after.cases).toEqual([]);
    // No amount anywhere (FR-467, R-MONEY-6): the case table has no money column to write.
    const { rows } = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name IN ('disputes', 'session_remedies')
          AND (column_name LIKE '%piasters%' OR column_name LIKE '%amount%')`,
    );
    expect(rows).toEqual([]);
  });

  it('a refund on the ijazah track CHOICE_NOT_ALLOWED, nothing written', async () => {
    const w = await world({}, { snapshot_track: 'ijazah_track' });
    const before = await committed(w);
    expect(
      await codeOf(
        services.remedy.choose(
          { userId: w.studentId },
          { sessionId: w.sessionId, choice: 'refund' },
          log,
        ),
      ),
    ).toBe('CHOICE_NOT_ALLOWED');
    expect(await committed(w)).toEqual(before);
  });
});

describe('sessions.remedy.counterOptions over the real tables (T031, H2; Q5 (a))', () => {
  it('per active slot its first free occurrence at or after C: the Monday slot past the pair’s session, the Sunday past the proposal’s own reservation', async () => {
    const w = await world({ status: 'proposed' });
    expect(
      await services.remedy.counterOptions(
        { userId: w.studentId },
        { sessionId: w.sessionId },
        log,
      ),
    ).toEqual({
      options: [
        {
          slotId: w.mondaySlotId,
          localDate: '2026-11-16',
          startTimeLocal: '18:00',
          timezone: 'Africa/Cairo',
          startsAt: '2026-11-16T16:00:00Z',
        },
        {
          slotId: w.ownSlotId,
          localDate: '2026-11-22',
          startTimeLocal: '09:00',
          timezone: 'Africa/Cairo',
          startsAt: '2026-11-22T07:00:00Z',
        },
      ],
    });
  });

  it('A and L are the row’s: with A = 300 h the bound is now + 324 h, whatever the setting says', async () => {
    const w = await world({ status: 'proposed', snapshot_answer_window_hours: 300 });
    const { options } = await services.remedy.counterOptions(
      { userId: w.studentId },
      { sessionId: w.sessionId },
      log,
    );
    // Bound 2026-11-16T20:00Z, past C: the Sunday slot's 2026-11-22, the Monday's 2026-11-23.
    expect(options.map(({ localDate }) => localDate)).toEqual(['2026-11-22', '2026-11-23']);
  });
});

describe('sessions.remedy.counter over the real tables (T031, FR-465, D1, Q14 (a))', () => {
  it('writes the five columns and one counter_proposed row; the same key answers the first outcome and writes nothing more; a second COUNTER_PENDING', async () => {
    const w = await world({ status: 'proposed' });
    const key = randomUUID();
    const first = await counter(w, '2026-11-16', w.mondaySlotId, key);
    expect(first.counter).toEqual({
      localDate: '2026-11-16',
      startTimeLocal: '18:00',
      timezone: 'Africa/Cairo',
      startsAt: '2026-11-16T16:00:00Z',
      answerClosesAt: '2026-11-06T08:00:00.000Z',
    });
    const after = await committed(w);
    expect(after.remedy).toMatchObject({
      status: 'counter_proposed',
      counter_slot_id: w.mondaySlotId,
      counter_date: '2026-11-16',
      counter_start_time_local: '18:00:00',
      counter_timezone: 'Africa/Cairo',
      counter_proposed_at: AT,
    });
    expect(after.events).toEqual([
      {
        kind: 'counter_proposed',
        counter_slot_id: w.mondaySlotId,
        counter_date: '2026-11-16',
        counter_start_time_local: '18:00:00',
        counter_timezone: 'Africa/Cairo',
      },
    ]);
    expect(await counter(w, '2026-11-16', w.mondaySlotId, key)).toEqual(first);
    expect(await committed(w)).toEqual(after);
    expect(await codeOf(counter(w, '2026-11-22', w.ownSlotId))).toBe('COUNTER_PENDING');
    expect(await committed(w)).toEqual(after);
  });

  it('a time not offered SLOT_NOT_OFFERED, and past choice_closes_at REMEDY_NOT_OPEN (Q9 (a)), each writing nothing', async () => {
    const w = await world({ status: 'proposed' });
    const before = await committed(w);
    for (const [localDate, slotId] of [
      ['2026-11-09', w.mondaySlotId],
      ['2026-11-23', w.mondaySlotId],
      ['2026-11-15', w.ownSlotId],
    ] as const) {
      expect(await codeOf(counter(w, localDate, slotId))).toBe('SLOT_NOT_OFFERED');
    }
    expect(await committed(w)).toEqual(before);
    const closed = await world({
      status: 'proposed',
      offered_at: '2026-10-25T08:00:00Z',
      choice_closes_at: '2026-11-01T08:00:00Z',
    });
    const closedBefore = await committed(closed);
    expect(await codeOf(counter(closed, '2026-11-16'))).toBe('REMEDY_NOT_OPEN');
    expect(await committed(closed)).toEqual(closedBefore);
  });
});

/**
 * Another student's package on the teacher's Monday slot, confirmed, its final session 2026-11-02
 * disputed and still open, so it is not completed: under the owner's rule of 2026-11-10 the slot is
 * its own on every week until it completes, with no session or reservation on the weeks after.
 */
async function otherPackageOnMonday(w: World) {
  const otherStudentId = await makeUser(db);
  const enrollmentId = await insertRow(db, 'enrollments', {
    ...enrollmentValues(w.offer, otherStudentId),
    slot_id: w.mondaySlotId,
    status: 'confirmed',
    confirmed_at: '2026-10-04T07:01:00Z',
    snapshot_session_count: 1,
    quoted_first_session_local_date: '2026-11-02',
  });
  await insertRow(db, 'sessions', {
    enrollment_id: enrollmentId,
    teacher_user_id: w.teacherId,
    student_user_id: otherStudentId,
    sequence_number: 1,
    scheduled_date_local: '2026-11-02',
    scheduled_start_time_local: '18:00:00',
    timezone: 'Africa/Cairo',
    scheduled_start_at: '2026-11-02T16:00:00Z',
    scheduled_end_at: '2026-11-02T17:00:00Z',
    status: 'disputed',
  });
}

describe("the counter and another package's slot (the owner's rule of 2026-11-10; the follow-up under T031 and T029)", () => {
  it('the options leave out every week of a slot another confirmed package keeps, and a counter on it is SLOT_NOT_OFFERED, nothing written', async () => {
    const w = await world({ status: 'proposed' });
    await otherPackageOnMonday(w);
    const { options } = await services.remedy.counterOptions(
      { userId: w.studentId },
      { sessionId: w.sessionId },
      log,
    );
    expect(options.map(({ slotId, localDate }) => [slotId, localDate])).toEqual([
      [w.ownSlotId, '2026-11-22'],
    ]);
    const before = await committed(w);
    expect(await codeOf(counter(w, '2026-11-16'))).toBe('SLOT_NOT_OFFERED');
    expect(await committed(w)).toEqual(before);
  });
  // A counter written before the other package took the slot, refused at its booking and released
  // (the owner's decision (b) under T032): `remedy-windows.spec.ts`.
});

describe('sessions.remedy.accept over the real tables (T031, FR-469)', () => {
  it('with a counter pending: one counter_withdrawn row and no counter_booking_refused, the proposal booked, the counter cleared', async () => {
    const w = await world({ status: 'proposed' });
    await counter(w, '2026-11-16');
    const view = await services.remedy.accept(
      { userId: w.studentId },
      { sessionId: w.sessionId },
      log,
    );
    expect(view).toMatchObject({ status: 'booked' });
    const after = await committed(w);
    expect(after.remedy).toMatchObject({
      status: 'booked',
      counter_slot_id: null,
      counter_date: null,
      counter_proposed_at: null,
    });
    expect(after.makeups).toEqual([{ date: '2026-11-15', starts: '2026-11-15T07:00' }]);
    expect(view.makeupSessionId).toBeDefined();
    expect(after.events.map(({ kind }) => kind)).toEqual([
      'counter_proposed',
      'counter_withdrawn',
      'makeup_booked',
    ]);
  });
});
