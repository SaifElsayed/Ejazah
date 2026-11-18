// 005:T017 (FR-619, FR-622, FR-BOOK-8; research R-407; contracts/jobs.md; SRS DEC-74; the note under
// T017) and 005:T018 (R-TIME-1): the `send-reminder` sweep. Every minute, on a cron pattern in code
// as every sweep's, payload `{}`. One run, at one instant read once:
//
//   1. THE REMINDERS. For each offset of `reminder_offsets_minutes` (read on every run, FR-034), a
//      `scheduled` session is due when `scheduled_start_at − offset <= now < scheduled_start_at`, and
//      each of its two parties (`teacher_user_id`, `student_user_id`) with no `session_reminders` row
//      for (session, user, offset) gets one `session_reminder` notification, payload
//      `{ sessionId, enrollmentId }` (ids only, R-HONEST-5), and its row. The sessions are read a page
//      at a time through ERD §14's partial index `sessions (scheduled_end_at) WHERE status =
//      'scheduled'`, bounded by `now < scheduled_end_at <= now + maxOffset + maxLength` (maxLength the
//      longest of `SESSION_LENGTHS_MINUTES`), with no new index (R-DB-9), then filtered on the start
//      instant here. No last run is kept: a run after downtime catches up every session not yet
//      started, and a session booked inside an offset's window gets that reminder on the next run.
//      A session no longer scheduled is not read; a start recomputed by `reresolve-session-instants`
//      is read as committed, so nothing is rescheduled (R-407, FR-622).
//   2. THE RE-SEND OF A LOST ENQUEUE (Q-N4 (a), DEC-74; the follow-up under T005). The writer queues
//      a push after its producer's commit; a crash between the two leaves the row with `pushed_at`
//      NULL and no job. Every notification with `pushed_at` NULL created in
//      `[now − notification_requeue_max_age_minutes, now − notification_requeue_after_minutes)` is
//      queued again through the writer's queue under its own id (`deliver-notification`, which skips
//      a row already pushed), a page at a time after the page's read, one info line per page. A row
//      the job skipped for a user with no device is queued again each minute inside that window, then
//      left. The registry does not hold `after < max_age`: when an administrator sets `after >=
//      max_age` the window is empty, and the run queues nothing, says so once with the two values and
//      the reason `requeue_window_empty`, and goes on (the review's note, 2026-11-18). Precedent:
//      payments' recovery of a lost enqueue, `expire-pending-payments.ts`' step 3.
//
// ONE TRANSACTION PER (SESSION, OFFSET), bound to its own after-commit list (`bindToTransaction`, as
// `identity/deletion.service.ts` binds its own), so `NotificationWriter.record` writes each party's
// notification on it and its push is queued only after the commit, dropped on a rollback. Each
// party's row is written after its notification (the row references it). THE PARTIES FIRST (#148
// Saif r1, Major 1; kernel.md's `send-reminder` row): each transaction's first statement takes both
// parties' `users` rows `FOR KEY SHARE`, in id order, in one call (`keyShareRows`), the lock the
// notifications' foreign keys take later. So the row's own key share on the session comes after
// every account, and a path that holds an account `FOR UPDATE` and then asks for the other account
// or the session never closes a cycle with a reminder (T005's rule 2, `platform/db/row-lock.ts`).
// THE KEY, NOT A LOCK: the reads take no lock, and the primary key
// `(session_id, user_id, offset_minutes)` makes a rerun or a concurrent run write nothing: a run that
// reads before another commits writes its row with `ON CONFLICT DO NOTHING`, which waits for the
// other's uncommitted key and then writes nothing, and the run then rolls its transaction back with
// its notification (`already_reminded`, logged). Both parties are written in one order, the
// teacher's first, so two runs never wait on each other in opposite orders. The transactions run one
// after another, so a page holds one connection of the pool.
//
// TIME (T018, R-TIME-1). The window is computed from instants only (`addMinutes` of `packages/time`),
// never from a session's local date and time: across a clock change each offset is that many
// minutes of real time before the start (`send-reminder-dst.spec.ts`).
//
// IDEMPOTENT (R-API-14): a second run finds every due key written and queues the same unpushed rows
// under the same job ids, which the queue holds once.
//
// ⚠️ AUTOMATIC, every minute: the reminders and the re-send. LOGS: ids, counts and a reason only.
import { SESSION_LENGTHS_MINUTES } from '@ijazah/contracts';
import { addMinutes } from '@ijazah/time';
import { z } from 'zod';

