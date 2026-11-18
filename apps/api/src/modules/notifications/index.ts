// PUBLIC ENTRY of the notifications module (T017). Other modules import this file and nothing below it (R-API-3).
//
// T005 of specs/005-certification (R-406): the writer the producers record on (handed to them by
// `main.ts`), and the store `deliver-notification` reads and marks (handed in by `worker.ts`).
import type { Database } from '../../platform/db/prisma.repository.js';
import {
  NotificationWriter,
  type NotificationLog,
  type NotificationQueue,
} from './notification-writer.js';
import { NotificationsRepository, type NotificationDelivery } from './notifications.repository.js';

export {
  bodyKeyOf,
  NOTIFICATION_KINDS,
  NotificationWriter,
  titleKeyOf,
  type NotificationKind,
  type NotificationLog,
  type NotificationPayload,
  type NotificationQueue,
  type NotificationRecord,
} from './notification-writer.js';
export type { NotificationDelivery } from './notifications.repository.js';

/** The one writer of `notifications`, over this module's repository. */
export function createNotificationWriter({
  database,
  queue,
  log,
}: {
  readonly database: Pick<Database, 'notification'>;
  readonly queue: NotificationQueue;
  readonly log: NotificationLog;
}): NotificationWriter {
  return new NotificationWriter({ repository: new NotificationsRepository(database), queue, log });
}

/** What `deliver-notification` reads and marks, over this module's repository (R-API-6). */
export function createNotificationDeliveries(database: Pick<Database, 'notification'>): {
  find(notificationId: string): Promise<NotificationDelivery | null>;
  markPushed(notificationId: string, at: Date): Promise<void>;
} {
  const repository = new NotificationsRepository(database);
  return {
    find: (notificationId) => repository.find(notificationId),
    markPushed: (notificationId, at) => repository.markPushed(notificationId, at),
  };
}

// ---------------------------------------------------------------------------------------------
// 005:T017 (FR-619, FR-622; research R-407; SRS DEC-74): what `send-reminder` reads and writes, each
// on the sweep's transaction: the `session_reminders` rows of some sessions, one row written after
// its notification (the primary key refusing a second, so a rerun or a concurrent run records
// nothing), and a page of the notifications whose push was never marked, for the re-send.
export {
  insertSessionReminder,
  remindersOf,
  type SessionReminderKey,
  type SessionReminderRow,
  unpushedCreatedWithin,
} from './notifications.repository.js';
