// T040 (R-215, FR-363, FR-364, FR-PAYG-6, FR-PAYG-19, ADR 0010 D7; ARCHITECTURE §8.1; PR #109's
// review, M2 and round 2 N1): the `expire-pending-payments` sweep, payments'. Every minute, on a cron
// pattern in code as every sweep's (the note under T040). One run, at one instant:
//
//   1. THE ORDERS. Every `created` order past the expiry it was created with is marked `expired`,
//      through payments' entry, which locks the orders and moves them by a conditional update.
//   2. THE HOLDS. Every active hold past its expiry that carries an enrollment is released through
//      booking's one release under `'expired'` (T033), which locks the holds, their enrollments and
//      their orders in T005's order and reads them again: the enrollment awaiting payment is cancelled
//      `payment_failed` when its last order failed and `payment_expired` otherwise, with one
//      `enrollment_events` row; one with a `paid` order is never cancelled, and stays awaiting
//      payment for `confirm-enrollment` (FR-363 as amended 2026-11-03).
//   3. THE HAND-OFF. Every `paid` order whose paid event was recorded at least
//      `checkout_confirmation_timeout_seconds` before the run, whose enrollment is `pending_payment`
//      or `cancelled`, and that no compensation case covers (`case-cover.ts`, the confirm job's
//      rule: a case opened after the order's first paid event), is handed to `confirm-enrollment`
//      (job id `paymentId`, through payments' `ConfirmationQueue`), so a paid event whose enqueue was lost
//      after its commit is confirmed all the same, and a paid enrollment a new checkout or another
//      student's hold cancelled meanwhile is confirmed by the late branch or gets one compensation
//      case, never left cancelled without one. The job decides under its own locks; the sweep only
//      reads, with no lock, and enqueues after the page's transaction. A failed enqueue fails the
//      run, and the queue runs it again.
//
// The holds' and the orders' windows are the expiries their rows carry, written from
// `slot_hold_ttl_minutes` and `slot_hold_grace_minutes` when they were made (FR-BOOK-9, FR-355);
// the hand-off's is the setting, read on every run (R-MONEY-12). Each step goes a page at a time, in
// id order after the last row read, each page in one transaction, the sweep holding no lock of its
// own; the instant is read once, so every step of a run agrees on what has expired.
//
// IDEMPOTENT (R-API-14): a second run finds no `created` order past its expiry and no active
// expired hold, and hands on the same orders under the same job ids, which the queue holds once.
import { checkoutPolling } from '@ijazah/contracts';
import { z } from 'zod';

import type { Database, Transaction } from '../platform/db/prisma.repository.js';
import type { SettingsReader } from '../platform/settings/settings-reader.js';
import {
  awaitingConfirmationAmong,
  expiredEnrollmentHoldIds,
  releaseHolds,
} from '../modules/booking/index.js';
import { latestCasesOpenedAt } from '../modules/moderation/index.js';
import {
  type ConfirmationQueue,
  expiredOrderIds,
  markOrdersExpired,
  orderStandingsOf,
  type PaidOrderRef,
  paidOrdersRecordedBefore,
} from '../modules/payments/index.js';
import { covers } from './case-cover.js';
import { EVERY_MINUTE, EXPIRY_PAGE_SIZE, inPages } from './expire-holds.js';
import { defineJob, type Job } from './job.js';
import { instantBefore } from './window.js';

/** The sweep's name. */
export const EXPIRE_PENDING_PAYMENTS = 'expire-pending-payments';

/** How long a paid event is given to confirm its enrollment before the sweep hands it on (ADR 0008). */
export const CONFIRMATION_TIMEOUT_SETTING = 'checkout_confirmation_timeout_seconds';