import {
  insertSessionReminder,
  type NotificationLog,
  type NotificationQueue,
  type NotificationWriter,
  remindersOf,
  type SessionReminderKey,
  type SessionReminderRow,
  unpushedCreatedWithin,
} from '../modules/notifications/index.js';
import { scheduledEndingWithin, type SessionToRemind } from '../modules/sessions/index.js';
import type { Database, Transaction } from '../platform/db/prisma.repository.js';
import { keyShareRows } from '../platform/db/row-lock.js';
import { bindToTransaction, RequestLive, unboundBus } from '../platform/live/live-publisher.js';
import type { SettingsReader } from '../platform/settings/settings-reader.js';
import { EVERY_MINUTE, EXPIRY_PAGE_SIZE, inPages } from './expire-holds.js';
import { defineJob, type Job } from './job.js';

/** The sweep's name. */
export const SEND_REMINDER = 'send-reminder';

/** The offsets before a session its parties are reminded at, in minutes (FR-BOOK-8). */
export const REMINDER_OFFSETS_SETTING = 'reminder_offsets_minutes';

/** How old an unpushed notification is before it is queued again (DEC-74). */
export const REQUEUE_AFTER_SETTING = 'notification_requeue_after_minutes';

/** How old an unpushed notification is when it is no longer queued again (DEC-74). */
export const REQUEUE_MAX_AGE_SETTING = 'notification_requeue_max_age_minutes';

const offsetsMinutes = z.array(z.int().positive());
const minutes = z.int().positive();

/** The longest session, so a session whose start is due ends inside the read's bound. */
const LONGEST_SESSION_MINUTES = Math.max(...SESSION_LENGTHS_MINUTES);

/** What the sweep asks of the sessions and notifications modules, each on its transaction (R-API-6). */
export interface ReminderSteps {
  /** A page of the scheduled sessions ending in `(after, upTo]`, in id order after `cursor`. */
  scheduledEndingWithin(
    tx: Transaction,
    window: { readonly after: Date; readonly upTo: Date },
    cursor: string | undefined,
    limit: number,
  ): Promise<readonly SessionToRemind[]>;
  /** The `session_reminders` keys of `sessionIds`. */
  remindersOf(
    tx: Transaction,
    sessionIds: readonly string[],
  ): Promise<readonly SessionReminderKey[]>;
  /** Writes the row after its notification; false when the key is already held. */
  insertReminder(tx: Transaction, row: SessionReminderRow): Promise<boolean>;
  /** A page of the unpushed notifications created in `[from, before)`, in id order after `cursor`. */
  unpushedCreatedWithin(
    tx: Transaction,
    window: { readonly from: Date; readonly before: Date },
    cursor: string | undefined,
    limit: number,
  ): Promise<readonly string[]>;
}

/** The steps over the modules' entries. */
export const reminderSteps: ReminderSteps = {
  scheduledEndingWithin,
  remindersOf,
  insertReminder: insertSessionReminder,
  unpushedCreatedWithin,
};

export interface SendReminderOptions {
  readonly database: Pick<Database, '$transaction'>;
  /** `reminder_offsets_minutes` and the two re-send settings, read on every run. */
  readonly settings: SettingsReader;
  /** The notifications module's one writer (`createNotificationWriter`). */
  readonly writer: Pick<NotificationWriter, 'record'>;
  /** The writer's own queue: `deliver-notification` under the job id = the notification's id. */
  readonly queue: NotificationQueue;
  readonly log: NotificationLog;
  readonly steps?: ReminderSteps;
  /** The clock; the system clock unless a spec sets one. */
  readonly clock?: () => Date;
  readonly pageSize?: number;
}

/** One session's reminders at one offset: the parties not yet reminded at it. */
interface DueReminder {
  readonly session: SessionToRemind;
  readonly offsetMinutes: number;
  readonly userIds: readonly string[];
}

/** Thrown inside a reminder's transaction when another run holds its key: the rollback's signal. */
class AlreadyReminded extends Error {
  constructor() {
    super('Another run recorded this reminder');
    this.name = 'AlreadyReminded';
  }
}

/** Whether `startsAt − offsetMinutes <= at < startsAt`, on instants (R-407, R-TIME-1). */
function isDue(startsAt: Date, offsetMinutes: number, at: Date): boolean {
  const opensAt = new Date(addMinutes(startsAt, -offsetMinutes));
  return opensAt.getTime() <= at.getTime() && at.getTime() < startsAt.getTime();
}

/** The page's due reminders whose key no row holds, the teacher first in each. */
function dueAmong(
  sessions: readonly SessionToRemind[],
  offsets: readonly number[],
  at: Date,
  held: readonly SessionReminderKey[],
): DueReminder[] {
  const keys = new Set(held.map((row) => keyOf(row.sessionId, row.userId, row.offsetMinutes)));
  const due: DueReminder[] = [];
  for (const session of sessions) {
    for (const offsetMinutes of offsets) {
      if (!isDue(session.startsAt, offsetMinutes, at)) continue;
      const userIds = [session.teacherUserId, session.studentUserId].filter(
        (userId) => !keys.has(keyOf(session.id, userId, offsetMinutes)),
      );
      if (userIds.length > 0) due.push({ session, offsetMinutes, userIds });
    }
  }
  return due;
}

