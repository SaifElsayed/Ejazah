// T047 — session generation across Cairo's 2027 clock changes, over the real tables (SC-303,
// ADR 0009 D1, FR-368, R-TIME-7):
//
//   - a Thursday 23:30 slot of 60 minutes and an 8-session package across the spring change
//     (Friday 2027-04-30 00:00 becomes 01:00) and across the autumn change (Thursday 2027-10-28 24:00
//     becomes 23:00), and a Friday 00:30 slot whose session of 2027-04-30 falls in the gap;
//   - every row keeps the local date and start as requested, consecutive weeks at the slot's local
//     time; the gap week's request resolves `shifted_forward` (to 01:30), the repeat's
//     `first_of_two`; every cached instant is the one `packages/time` resolves for that request.
//
// The transitions are the ones `packages/time/src/first-occurrence.spec.ts` recorded from the
// runtime's data (tz 2025b): a spec over existing generation (T034), so it proves rather than
// drives the code. Rows are written as `session-generation.spec.ts` writes them: the parents
// committed through the application role, generation on the API's client, the rows removed after
// the suite by the OWNER role.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type EnrollmentToSchedule,
  generateForEnrollment,
} from '../../apps/api/src/modules/sessions/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures';
import {
  connectAsApplication,
  type Db,
  enrollmentValues,
  insertRow,
  makeOffer,
  makeUser,
} from './harness';
import {
  type DayOfWeek,
  resolveLocalDateTime,
  resolveOccurrences,
  type RecurringSlot,
} from '../../packages/time/src/index.js';

const CAIRO = 'Africa/Cairo';
const LEAD = 24;
const SESSIONS = 8;
const MINUTES = 60;
const THURSDAY: DayOfWeek = 4;
const FRIDAY: DayOfWeek = 5;

let setup: Db;
let database: Database;
const users: string[] = [];
const subjects: string[] = [];

beforeAll(async () => {
  specDatabaseUrl('DATABASE_URL_OWNER');
  setup = await connectAsApplication();
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 2,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
});

afterAll(async () => {
  await Promise.all([setup?.end(), database === undefined ? undefined : closeDatabase(database)]);
  if (users.length === 0) return;
  const owner = new pg.Client({
    connectionString: specDatabaseUrl('DATABASE_URL_OWNER'),
    connectionTimeoutMillis: 5_000,
  });
  await owner.connect();
  try {
    await owner.query('BEGIN');
    await owner.query(
      'DELETE FROM "sessions" WHERE teacher_user_id = ANY($1) OR student_user_id = ANY($1)',
      [users],
    );
    await owner.query(
      'DELETE FROM "enrollments" WHERE teacher_user_id = ANY($1) OR student_user_id = ANY($1)',
      [users],
    );
    await owner.query('DELETE FROM "availability_slots" WHERE teacher_user_id = ANY($1)', [users]);
    await owner.query('DELETE FROM "packages" WHERE teacher_user_id = ANY($1)', [users]);
    await owner.query('DELETE FROM "subjects" WHERE id = ANY($1)', [subjects]);
    await owner.query('DELETE FROM "users" WHERE id = ANY($1)', [users]);
    await owner.query('COMMIT');
  } finally {
    await owner.end();
  }
});

/** A slot of `day` at `start`, 60 minutes in Cairo, as `packages/time` reads it. */
function cairoSlot(day: DayOfWeek, start: string): RecurringSlot {
  return { dayOfWeek: day, startTimeLocal: start, durationMinutes: MINUTES, timezone: CAIRO };
}

/**
 * A teacher with that weekly slot, a student, and one committed enrollment of eight 60-minute
 * sessions on it, as generation is handed it.
 */
