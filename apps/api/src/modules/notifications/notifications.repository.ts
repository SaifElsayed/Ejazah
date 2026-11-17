// T005 of specs/005-certification (R-406): the `notifications` rows, as the writer and the delivery
// job reach them (R-API-6). Queries only; the writer and the job hold the rules.
//
// The payload is stored as ERD §11 names its keys (`enrollment_id`, `session_id`) and read back
// into the port's names; a stored payload or kind this phase does not write is refused when read,
// naming nothing of it, so the job never pushes what it cannot read.
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
