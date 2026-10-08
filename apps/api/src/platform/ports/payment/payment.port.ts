// T117: the payment port (contracts/ports.md, ADR 0007). Direct gateway checkout, 0% commission,
// zero custody: the student pays the gateway, the gateway settles the net to the teacher, and the
// platform keeps records only.
//
// Held by absence: no operation reads a balance, moves funds between parties or issues a refund
// (FR-PAYG-1, FR-PAYG-10). `cancelCheckout` is not a refund; it ends an order nobody has paid, so
// no money moves (ADR 0010 D6). The event operation takes the raw body, so a parsed object cannot
// skip the signature (R-MONEY-9); every event carries the provider's own id, which the caller
// stores under a unique NOT NULL column before acting (R-MONEY-8). The recipient operations answer
// a reference, never account data, so only an encrypted reference can reach the database (R-DB-8).
//
// A recipient event carries the gateway's recipient reference as the gateway sent it. Which teacher
// it concerns is a database question, decided before the first consumer of recipient events (note
// under T117).
import type { Piasters } from '@ijazah/money';

/** The order a checkout created, and where the student pays it (the gateway's hosted page). */
export interface Checkout {
  readonly gatewayOrderId: string;
  readonly checkoutUrl: string;
}

/**
 * What `cancelCheckout` found. `cancelled` also when the order was already cancelled or expired;
 * `paid` and `in_progress` refuse a new checkout and write nothing (ADR 0010 D6).
 */
export type CancelOutcome = 'cancelled' | 'paid' | 'in_progress' | 'unsupported';

export type RecipientStatus = 'pending' | 'verified' | 'rejected';

/**
 * What a teacher enters in payout setup, handed to the gateway and never stored (FR-PAYG-13). The
 * fields the selected gateway needs are settled with it (OPEN-11).
 */
export interface PayoutDetails {
  readonly holderName: string;
  readonly method: 'bank_account' | 'mobile_wallet';
  readonly accountNumber: string;
}

/** A verified inbound event. `type` is the `payment_events.event_type` it is stored under. */
export type GatewayEvent =
  | {
      readonly type: 'paid';
      readonly providerEventId: string;
      readonly gatewayOrderId: string;
      readonly gatewayTransactionId: string;
      readonly gross_piasters: Piasters;
      readonly gateway_fee_piasters: Piasters;
      readonly net_piasters: Piasters;
      readonly currency: string;
    }
  | {
      readonly type: 'failed' | 'expired' | 'refunded';
      readonly providerEventId: string;
      readonly gatewayOrderId: string;
    }
  | {
      readonly type: 'recipient_verified' | 'recipient_rejected';
      readonly providerEventId: string;
      readonly recipientRef: string;
    };

// The refusals of an inbound event, shared with the video port since T118.
export { EventSignatureError, MalformedEventError } from '../inbound-event.js';

export interface PaymentPort {
  /** An order for `gross_piasters` that expires no later than `latestExpiry`, where the gateway lets it be set (ADR 0010 D4). */
  createCheckout(
    enrollmentId: string,
    gross_piasters: Piasters,
    currency: string,
    latestExpiry: Date,
  ): Promise<Checkout>;
  /** End an unpaid order before a new checkout (FR-BOOK-12, ADR 0010 D6). Moves no money. */
  cancelCheckout(gatewayOrderId: string): Promise<CancelOutcome>;
  /** The only way a payment or recipient status becomes known. Throws `EventSignatureError`. */
  verifyAndParseEvent(
    rawBody: Buffer,
    headers: Readonly<Record<string, string | undefined>>,
  ): Promise<GatewayEvent>;
  /** Post-approval payout onboarding (FR-PAYG-13). Answers the gateway's recipient reference. */
  registerPayoutRecipient(teacherUserId: string, details: PayoutDetails): Promise<string>;
  /** Poll fallback for the payout gate (FR-PAYG-15). */
  getRecipientStatus(recipientRef: string): Promise<RecipientStatus>;
}
