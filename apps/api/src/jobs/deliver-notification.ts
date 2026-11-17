// T005 of specs/005-certification (FR-620, FR-621; R-405, R-406; contracts/jobs.md): the
// `deliver-notification { notificationId }` job, enqueued by the notifications module's writer once
// the producer's transaction has committed. It is the one file that reaches the push port (R-API-15,
// `api/no-push-outside-job`).
//
// ONE DELIVERY. The row is read through the notifications module's entry, and the user's device
// tokens (decrypted by identity, never here) and `preferred_language` through the `PushRecipients`
// store, which identity implements and `worker.ts` hands in (the review session's answer Q-E1-1 (b),
// 2026-11-17; the store pattern of `jobs/README.md`). The kind's fixed title and body in that
// language come from the renderer `worker.ts` binds to the generated copy (Q5 (a)); the payload is
// the notification's identifiers and nothing else (R-HONEST-5). Each device is sent to concurrently,
// then `pushed_at` is set.
//
// IDEMPOTENT (R-API-14). A row whose `pushed_at` is set is skipped, so a redelivery sends nothing
// more; `pushed_at` is set once (`markPushed` writes only where it is NULL).
//
// RETRIES come from the queue's attempts (`queue.ts`, T171): a delivery that reaches no device
// throws, so the queue tries again. A delivery that reaches some devices and fails on others sets
// `pushed_at` and logs the count: a retry would push again to the devices already reached, and
// FR-620 says at most once per device, which `notifications` cannot record per device.
//
// STALE TOKENS ⚠️ automatic and final. After the push, the provider is asked which of the user's
// devices it no longer accepts, and those tokens are deleted through identity (R-405); the device
// registers again when the application next starts. A question that fails is logged and left: the
// row is already pushed, and `purge-stale-push-tokens` prunes a token that stops being seen.
//
// LOGS. Each skip, retry, partial delivery and removal logs ids, counts and a reason; a token, a
// title or a body never reaches a log (R-SEC-2).
import { z } from 'zod';

import { NOTIFICATION_KINDS } from '../modules/notifications/index.js';
import type { NotificationDelivery, NotificationKind } from '../modules/notifications/index.js';
import type {
  PushMessage,
  PushPayload,
  PushPort,
  PushTarget,
} from '../platform/ports/push/push.port.js';
import { defineJob, type Job } from './job.js';

/** The job's name, the one `main.ts` enqueues it by. */
export const DELIVER_NOTIFICATION = 'deliver-notification';

/** A user's `preferred_language`. */
export type PushLanguage = 'ar' | 'en';

/** What the job reads and marks, from the notifications module's entry (`createNotificationDeliveries`). */
export interface NotificationDeliveryStore {
  find(notificationId: string): Promise<NotificationDelivery | null>;
  /** Sets `pushed_at` where it is NULL. */
  markPushed(notificationId: string, at: Date): Promise<void>;
}

/** A user's devices and language. */
export interface PushRecipient {
  readonly language: PushLanguage;
  /** Each token decrypted from `device_push_tokens.token_encrypted`, with its platform. */
  readonly targets: readonly PushTarget[];
}

/** What the job asks of identity, implemented by identity and handed in by `worker.ts`. */
export interface PushRecipients {
  /** The user's decrypted tokens, platforms and `preferred_language`; null for a deleted user. */
  targetsOf(userId: string): Promise<PushRecipient | null>;
  /** Deletes these tokens of the user, matched by `token_hash`. */
  removeStale(userId: string, tokens: readonly string[]): Promise<void>;
}

/** A kind's fixed title and body in a language, with no placeholder (Q5 (a)). */
export type PushRenderer = (kind: NotificationKind, language: PushLanguage) => PushMessage;

/** Where the job tells what it skipped, retried and removed: ids, counts and a reason. */
export interface DeliveryLog {
  info(fields: Readonly<Record<string, unknown>>, message: string): void;
  warn(fields: Readonly<Record<string, unknown>>, message: string): void;
}

export interface DeliverNotificationOptions {
  readonly notifications: NotificationDeliveryStore;
  readonly recipients: PushRecipients;
  readonly push: PushPort;
  readonly render: PushRenderer;
  readonly log: DeliveryLog;
  readonly clock?: () => Date;
}

/** No device of the user took the push; the queue retries the delivery. */
export class PushNotDelivered extends Error {
  constructor(notificationId: string, devices: number) {
    super(`Notification ${notificationId} reached none of ${String(devices)} devices.`);
    this.name = 'PushNotDelivered';
  }
}

const LANGUAGES: readonly PushLanguage[] = ['ar', 'en'];
const ICU_ARGUMENT = /[{}]/;

