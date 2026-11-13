// T015 of specs/004-sessions/tasks.md — completion and the slot a completed enrollment frees, over
// the real tables as the application role (FR-423, FR-449; research R-309; the note under 003:T026,
// nit 6; the note under T015 on `exceptEnrollmentId`).
//
// A completed enrollment holds its slot as a confirmed one does, until R-205's release: from the
// week after its final session plus `slot_release_buffer_weeks`, read in the zone it snapshot its
// slot in. Before T015 booking's occupancy read `pending_payment` and `confirmed` only, so a
// completed enrollment freed its slot at once. `slotWeekTaken` still leaves the asking enrollment's
// own use out (T008's `exceptEnrollmentId`).
//
// Completion (`createCompletion().completeIfDue`, bound over booking's `EnrollmentSide` and the
// database's clock as `main.ts` binds it): a confirmed enrollment becomes `completed`, with its one
// `enrollment_events` row, once every session is settled and not frozen, no remedy is owed, the
// last session's dispute window has closed and no `student_suspended` case is open; a session under
// review or disputed, a remedy never offered or open, and that case each hold it. Five or more
// Teacher-No-Shows end nothing (FR-448, SC-404).
//
// The rows are written and committed by the harness, each probe with its own offer; each check runs
// in a transaction this file rolls back, so no status or event row it writes is kept.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createEnrollmentSide, slotInUse } from '../../apps/api/src/modules/booking/index.js';
import { createCompletion } from '../../apps/api/src/modules/sessions/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
import { addHours, resolveLocalDateTime } from '../../packages/time/src/index.js';
import {
  connectAsApplication,
  type Db,
  enrollmentValues,
  insertRow,
  makeOffer,
  makeUser,
} from './harness';

const BUFFER_WEEKS = 2;
const CONFIRMED_AT = new Date('2026-10-04T07:01:00Z');

let db: Db;
let database: Database;

const SETTINGS: Readonly<Record<string, number>> = {
  slot_release_buffer_weeks: BUFFER_WEEKS,
  dispute_window_hours: 72,
  first_session_lead_hours: 24,
};
const settings: SettingsReader = {
  read: async (key, schema) => {
    if (!(key in SETTINGS)) throw new Error(`unexpected setting ${key}`);
    return schema.parse(SETTINGS[key]);
  },
};

beforeAll(async () => {
  db = await connectAsApplication();
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 2,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
});

afterAll(async () => {
  await db?.end();
  if (database !== undefined) await closeDatabase(database);
});

type Offer = Awaited<ReturnType<typeof makeOffer>>;

/** A committed enrollment of a new student on `offer`, once confirmed, now in `status`. */
async function enrollmentOn(offer: Offer, status: string): Promise<string> {
  return insertRow(db, 'enrollments', {
    ...enrollmentValues(offer, await makeUser(db)),
    status,
    confirmed_at: CONFIRMED_AT,
  });
}

/** A committed session of the enrollment on a Sunday at 09:00 in Cairo (07:00 UTC in winter). */
async function sessionOn(
  enrollmentId: string,
  localDate: string,
  status = 'done',
): Promise<string> {
  const { rows } = await db.query<{ student_user_id: string; teacher_user_id: string }>(
    'SELECT student_user_id, teacher_user_id FROM enrollments WHERE id = $1',
    [enrollmentId],
  );
  const [parties] = rows;
  if (parties === undefined) throw new Error('sessionOn: no enrollment');
  const { rows: last } = await db.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM sessions WHERE enrollment_id = $1',
    [enrollmentId],
  );
  return insertRow(db, 'sessions', {
    enrollment_id: enrollmentId,
    teacher_user_id: parties.teacher_user_id,
    student_user_id: parties.student_user_id,
    sequence_number: (last[0]?.n ?? 0) + 1,
    scheduled_date_local: localDate,
    scheduled_start_time_local: '09:00:00',
    timezone: 'Africa/Cairo',
    scheduled_start_at: `${localDate}T07:00:00Z`,
    scheduled_end_at: `${localDate}T08:00:00Z`,
    status,
  });
}

