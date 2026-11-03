// PUBLIC ENTRY of the payments module (ADR 0007 D4). Other modules import this file and nothing below it (R-API-3).
// Owns payments and payment_events; hosts the raw-body webhook endpoint outside tRPC; runs confirm-enrollment
// and expire-pending-payments. Confirms an enrollment through booking's public entry; never writes enrollments itself.
//
// Phase 1 (T077): the webhook route alone, which records a signed payout-recipient event and hands
// its verdict to the identity module's entries (payments imports identity, never the reverse; R-121).
// Phase 2 (T038): the route's order branch, which records an order event, moves the order, appends a
// failed order's outcome through booking's entry, and enqueues `confirm-enrollment` on a paid one.
import type { EncryptedColumn } from '../../platform/crypto/encryption.js';
import type { Database } from '../../platform/db/prisma.repository.js';
import type { Logger } from '../../platform/logging/logger.js';
import type { PaymentPort } from '../../platform/ports/payment/payment.port.js';
import type { NodeHandler } from '../../platform/web/route.js';
import { recordOrderFailed } from '../booking/index.js';
import { markPayoutRejected, markPayoutVerified, payoutRefHash } from '../identity/index.js';
import { type ConfirmationQueue, OrderEventsService } from './order-events.service.js';
import { checkoutAddresses } from './payments.repository.js';
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
        identity: { markPayoutVerified, markPayoutRejected, payoutRefHash },
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