/**
 * The renderer over the generated copy (`platform/web/i18n/{ar,en}.ts`), as `worker.ts` binds it:
 * `notifications.push.<kind>.title` and `.body` in the language. Every kind's two texts in both
 * languages are checked when it is built, so a missing key or one holding an ICU argument (`{name}`)
 * stops the worker at its start instead of failing a delivery (Q5 (a): no placeholder in a push).
 * The refusal names the key, never the text.
 */
export function pushCopyRenderer(copy: Readonly<Record<PushLanguage, unknown>>): PushRenderer {
  const texts = new Map<string, PushMessage>();
  for (const language of LANGUAGES) {
    for (const kind of NOTIFICATION_KINDS) {
      texts.set(`${language}:${kind}`, {
        title: fixedText(copy[language], language, kind, 'title'),
        body: fixedText(copy[language], language, kind, 'body'),
      });
    }
  }
  return (kind, language) => {
    const message = texts.get(`${language}:${kind}`);
    if (message === undefined) throw new Error(`No push text for ${kind} in ${language}.`);
    return message;
  };
}

function fixedText(
  catalogue: unknown,
  language: PushLanguage,
  kind: NotificationKind,
  part: 'title' | 'body',
): string {
  const key = `notifications.push.${kind}.${part}`;
  let value: unknown = catalogue;
  for (const segment of key.split('.')) {
    value =
      typeof value === 'object' && value !== null
        ? (value as Record<string, unknown>)[segment]
        : undefined;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`The generated copy has no ${language} text at ${key}.`);
  }
  if (ICU_ARGUMENT.test(value)) {
    throw new Error(`The ${language} text at ${key} holds an argument; a push's text is fixed.`);
  }
  return value;
}

function payloadOf(notification: NotificationDelivery): PushPayload {
  const { enrollmentId, sessionId } = notification.payload;
  return {
    notificationId: notification.id,
    ...(enrollmentId === undefined ? {} : { enrollmentId }),
    ...(sessionId === undefined ? {} : { sessionId }),
  };
}

export function deliverNotification({
  notifications,
  recipients,
  push,
  render,
  log,
  clock = () => new Date(),
}: DeliverNotificationOptions): Job {
  const skip = (fields: Readonly<Record<string, unknown>>): void => {
    log.info(fields, 'A notification push was skipped');
  };

  async function pruneStale(
    notificationId: string,
    userId: string,
    targets: readonly PushTarget[],
  ) {
    try {
      const stale = await push.findStaleTargets(targets);
      if (stale.length === 0) return;
      await recipients.removeStale(
        userId,
        stale.map((target) => target.token),
      );
      log.info(
        { notificationId, userId, removed: stale.length, reason: 'provider_no_longer_accepts' },
        'Stale push tokens were removed',
      );
    } catch (error: unknown) {
      log.warn(
        {
          notificationId,
          userId,
          reason: 'stale_check_failed',
          errorName: error instanceof Error ? error.name : 'unknown',
        },
        'Stale push tokens could not be checked; left for the purge sweep',
      );
    }
  }

  return defineJob({
    name: DELIVER_NOTIFICATION,
    payload: z.object({ notificationId: z.uuid() }),
    run: async ({ notificationId }) => {
      const notification = await notifications.find(notificationId);
      if (notification === null) return skip({ notificationId, reason: 'not_found' });
      if (notification.pushedAt !== null) return skip({ notificationId, reason: 'already_pushed' });
      const { userId } = notification;
      const recipient = await recipients.targetsOf(userId);
      if (recipient === null) return skip({ notificationId, userId, reason: 'recipient_deleted' });
      if (recipient.targets.length === 0) {
        return skip({ notificationId, userId, reason: 'no_device' });
      }

      const message = render(notification.kind, recipient.language);
      const payload = payloadOf(notification);
      const results = await Promise.allSettled(
        recipient.targets.map((target) => push.deliver(target, payload, message)),
      );
      const failed = results.filter((result) => result.status === 'rejected');
      if (failed.length === results.length) {
        const [first] = failed;
        log.warn(
          {
            notificationId,
            userId,
            devices: results.length,
            reason: 'not_delivered',
            errorName: first?.reason instanceof Error ? first.reason.name : 'unknown',
          },
          'A notification push failed; the queue retries it',
        );
        throw new PushNotDelivered(notificationId, results.length);
      }
      if (failed.length > 0) {
        log.warn(
          {
            notificationId,
            userId,
            delivered: results.length - failed.length,
            failed: failed.length,
            reason: 'partly_delivered',
          },
          'A notification push reached some devices only; it is not retried',
        );
      }

      await notifications.markPushed(notificationId, clock());
      await pruneStale(notificationId, userId, recipient.targets);
    },
  });
}