/** Noon in Cairo on `localDate`, resolved by `packages/time` (R-TIME-1). */
const noonOn = (localDate: string): Date =>
  new Date(
    resolveLocalDateTime({ localDate, localTime: '12:00:00', timezone: 'Africa/Cairo' }).startsAt,
  );

describe("booking's occupancy counts a completed enrollment under R-205's release (T015; 003:T026, nit 6; FR-423)", () => {
  it('holds the slot until the week after the final session plus the buffer, and frees it from that week', async () => {
    const offer = await makeOffer(db);
    const completed = await enrollmentOn(offer, 'completed');
    await sessionOn(completed, '2026-11-29');
    // The release: 2026-11-29 plus the buffer's two weeks and one more, 2026-12-20.
    const inUse = (localDate: string) =>
      database.$transaction((tx) =>
        slotInUse(tx, offer.slotId, {
          now: () => noonOn(localDate),
          bufferWeeks: async () => BUFFER_WEEKS,
          windowDays: async () => 14, // T070 (rule d)
        }),
      );
    expect(await inUse('2026-12-06')).toBe(true);
    expect(await inUse('2026-12-19')).toBe(true);
    expect(await inUse('2026-12-20')).toBe(false);
  });

  it("slotWeekTaken counts another's completed enrollment until its release and still leaves the asking enrollment's own out", async () => {
    const offer = await makeOffer(db);
    const completed = await enrollmentOn(offer, 'completed');
    await sessionOn(completed, '2026-11-29');
    const asking = await enrollmentOn(offer, 'terminated_no_show');
    const side = createEnrollmentSide({ settings, now: () => noonOn('2026-11-08') });
    const taken = (localDate: string, enrollmentId: string) =>
      database.$transaction((tx) => side.slotWeekTaken(tx, offer.slotId, localDate, enrollmentId));
    expect(await taken('2026-12-13', asking)).toBe(true);
    expect(await taken('2026-12-20', asking)).toBe(false);
    // The completed enrollment asking about its own slot: its own use left out.
    expect(await taken('2026-12-13', completed)).toBe(false);
  });

  it('a terminated enrollment still holds no slot, as before', async () => {
    const offer = await makeOffer(db);
    const ended = await enrollmentOn(offer, 'terminated_no_show');
    await sessionOn(ended, '2026-11-29', 'scheduled');
    const used = await database.$transaction((tx) =>
      slotInUse(tx, offer.slotId, {
        now: () => noonOn('2026-12-06'),
        bufferWeeks: async () => BUFFER_WEEKS,
        windowDays: async () => 14, // T070 (rule d)
      }),
    );
    expect(used).toBe(false);
  });
});

const ROLLED_BACK = Symbol('rolled back');

/** Runs `probe` on one transaction and rolls back whatever it wrote. */
async function rolledBack(probe: (tx: Transaction) => Promise<void>): Promise<void> {
  try {
    await database.$transaction(
      async (tx) => {
        await probe(tx);
        throw ROLLED_BACK;
      },
      { timeout: 30_000 },
    );
  } catch (thrown) {
    if (thrown !== ROLLED_BACK) throw thrown;
  }
}

/** A committed remedy of the session in `status` (kind `makeup`), offered on 2026-10-01. */
async function remedyOf(sessionId: string, status: string): Promise<void> {
  await insertRow(db, 'session_remedies', {
    session_id: sessionId,
    kind: 'makeup',
    status,
    offered_at: '2026-10-01T08:00:00Z',
    choice_closes_at: '2026-10-08T08:00:00Z',
    snapshot_answer_window_hours: 72,
    snapshot_first_session_lead_hours: 24,
  });
}

