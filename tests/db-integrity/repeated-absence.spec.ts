// T015 of specs/004-sessions/tasks.md — the repeated-absence count and mark, over the real tables as
// the application role (FR-447, FR-451, SC-404; research R-322; ADR 0023).
//
// The count is read when shown and never stored (R-DB-4): an enrollment's `sessions` rows whose
// `status` is `teacher_no_show`, each by its final status, so a Both-No-Show, a
// Cancelled-By-Agreement session, a disputed session until it is resolved and an absence a
// resolution or a revision removed are left out, and a soft-deleted row too. The mark is the
// teacher's enrollments whose count is at least `repeated_absence_flag_count`, grouped over the
// cached `sessions.teacher_user_id`. Reading either changes nothing: no count ends an enrollment
// (FR-448), so an enrollment with five or more absences stays `confirmed` and every session keeps
// its status.
//
// The rows are written and committed by the harness, each probe with its own enrollments.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createRepeatedAbsence } from '../../apps/api/src/modules/sessions/index.js';
import { addDays, addMinutes } from '../../packages/time/src/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
import {
  connectAsApplication,
  type Db,
  enrollmentValues,
  insertRow,
  makeOffer,
  makeUser,
} from './harness';

const FLAG_COUNT = 5;
const CONFIRMED_AT = new Date('2026-10-04T07:01:00Z');

let db: Db;
let database: Database;

const settings: SettingsReader = {
  read: async (key, schema) => {
    if (key !== 'repeated_absence_flag_count') throw new Error(`unexpected setting ${key}`);
    return schema.parse(FLAG_COUNT);
  },
};
const absence = createRepeatedAbsence({ settings });

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

/** A committed `confirmed` enrollment of a new student on `offer`. */
async function confirmedOn(offer: Offer): Promise<string> {
  return insertRow(db, 'enrollments', {
    ...enrollmentValues(offer, await makeUser(db)),
    status: 'confirmed',
    confirmed_at: CONFIRMED_AT,
  });
}

/** A session's status, and the outcome frozen while it is disputed. */
type Row =
  | { readonly status: string; readonly outcomeUnderDispute?: string; readonly deleted?: boolean }
  | string;

const FIRST_DAY = new Date('2026-09-06T00:00:00Z');

/** Each call's sessions start an hour later than the last call's, so no teacher's two overlap. */
let hourShift = 0;

/**
 * The enrollment's sessions, one a week from 2026-09-06, in `rows`' order. The instants are
 * stand-ins (only the count and the overlap exclusions read them): each call an hour apart.
 */
async function sessionsOf(enrollmentId: string, rows: readonly Row[]): Promise<string[]> {
  const { rows: found } = await db.query<{ student_user_id: string; teacher_user_id: string }>(
    'SELECT student_user_id, teacher_user_id FROM enrollments WHERE id = $1',
    [enrollmentId],
  );
  const [parties] = found;
  if (parties === undefined) throw new Error('sessionsOf: no enrollment');
  const ids: string[] = [];
  hourShift += 1;
  for (const [index, row] of rows.entries()) {
    const { status, outcomeUnderDispute, deleted } =
      typeof row === 'string' ? { status: row } : row;
    const day = addDays(FIRST_DAY, index * 7);
    const localDate = day.slice(0, 10);
    const startsAt = addMinutes(new Date(day), hourShift * 60);
    ids.push(
      await insertRow(db, 'sessions', {
        enrollment_id: enrollmentId,
        teacher_user_id: parties.teacher_user_id,
        student_user_id: parties.student_user_id,
        sequence_number: index + 1,
        scheduled_date_local: localDate,
        scheduled_start_time_local: '09:00:00',
        timezone: 'Africa/Cairo',
        scheduled_start_at: startsAt,
        scheduled_end_at: addMinutes(new Date(startsAt), 60),
        status,
        ...(outcomeUnderDispute === undefined
          ? {}
          : { outcome_under_dispute: outcomeUnderDispute }),
        ...(deleted === true ? { deleted_at: '2026-11-01T00:00:00Z' } : {}),
      }),
    );
  }
  return ids;
}

const six = Array.from({ length: 6 }, () => 'teacher_no_show');

