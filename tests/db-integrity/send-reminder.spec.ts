// 005:T017 (FR-619, FR-622, FR-BOOK-8; research R-407; SRS DEC-74): the `send-reminder` sweep over
// the real tables, with the notifications module's writer:
//
//   - two runs keep one `session_reminders` row per (session, user, offset), each beside its own
//     `session_reminder` notification, and queue each push once;
//   - THE RACE: two runs at once, both reading before either writes, still leave one row and one
//     notification per key: the loser's row waits on the winner's key, writes nothing
//     (`ON CONFLICT DO NOTHING`), and its transaction is rolled back with its notification;
//   - a session moved by `reresolve-session-instants` is reminded from its new start (the sweep
//     reads the committed instants, R-407);
//   - a cancelled session is reminded never;
//   - the re-send's window over `notifications.created_at`: `[now − 30, now − 5)` minutes, edges
//     included and excluded as written, a pushed row never.
//
// Each case runs at an instant of its own in 2061 or 2062 (winter, Cairo +02:00), so the sweep, which
// reads every scheduled session of the database ending in its window, meets only that case's rows.
// Parents and sessions are committed through the application role and removed after the suite by the
// OWNER role, as `reresolve-session-instants.spec.ts` does.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  reresolveSessionInstants,
  TZDATA_RERESOLVE_SCOPE,
} from '../../apps/api/src/jobs/reresolve-session-instants.js';
import {
  REMINDER_OFFSETS_SETTING,
  reminderSteps,
  type ReminderSteps,
  REQUEUE_AFTER_SETTING,
  REQUEUE_MAX_AGE_SETTING,
  sendReminder,
} from '../../apps/api/src/jobs/send-reminder.js';
import { createNotificationWriter } from '../../apps/api/src/modules/notifications/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures';
import { jobRunsOver } from '../../apps/api/src/platform/idempotency/job-runs.repository.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
import {
  connectAsApplication,
  type Db,
  enrollmentValues,
  insertRow,
  makeOffer,
  makeUser,
} from './harness';

const CAIRO = 'Africa/Cairo';

let setup: Db;
let database: Database;
const users: string[] = [];
const subjects: string[] = [];
const versions: string[] = [];

beforeAll(async () => {
  specDatabaseUrl('DATABASE_URL_OWNER');
  setup = await connectAsApplication();
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 4,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
});

