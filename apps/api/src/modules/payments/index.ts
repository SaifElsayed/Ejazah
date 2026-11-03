// PUBLIC ENTRY of the payments module (ADR 0007 D4). Other modules import this file and nothing below it (R-API-3).
// Owns payments and payment_events; hosts the raw-body webhook endpoint outside tRPC; runs confirm-enrollment
// and expire-pending-payments. Confirms an enrollment through booking's public entry; never writes enrollments itself.
//
// Phase 1 (T077): the webhook route alone, which records a signed payout-recipient event and hands
// its verdict to the identity module's entries (payments imports identity, never the reverse; R-121).
import type { EncryptedColumn } from '../../platform/crypto/encryption.js';
import type { Database } from '../../platform/db/prisma.repository.js';
import type { Logger } from '../../platform/logging/logger.js';
import type { PaymentPort } from '../../platform/ports/payment/payment.port.js';
import type { NodeHandler } from '../../platform/web/route.js';
import { markPayoutRejected, markPayoutVerified, payoutRefHash } from '../identity/index.js';
import { checkoutAddresses } from './payments.repository.js';
import { RecipientEventsService } from './recipient-events.service.js';
import { PAYMENT_WEBHOOK_PATH, paymentWebhookRoute } from './webhook.controller.js';

export { PAYMENT_WEBHOOK_PATH };

/** `POST /webhooks/payment` (T077), over the payment port and the identity module's two entries. */
export function createPaymentWebhookRoute({
  database,
  payment,
  log,
  maxBodyBytes,
}: {
  readonly database: Database;
  readonly payment: Pick<PaymentPort, 'verifyAndParseEvent'>;
  readonly log: Logger;
  /** `MAX_REQUEST_BODY_BYTES`. */
  readonly maxBodyBytes: number;
}): NodeHandler {
  return paymentWebhookRoute({
    verify: (rawBody, headers) => payment.verifyAndParseEvent(rawBody, headers),
    events: new RecipientEventsService({
      database,
      identity: { markPayoutVerified, markPayoutRejected, payoutRefHash },
      log,
    }),
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
