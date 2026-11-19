// 003:T112 (SRS FR-POSTPONE-2, R-407; the note under T112, «Reminders» and «The week», Q-1 (a); the
// owner's hidden-times rule of 2026-11-05) — what a postponement leaves in time, over the real
// tables, `20261119095115_session_postponements` applied.
//
//   - THE REMINDERS (R-407, the task's own case): a session postponed 13 hours before its start gets no
//     further reminder, since `send-reminder` reads only `scheduled` sessions; the make-up that takes
//     its place, booked by the student's acceptance of the proposal (FR-MAKEUP-4), is a new session row
//     and gets its own 24-hour reminder for its own date. No `session_reminders` row is deleted.
//     `send-reminder` changes nothing for this: a pin, red under mutant M-F1 (the sweep reading
//     `postponed` sessions too).
//   - THE HIDDEN WEEK (Q-1 (a)): after a postponement, neither the system's proposal nor any counter
//     option starts inside the week the postponement covered, [now + the notice, now + 7 days]. The
//     choice window opened at the same instant ends at the week's end, and both bounds start from it
//     (`remedy-offer.service.ts`, `remedy.service.ts`). Red under mutants M-F2 (the proposal bounded
//     from the offer instead of the choice window's end) and M-F3 (the counter options bounded from
//     now + the answer window and the lead, ignoring the choice window).
//
// The enrollment's weekly slot is placed on the weekday five days from now, so a bound that forgot
// the choice window would land inside the week. The reminder sweep is narrowed to this file's
// sessions, so it reminds no other spec's. Rows are committed; every connection is the application
// role.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  REMINDER_OFFSETS_SETTING,
  reminderSteps,
  type ReminderSteps,
  REQUEUE_AFTER_SETTING,
  REQUEUE_MAX_AGE_SETTING,
  sendReminder,
} from '../../apps/api/src/jobs/send-reminder.js';
import { createEnrollmentSide } from '../../apps/api/src/modules/booking/index.js';
import { createNotificationWriter } from '../../apps/api/src/modules/notifications/index.js';
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
import { IdempotencyRepository } from '../../apps/api/src/platform/idempotency/idempotency.repository.js';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service.js';
import type { LivePublisher } from '../../apps/api/src/platform/live/live-publisher.js';
import { createLogger } from '../../apps/api/src/platform/logging/logger.js';
import { createVideoPort } from '../../apps/api/src/platform/ports/video/index.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
import {
  addHours,
  addMinutes,
  addSeconds,
  dateColumnOf,
  localDateIn,
} from '../../packages/time/src/index.js';
import {
  connectAsApplication,
  type Db,
  enrollmentValues,
  insertRow,
  makeOffer,
  makeUser,
} from './harness';

const CAIRO = 'Africa/Cairo';
const NO_PUSH = { record: async () => undefined };

let db: Db;
let database: Database;
let services: SessionsServices;

/** The seeded values (`prisma/seed.ts`), read through a fixed reader. */
const SEEDED: Record<string, unknown> = {
  early_join_lead_minutes: 15,
  video_empty_timeout_seconds: 300,
  video_departure_timeout_seconds: 20,
  idempotency_key_ttl_hours: 24,
  first_session_lead_hours: 24,
  dispute_window_hours: 72,
  makeup_choice_window_days: 7,
  makeup_counter_answer_hours: 72,
  postponement_notice_hours: 12,
  postponement_interval_weeks: 4,
  [REMINDER_OFFSETS_SETTING]: [1440, 15],
  [REQUEUE_AFTER_SETTING]: 5,
  [REQUEUE_MAX_AGE_SETTING]: 30,
};
const settings: SettingsReader = { read: async (key, schema) => schema.parse(SEEDED[key]) };
const log = createLogger({ level: 'fatal' });
const noLive: LivePublisher = { afterCommit: () => undefined };

beforeAll(async () => {
  db = await connectAsApplication();
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 6,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  services = createSessionsServices({
    notifications: NO_PUSH,
    transactions: transactionsOver(database),
    settings,
    video: createVideoPort({
      VIDEO_PROVIDER: 'fake',
      ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    }),
    enrollmentSide: createEnrollmentSide({ settings }),
    store: sessionsStore,
    idempotency: new IdempotencyService<Transaction>({
      store: new IdempotencyRepository(database),
      settings,
    }),
  });
});

afterAll(async () => {
  await db?.end();
  if (database !== undefined) await closeDatabase(database);
});

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

/** The weekday (0 = Sunday) of `at` in Cairo, `availability_slots.day_of_week`'s count. */
function cairoWeekday(at: Date): number {
  // `dateColumnOf`: the local date's midnight in UTC, resolved in `packages/time` (R-TIME-1).
  return dateColumnOf(localDateIn(at, CAIRO)).getUTCDay();
}

/**
 * A male student and an approved male teacher with a confirmed enrollment on a weekly slot at 09:00
 * Cairo on the weekday five days from now, and one session starting `startsIn` seconds from now,
 * its local date the instant's own in Cairo.
 */
