// T032 of specs/004-sessions/tasks.md — the teacher's answer and the windows' ends over the real
// tables as the application role (FR-465 to FR-468; research R-311, "The teacher", "Windows ending"
// and "Booking a make-up"; data-model.md §3, the remedy's table; D1; H3, H5; A1, A3, A7; the notes
// under T029 and T032, Q4 (a), Q11 (a)).
//
//   - `answerCounter`: accept books the counter; decline releases it (`proposed`) inside the choice
//     window, the student countering again on options read again (H4), and books the proposal after
//     it; an acceptance the database refuses, or T029 refuses on a week another package keeps
//     (`slot_taken`, the owner's decision (b) under T032), answers `MAKEUP_REFUSED`, releases the counter in a
//     second transaction (one `counter_booking_refused` row, never `counter_withdrawn`, never a
//     `counter_unanswered` case), one warn line `{ sessionId, enrollmentId, constraint }`, and books
//     the proposal once the choice window has closed.
//   - D1 at its boundary: `answerCounter`'s refusal and the sweep agree at `answerClosesAt`, from the
//     row's A and never the setting.
//   - the windows' ends through `advance-remedies`' run (`createRemedyAdvance` over
//     `createRemedyWindows`): the worst case, a counter sent just before C, handed to its case at
//     C + A; H5's booking, run twice (one booking); a refused proposal retried up to the last instant
//     L before its start, each refusal one warn line, then handed to a `makeup_refused` case (kind
//     `makeup`), error tracking told once; a retry refused over a hold or another remedy's
//     reservation of either party.
//   - the job as `worker.ts` builds it hands an unanswered counter over (the composition).
//
// The clock is set per case (Q8's `clockTimestamp` stood in for, as T028's spec does) but for the
// job's case, which reads the database's own. Committed rows, each case a world of its own; the
// sweep's reads are narrowed to the case's remedies.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { advanceRemedies } from '../../apps/api/src/jobs/advance-remedies.js';
import { createEnrollmentSide } from '../../apps/api/src/modules/booking/index.js';
import {
  type AdvanceRun,
  createCompletion,
  createRemedyAdvance,
  createRemedyWindows,
  createSessionsServices,
  remedyAdvanceStore,
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
import type { Logger } from '../../apps/api/src/platform/logging/logger.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
import { addDays, addHours } from '../../packages/time/src/index.js';
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
  dispute_window_hours: 72,
  admin_list_page_size: 50,
  // A later change of the settings the row snapshots: no bound of the remedy reads them (D1).
  makeup_counter_answer_hours: 1,
  makeup_choice_window_days: 1,
};
const settings: SettingsReader = { read: async (key, schema) => schema.parse(SETTINGS[key]) };

/** The remedy's world: offered 2026-11-01T08:00Z, C 2026-11-08T08:00Z, A 72 h, L 24 h. */
const AT = new Date('2026-11-03T08:00:00.000Z');
const C = new Date('2026-11-08T08:00:00.000Z');

let db: Db;
let database: Database;
let services: SessionsServices;
let clockAt: Date;
let lines: { level: string; fields: Record<string, unknown>; message: string }[];
let reported: Error[];

const log = {
  info: (fields: Record<string, unknown>, message: string) =>
    lines.push({ level: 'info', fields, message }),
  warn: (fields: Record<string, unknown>, message: string) =>
    lines.push({ level: 'warn', fields, message }),
  error: (fields: Record<string, unknown>, message: string) =>
    lines.push({ level: 'error', fields, message }),
  fatal: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
} as unknown as Logger;

const clock = async () => clockAt;
const enrollments = createEnrollmentSide({ settings, now: () => clockAt });

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
    enrollmentSide: enrollments,
    store: sessionsStore,
    idempotency: new IdempotencyService<Transaction>({
      store: new IdempotencyRepository(database),
      settings,
    }),
    clock,
  });
});

afterAll(async () => {
  if (database !== undefined) await closeDatabase(database);
  await db?.end();
});

/** A session of `enrollment` between its parties; returns its id. */
function sessionOf(
  enrollment: { id: string; studentId: string; teacherId: string },
  sequence: number,
  startsAt: string,
  endsAt: string,
  status: string,
): Promise<string> {
  return insertRow(db, 'sessions', {
    enrollment_id: enrollment.id,
    teacher_user_id: enrollment.teacherId,
    student_user_id: enrollment.studentId,
    sequence_number: sequence,
    scheduled_date_local: startsAt.slice(0, 10),
    scheduled_start_time_local: '09:00:00',
    timezone: 'Africa/Cairo',
    scheduled_start_at: startsAt,
    scheduled_end_at: endsAt,
    status,
  });
}

