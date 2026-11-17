// T005 of specs/005-certification (FR-619, FR-620; R-406): the one writer of `notifications`.
//
// A producer records a notification on its own transaction: `record(tx, { userId, type, payload })`
// writes the row with the kind's keys (`notifications.push.<kind>.title` and `.body`, rendered in the
// recipient's language at send time, FR-NOTIF-3), and `deliver-notification { notificationId }` is
// enqueued once that transaction has committed, never inside it (R-API-15): a provider outage, or a
// queue that is down, fails no producer's work, and a rollback queues nothing.
//
// THE SEVEN KINDS (DEC-70 as amended by DEC-71). `type` takes the v1.0 kinds and nothing else, by
// type: every other member of `notification_type` waits for v1.1's notification centre.
//
// THE PAYLOAD (R-HONEST-5). Identifiers for deep-linking only, each a UUID: the type has no field for
// anything else, and a value that is not a UUID is refused before the row is written, echoing nothing
// of it.
//
// AFTER THE COMMIT (the review session's answer Q-E1-2, 2026-11-17). The writer is handed only the
// transaction, and the kernel's after-commit work is reached through it (`publisherOn(tx)`,
// `platform/live/live-publisher.ts`): a transaction its caller bound no list to is refused, as the
// administrator's deletion refuses one (`identity/deletion.service.ts`'s `deleteByAdministrator`),
// so no producer can lose a push silently. An enqueue that fails after the commit is logged with the
// id and reported, and not retried here: the row stays with `pushed_at` null (T005's follow-up).
import { z } from 'zod';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { reportError } from '../../platform/errors/reporting.js';
import { publisherOn } from '../../platform/live/live-publisher.js';
import type { NotificationsRepository } from './notifications.repository.js';

/** The kinds v1.0 records and pushes (FR-619; R-406), all members of `notification_type`. */
export const NOTIFICATION_KINDS = [
  'session_reminder',
  'cancellation_requested',
  'cancellation_request_accepted',
  'cancellation_request_declined',
  'payment_confirmed',
  'payment_failed',
  'payment_expired',
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** The deep-link identifiers a notification carries (ERD §11 `payload`), and nothing else. */
export interface NotificationPayload {
  readonly enrollmentId?: string;
  readonly sessionId?: string;
}

export interface NotificationRecord {
  readonly userId: string;
  readonly type: NotificationKind;
  readonly payload: NotificationPayload;
}

/** Where `deliver-notification` is enqueued, bound by `main.ts` (job id = the notification's id). */
export interface NotificationQueue {
  enqueue(notificationId: string): Promise<void>;
}

/** Where a refusal and a lost enqueue are told: ids and a reason, never a value (R-SEC-2). */
export interface NotificationLog {
  info(fields: Readonly<Record<string, unknown>>, message: string): void;
  warn(fields: Readonly<Record<string, unknown>>, message: string): void;
}

export interface NotificationWriterDependencies {
  readonly repository: Pick<NotificationsRepository, 'insert'>;
  readonly queue: NotificationQueue;
  readonly log: NotificationLog;
  /** Error tracking; `reportError` unless a spec sets one. */
  readonly report?: (error: unknown) => void;
}

/** The i18n key of a kind's push title. */
export function titleKeyOf(kind: NotificationKind): string {
  return `notifications.push.${kind}.title`;
}

/** The i18n key of a kind's push body. */
export function bodyKeyOf(kind: NotificationKind): string {
  return `notifications.push.${kind}.body`;
}

const payloadSchema = z.strictObject({
  enrollmentId: z.uuid().optional(),
  sessionId: z.uuid().optional(),
});

export class NotificationWriter {
  readonly #repository: Pick<NotificationsRepository, 'insert'>;
  readonly #queue: NotificationQueue;
  readonly #log: NotificationLog;
  readonly #report: (error: unknown) => void;

  constructor({ repository, queue, log, report = reportError }: NotificationWriterDependencies) {
    this.#repository = repository;
    this.#queue = queue;
    this.#log = log;
    this.#report = report;
  }

  /** Writes the row on `tx`; its delivery is enqueued once `tx` has committed. */
  async record(
    tx: Transaction,
    { userId, type, payload }: NotificationRecord,
  ): Promise<{ readonly notificationId: string }> {
    const list = publisherOn(tx);
    if (list?.afterCommitDo === undefined) {
      this.#log.info(
        { userId, type, reason: 'no_after_commit_list' },
        'A notification was refused',
      );
      throw new Error(
        'A notification is recorded on a transaction its caller bound an after-commit list to (T005), so its push is enqueued only once the row has committed.',
      );
    }
    if (!payloadSchema.safeParse(payload).success) {
      this.#log.info({ userId, type, reason: 'payload_not_ids' }, 'A notification was refused');
      throw new TypeError(
        'A notification carries identifiers for deep-linking only: optionally enrollmentId and sessionId, each a UUID (R-HONEST-5).',
      );
    }
    const notificationId = await this.#repository.insert(tx, {
      userId,
      type,
      titleKey: titleKeyOf(type),
      bodyKey: bodyKeyOf(type),
      payload,
    });
    list.afterCommitDo(() => {
      void this.#enqueue(notificationId);
    });
    return { notificationId };
  }

  async #enqueue(notificationId: string): Promise<void> {
    try {
      await this.#queue.enqueue(notificationId);
    } catch (error: unknown) {
      this.#log.warn(
        {
          notificationId,
          reason: 'enqueue_failed',
          errorName: error instanceof Error ? error.name : 'unknown',
        },
        'A notification push could not be queued; it is not retried',
      );
      this.#report(error);
    }
  }
}