/** A committed open compensation case of `reason` on the enrollment. */
function openCaseOn(enrollmentId: string, reason: string): Promise<string> {
  return insertRow(db, 'disputes', {
    enrollment_id: enrollmentId,
    kind: 'compensation_case',
    reason,
    status: 'open',
  });
}

/**
 * Completion as `main.ts` binds it: over booking's side, the window's close compared with the
 * database's own clock (`clockTimestamp`, the owner's decision of 2026-11-08, Q3).
 */
const enrollments = createEnrollmentSide({ settings });
const completion = createCompletion({ enrollments, settings });

async function statusOf(tx: Transaction, enrollmentId: string) {
  const row = await tx.enrollment.findUniqueOrThrow({
    where: { id: enrollmentId },
    select: { status: true, cancellationReason: true },
  });
  const events = await tx.enrollmentEvent.findMany({
    where: { enrollmentId },
    select: { kind: true },
  });
  return { ...row, events: events.map(({ kind }) => kind) };
}

/**
 * A confirmed enrollment with two sessions settled `done`, the last on 2026-09-27: its 72-hour
 * dispute window closed long before the database's clock reads now.
 */
async function delivered(offer: Offer): Promise<string> {
  const enrollment = await enrollmentOn(offer, 'confirmed');
  await sessionOn(enrollment, '2026-09-20');
  await sessionOn(enrollment, '2026-09-27');
  return enrollment;
}

/** Locks the enrollment, as every settling path does first, and checks it now. */
async function check(enrollment: string, expected: boolean): Promise<void> {
  await rolledBack(async (tx) => {
    await enrollments.lockEnrollments(tx, [enrollment]);
    expect(await completion.completeIfDue(tx, enrollment)).toBe(expected);
  });
}