describe('teacherNoShowCountsOf (T015, FR-447, FR-451, R-322)', () => {
  it("counts each enrollment's Teacher-No-Shows by their final status, and none for one without", async () => {
    const offer = await makeOffer(db);
    const absent = await confirmedOn(offer);
    const none = await confirmedOn(offer);
    await sessionsOf(absent, six);
    await sessionsOf(none, ['done', 'student_no_show']);
    const counts = await database.$transaction((tx) =>
      absence.teacherNoShowCountsOf(tx, [absent, none]),
    );
    expect(counts.get(absent)).toBe(6);
    expect(counts.get(none)).toBe(0);
  });

  it('leaves out a Both-No-Show, a Cancelled-By-Agreement session, a disputed one until resolved, a removed absence and a soft-deleted row', async () => {
    const offer = await makeOffer(db);
    const enrollment = await confirmedOn(offer);
    const [, , disputed, revised] = await sessionsOf(enrollment, [
      'teacher_no_show',
      'both_no_show',
      { status: 'disputed', outcomeUnderDispute: 'teacher_no_show' },
      // An absence a resolution or a revision turned into a Student-No-Show.
      'teacher_no_show',
      'cancelled_by_agreement',
      { status: 'teacher_no_show', deleted: true },
    ]);
    if (disputed === undefined || revised === undefined) throw new Error('no session');
    await db.query(
      "UPDATE sessions SET status = 'student_no_show', updated_at = now() WHERE id = $1",
      [revised],
    );
    const before = await database.$transaction((tx) =>
      absence.teacherNoShowCountsOf(tx, [enrollment]),
    );
    expect(before.get(enrollment)).toBe(1);
    // The dispute resolved as a Teacher-No-Show: counted once resolved.
    await db.query(
      "UPDATE sessions SET status = 'teacher_no_show', outcome_under_dispute = NULL, updated_at = now() WHERE id = $1",
      [disputed],
    );
    const after = await database.$transaction((tx) =>
      absence.teacherNoShowCountsOf(tx, [enrollment]),
    );
    expect(after.get(enrollment)).toBe(2);
  });

  it('answers an empty map for no enrollments', async () => {
    const counts = await database.$transaction((tx) => absence.teacherNoShowCountsOf(tx, []));
    expect(counts.size).toBe(0);
  });
});

describe('markedEnrollmentsOfTeacher (T015, FR-451, SC-404)', () => {
  it("lists the teacher's enrollments at the flag count or above, with their counts, and no other teacher's", async () => {
    const offer = await makeOffer(db);
    const marked = await confirmedOn(offer);
    const below = await confirmedOn(offer);
    const atFlag = await confirmedOn(offer);
    await sessionsOf(marked, six);
    await sessionsOf(below, ['teacher_no_show', 'teacher_no_show', 'teacher_no_show', 'teacher_no_show']);
    await sessionsOf(atFlag, [...six.slice(0, FLAG_COUNT), 'done']);
    const other = await makeOffer(db);
    await sessionsOf(await confirmedOn(other), six);

    const found = await database.$transaction((tx) =>
      absence.markedEnrollmentsOfTeacher(tx, offer.teacherId),
    );
    expect(found).toEqual(
      [
        { enrollmentId: marked, teacherNoShows: 6 },
        { enrollmentId: atFlag, teacherNoShows: FLAG_COUNT },
      ].sort((one, two) => (one.enrollmentId < two.enrollmentId ? -1 : 1)),
    );
  });

  it('a run of Teacher-No-Shows past the flag count ends nothing: the enrollment stays confirmed and every session keeps its status (FR-448, SC-404)', async () => {
    const offer = await makeOffer(db);
    const enrollment = await confirmedOn(offer);
    const ids = await sessionsOf(enrollment, [...six, 'scheduled']);
    await database.$transaction(async (tx) => {
      await absence.teacherNoShowCountsOf(tx, [enrollment]);
      await absence.markedEnrollmentsOfTeacher(tx, offer.teacherId);
    });
    const { rows: enrollments } = await db.query<{ status: string; cancellation_reason: null }>(
      'SELECT status, cancellation_reason FROM enrollments WHERE id = $1',
      [enrollment],
    );
    expect(enrollments).toEqual([{ status: 'confirmed', cancellation_reason: null }]);
    const { rows: sessions } = await db.query<{ status: string }>(
      'SELECT status FROM sessions WHERE id = ANY($1::uuid[]) ORDER BY sequence_number',
      [ids],
    );
    expect(sessions.map(({ status }) => status)).toEqual([...six, 'scheduled']);
    const { rows: events } = await db.query<{ n: string }>(
      'SELECT count(*) AS n FROM enrollment_events WHERE enrollment_id = $1',
      [enrollment],
    );
    expect(events).toEqual([{ n: '0' }]);
  });
});