/** What the sweep asks of payments, booking and moderation, each on its transaction (R-API-6). */
export interface PendingPaymentSteps {
  expiredOrders(
    tx: Transaction,
    at: Date,
    after: string | undefined,
    limit: number,
  ): Promise<readonly string[]>;
  markExpired(tx: Transaction, paymentIds: readonly string[], at: Date): Promise<unknown>;
  expiredHolds(
    tx: Transaction,
    at: Date,
    after: string | undefined,
    limit: number,
  ): Promise<readonly string[]>;
  release(tx: Transaction, holdIds: readonly string[], at: Date): Promise<unknown>;
  paidOrders(
    tx: Transaction,
    recordedBefore: Date,
    after: string | undefined,
    limit: number,
  ): Promise<readonly PaidOrderRef[]>;
  awaitingConfirmation(
    tx: Transaction,
    enrollmentIds: readonly string[],
  ): Promise<readonly string[]>;
  latestCases(
    tx: Transaction,
    enrollmentIds: readonly string[],
  ): Promise<ReadonlyMap<string, Date>>;
}

/** The steps over the modules' entries. */
export const pendingPaymentSteps: PendingPaymentSteps = {
  expiredOrders: expiredOrderIds,
  markExpired: markOrdersExpired,
  expiredHolds: expiredEnrollmentHoldIds,
  release: (tx, holdIds, at) =>
    releaseHolds(tx, holdIds, 'expired', { at, orders: orderStandingsOf }),
  paidOrders: paidOrdersRecordedBefore,
  awaitingConfirmation: awaitingConfirmationAmong,
  latestCases: latestCasesOpenedAt,
};

export interface ExpirePendingPaymentsOptions {
  readonly database: Pick<Database, '$transaction'>;
  /** `checkout_confirmation_timeout_seconds`, read on every run. */
  readonly settings: SettingsReader;
  /** Where `confirm-enrollment` is added under the job id `paymentId` (`worker.ts` binds it). */
  readonly confirmations: ConfirmationQueue;
  readonly steps?: PendingPaymentSteps;
  /** The clock; the system clock unless a spec sets one. */
  readonly clock?: () => Date;
  readonly pageSize?: number;
}

export function expirePendingPayments({
  database,
  settings,
  confirmations,
  steps = pendingPaymentSteps,
  clock = () => new Date(),
  pageSize = EXPIRY_PAGE_SIZE,
}: ExpirePendingPaymentsOptions): Job {
  /** The page's paid orders whose enrollment awaits confirmation and that no case covers. */
  const due = async (tx: Transaction, orders: readonly PaidOrderRef[]): Promise<string[]> => {
    const awaiting = new Set(
      await steps.awaitingConfirmation(tx, [...new Set(orders.map((o) => o.enrollmentId))]),
    );
    if (awaiting.size === 0) return [];
    const latestCase = await steps.latestCases(tx, [...awaiting]);
    return orders
      .filter(
        ({ enrollmentId, paidRecordedAt }) =>
          awaiting.has(enrollmentId) &&
          !covers(latestCase.get(enrollmentId) ?? null, paidRecordedAt),
      )
      .map(({ paymentId }) => paymentId);
  };

  return defineJob({
    name: EXPIRE_PENDING_PAYMENTS,
    payload: z.object({}),
    schedule: EVERY_MINUTE,
    run: async () => {
      const timeoutSeconds = await settings.read(
        CONFIRMATION_TIMEOUT_SETTING,
        checkoutPolling.shape.confirmationTimeoutSeconds,
      );
      const at = clock();
      await inPages(pageSize, (after) =>
        database.$transaction(async (tx) => {
          const ids = await steps.expiredOrders(tx, at, after, pageSize);
          if (ids.length > 0) await steps.markExpired(tx, ids, at);
          return ids;
        }),
      );
      await inPages(pageSize, (after) =>
        database.$transaction(async (tx) => {
          const ids = await steps.expiredHolds(tx, at, after, pageSize);
          if (ids.length > 0) await steps.release(tx, ids, at);
          return ids;
        }),
      );
      const recordedBefore = instantBefore(at, timeoutSeconds);
      await inPages(pageSize, async (after) => {
        const [read, handed] = await database.$transaction(async (tx) => {
          const orders = await steps.paidOrders(tx, recordedBefore, after, pageSize);
          return [orders.map(({ paymentId }) => paymentId), await due(tx, orders)] as const;
        });
        await Promise.all(handed.map((paymentId) => confirmations.enqueue(paymentId)));
        return read;
      });
    },
  });
}