afterAll(async () => {
  await Promise.all([setup?.end(), database === undefined ? undefined : closeDatabase(database)]);
  const owner = new pg.Client({
    connectionString: specDatabaseUrl('DATABASE_URL_OWNER'),
    connectionTimeoutMillis: 5_000,
  });
  await owner.connect();
  try {
    await owner.query('BEGIN');
    await owner.query('DELETE FROM "idempotency_keys" WHERE scope = $1 AND key = ANY($2)', [
      TZDATA_RERESOLVE_SCOPE,
      versions,
    ]);
    await owner.query('DELETE FROM "session_reminders" WHERE user_id = ANY($1)', [users]);
    await owner.query('DELETE FROM "notifications" WHERE user_id = ANY($1)', [users]);
    await owner.query(
      `DELETE FROM "session_events" WHERE enrollment_id IN (
         SELECT id FROM "enrollments" WHERE teacher_user_id = ANY($1) OR student_user_id = ANY($1))`,
      [users],
    );
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

interface Enrollment {
  readonly id: string;
  readonly teacherId: string;
  readonly studentId: string;
}

/** An enrollment of a new teacher and a new student (60-minute sessions), committed. */
async function committedEnrollment(): Promise<Enrollment> {
  const offer = await makeOffer(setup);
  users.push(offer.teacherId);
  subjects.push(offer.subjectId);
  const studentId = await makeUser(setup);
  users.push(studentId);
  const id = await insertRow(setup, 'enrollments', enrollmentValues(offer, studentId));
  return { id, teacherId: offer.teacherId, studentId };
}

/** A committed session of `enrollment` on `day` at `startLocal` in Cairo, cached as given. */
async function committedSession(
  enrollment: Enrollment,
  values: {
    readonly day: string;
    readonly startLocal: string;
    readonly startsAt: string;
    readonly endsAt: string;
    readonly status?: string;
  },
): Promise<string> {
  return insertRow(setup, 'sessions', {
    enrollment_id: enrollment.id,
    teacher_user_id: enrollment.teacherId,
    student_user_id: enrollment.studentId,
    sequence_number: 1,
    scheduled_date_local: values.day,
    scheduled_start_time_local: values.startLocal,
    timezone: CAIRO,
    scheduled_start_at: values.startsAt,
    scheduled_end_at: values.endsAt,
    status: values.status ?? 'scheduled',
  });
}

const settings: SettingsReader = {
  async read(key, schema) {
    const values: Record<string, unknown> = {
      [REMINDER_OFFSETS_SETTING]: [1440, 15],
      [REQUEUE_AFTER_SETTING]: 5,
      [REQUEUE_MAX_AGE_SETTING]: 30,
      idempotency_key_ttl_hours: 24,
    };
    if (!(key in values)) throw new Error(`unexpected setting ${key}`);
    return schema.parse(values[key]);
  },
};

/** The sweep over the real tables at `now`, its queue and its log lines kept. */
function sweepAt(now: string, steps: ReminderSteps = reminderSteps) {
  const queued: string[] = [];
  const logs: Record<string, unknown>[] = [];
  const queue = {
    enqueue: async (notificationId: string) => {
      queued.push(notificationId);
    },
  };
  const log = {
    info: (fields: Readonly<Record<string, unknown>>) => {
      logs.push({ ...fields });
    },
    warn: (fields: Readonly<Record<string, unknown>>) => {
      logs.push({ ...fields });
    },
  };
  const writer = createNotificationWriter({ database, queue, log });
  const job = sendReminder({
    database,
    settings,
    writer,
    queue,
    log,
    steps,
    clock: () => new Date(now),
  });
  return {
    queued,
    logs,
    run: async () => {
      await job.handle({});
      // The writer's after-commit enqueue is not awaited by the transaction's caller.
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

interface ReminderRow {
  readonly user: 'teacher' | 'student';
  readonly offset: number;
  readonly notificationOfSameUser: boolean;
  readonly payload: unknown;
}

/** The reminder rows of `sessionId`, each with its notification, sorted. */
async function remindersOf(sessionId: string, enrollment: Enrollment): Promise<ReminderRow[]> {
  const { rows } = await setup.query<{
    user_id: string;
    offset_minutes: number;
    notification_user_id: string | null;
    payload: unknown;
  }>(
    `SELECT r.user_id, r.offset_minutes, n.user_id AS notification_user_id, n.payload
       FROM "session_reminders" r LEFT JOIN "notifications" n ON n.id = r.notification_id
      WHERE r.session_id = $1`,
    [sessionId],
  );
  return rows
    .map((row) => ({
      user: row.user_id === enrollment.teacherId ? ('teacher' as const) : ('student' as const),
      offset: row.offset_minutes,
      notificationOfSameUser: row.notification_user_id === row.user_id,
      payload: row.payload,
    }))
    .sort((one, other) =>
      `${one.user}${String(one.offset)}` < `${other.user}${String(other.offset)}` ? -1 : 1,
    );
}

/** How many `session_reminder` notifications the enrollment's two parties hold. */
async function reminderNotificationsOf(enrollment: Enrollment): Promise<number> {
  const { rows } = await setup.query<{ count: string }>(
    `SELECT count(*) FROM "notifications"
      WHERE user_id = ANY($1) AND type = 'session_reminder'`,
    [[enrollment.teacherId, enrollment.studentId]],
  );
  return Number(rows[0]?.count);
}

/** Every key of a session due at both offsets, each beside its own notification. */
function bothOffsets(sessionId: string, enrollmentId: string): ReminderRow[] {
  const payload = { session_id: sessionId, enrollment_id: enrollmentId };
  return [
    { user: 'student', offset: 1440, notificationOfSameUser: true, payload },
    { user: 'student', offset: 15, notificationOfSameUser: true, payload },
    { user: 'teacher', offset: 1440, notificationOfSameUser: true, payload },
    { user: 'teacher', offset: 15, notificationOfSameUser: true, payload },
  ];
}

describe('send-reminder over the real tables (005:T017, R-407)', () => {
  it('keeps one row per (session, user, offset) across two runs, each push queued once', async () => {
    const enrollment = await committedEnrollment();
    // Local 10:10 in Cairo (+02:00), ten minutes after the run: due at 1440 and at 15.
    const sessionId = await committedSession(enrollment, {
      day: '2061-01-16',
      startLocal: '10:10:00',
      startsAt: '2061-01-16T08:10:00Z',
      endsAt: '2061-01-16T09:10:00Z',
    });
    const first = sweepAt('2061-01-16T08:00:00Z');
    const second = sweepAt('2061-01-16T08:00:30Z');

    await first.run();
    await second.run();

    expect(await remindersOf(sessionId, enrollment)).toEqual(bothOffsets(sessionId, enrollment.id));
    expect(await reminderNotificationsOf(enrollment)).toBe(4);
    expect(first.queued).toHaveLength(4);
    expect(second.queued).toEqual([]);
  });

  it('leaves one row and one notification per key when two runs race (the race)', async () => {
    const enrollment = await committedEnrollment();
    const sessionId = await committedSession(enrollment, {
      day: '2061-02-16',
      startLocal: '10:10:00',
      startsAt: '2061-02-16T08:10:00Z',
      endsAt: '2061-02-16T09:10:00Z',
    });
    // Both runs read the reminders before either writes one.
    let arrived = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const racing: ReminderSteps = {
      ...reminderSteps,
      remindersOf: async (tx, sessionIds) => {
        const rows = await reminderSteps.remindersOf(tx, sessionIds);
        arrived += 1;
        if (arrived === 2) release();
        await gate;
        return rows;
      },
    };
    const one = sweepAt('2061-02-16T08:00:00Z', racing);
    const other = sweepAt('2061-02-16T08:00:00Z', racing);

    await Promise.all([one.run(), other.run()]);

    expect(await remindersOf(sessionId, enrollment)).toEqual(bothOffsets(sessionId, enrollment.id));
    expect(await reminderNotificationsOf(enrollment)).toBe(4);
    expect(one.queued.length + other.queued.length).toBe(4);
    expect(
      [...one.logs, ...other.logs].filter((fields) => fields.reason === 'already_reminded'),
    ).toHaveLength(2);
  });

  it('reminds a session moved by reresolve-session-instants from its new start', async () => {
    const enrollment = await committedEnrollment();
    // Local 10:00 in Cairo is 08:00Z; cached an hour early, as a data change would leave it.
    const sessionId = await committedSession(enrollment, {
      day: '2061-03-16',
      startLocal: '10:00:00',
      startsAt: '2061-03-16T07:00:00Z',
      endsAt: '2061-03-16T08:00:00Z',
    });
    const version = `spec-${randomUUID()}`;
    versions.push(version);
    await reresolveSessionInstants({
      database,
      runs: jobRunsOver(database),
      settings,
      tzVersion: () => version,
      report: () => undefined,
    }).handle({});

    // 15 minutes before the stale start, and an hour before the new one less 15.
    await sweepAt('2061-03-16T06:50:00Z').run();
    expect((await remindersOf(sessionId, enrollment)).map(({ offset }) => offset)).toEqual([
      1440, 1440,
    ]);

    await sweepAt('2061-03-16T07:45:00Z').run();
    expect(await remindersOf(sessionId, enrollment)).toEqual(bothOffsets(sessionId, enrollment.id));
  });

  it('never reminds a cancelled session', async () => {
    const enrollment = await committedEnrollment();
    const sessionId = await committedSession(enrollment, {
      day: '2061-01-26',
      startLocal: '10:10:00',
      startsAt: '2061-01-26T08:10:00Z',
      endsAt: '2061-01-26T09:10:00Z',
      status: 'cancelled_by_agreement',
    });
    const sweep = sweepAt('2061-01-26T08:00:00Z');

    await sweep.run();

    expect(await remindersOf(sessionId, enrollment)).toEqual([]);
    expect(await reminderNotificationsOf(enrollment)).toBe(0);
  });
});

describe('send-reminder: the re-send over notifications.created_at (005:T017, SRS DEC-74)', () => {
  it('queues again the unpushed rows created in [now − 30, now − 5) minutes, and no other', async () => {
    const userId = await makeUser(setup);
    users.push(userId);
    const row = (createdAt: string, pushedAt: string | null = null): Promise<string> =>
      insertRow(setup, 'notifications', {
        user_id: userId,
        type: 'payment_failed',
        title_key: 'notifications.push.payment_failed.title',
        body_key: 'notifications.push.payment_failed.body',
        payload: JSON.stringify({}),
        created_at: createdAt,
        updated_at: createdAt,
        pushed_at: pushedAt,
      });
    const justInside = await row('2062-03-01T07:54:59.999Z');
    const oldest = await row('2062-03-01T07:30:00Z');
    const atTheWait = await row('2062-03-01T07:55:00Z');
    const tooYoung = await row('2062-03-01T07:55:01Z');
    const tooOld = await row('2062-03-01T07:29:59.999Z');
    const twoDaysOld = await row('2062-02-27T08:00:00Z');
    const pushed = await row('2062-03-01T07:50:00Z', '2062-03-01T07:51:00Z');
    const sweep = sweepAt('2062-03-01T08:00:00Z');

    await sweep.run();

    const mine = new Set([justInside, oldest, atTheWait, tooYoung, tooOld, twoDaysOld, pushed]);
    expect(sweep.queued.filter((id) => mine.has(id)).sort()).toEqual([justInside, oldest].sort());
  });
});