function keyOf(sessionId: string, userId: string, offsetMinutes: number): string {
  return `${sessionId} ${userId} ${String(offsetMinutes)}`;
}

export function sendReminder({
  database,
  settings,
  writer,
  queue,
  log,
  steps = reminderSteps,
  clock = () => new Date(),
  pageSize = EXPIRY_PAGE_SIZE,
}: SendReminderOptions): Job {
  /** One session's reminders at one offset, on one transaction bound to its own after-commit list. */
  const remind = async ({ session, offsetMinutes, userIds }: DueReminder): Promise<void> => {
    const live = new RequestLive(unboundBus, log);
    try {
      await database.$transaction(async (tx) => {
        const unbind = bindToTransaction(tx, live);
        try {
          // Both parties first, id order, one call (the file's head; kernel.md).
          await keyShareRows(tx, 'users', [session.teacherUserId, session.studentUserId].sort());
          for (const userId of userIds) {
            const { notificationId } = await writer.record(tx, {
              userId,
              type: 'session_reminder',
              payload: { sessionId: session.id, enrollmentId: session.enrollmentId },
            });
            const written = await steps.insertReminder(tx, {
              sessionId: session.id,
              userId,
              offsetMinutes,
              notificationId,
            });
            if (!written) throw new AlreadyReminded();
          }
        } finally {
          unbind();
        }
      });
    } catch (error: unknown) {
      live.drop();
      if (!(error instanceof AlreadyReminded)) throw error;
      log.info(
        { sessionId: session.id, offsetMinutes, reason: 'already_reminded' },
        'A session reminder was already recorded by another run; this one was rolled back',
      );
      return;
    }
    live.flush();
    log.info(
      {
        sessionId: session.id,
        enrollmentId: session.enrollmentId,
        offsetMinutes,
        recipients: userIds.length,
      },
      'Session reminders were recorded',
    );
  };

  const remindAll = async (at: Date, offsets: readonly number[]): Promise<void> => {
    if (offsets.length === 0) {
      log.info({ reason: 'no_reminder_offsets' }, 'No session reminder is set');
      return;
    }
    const window = {
      after: at,
      upTo: new Date(addMinutes(at, Math.max(...offsets) + LONGEST_SESSION_MINUTES)),
    };
    await inPages(pageSize, async (cursor) => {
      const [read, due] = await database.$transaction(async (tx) => {
        const sessions = await steps.scheduledEndingWithin(tx, window, cursor, pageSize);
        const held =
          sessions.length === 0
            ? []
            : await steps.remindersOf(
                tx,
                sessions.map(({ id }) => id),
              );
        return [sessions.map(({ id }) => id), dueAmong(sessions, offsets, at, held)] as const;
      });
      for (const reminder of due) await remind(reminder);
      return read;
    });
  };

  const requeue = async (at: Date, afterMinutes: number, maxAgeMinutes: number): Promise<void> => {
    if (afterMinutes >= maxAgeMinutes) {
      log.info(
        { afterMinutes, maxAgeMinutes, reason: 'requeue_window_empty' },
        'No unpushed notification is queued again: the wait is not shorter than the maximum age',
      );
      return;
    }
    const window = {
      from: new Date(addMinutes(at, -maxAgeMinutes)),
      before: new Date(addMinutes(at, -afterMinutes)),
    };
    await inPages(pageSize, async (cursor) => {
      const ids = await database.$transaction((tx) =>
        steps.unpushedCreatedWithin(tx, window, cursor, pageSize),
      );
      if (ids.length === 0) return ids;
      await Promise.all(ids.map((notificationId) => queue.enqueue(notificationId)));
      log.info(
        { count: ids.length, firstId: ids[0], lastId: ids.at(-1), reason: 'lost_enqueue_requeued' },
        'Unpushed notifications were queued again',
      );
      return ids;
    });
  };

  return defineJob({
    name: SEND_REMINDER,
    payload: z.object({}),
    schedule: EVERY_MINUTE,
    run: async () => {
      const at = clock();
      // The reminders first, so a re-send setting the store lacks (FR-034: it fails the run) never
      // holds a reminder back; the run is retried by the queue and both halves are idempotent.
      const offsets = [...new Set(await settings.read(REMINDER_OFFSETS_SETTING, offsetsMinutes))];
      await remindAll(at, offsets);
      const [afterMinutes, maxAgeMinutes] = await Promise.all([
        settings.read(REQUEUE_AFTER_SETTING, minutes),
        settings.read(REQUEUE_MAX_AGE_SETTING, minutes),
      ]);
      await requeue(at, afterMinutes, maxAgeMinutes);
    },
  });
}
