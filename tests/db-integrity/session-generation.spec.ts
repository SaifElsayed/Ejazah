// T034 — session generation over the real tables (R-209, FR-368, FR-369, ERD §15 rule 19):
//
//   - `generateForEnrollment` (sessions' entry) writes one row per session, numbered from one, the
//     requested local date, start and zone as the fact, the instants `packages/time` resolved as
//     the cache, the two accounts copied from the enrollment;
//   - a session the database refuses as overlapping another of the same teacher, or of the same
//     student, fails the whole call with the exclusion T006 names, and the enrollment is left with
//     no session at all: the refused one is the third, so a row-by-row writer would have left two.
//
// HOW THE ROWS ARE WRITTEN (as db-errors.spec.ts). Generation runs on the API's own client, in its
// interactive transaction, so its error is the one the confirm job (T039) sees. That client cannot
// see another transaction's uncommitted rows, so the parents and the session in the way are
// committed through the application role, and removed after the suite by the OWNER role, the only
// role that may delete a user, an enrollment or a session (T065).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type EnrollmentToSchedule,
  generateForEnrollment,
  lastSessionDateOf,
} from '../../apps/api/src/modules/sessions/index.js';
import { isExclusionViolation } from '../../apps/api/src/platform/db/db-errors.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
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

type Offer = Awaited<ReturnType<typeof makeOffer>>;

const CAIRO = 'Africa/Cairo';
const LEAD = 24;

/**
 * Wednesday 2026-11-04 10:00 in Cairo (+02:00). The harness's slot is Sunday 09:00, so the four
 * sessions are Sundays 11-08 to 11-29 at 07:00Z.
 */
const CONFIRMED_AT = new Date('2026-11-04T08:00:00Z');

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
  if (users.length === 0 && subjects.length === 0) return;
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

/** A teacher's offer (a Sunday 09:00 Cairo slot of 60 minutes), committed and recorded for removal. */
async function committedOffer(): Promise<Offer> {
  const offer = await makeOffer(setup);
  users.push(offer.teacherId);
  subjects.push(offer.subjectId);
  return offer;
}

/** A student, committed and recorded for removal. */
async function committedStudent(): Promise<string> {
  const id = await makeUser(setup);
  users.push(id);
  return id;
}

/** One enrollment of four 60-minute sessions in Cairo, committed, as generation is handed it. */
async function committedEnrollment(offer: Offer, studentId: string): Promise<EnrollmentToSchedule> {
  const id = await insertRow(setup, 'enrollments', enrollmentValues(offer, studentId));
  return {
    id,
    teacherUserId: offer.teacherId,
    studentUserId: studentId,
    snapshotSessionCount: 4,
    snapshotDurationMinutes: 60,
    snapshotSlotTimezone: CAIRO,
    slot: { dayOfWeek: 0, startTimeLocal: '09:00:00' },
  };
}

/**
 * A committed session of `enrollment` on Sunday 2026-11-22 09:30–10:30 in Cairo, written whole as
 * text: it overlaps the third session generation would write (09:00–10:00).
 */
async function committedSessionInTheWay(enrollment: EnrollmentToSchedule): Promise<void> {
  await insertRow(setup, 'sessions', {
    enrollment_id: enrollment.id,
    teacher_user_id: enrollment.teacherUserId,
    student_user_id: enrollment.studentUserId,
    sequence_number: 1,
    scheduled_date_local: '2026-11-22',
    scheduled_start_time_local: '09:30:00',
    timezone: CAIRO,
    scheduled_start_at: '2026-11-22T07:30:00Z',
    scheduled_end_at: '2026-11-22T08:30:00Z',
    status: 'scheduled',
  });
}

/** What `work` threw in one transaction of the API's client; fails the probe if it committed. */
async function refusal(work: (tx: Transaction) => Promise<unknown>): Promise<unknown> {
  try {
    await database.$transaction(async (tx) => {
      await work(tx);
    });
  } catch (error: unknown) {
    return error;
  }
  throw new Error('the transaction committed; the probe expected a refusal');
}