describe('completeIfDue over the real tables (T015, FR-449, R-309)', () => {
  it('completes once the last window has closed, with its one enrollment_events row, and the slot is released only after the buffer', async () => {
    const offer = await makeOffer(db);
    const enrollment = await delivered(offer);
    await rolledBack(async (tx) => {
      await enrollments.lockEnrollments(tx, [enrollment]);
      expect(await completion.completeIfDue(tx, enrollment)).toBe(true);
      expect(await statusOf(tx, enrollment)).toEqual({
        status: 'completed',
        cancellationReason: null,
        events: ['completed'],
      });
      // A second check changes nothing: the enrollment is no longer confirmed.
      expect(await completion.completeIfDue(tx, enrollment)).toBe(false);
      // The release week with a buffer above 0: 2026-09-27 plus two weeks and one more.
      const release = (localDate: string) => ({
        now: () => noonOn(localDate),
        bufferWeeks: async () => BUFFER_WEEKS,
        windowDays: async () => 14, // T070 (rule d)
      });
      expect(await slotInUse(tx, offer.slotId, release('2026-10-17'))).toBe(true);
      expect(await slotInUse(tx, offer.slotId, release('2026-10-18'))).toBe(false);
    });
  });

  it('does not complete before the last window has closed, by the database clock', async () => {
    const offer = await makeOffer(db);
    const enrollment = await enrollmentOn(offer, 'confirmed');
    await sessionOn(enrollment, '2026-09-20');
    // The last session ended an hour ago by the process's clock: its window is open.
    const endedAt = new Date(addHours(new Date(), -1));
    const startedAt = addHours(endedAt, -1);
    const { rows } = await db.query<{ student_user_id: string; teacher_user_id: string }>(
      'SELECT student_user_id, teacher_user_id FROM enrollments WHERE id = $1',
      [enrollment],
    );
    const [parties] = rows;
    if (parties === undefined) throw new Error('no enrollment');
    await insertRow(db, 'sessions', {
      enrollment_id: enrollment,
      teacher_user_id: parties.teacher_user_id,
      student_user_id: parties.student_user_id,
      sequence_number: 2,
      scheduled_date_local: startedAt.slice(0, 10),
      scheduled_start_time_local: '09:00:00',
      timezone: 'Africa/Cairo',
      scheduled_start_at: startedAt,
      scheduled_end_at: endedAt.toISOString(),
      status: 'done',
    });
    await rolledBack(async (tx) => {
      await enrollments.lockEnrollments(tx, [enrollment]);
      expect(await completion.completeIfDue(tx, enrollment)).toBe(false);
      expect(await statusOf(tx, enrollment)).toEqual({
        status: 'confirmed',
        cancellationReason: null,
        events: [],
      });
    });
  });

  // B38 (the owner's decision of 2026-11-10 under T023, Q3 (a)): an open admin_cancellation case
  // holds completion too, so "another case" is a refund_choice case.
  it('a student_suspended case open on it holds completion; another case does not (FR-486)', async () => {
    const suspended = await delivered(await makeOffer(db));
    await openCaseOn(suspended, 'student_suspended');
    await check(suspended, false);
    const other = await delivered(await makeOffer(db));
    await openCaseOn(other, 'refund_choice');
    await check(other, true);
  });

  it('a remedy owed holds it, one never offered or one open; a refund handed to its case does not', async () => {
    const enrollment = await delivered(await makeOffer(db));
    const absence = await sessionOn(enrollment, '2026-09-13', 'teacher_no_show');
    await check(enrollment, false);
    await remedyOf(absence, 'awaiting_choice');
    await check(enrollment, false);
    const refundCase = await openCaseOn(enrollment, 'refund_choice');
    await db.query(
      `UPDATE session_remedies SET status = 'refund_case', kind = 'refund', case_id = $2,
         decided_at = '2026-10-02T08:00:00Z', updated_at = now()
       WHERE session_id = $1`,
      [absence, refundCase],
    );
    await check(enrollment, true);
  });

  it('a session under review or disputed holds it, and once resolved it completes', async () => {
    const enrollment = await delivered(await makeOffer(db));
    const held = await sessionOn(enrollment, '2026-09-13', 'under_threshold');
    await check(enrollment, false);
    await db.query(
      "UPDATE sessions SET status = 'provider_outage', updated_at = now() WHERE id = $1",
      [held],
    );
    await check(enrollment, false);
    await db.query(
      `UPDATE sessions SET status = 'disputed', outcome_under_dispute = 'done', updated_at = now()
       WHERE id = $1`,
      [held],
    );
    await check(enrollment, false);
    await db.query(
      `UPDATE sessions SET status = 'done', outcome_under_dispute = NULL, updated_at = now()
       WHERE id = $1`,
      [held],
    );
    await check(enrollment, true);
  });

  it('five or more Teacher-No-Shows end nothing: the enrollment stays confirmed and each absence is owed its remedy (FR-448, SC-404)', async () => {
    const enrollment = await delivered(await makeOffer(db));
    const absences: string[] = [];
    for (const localDate of [
      '2026-08-09',
      '2026-08-16',
      '2026-08-23',
      '2026-08-30',
      '2026-09-06',
    ]) {
      absences.push(await sessionOn(enrollment, localDate, 'teacher_no_show'));
    }
    for (const absence of absences) await remedyOf(absence, 'awaiting_choice');
    await rolledBack(async (tx) => {
      await enrollments.lockEnrollments(tx, [enrollment]);
      expect(await completion.completeIfDue(tx, enrollment)).toBe(false);
      expect(await statusOf(tx, enrollment)).toEqual({
        status: 'confirmed',
        cancellationReason: null,
        events: [],
      });
      const sessions = await tx.session.findMany({
        where: { id: { in: absences } },
        select: { status: true, remedy: { select: { status: true } } },
      });
      expect(sessions).toEqual(
        absences.map(() => ({ status: 'teacher_no_show', remedy: { status: 'awaiting_choice' } })),
      );
    });
  });
});