async function world(startsIn: number) {
  const offer = await makeOffer(db);
  await insertRow(db, 'user_roles', {
    user_id: offer.teacherId,
    role: 'teacher',
    status: 'active',
  });
  await insertRow(db, 'teacher_profiles', {
    user_id: offer.teacherId,
    bio: 'Probe',
    qualification_summary: 'Probe',
    verification_status: 'approved',
    approved_at: '2026-10-01T00:00:00Z',
    application_status: 'approved',
    application_submitted_at: '2026-09-30T00:00:00Z',
    payout_verified_at: '2026-10-01T00:00:00Z',
  });
  const now = new Date();
  const slotId = await insertRow(db, 'availability_slots', {
    teacher_user_id: offer.teacherId,
    day_of_week: cairoWeekday(new Date(addSeconds(now, 5 * DAY))),
    start_time_local: '09:00:00',
    duration_minutes: 60,
    timezone: CAIRO,
    is_active: true,
  });
  const studentId = await makeUser(db, { gender: 'male' });
  const enrollmentId = await insertRow(db, 'enrollments', {
    ...enrollmentValues({ ...offer, slotId }, studentId),
    status: 'confirmed',
    confirmed_at: '2026-10-04T07:05:00Z',
  });
  const startsAt = new Date(addSeconds(now, startsIn));
  const sessionId = await insertRow(db, 'sessions', {
    enrollment_id: enrollmentId,
    teacher_user_id: offer.teacherId,
    student_user_id: studentId,
    sequence_number: 1,
    scheduled_date_local: localDateIn(startsAt, CAIRO),
    scheduled_start_time_local: '09:00:00',
    timezone: CAIRO,
    scheduled_start_at: startsAt.toISOString(),
    scheduled_end_at: new Date(addMinutes(startsAt, 60)).toISOString(),
    status: 'scheduled',
  });
  return { enrollmentId, studentId, teacherId: offer.teacherId, sessionId, now };
}

const postpone = (enrollmentId: string, userId: string) =>
  services.postpone(
    { userId },
    { enrollmentId, reason: 'سفر طارئ', idempotencyKey: `probe-${randomUUID()}` },
    log,
    noLive,
  );

/** The reminder sweep at `at`, reading only `own` sessions. */
function sweepAt(at: Date, own: ReadonlySet<string>) {
  const queue = { enqueue: async () => undefined };
  const sweepLog = { info: () => undefined, warn: () => undefined };
  const steps: ReminderSteps = {
    ...reminderSteps,
    scheduledEndingWithin: async (tx, window, cursor) =>
      cursor !== undefined
        ? []
        : (await reminderSteps.scheduledEndingWithin(tx, window, undefined, 100_000)).filter(
            ({ id }) => own.has(id),
          ),
  };
  const job = sendReminder({
    database,
    settings,
    writer: createNotificationWriter({ database, queue, log: sweepLog }),
    queue,
    log: sweepLog,
    steps,
    clock: () => at,
  });
  return async () => {
    await job.handle({});
    await new Promise((resolve) => setImmediate(resolve));
  };
}

/** The reminder rows of `sessionId`: who and at which offset. */
async function remindersOf(sessionId: string, teacherId: string) {
  const { rows } = await db.query<{ user_id: string; offset_minutes: number }>(
    'SELECT user_id, offset_minutes FROM session_reminders WHERE session_id = $1',
    [sessionId],
  );
  return rows
    .map(({ user_id, offset_minutes }) => ({
      user: user_id === teacherId ? 'teacher' : 'student',
      offset: offset_minutes,
    }))
    .sort((a, b) => a.user.localeCompare(b.user) || a.offset - b.offset);
}

describe('the reminders of a postponed session (R-407; the note under T112)', () => {
  it('a session postponed 13 hours before: no further reminder for it, the 24-hour reminder sent for the make-up’s own date', async () => {
    const w = await world(13 * HOUR);
    await postpone(w.enrollmentId, w.studentId);
    // The make-up row: the student accepts the system's proposal (FR-MAKEUP-4).
    const accepted = await services.remedy.accept(
      { userId: w.studentId },
      { sessionId: w.sessionId },
      log,
    );
    const makeup = accepted.makeupSessionId;
    const own = new Set([w.sessionId, makeup]);

    // Now, inside the postponed session's 24-hour window: nothing for it.
    await sweepAt(new Date(), own)();
    expect(await remindersOf(w.sessionId, w.teacherId)).toEqual([]);

    // A minute inside the make-up's 24-hour window: both parties reminded, for the make-up.
    const { rows } = await db.query<{ scheduled_start_at: Date }>(
      'SELECT scheduled_start_at FROM sessions WHERE id = $1',
      [makeup],
    );
    const makeupStarts = rows[0]?.scheduled_start_at;
    if (makeupStarts === undefined) throw new Error('the make-up was not written');
    await sweepAt(new Date(addMinutes(new Date(addHours(makeupStarts, -24)), 1)), own)();
    expect(await remindersOf(makeup, w.teacherId)).toEqual([
      { user: 'student', offset: 1440 },
      { user: 'teacher', offset: 1440 },
    ]);
    expect(await remindersOf(w.sessionId, w.teacherId)).toEqual([]);
  });
});

describe('the postponement’s week is never offered (Q-1 (a); the hidden-times rule)', () => {
  it('neither the proposal nor any counter option starts inside [now + 12 h, now + 7 days]', async () => {
    const w = await world(2 * DAY);
    await postpone(w.enrollmentId, w.studentId);
    const weekFrom = new Date(addHours(w.now, 12)).getTime();
    const weekTo = new Date(addSeconds(w.now, 7 * DAY)).getTime();
    const inside = (startsAt: string) => {
      const at = new Date(startsAt).getTime();
      return at >= weekFrom && at <= weekTo;
    };
    const got = await services.get({ userId: w.studentId }, { sessionId: w.sessionId }, log);
    const proposal = got.remedy?.proposal;
    if (proposal === undefined) throw new Error('no proposal offered');
    expect(inside(proposal.startsAt), proposal.startsAt).toBe(false);
    const { options } = await services.remedy.counterOptions(
      { userId: w.studentId },
      { sessionId: w.sessionId },
      log,
    );
    expect(options.length).toBeGreaterThan(0);
    expect(options.filter(({ startsAt }) => inside(startsAt))).toEqual([]);
  });
});
