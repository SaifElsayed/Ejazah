// T058 of specs/004-sessions/tasks.md — the user directory, `users.list` and `users.get`, over the real
// tables as the application role (FR-481, FR-459, FR-451, FR-426; SRS FR-ADMIN-4; the notes under
// T058, Q7, Q8 and Q9).
//
// The list reads every user, deleted ones included (`includeDeleted`), newest first, and searches a
// name by its folded prefix (R-203: أ, إ and آ count as ا), in doubling batches, in pages of
// `admin_list_page_size`. The record answers FR-ADMIN-4's fields, FR-459's counts and, for a teacher,
// the enrollments FR-451 marks with their student and status; the date of birth is read only to
// derive `isMinor` and never answered (PDPL).
//
// The rows are written and committed by the harness, each probe with its own people; a name carries
// a token drawn for this run, so other probes' users never match it.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomInt } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createEnrollmentSide } from '../../apps/api/src/modules/booking/index.js';
import { createBanLift } from '../../apps/api/src/modules/sessions/index.js';
import { createUserDirectory } from '../../apps/api/src/modules/verification/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
import { addDays, addHours, addMinutes } from '../../packages/time/src/index.js';
import {
  connectAsApplication,
  type Db,
  enrollmentValues,
  insertRow,
  makeOffer,
  makeUser,
} from './harness';

const ADMIN = '0199d0a0-0000-7000-8000-0000000000a1';

let db: Db;
let database: Database;

const SETTINGS: Readonly<Record<string, number>> = {
  admin_list_page_size: 2,
  repeated_absence_flag_count: 5,
  cancellation_requests_recent_days: 30,
  // B42b, T075 of specs/004-sessions (rule d): `users.get` reads the ban restore window (Q-O2 (a)).
  ban_restore_window_days: 14,
};
const settings: SettingsReader = {
  read: async (key, schema) => {
    if (!(key in SETTINGS)) throw new Error(`unexpected setting ${key}`);
    return schema.parse(SETTINGS[key]);
  },
};

let directory: ReturnType<typeof createUserDirectory>;

beforeAll(async () => {
  db = await connectAsApplication();
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 2,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  const enrollments = createEnrollmentSide({ settings });
  directory = createUserDirectory({
    database,
    settings,
    enrollments,
    log: { info: () => undefined },
    // T072 of specs/004-sessions (rule d): `users.get`'s hold end, sessions' read; none held here.
    slotHeldUntilOf: createBanLift({
      enrollments,
      restore: {
        restoreClosed: async () => {
          throw new Error('not used by the directory');
        },
      },
      settings,
      log: { info: () => undefined, warn: () => undefined },
    }).slotHeldUntilOf,
  });
});

afterAll(async () => {
  await db?.end();
  if (database !== undefined) await closeDatabase(database);
});

/** Letters `ijazah_fold` leaves as they are. */
const PLAIN = 'بتثجحخدذرزسشصضطظعغفقكلمن';

/** A run's own token of Arabic letters, so only this probe's names begin with it. */
function token(): string {
  return Array.from({ length: 8 }, () => PLAIN[randomInt(PLAIN.length)]).join('');
}

async function withRole(userId: string, role: 'student' | 'teacher'): Promise<string> {
  await insertRow(db, 'user_roles', { user_id: userId, role, status: 'active' });
  return userId;
}

const list = (input: { name?: string; cursor?: string }) =>
  database.$transaction((tx) => directory.list(tx, ADMIN, input));
const get = (targetUserId: string) =>
  database.$transaction((tx) => directory.get(tx, ADMIN, { targetUserId }));

describe('users.list (T058, FR-481, R-203)', () => {
  it('finds a name by its folded prefix, newest first, in pages of admin_list_page_size', async () => {
    const typed = token();
    const first = await withRole(await makeUser(db, { display_name: `إ${typed} أول` }), 'student');
    await withRole(await makeUser(db, { display_name: `ب${typed} غيره` }), 'student');
    const second = await withRole(await makeUser(db, { display_name: `أ${typed} ثان` }), 'teacher');
    const third = await withRole(await makeUser(db, { display_name: `ا${typed} ثالث` }), 'student');

    const page = await list({ name: `آ${typed}` });
    expect(page).toEqual({
      items: [
        {
          userId: third,
          displayName: `ا${typed} ثالث`,
          deleted: false,
          role: 'student',
          accountStatus: 'active',
        },
        {
          userId: second,
          displayName: `أ${typed} ثان`,
          deleted: false,
          role: 'teacher',
          accountStatus: 'active',
        },
      ],
      nextCursor: second,
    });
    expect(await list({ name: `آ${typed}`, cursor: second })).toEqual({
      items: [
        {
          userId: first,
          displayName: `إ${typed} أول`,
          deleted: false,
          role: 'student',
          accountStatus: 'active',
        },
      ],
    });
  });

  it('lists a deleted user without its name', async () => {
    const deleted = await withRole(await makeUser(db, { display_name: 'محذوف' }), 'student');
    await db.query('UPDATE users SET deleted_at = now() WHERE id = $1', [deleted]);
    const after = await makeUser(db);
    const { items } = await list({ cursor: after });
    expect(items[0]).toEqual({
      userId: deleted,
      displayName: null,
      deleted: true,
      role: 'student',
      accountStatus: 'active',
    });
    const record = await get(deleted);
    expect(record.profile).toMatchObject({ displayName: null, deleted: true });
  });
});

