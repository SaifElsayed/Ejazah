// PUBLIC ENTRY of the payments module (ADR 0007 D4). Other modules import this file and nothing below it (R-API-3).
// Owns payments and payment_events; hosts the raw-body webhook endpoint outside tRPC; runs confirm-enrollment
// and expire-pending-payments. Confirms an enrollment through booking's public entry; never writes enrollments itself.
//
// Phase 1 (T077): the webhook route alone, which records a signed payout-recipient event and hands
// its verdict to the identity module's entries (payments imports identity, never the reverse; R-121).
// Phase 2 (T038): the route's order branch, which records an order event, moves the order, appends a
// failed order's outcome through booking's entry, and enqueues `confirm-enrollment` on a paid one.
// Phase 2 (T036): the student's `checkout` procedures, the gateway's orders created outside any
// transaction and recorded through booking's holds and enrollments (R-208).
import type {
  CheckoutHandover,
  CheckoutHoldInput,
  CheckoutHoldOutput,
  CheckoutContinueInput,
  CheckoutCurrentOutput,
  CheckoutPayInput,
  CheckoutPayOutput,
  CheckoutRetryInput,
  CheckoutStatusInput,
  CheckoutStatusOutput,
} from '@ijazah/contracts';

import type { ColumnCipher, EncryptedColumn } from '../../platform/crypto/encryption.js';
import type { Database, Transaction } from '../../platform/db/prisma.repository.js';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type { Logger } from '../../platform/logging/logger.js';
import type { PaymentPort } from '../../platform/ports/payment/payment.port.js';
import type { NodeHandler } from '../../platform/web/route.js';
import { recordOrderFailed } from '../booking/index.js';
import {
  lockPayoutHolder,
  markPayoutRejected,
  markPayoutVerified,
  payoutRefHash,
} from '../identity/index.js';
import type { PaymentGateway } from './checkout.repository.js';
import { type CheckoutStudent, CheckoutService, checkoutStepsOver } from './checkout.service.js';
import { type ConfirmationQueue, OrderEventsService } from './order-events.service.js';
import { checkoutAddresses } from './payments.repository.js';
import { PaymentsMonitorService } from './payments-monitor.service.js';
import { RecipientEventsService } from './recipient-events.service.js';
import { PAYMENT_WEBHOOK_PATH, paymentWebhookRoute } from './webhook.controller.js';

export { PAYMENT_WEBHOOK_PATH };
export type { ConfirmationQueue };

/**
 * `POST /webhooks/payment` (T077, T038), over the payment port, the identity module's two entries,
 * booking's `recordOrderFailed`, and the queue `confirm-enrollment` is enqueued on.
 */
export function createPaymentWebhookRoute({
  database,
  payment,
  log,
  maxBodyBytes,
  confirmations,
  report,
}: {
  readonly database: Database;
  readonly payment: Pick<PaymentPort, 'verifyAndParseEvent'>;
  readonly log: Logger;
  /** `MAX_REQUEST_BODY_BYTES`. */
  readonly maxBodyBytes: number;
  /** Enqueues `confirm-enrollment({ paymentId })` under the job id `paymentId` (R-214). */
  readonly confirmations: ConfirmationQueue;
  /** The process's error reporting by default (T111); a recorder in the specs. */
  readonly report?: (error: Error) => void;
}): NodeHandler {
  const reporting = report === undefined ? {} : { report };
  return paymentWebhookRoute({
    verify: (rawBody, headers) => payment.verifyAndParseEvent(rawBody, headers),
    events: {
      recipients: new RecipientEventsService({
        database,
        identity: { markPayoutVerified, markPayoutRejected, lockPayoutHolder, payoutRefHash },
        log,
        ...reporting,
      }),
      orders: new OrderEventsService({
        database,
        booking: { recordOrderFailed },
        confirmations,
        log,
        ...reporting,
      }),
    },
    log,
    maxBodyBytes,
  });
}

/** The payments module's `_encrypted` column, for the `reencrypt-columns` job (T004, 002:T134, R-API-6). */
export function createEncryptedColumns(
  database: Pick<Database, 'payment'>,
): readonly EncryptedColumn[] {
  return [checkoutAddresses(database)];
}