/** The sessions of `enrollmentId` as committed, read through a separate connection. */
async function committedSessionsOf(enrollmentId: string): Promise<number> {
  const { rows } = await setup.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM "sessions" WHERE enrollment_id = $1',
    [enrollmentId],
  );
  return Number(rows[0]?.count);
}

describe('generateForEnrollment writes the enrollment’s sessions (FR-368, ADR 0009 D1–D2)', () => {
  it('one row per session, numbered from one, the request stored and the instants cached', async () => {
    const enrollment = await committedEnrollment(await committedOffer(), await committedStudent());
    await database.$transaction(async (tx) => {
      await generateForEnrollment(tx, enrollment, CONFIRMED_AT, LEAD);
    });

    const rows = await setup.query<Record<string, string | number>>(
      `SELECT sequence_number, teacher_user_id, student_user_id, timezone, status,
              to_char(scheduled_date_local, 'YYYY-MM-DD') AS date_local,
              to_char(scheduled_start_time_local, 'HH24:MI:SS') AS start_local,
              to_char(scheduled_start_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS starts_at,
              to_char(scheduled_end_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS ends_at
         FROM "sessions" WHERE enrollment_id = $1 ORDER BY sequence_number`,
      [enrollment.id],
    );
    expect(
      rows.rows.map((row) => [
        row.sequence_number,
        row.date_local,
        row.start_local,
        row.timezone,
        row.starts_at,
        row.ends_at,
        row.status,
      ]),
    ).toEqual([
      [
        1,
        '2026-11-08',
        '09:00:00',
        CAIRO,
        '2026-11-08T07:00:00Z',
        '2026-11-08T08:00:00Z',
        'scheduled',
      ],
      [
        2,
        '2026-11-15',
        '09:00:00',
        CAIRO,
        '2026-11-15T07:00:00Z',
        '2026-11-15T08:00:00Z',
        'scheduled',
      ],
      [
        3,
        '2026-11-22',
        '09:00:00',
        CAIRO,
        '2026-11-22T07:00:00Z',
        '2026-11-22T08:00:00Z',
        'scheduled',
      ],
      [
        4,
        '2026-11-29',
        '09:00:00',
        CAIRO,
        '2026-11-29T07:00:00Z',
        '2026-11-29T08:00:00Z',
        'scheduled',
      ],
    ]);
    expect(
      rows.rows.every(
        (row) =>
          row.teacher_user_id === enrollment.teacherUserId &&
          row.student_user_id === enrollment.studentUserId,
      ),
    ).toBe(true);
    const last = await database.$transaction((tx) => lastSessionDateOf(tx, [enrollment.id]));
    expect(last.get(enrollment.id)).toBe('2026-11-29');
  });
});

describe('the database refuses an overlapping session and generation leaves none (FR-369, rule 19)', () => {
  it('another session of the same teacher: sessions_teacher_no_overlap, no session written', async () => {
    const offer = await committedOffer();
    const booked = await committedEnrollment(offer, await committedStudent());
    await committedSessionInTheWay(booked);
    const enrollment = await committedEnrollment(offer, await committedStudent());

    const error = await refusal((tx) => generateForEnrollment(tx, enrollment, CONFIRMED_AT, LEAD));

    expect(isExclusionViolation(error, 'sessions_teacher_no_overlap')).toBe(true);
    expect(await committedSessionsOf(enrollment.id)).toBe(0);
    expect(await committedSessionsOf(booked.id)).toBe(1);
  });

  it('another session of the same student: sessions_student_no_overlap, no session written', async () => {
    const [one, other] = await Promise.all([committedOffer(), committedOffer()]);
    const student = await committedStudent();
    const booked = await committedEnrollment(one, student);
    await committedSessionInTheWay(booked);
    const enrollment = await committedEnrollment(other, student);

    const error = await refusal((tx) => generateForEnrollment(tx, enrollment, CONFIRMED_AT, LEAD));

    expect(isExclusionViolation(error, 'sessions_student_no_overlap')).toBe(true);
    expect(await committedSessionsOf(enrollment.id)).toBe(0);
    expect(await committedSessionsOf(booked.id)).toBe(1);
  });
});