describe('users.get (T058, SRS FR-ADMIN-4)', () => {
  const FIRST_DAY = new Date('2026-09-06T00:00:00Z');
  let hourShift = 0;

  /** The enrollment's sessions in `statuses`' order, one a week, each call an hour later than the last. */
  async function sessionsOf(enrollmentId: string, statuses: readonly string[]): Promise<string[]> {
    const { rows } = await db.query<{ student_user_id: string; teacher_user_id: string }>(
      'SELECT student_user_id, teacher_user_id FROM enrollments WHERE id = $1',
      [enrollmentId],
    );
    const [parties] = rows;
    if (parties === undefined) throw new Error('sessionsOf: no enrollment');
    hourShift += 1;
    const ids: string[] = [];
    for (const [index, status] of statuses.entries()) {
      const day = addDays(FIRST_DAY, index * 7);
      const startsAt = addMinutes(new Date(day), hourShift * 60);
      ids.push(
        await insertRow(db, 'sessions', {
          enrollment_id: enrollmentId,
          teacher_user_id: parties.teacher_user_id,
          student_user_id: parties.student_user_id,
          sequence_number: index + 1,
          scheduled_date_local: day.slice(0, 10),
          scheduled_start_time_local: '09:00:00',
          timezone: 'Africa/Cairo',
          scheduled_start_at: startsAt,
          scheduled_end_at: addMinutes(new Date(startsAt), 60),
          status,
        }),
      );
    }
    return ids;
  }

  it("answers a teacher's record with the counts and the enrollments marked at repeated_absence_flag_count", async () => {
    const offer = await makeOffer(db);
    await withRole(offer.teacherId, 'teacher');
    await insertRow(db, 'teacher_profiles', {
      user_id: offer.teacherId,
      bio: 'نبذة',
      qualification_summary: 'إجازة',
      verification_status: 'approved',
      approved_at: '2026-10-01T00:00:00Z',
      application_status: 'approved',
      application_submitted_at: '2026-09-30T00:00:00Z',
      payout_verified_at: '2026-10-01T00:00:00Z',
    });
    const student = await withRole(await makeUser(db, { display_name: 'طالب' }), 'student');
    const marked = await insertRow(db, 'enrollments', {
      ...enrollmentValues(offer, student),
      status: 'confirmed',
      confirmed_at: '2026-10-04T07:01:00Z',
    });
    const unmarked = await insertRow(db, 'enrollments', {
      ...enrollmentValues(offer, await makeUser(db)),
      status: 'confirmed',
      confirmed_at: '2026-10-04T07:01:00Z',
    });
    const [session] = await sessionsOf(
      marked,
      Array.from({ length: 5 }, () => 'teacher_no_show'),
    );
    await sessionsOf(unmarked, ['teacher_no_show', 'teacher_no_show', 'done']);
    for (const ago of [40 * 24, 24]) {
      await insertRow(db, 'cancellation_requests', {
        session_id: session,
        requested_by_user_id: offer.teacherId,
        reason: 'Probe reason',
        status: 'expired',
        created_at: new Date(addHours(new Date(), -ago)),
      });
    }

    const record = await get(offer.teacherId);
    expect(record).toMatchObject({
      userId: offer.teacherId,
      profile: { deleted: false, teacher: { bio: 'نبذة', qualification: 'إجازة' } },
      role: 'teacher',
      isMinor: false,
      verificationStatus: 'approved',
      accountStatus: 'active',
      cancellationRequests: { total: 2, recent: 1 },
      repeatedAbsences: [
        {
          enrollmentId: marked,
          student: { userId: student, displayName: 'طالب', deleted: false },
          status: 'confirmed',
          teacherNoShows: 5,
        },
      ],
    });
  });

  it("answers a student's record with the minor flag derived, and no date of birth", async () => {
    const student = await withRole(
      await makeUser(db, { display_name: 'قاصر', gender: 'female', date_of_birth: '2012-06-01' }),
      'student',
    );
    const record = await get(student);
    expect(record).toEqual({
      userId: student,
      profile: {
        displayName: 'قاصر',
        email: expect.any(String),
        joinedAt: expect.any(String),
        deleted: false,
      },
      role: 'student',
      gender: 'female',
      isMinor: true,
      verificationStatus: null,
      accountStatus: 'active',
      cancellationRequests: { total: 0, recent: 0 },
      // T072 (rule d): no ban's closing holds a slot.
      enrollmentsSlotHeldUntil: null,
      // B42b, T075 (rule d): the ban restore window's days (Q-O2 (a)).
      banRestoreWindowDays: 14,
    });
    expect(JSON.stringify(record)).not.toMatch(/birth|2012-06-01/);
  });

  it('refuses NOT_FOUND for a user that never existed', async () => {
    await expect(get('0199d0a0-0000-7000-8000-00000000dead')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