/**
 * The world of `remedy-choice.spec.ts`: a teacher's Sunday 09:00 Cairo slot (the enrollment's) and
 * Monday 18:00 slot, a confirmed enrollment, its Teacher-No-Show of 2026-10-11 and its remedy
 * (proposal Sunday 2026-11-15, 07:00Z to 08:00Z), the pair's own session on Monday 2026-11-09.
 */
async function world(remedy: Readonly<Record<string, unknown>> = {}) {
  const offer = await makeOffer(db);
  const studentId = await makeUser(db);
  const enrollmentId = await insertRow(db, 'enrollments', {
    ...enrollmentValues(offer, studentId),
    status: 'confirmed',
    confirmed_at: '2026-10-04T07:01:00Z',
  });
  const mondaySlotId = await insertRow(db, 'availability_slots', {
    teacher_user_id: offer.teacherId,
    day_of_week: 1,
    start_time_local: '18:00:00',
    duration_minutes: 60,
    timezone: 'Africa/Cairo',
    is_active: true,
  });
  const enrollment = { id: enrollmentId, studentId, teacherId: offer.teacherId };
  const sessionId = await sessionOf(
    enrollment,
    1,
    '2026-10-11T06:00:00Z',
    '2026-10-11T07:00:00Z',
    'teacher_no_show',
  );
  await sessionOf(enrollment, 2, '2026-11-09T16:00:00Z', '2026-11-09T17:00:00Z', 'scheduled');
  const remedyId = await insertRow(db, 'session_remedies', {
    session_id: sessionId,
    kind: 'makeup',
    status: 'proposed',
    offered_at: '2026-11-01T08:00:00Z',
    choice_closes_at: C.toISOString(),
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
    offer,
    mondaySlotId,
  };
}

type World = Awaited<ReturnType<typeof world>>;

/**
 * Another student of the teacher with a session at `[startsAt, endsAt)`: the teacher's overlap only.
 * Its enrollment is on a slot of its own, inactive, never the counter's: a confirmed package keeps
 * its slot on every week (the owner's rule of 2026-11-10), which would refuse the counter before the
 * database's exclusion these cases test (the follow-up under T032).
 */
async function teacherBusy(w: World, startsAt: string, endsAt: string): Promise<void> {
  const other = await makeUser(db);
  const slotId = await insertRow(db, 'availability_slots', {
    teacher_user_id: w.teacherId,
    day_of_week: 2,
    start_time_local: '18:00:00',
    duration_minutes: 60,
    timezone: 'Africa/Cairo',
    is_active: false,
  });
  const id = await insertRow(db, 'enrollments', {
    ...enrollmentValues(w.offer, other),
    slot_id: slotId,
    status: 'confirmed',
    confirmed_at: '2026-10-04T07:01:00Z',
  });
  await sessionOf(
    { id, studentId: other, teacherId: w.teacherId },
    1,
    startsAt,
    endsAt,
    'scheduled',
  );
}

/**
 * Another student's package on the counter's Monday slot, confirmed, its final session 2026-11-02
 * disputed and still open, so not completed: under the owner's rule of 2026-11-10 the slot is its
 * own on every week, with no session or reservation on the counter's week.
 */
async function otherPackageKeepsMonday(w: World): Promise<void> {
  const other = await makeUser(db);
  const id = await insertRow(db, 'enrollments', {
    ...enrollmentValues(w.offer, other),
    slot_id: w.mondaySlotId,
    status: 'confirmed',
    confirmed_at: '2026-10-04T07:01:00Z',
    snapshot_session_count: 1,
    quoted_first_session_local_date: '2026-11-02',
  });
  await sessionOf(
    { id, studentId: other, teacherId: w.teacherId },
    1,
    '2026-11-02T16:00:00Z',
    '2026-11-02T17:00:00Z',
    'disputed',
  );
}

/** What is committed of the remedy and its session. */
async function committed(w: World) {
  const remedy = await db.query<Record<string, unknown>>(
    `SELECT status::text, kind::text, counter_slot_id, counter_proposed_at
       FROM session_remedies WHERE id = $1::uuid`,
    [w.remedyId],
  );
  const events = await db.query<{ kind: string }>(
    'SELECT kind::text FROM session_events WHERE session_id = $1::uuid ORDER BY id',
    [w.sessionId],
  );
  const makeups = await db.query<{ starts: string }>(
    `SELECT to_char(scheduled_start_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI') AS starts
       FROM sessions WHERE makeup_for_session_id = $1::uuid ORDER BY id`,
    [w.sessionId],
  );
  const cases = await db.query<{ reason: string }>(
    'SELECT reason FROM disputes WHERE enrollment_id = $1::uuid ORDER BY id',
    [w.enrollmentId],
  );
  return {
    remedy: remedy.rows[0],
    events: events.rows.map(({ kind }) => kind),
    makeups: makeups.rows.map(({ starts }) => starts),
    cases: cases.rows.map(({ reason }) => reason),
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

/** The student's counter on the Monday slot's 2026-11-16 (18:00 Cairo, 16:00Z), at `at`. */
async function counterOn(w: World, at: Date) {
  clockAt = at;
  return services.remedy.counter(
    { userId: w.studentId },
    {
      sessionId: w.sessionId,
      slotId: w.mondaySlotId,
      localDate: '2026-11-16',
      idempotencyKey: `probe-${randomUUID()}`,
    },
    log,
  );
}

const answer = (w: World, accept: boolean, at: Date) => {
  clockAt = at;
  return services.remedy.answerCounter(
    { userId: w.teacherId },
    { sessionId: w.sessionId, accept },
    log,
  );
};

/** The windows and the sweep over this case's remedies only, at `clockAt`. */
function sweepOf(remedyIds: readonly string[]) {
  const mine = new Set(remedyIds);
  return createRemedyAdvance({
    transactions: transactionsOver(database),
    offer: { offer: async () => null },
    windows: createRemedyWindows({
      transactions: transactionsOver(database),
      enrollments,
      log,
      report: (error) => {
        reported.push(error);
      },
      clock,
    }),
    completion: { completeIfDue: async () => false },
    enrollments: {
      enrollmentPage: async () => ({ items: [] }),
      lockEnrollments: async () => undefined,
    },
    settings,
    log,
    pageSize: 2,
    clock,
    store: {
      ...remedyAdvanceStore,
      dueForOffer: async () => [],
      frozenRemedies: async () => [],
      enrollmentsSettledAmong: async () => [],
      pendingCounters: async (tx, after, limit) =>
        (await remedyAdvanceStore.pendingCounters(tx, after, 100_000))
          .filter(({ remedyId }) => mine.has(remedyId))
          .slice(0, limit),
      choiceWindowsEnded: async (tx, at, after, limit) =>
        (await remedyAdvanceStore.choiceWindowsEnded(tx, at, after, 100_000))
          .filter((id) => mine.has(id))
          .slice(0, limit),
    },
  });
}

async function runAt(w: World, at: Date): Promise<AdvanceRun> {
  clockAt = at;
  return sweepOf([w.remedyId]).run();
}

const linesAt = (level: string) =>
  lines.filter((line) => line.level === level).map(({ fields }) => fields);

const reset = () => {
  lines = [];
  reported = [];
};

describe('sessions.remedy.answerCounter over the real tables (T032, FR-465, decision 9)', () => {
  it('accept: the counter booked at its own time, counter_accepted then makeup_booked', async () => {
    reset();
    const w = await world();
    await counterOn(w, AT);
    expect(await answer(w, true, AT)).toMatchObject({ status: 'booked' });
    expect(await committed(w)).toMatchObject({
      remedy: { status: 'booked', counter_slot_id: null },
      events: ['counter_proposed', 'counter_accepted', 'makeup_booked'],
      makeups: ['2026-11-16T16:00'],
      cases: [],
    });
  });

  it('decline inside the choice window: proposed, the counter cleared, counter_declined; a second counter on options read again (H4)', async () => {
    reset();
    const w = await world();
    await counterOn(w, AT);
    expect(await answer(w, false, AT)).toMatchObject({ status: 'proposed' });
    expect(await committed(w)).toMatchObject({
      remedy: { status: 'proposed', counter_slot_id: null, counter_proposed_at: null },
      events: ['counter_proposed', 'counter_declined'],
      makeups: [],
    });
    expect((await counterOn(w, AT)).status).toBe('counter_proposed');
    expect((await committed(w)).events).toEqual([
      'counter_proposed',
      'counter_declined',
      'counter_proposed',
    ]);
  });

  it('decline after the choice window: released, then the proposal booked', async () => {
    reset();
    const w = await world();
    await counterOn(w, new Date('2026-11-07T12:00:00.000Z'));
    expect(await answer(w, false, new Date('2026-11-08T09:00:00.000Z'))).toMatchObject({
      status: 'booked',
    });
    expect(await committed(w)).toMatchObject({
      events: ['counter_proposed', 'counter_declined', 'makeup_booked'],
      makeups: ['2026-11-15T07:00'],
    });
  });
});

describe("a counter's acceptance the database refuses (T032; A3, A1, A7; FR-468)", () => {
  it('inside the choice window: MAKEUP_REFUSED, released, exactly one counter_booking_refused row and no counter_withdrawn, one warn line naming the constraint, never a case', async () => {
    reset();
    const w = await world();
    await counterOn(w, AT);
    await teacherBusy(w, '2026-11-16T16:00:00Z', '2026-11-16T17:00:00Z');
    expect(await codeOf(answer(w, true, AT))).toBe('MAKEUP_REFUSED');
    expect(await committed(w)).toEqual({
      remedy: {
        status: 'proposed',
        kind: 'makeup',
        counter_slot_id: null,
        counter_proposed_at: null,
      },
      events: ['counter_proposed', 'counter_booking_refused'],
      makeups: [],
      cases: [],
    });
    expect(linesAt('warn')).toEqual([
      {
        sessionId: w.sessionId,
        enrollmentId: w.enrollmentId,
        constraint: 'sessions_teacher_no_overlap',
      },
    ]);
  });

  it('after the choice window: released, then the proposal booked, never read as unanswered', async () => {
    reset();
    const w = await world();
    await counterOn(w, new Date('2026-11-07T12:00:00.000Z'));
    await teacherBusy(w, '2026-11-16T16:00:00Z', '2026-11-16T17:00:00Z');
    expect(await codeOf(answer(w, true, new Date('2026-11-08T09:00:00.000Z')))).toBe(
      'MAKEUP_REFUSED',
    );
    expect(await committed(w)).toMatchObject({
      remedy: { status: 'booked' },
      events: ['counter_proposed', 'counter_booking_refused', 'makeup_booked'],
      makeups: ['2026-11-15T07:00'],
      cases: [],
    });
  });

  // The owner's decision (b) of 2026-11-10 under T032: a week another package keeps lasts, so the
  // counter is released as the database's refusal releases it, never left pending to become a
  // refund once its answer window closes (FR-MAKEUP-4).
  it('a counter on a week another package then keeps, inside the choice window: MAKEUP_REFUSED, released to proposed, one counter_booking_refused row, one warn line naming slot_taken, never a case', async () => {
    reset();
    const w = await world();
    await counterOn(w, AT);
    await otherPackageKeepsMonday(w);
    expect(await codeOf(answer(w, true, AT))).toBe('MAKEUP_REFUSED');
    expect(await committed(w)).toEqual({
      remedy: {
        status: 'proposed',
        kind: 'makeup',
        counter_slot_id: null,
        counter_proposed_at: null,
      },
      events: ['counter_proposed', 'counter_booking_refused'],
      makeups: [],
      cases: [],
    });
    expect(linesAt('warn')).toEqual([
      { sessionId: w.sessionId, enrollmentId: w.enrollmentId, constraint: 'slot_taken' },
    ]);
  });

  it('a counter on a week another package then keeps, after the choice window: released, then the proposal booked, never read as unanswered', async () => {
    reset();
    const w = await world();
    await counterOn(w, new Date('2026-11-07T12:00:00.000Z'));
    await otherPackageKeepsMonday(w);
    expect(await codeOf(answer(w, true, new Date('2026-11-08T09:00:00.000Z')))).toBe(
      'MAKEUP_REFUSED',
    );
    expect(await committed(w)).toMatchObject({
      remedy: { status: 'booked' },
      events: ['counter_proposed', 'counter_booking_refused', 'makeup_booked'],
      makeups: ['2026-11-15T07:00'],
      cases: [],
    });
  });

  it('a student’s acceptance of the proposal with a counter pending writes counter_withdrawn and no counter_booking_refused', async () => {
    reset();
    const w = await world();
    await counterOn(w, AT);
    clockAt = AT;
    await services.remedy.accept({ userId: w.studentId }, { sessionId: w.sessionId }, log);
    expect((await committed(w)).events).toEqual([
      'counter_proposed',
      'counter_withdrawn',
      'makeup_booked',
    ]);
  });
});

describe('D1 at its boundary: answerCounter and the sweep agree at answerClosesAt, from the row (T032)', () => {
  it('a millisecond before, the sweep leaves it; at answerClosesAt the answer is refused and the sweep hands it to a counter_unanswered case', async () => {
    reset();
    const w = await world();
    await counterOn(w, AT);
    // AT + the row's 72 h; the setting says 1 h.
    const closes = new Date('2026-11-06T08:00:00.000Z');
    expect((await runAt(w, new Date('2026-11-06T07:59:59.999Z'))).handedOff).toEqual([]);
    expect(await codeOf(answer(w, true, closes))).toBe('REMEDY_NOT_OPEN');
    expect((await committed(w)).events).toEqual(['counter_proposed']);
    expect((await runAt(w, closes)).handedOff).toEqual([w.remedyId]);
    expect(await committed(w)).toEqual({
      remedy: {
        status: 'refund_case',
        kind: 'refund',
        counter_slot_id: null,
        counter_proposed_at: null,
      },
      events: ['counter_proposed', 'remedy_handed_to_case'],
      makeups: [],
      cases: ['counter_unanswered'],
    });
    expect(linesAt('info').at(-1)).toEqual({
      remedyId: w.remedyId,
      sessionId: w.sessionId,
      enrollmentId: w.enrollmentId,
      action: 'counter_unanswered',
    });
  });

  it('the worst case, a counter sent just before C: nothing booked at C, the case at C + A', async () => {
    reset();
    const w = await world();
    const sent = new Date('2026-11-08T07:59:59.000Z');
    await counterOn(w, sent);
    const atC = await runAt(w, new Date('2026-11-08T09:00:00.000Z'));
    expect([atC.booked, atC.handedOff]).toEqual([[], []]);
    expect((await runAt(w, new Date(addHours(sent, 72)))).handedOff).toEqual([w.remedyId]);
    expect((await committed(w)).cases).toEqual(['counter_unanswered']);
  });
});

describe('the choice window’s end: H5, and a refused proposal retried (T032; A3; Q4 (a), Q11 (a))', () => {
  it('books the proposal at C; run twice, one booking and one info line', async () => {
    reset();
    const w = await world();
    const first = await runAt(w, C);
    const second = await runAt(w, C);
    expect([first.booked, second.booked]).toEqual([[w.remedyId], []]);
    expect(await committed(w)).toMatchObject({
      remedy: { status: 'booked' },
      events: ['makeup_booked'],
      makeups: ['2026-11-15T07:00'],
    });
    expect(linesAt('info')).toEqual([
      {
        remedyId: w.remedyId,
        sessionId: w.sessionId,
        enrollmentId: w.enrollmentId,
        action: 'booked',
      },
    ]);
  });

  it('refused by the database: one warn line per run, retried up to start − L, then handed to a makeup_refused case (kind makeup), error tracking told once; run twice, one case', async () => {
    reset();
    const w = await world();
    await teacherBusy(w, '2026-11-15T07:00:00Z', '2026-11-15T08:00:00Z');
    const retriedUntil = new Date('2026-11-14T07:00:00.000Z');
    expect((await runAt(w, C)).retried).toEqual([w.remedyId]);
    expect((await runAt(w, retriedUntil)).retried).toEqual([w.remedyId]);
    expect(linesAt('warn')).toEqual([
      { remedyId: w.remedyId, sessionId: w.sessionId, constraint: 'sessions_teacher_no_overlap' },
      { remedyId: w.remedyId, sessionId: w.sessionId, constraint: 'sessions_teacher_no_overlap' },
    ]);
    expect(reported).toEqual([]);
    const after = new Date('2026-11-14T07:00:00.001Z');
    expect((await runAt(w, after)).handedOff).toEqual([w.remedyId]);
    expect((await runAt(w, after)).handedOff).toEqual([]);
    expect(await committed(w)).toEqual({
      remedy: {
        status: 'refund_case',
        kind: 'makeup',
        counter_slot_id: null,
        counter_proposed_at: null,
      },
      events: ['remedy_handed_to_case'],
      makeups: [],
      cases: ['makeup_refused'],
    });
    expect(reported).toHaveLength(1);
    expect(linesAt('info')).toEqual([
      {
        remedyId: w.remedyId,
        sessionId: w.sessionId,
        enrollmentId: w.enrollmentId,
        action: 'makeup_refused',
      },
    ]);
  });

  it('a retry over an open hold of either party, or another remedy’s reservation, is refused, nothing written', async () => {
    reset();
    const held = await world();
    const holder = await makeUser(db);
    await insertRow(db, 'slot_holds', {
      slot_id: held.offer.slotId,
      student_user_id: holder,
      package_id: held.offer.packageId,
      session_count: 4,
      expires_at: new Date(addDays(C, 1)).toISOString(),
    });
    expect((await runAt(held, C)).retried).toEqual([held.remedyId]);
    expect(await committed(held)).toMatchObject({ remedy: { status: 'proposed' }, events: [] });

    const reserved = await world();
    const otherOffer = await makeOffer(db);
    const otherEnrollment = await insertRow(db, 'enrollments', {
      ...enrollmentValues(otherOffer, reserved.studentId),
      status: 'confirmed',
      confirmed_at: '2026-10-04T07:01:00Z',
    });
    const otherSession = await sessionOf(
      { id: otherEnrollment, studentId: reserved.studentId, teacherId: otherOffer.teacherId },
      1,
      '2026-10-04T06:00:00Z',
      '2026-10-04T07:00:00Z',
      'teacher_no_show',
    );
    await insertRow(db, 'session_remedies', {
      session_id: otherSession,
      kind: 'makeup',
      status: 'proposed',
      offered_at: '2026-11-01T08:00:00Z',
      choice_closes_at: '2026-11-20T08:00:00Z',
      snapshot_answer_window_hours: 72,
      snapshot_first_session_lead_hours: 24,
      proposed_date: '2026-11-15',
    });
    expect((await runAt(reserved, C)).retried).toEqual([reserved.remedyId]);
    expect(await committed(reserved)).toMatchObject({ remedy: { status: 'proposed' }, events: [] });
    expect(linesAt('warn')).toEqual([
      { remedyId: held.remedyId, sessionId: held.sessionId, constraint: 'hold' },
      { remedyId: reserved.remedyId, sessionId: reserved.sessionId, constraint: 'reservation' },
    ]);
  });
});

describe('advance-remedies as worker.ts builds it (T032, the composition)', () => {
  it('hands a counter whose answer window has closed by the database’s clock to its case', async () => {
    reset();
    const now = new Date();
    const w = await world({
      offered_at: new Date(addDays(now, -4)).toISOString(),
      choice_closes_at: new Date(addDays(now, 3)).toISOString(),
      proposed_date: '2040-01-01',
    });
    // The counter's five columns with its status, in one statement (rule 42).
    await db.query(
      `UPDATE session_remedies
          SET status = 'counter_proposed',
              counter_slot_id = $2::uuid, counter_date = '2040-01-02',
              counter_start_time_local = '18:00', counter_timezone = 'Africa/Cairo',
              counter_proposed_at = $3::timestamptz
        WHERE id = $1::uuid`,
      [w.remedyId, w.mondaySlotId, new Date(addHours(now, -73)).toISOString()],
    );
    const job = advanceRemedies({
      database,
      settings,
      enrollments: createEnrollmentSide({ settings }),
      completion: createCompletion({ enrollments: createEnrollmentSide({ settings }), settings }),
      log,
      report: (error) => {
        reported.push(error);
      },
      store: {
        ...remedyAdvanceStore,
        dueForOffer: async () => [],
        frozenRemedies: async () => [],
        enrollmentsSettledAmong: async () => [],
        choiceWindowsEnded: async () => [],
        pendingCounters: async (tx, after, limit) =>
          (await remedyAdvanceStore.pendingCounters(tx, after, 100_000))
            .filter(({ remedyId }) => remedyId === w.remedyId)
            .slice(0, limit),
      },
    });
    await job.handle({});
    expect((await committed(w)).cases).toEqual(['counter_unanswered']);
  });
});