/**
 * Each enrollment's order standing, payments' answer to booking's release of a hold (T033, FR-363):
 * the `orders` a caller of booking's hold functions hands in, on the caller's transaction, after the
 * enrollments' locks (T005).
 */
export { orderStandingsOf } from './order-standing.repository.js';

/**
 * What the `confirm-enrollment` job reads of its paid order (T039, R-215): the order's enrollment,
 * with no lock, and, under the locks the job takes through booking's `lockForConfirmation` (whose
 * `orders` is `orderStandingsOf` above), the order's status and when its paid event was recorded.
 */
export { orderEnrollmentOf, type PaidOrder, paidOrderOf } from './confirmation-order.repository.js';

/**
 * What `expire-pending-payments` reads and writes of the orders (T040, FR-364; PR #109's review, M2
 * and round 2 N1), on the caller's transaction: a page of the `created` orders past their expiry,
 * their move to `expired` under the orders' locks, and a page of the `paid` orders whose paid event
 * was recorded before an instant, each with its enrollment, for the hand-off to `confirm-enrollment`
 * through the `ConfirmationQueue` above.
 */
export {
  expiredOrderIds,
  markOrdersExpired,
  type PaidOrderRef,
  paidOrdersRecordedBefore,
} from './order-expiry.repository.js';

/**
 * The `checkout` procedures' services (T036, R-208), bound once by `main.ts` and carried by the
 * request context; `checkoutRouter` is mounted under `checkout` by `app.router.ts`.
 */
export interface CheckoutServices {
  hold(student: CheckoutStudent, input: CheckoutHoldInput): Promise<CheckoutHoldOutput>;
  pay(student: CheckoutStudent, input: CheckoutPayInput): Promise<CheckoutPayOutput>;
  retry(student: CheckoutStudent, input: CheckoutRetryInput): Promise<CheckoutHandover>;
  current(student: CheckoutStudent): Promise<CheckoutCurrentOutput>;
  continue(student: CheckoutStudent, input: CheckoutContinueInput): Promise<CheckoutHandover>;
  status(student: CheckoutStudent, input: CheckoutStatusInput): Promise<CheckoutStatusOutput>;
}

export { checkoutRouter } from './checkout.router.js';
export type { CheckoutStudent };

/**
 * The checkout over the process's client, the kernel's idempotency, the payment port and the column
 * cipher (T036): the gateway's orders recorded with their address encrypted (R-DB-8).
 */
export function createCheckoutServices({
  database,
  settings,
  idempotency,
  payment,
  cipher,
  gateway,
  now,
}: {
  readonly database: Database;
  readonly settings: SettingsReader;
  readonly idempotency: Pick<IdempotencyService<Transaction>, 'run' | 'completed'>;
  readonly payment: Pick<PaymentPort, 'createCheckout' | 'cancelCheckout'>;
  readonly cipher: Pick<ColumnCipher, 'encrypt' | 'decrypt'>;
  readonly gateway: PaymentGateway;
  readonly now?: () => Date;
}): CheckoutServices {
  const service = new CheckoutService({
    settings,
    idempotency,
    payment,
    cipher,
    gateway,
    steps: checkoutStepsOver(database, now),
    ...(now === undefined ? {} : { now }),
  });
  return {
    hold: (student, input) => service.hold(student, input),
    pay: (student, input) => service.pay(student, input),
    retry: (student, input) => service.retry(student, input),
    current: (student) => service.current(student),
    continue: (student, input) => service.continue(student, input),
    status: (student, input) => service.status(student, input),
  };
}

/**
 * The admin's payments monitor (T052, FR-400 to FR-402, R-220): `paymentsAdminRouter` is mounted
 * under `payments` by `admin.router.ts`, and its two reads are composed into the admin module's
 * services, which `main.ts` binds to the administrator surface. Nothing in it writes (FR-401).
 */
export { paymentsAdminRouter } from './payments-admin.router.js';
export { type PaymentsMonitorStore, paymentsMonitorStore } from './payments-monitor.service.js';

/** The monitor over the module's queries and the owners' entries, its page size from settings. */
export function createPaymentsMonitorService(dependencies: {
  readonly settings: SettingsReader;
  readonly now?: () => Date;
}): Pick<PaymentsMonitorService, 'list' | 'get'> {
  return new PaymentsMonitorService(dependencies);
}
