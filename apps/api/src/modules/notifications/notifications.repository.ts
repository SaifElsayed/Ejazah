// T005 of specs/005-certification (R-406): the `notifications` rows, as the writer and the delivery
// job reach them (R-API-6). Queries only; the writer and the job hold the rules.
//
// The payload is stored as ERD §11 names its keys (`enrollment_id`, `session_id`) and read back
// into the port's names; a stored payload or kind this phase does not write is refused when read,
// naming nothing of it, so the job never pushes what it cannot read.
//
// 005:T017 (R-407, SRS DEC-74): the `send-reminder` sweep's queries, each on its transaction and with
// no lock: the `session_reminders` keys of a page of sessions, a row written after its notification
// (the primary key keeping one per (session, user, offset)), and a page of the unpushed notifications
// for the re-send of a lost enqueue.
import { z } from 'zod';

import type { Database, Transaction } from '../../platform/db/prisma.repository.js';
import {
  NOTIFICATION_KINDS,
  type NotificationKind,
  type NotificationPayload,
} from './notification-writer.js';

/** A notification as the delivery job reads it. */
export interface NotificationDelivery {
  readonly id: string;
  readonly userId: string;
  readonly kind: NotificationKind;
  readonly payload: NotificationPayload;
  readonly pushedAt: Date | null;
}

export interface NotificationInsert {
  readonly userId: string;
  readonly type: NotificationKind;
  readonly titleKey: string;
  readonly bodyKey: string;
  readonly payload: NotificationPayload;
}

const storedPayload = z.strictObject({
  enrollment_id: z.uuid().optional(),
  session_id: z.uuid().optional(),
});

const storedKind = z.enum(NOTIFICATION_KINDS);

export class NotificationsRepository {
  readonly #database: Pick<Database, 'notification'>;

  constructor(database: Pick<Database, 'notification'>) {
    this.#database = database;
  }

  /** Writes the row on the caller's transaction; its id. */
  async insert(tx: Pick<Transaction, 'notification'>, row: NotificationInsert): Promise<string> {
    const { enrollmentId, sessionId } = row.payload;
    const { id } = await tx.notification.create({
      data: {
        userId: row.userId,
        type: row.type,
        titleKey: row.titleKey,
        bodyKey: row.bodyKey,
        payload: {
          ...(enrollmentId === undefined ? {} : { enrollment_id: enrollmentId }),
          ...(sessionId === undefined ? {} : { session_id: sessionId }),
        },
      },
      select: { id: true },
    });
    return id;
  }

  /** The notification the job delivers, or null when there is none. */
  async find(notificationId: string): Promise<NotificationDelivery | null> {
    const row = await this.#database.notification.findUnique({
      where: { id: notificationId },
      select: { id: true, userId: true, type: true, payload: true, pushedAt: true },
    });
    if (row === null) return null;
    const payload = storedPayload.safeParse(row.payload);
    const kind = storedKind.safeParse(row.type);
    if (!payload.success || !kind.success) {
      throw new Error(`Notification ${row.id} holds a kind or a payload v1.0 does not push.`);
    }
    return {
      id: row.id,
      userId: row.userId,
      kind: kind.data,
      payload: {
        ...(payload.data.enrollment_id === undefined
          ? {}
          : { enrollmentId: payload.data.enrollment_id }),
        ...(payload.data.session_id === undefined ? {} : { sessionId: payload.data.session_id }),
      },
      pushedAt: row.pushedAt,
    };
  }

  /** Sets `pushed_at` once: a row already pushed keeps its time. */
  async markPushed(notificationId: string, at: Date): Promise<void> {
    await this.#database.notification.updateMany({
      where: { id: notificationId, pushedAt: null },
      data: { pushedAt: at },
    });
  }
}

/** 005:T017: a `session_reminders` key (R-407). */
export interface SessionReminderKey {
  readonly sessionId: string;
  readonly userId: string;
  readonly offsetMinutes: number;
}

/** 005:T017: a `session_reminders` row, its notification written first on the same transaction. */
export interface SessionReminderRow extends SessionReminderKey {
  readonly notificationId: string;
}

/**
 * 005:T017: the `session_reminders` keys of `sessionIds`, every offset and user; over the primary
 * key, whose first column is `session_id`. Bounded by the caller's page: two parties per session and
 * offset.
 */
export async function remindersOf(
  tx: Pick<Transaction, 'sessionReminder'>,
  sessionIds: readonly string[],
): Promise<readonly SessionReminderKey[]> {
  if (sessionIds.length === 0) return [];
  return tx.sessionReminder.findMany({
    where: { sessionId: { in: [...sessionIds] } },
    select: { sessionId: true, userId: true, offsetMinutes: true },
  });
}

/**
 * 005:T017: writes the row on the caller's transaction, after its notification (the row references
 * it); false when the primary key already holds (session, user, offset). `ON CONFLICT DO NOTHING`
 * (`skipDuplicates`): a concurrent run's uncommitted row of the same key is waited for, and once it
 * commits this one writes nothing, so the caller rolls its transaction back with the notification it
 * wrote, rather than meeting a unique violation that would abort the transaction.
 */
export async function insertSessionReminder(
  tx: Pick<Transaction, 'sessionReminder'>,
  row: SessionReminderRow,
): Promise<boolean> {
  const { count } = await tx.sessionReminder.createMany({
    data: [
      {
        sessionId: row.sessionId,
        userId: row.userId,
        offsetMinutes: row.offsetMinutes,
        notificationId: row.notificationId,
      },
    ],
    skipDuplicates: true,
  });
  return count === 1;
}

/**
 * 005:T017 (SRS DEC-74, the note under T017): a page of the notifications whose push was never
 * marked (`pushed_at` NULL) created in `[from, before)`, in id order after `cursor`, at most `limit`.
 * No index serves `pushed_at` or `created_at` (ERD §14; R-DB-9: an index only after a measured slow
 * query), so the read walks the primary key in id order, which `uuidv7()` keeps in creation order.
 */
export async function unpushedCreatedWithin(
  tx: Pick<Transaction, 'notification'>,
  window: { readonly from: Date; readonly before: Date },
  cursor: string | undefined,
  limit: number,
): Promise<readonly string[]> {
  const rows = await tx.notification.findMany({
    where: {
      pushedAt: null,
      createdAt: { gte: window.from, lt: window.before },
      ...(cursor === undefined ? {} : { id: { gt: cursor } }),
    },
    orderBy: { id: 'asc' },
    take: limit,
    select: { id: true },
  });
  return rows.map(({ id }) => id);
}