async function committedEnrollment(slot: RecurringSlot): Promise<EnrollmentToSchedule> {
  const offer = await makeOffer(setup);
  users.push(offer.teacherId);
  subjects.push(offer.subjectId);
  const studentId = await makeUser(setup);
  users.push(studentId);
  const slotId = await insertRow(setup, 'availability_slots', {
    teacher_user_id: offer.teacherId,
    day_of_week: slot.dayOfWeek,
    start_time_local: slot.startTimeLocal,
    duration_minutes: MINUTES,
    timezone: CAIRO,
    is_active: true,
  });
  const id = await insertRow(setup, 'enrollments', {
    ...enrollmentValues({ ...offer, slotId }, studentId),
    snapshot_session_count: SESSIONS,
    snapshot_duration_minutes: MINUTES,
  });
  return {
    id,
    teacherUserId: offer.teacherId,
    studentUserId: studentId,
    snapshotSessionCount: SESSIONS,
    snapshotDurationMinutes: MINUTES,
    snapshotSlotTimezone: CAIRO,
    slot: { dayOfWeek: slot.dayOfWeek, startTimeLocal: slot.startTimeLocal },
  };
}

/** One stored session, its local fields and instants as text. */
interface StoredSession {
  readonly sequence: number;
  readonly dateLocal: string;
  readonly startLocal: string;
  readonly timezone: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

/** Generates `slot`'s enrollment, confirmed at `confirmedAt`, and reads its committed rows back. */
async function generated(slot: RecurringSlot, confirmedAt: string): Promise<StoredSession[]> {
  const enrollment = await committedEnrollment(slot);
  await database.$transaction(async (tx) => {
    await generateForEnrollment(tx, enrollment, new Date(confirmedAt), LEAD);
  });
  const { rows } = await setup.query<StoredSession>(
    `SELECT sequence_number AS sequence, timezone,
            to_char(scheduled_date_local, 'YYYY-MM-DD') AS "dateLocal",
            to_char(scheduled_start_time_local, 'HH24:MI:SS') AS "startLocal",
            to_char(scheduled_start_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "startsAt",
            to_char(scheduled_end_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "endsAt"
       FROM "sessions" WHERE enrollment_id = $1 ORDER BY sequence_number`,
    [enrollment.id],
  );
  return rows;
}

/** `packages/time`'s resolution of the eight weeks from `firstDate`, as the rows store them. */
function resolvedBy(slot: RecurringSlot, firstDate: string): StoredSession[] {
  return resolveOccurrences(slot, { fromLocalDate: firstDate, count: SESSIONS }).map(
    (occurrence, index) => ({
      sequence: index + 1,
      dateLocal: occurrence.requestedLocalDate,
      startLocal: occurrence.requestedStartTimeLocal,
      timezone: CAIRO,
      startsAt: occurrence.startsAt,
      endsAt: occurrence.endsAt,
    }),
  );
}

/** How `packages/time` resolves the request a row stores. */
function disambiguationOf(row: StoredSession): string {
  return resolveLocalDateTime({
    localDate: row.dateLocal,
    localTime: row.startLocal,
    timezone: row.timezone,
  }).disambiguation;
}

describe('generation across Cairo’s 2027 changes (SC-303, ADR 0009 D1)', () => {
  it('Thursday 23:30 across the spring change: every week at 23:30, the instants packages/time’s', async () => {
    const slot = cairoSlot(THURSDAY, '23:30:00');
    // Thursday 2027-04-01 12:00 in Cairo (+02:00): the lead ends on Friday, so the first is 04-08.
    const rows = await generated(slot, '2027-04-01T10:00:00Z');

    expect(rows.map((row) => [row.sequence, row.dateLocal, row.startLocal])).toEqual([
      [1, '2027-04-08', '23:30:00'],
      [2, '2027-04-15', '23:30:00'],
      [3, '2027-04-22', '23:30:00'],
      [4, '2027-04-29', '23:30:00'],
      [5, '2027-05-06', '23:30:00'],
      [6, '2027-05-13', '23:30:00'],
      [7, '2027-05-20', '23:30:00'],
      [8, '2027-05-27', '23:30:00'],
    ]);
    expect(rows).toEqual(resolvedBy(slot, '2027-04-08'));
    // The last Thursday before the change at +02:00, the first after it at +03:00; each an hour.
    expect([rows[3]?.startsAt, rows[3]?.endsAt]).toEqual([
      '2027-04-29T21:30:00Z',
      '2027-04-29T22:30:00Z',
    ]);
    expect([rows[4]?.startsAt, rows[4]?.endsAt]).toEqual([
      '2027-05-06T20:30:00Z',
      '2027-05-06T21:30:00Z',
    ]);
    expect(rows.map(disambiguationOf)).toEqual(Array(SESSIONS).fill('exact'));
  });

  it('Thursday 23:30 across the autumn change: the repeat stored as asked, resolved first_of_two', async () => {
    const slot = cairoSlot(THURSDAY, '23:30:00');
    // Monday 2027-10-04 13:00 in Cairo (+03:00): the first is Thursday 10-07.
    const rows = await generated(slot, '2027-10-04T10:00:00Z');

    expect(rows.map((row) => [row.sequence, row.dateLocal, row.startLocal])).toEqual([
      [1, '2027-10-07', '23:30:00'],
      [2, '2027-10-14', '23:30:00'],
      [3, '2027-10-21', '23:30:00'],
      [4, '2027-10-28', '23:30:00'],
      [5, '2027-11-04', '23:30:00'],
      [6, '2027-11-11', '23:30:00'],
      [7, '2027-11-18', '23:30:00'],
      [8, '2027-11-25', '23:30:00'],
    ]);
    expect(rows).toEqual(resolvedBy(slot, '2027-10-07'));
    const repeat = rows[3];
    expect(repeat && disambiguationOf(repeat)).toBe('first_of_two');
    // The first of the two 23:30s is the summer one (+03:00).
    expect([repeat?.startsAt, repeat?.endsAt]).toEqual([
      '2027-10-28T20:30:00Z',
      '2027-10-28T21:30:00Z',
    ]);
    expect([rows[4]?.startsAt, rows[4]?.endsAt]).toEqual([
      '2027-11-04T21:30:00Z',
      '2027-11-04T22:30:00Z',
    ]);
    expect(rows.filter((row) => row !== repeat).map(disambiguationOf)).toEqual(
      Array(SESSIONS - 1).fill('exact'),
    );
  });

  it('Friday 00:30 across the spring gap: the gap week stored as 00:30, resolved shifted_forward', async () => {
    const slot = cairoSlot(FRIDAY, '00:30:00');
    // Thursday 2027-04-01 12:00 in Cairo: Friday 04-02 00:30 is before the lead ends, so 04-09.
    const rows = await generated(slot, '2027-04-01T10:00:00Z');

    expect(rows.map((row) => [row.sequence, row.dateLocal, row.startLocal])).toEqual([
      [1, '2027-04-09', '00:30:00'],
      [2, '2027-04-16', '00:30:00'],
      [3, '2027-04-23', '00:30:00'],
      [4, '2027-04-30', '00:30:00'],
      [5, '2027-05-07', '00:30:00'],
      [6, '2027-05-14', '00:30:00'],
      [7, '2027-05-21', '00:30:00'],
      [8, '2027-05-28', '00:30:00'],
    ]);
    expect(rows).toEqual(resolvedBy(slot, '2027-04-09'));
    const gap = rows[3];
    expect(gap && disambiguationOf(gap)).toBe('shifted_forward');
    expect(
      gap &&
        resolveLocalDateTime({
          localDate: gap.dateLocal,
          localTime: gap.startLocal,
          timezone: CAIRO,
        }).startTimeLocal,
    ).toBe('01:30:00');
    // Landed at 01:30 (+03:00): the instant 00:30 would have had at +02:00, an hour long.
    expect([gap?.startsAt, gap?.endsAt]).toEqual(['2027-04-29T22:30:00Z', '2027-04-29T23:30:00Z']);
    expect([rows[2]?.startsAt, rows[4]?.startsAt]).toEqual([
      '2027-04-22T22:30:00Z',
      '2027-05-06T21:30:00Z',
    ]);
    expect(rows.filter((row) => row !== gap).map(disambiguationOf)).toEqual(
      Array(SESSIONS - 1).fill('exact'),
    );
  });
});
