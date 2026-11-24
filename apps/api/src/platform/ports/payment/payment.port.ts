// T117: the payment port (contracts/ports.md, ADR 0007). Direct gateway checkout, zero custody:
// the student pays the gateway, the gateway settles the teacher's share to the teacher (T104, ADR
// 0025 D1: a commission, amending ADR 0007 D1's 0%), and the platform keeps records only.
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
  /** The order's expiry as the gateway created it, never after `latestExpiry` (T012, FR-355). */
  readonly expiresAt: Date;
}

/**
 * Whom the order's teacher share settles to, where the gateway splits at checkout (T056, OPEN-11):
 * the teacher's recipient reference as `registerPayoutRecipient` answered it, and the share the
 * split sends (T104, ADR 0025 D1): the gross at the rate kept on the order, rounded up, computed
 * by `packages/money`'s `teacherShare` before it reaches the port, never here.
 */
export interface CheckoutPayee {
  readonly recipientRef: string;
  readonly share_piasters: Piasters;
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
      /** As the gateway reported them; null when its event reports none (T056), never computed. */
      readonly gateway_fee_piasters: Piasters | null;
      readonly net_piasters: Piasters | null;
      readonly currency: string;
    }
  | {
      readonly type: 'failed';
      readonly providerEventId: string;
      readonly gatewayOrderId: string;
      /**
       * 006:T014 (SRS DEC-113, Q-10 (a) adjusted): whether the issuer may approve a retry, set only
       * from `inquireOrder`'s authenticated answer, never from a callback (whose decline codes no
       * gateway signs); absent on every signed callback.
       */
      readonly declineKind?: DeclineKind;
    }
  | {
      readonly type: 'expired';
      readonly providerEventId: string;
      readonly gatewayOrderId: string;
    }
  | {
      /**
       * 003:T102 (Q-2 (a)'s safety net, DEC-82): a refund the gateway flagged on the original
       * payment, which reports no signed refunded amount, so it carries none.
       */
      readonly type: 'refund_reported';
      readonly providerEventId: string;
      readonly gatewayOrderId: string;
    }
  | {
      readonly type: 'refunded';
      readonly providerEventId: string;
      readonly gatewayOrderId: string;
      /**
       * 003:T102 (DEC-82, ADR 0025 D3): the refund's signed amount as the gateway reported it, a
       * part of the order or all of it; `whole_order` for a void, which ends the whole order.
       */
      readonly refunded_piasters: Piasters | 'whole_order';
    }
  | {
      /**
       * 006:T013 (R-510, FR-713, FR-719): the gateway saved the card a programme's order was paid
       * with, read from the signed fields alone. `token` is card detail: it reaches only
       * `programme_cards.token_encrypted`, encrypted on the webhook's transaction, and never a log, an
       * audit entry, a job payload or a response (SC-707); `last4` and `brand` may be shown to the
       * student. Nothing else of the card (the holder's name, the expiry) is carried.
       */
      readonly type: 'card_saved';
      readonly providerEventId: string;
      readonly gatewayOrderId: string;
      readonly token: string;
      readonly last4: string;
      readonly brand: string;
    }
  | {
      readonly type: 'recipient_verified';
      readonly providerEventId: string;
      readonly recipientRef: string;
    }
  | {
      readonly type: 'recipient_rejected';
      readonly providerEventId: string;
      readonly recipientRef: string;
      /** The gateway's reason, as it sent it, where it sent one (B15 check, decision 2). */
      readonly reason?: string;
    };

// The refusals of an inbound event, shared with the video port since T118.
export { EventSignatureError, MalformedEventError, NonFinalEventError } from '../inbound-event.js';

/**
 * 006:T014 (R-509, SRS DEC-113): why a failed automatic charge may or may not be retried. `soft`:
 * the issuer cannot approve now (Visa's Category 2); `hard`: anything else, unknown or uncoded.
 */
export type DeclineKind = 'soft' | 'hard';

/**
 * 006:T014: how far an automatic charge's two gateway steps went (SRS DEC-113 (2)). The payment is
 * never sent twice, and never when the gateway's order id could not be recorded first.
 * - `order_unanswered`: the first step (the gateway's order) had no readable answer; nothing was
 *   charged (a soft decline at once, with no inquiry).
 * - `order_not_recorded`: the order was created, but `recordOrder` answered false (the platform's
 *   order moved meanwhile); the payment was not sent.
 * - `payment_sent`: the order's id was recorded and the payment sent once; its result arrives by
 *   the signed callback or the inquiry, whatever the payment request answered.
 */
export type SavedCardCharge =
  | { readonly step: 'order_unanswered' }
  | { readonly step: 'order_not_recorded'; readonly gatewayOrderId: string }
  | { readonly step: 'payment_sent'; readonly gatewayOrderId: string };

/** 006:T014: why `chargeSavedCard` refused before sending anything. */
export type ChargeRefusal = 'no_payee' | 'charge_off';

/**
 * 006:T014: a charge refused before any request left: in live mode a charge naming no payee (as
 * `createCheckout` refuses, R-MONEY-6), or a gateway with no saved-card charge configured. Carries
 * the reason alone.
 */
export class ChargeRefusedError extends Error {
  constructor(readonly reason: ChargeRefusal) {
    super(`The automatic charge was refused before the gateway: ${reason}.`);
    this.name = 'ChargeRefusedError';
  }
}

/**
 * 006:T014 (SRS DEC-110, DEC-113): what the gateway answered, authenticated, about an order.
 * - `transaction`: the order's last transaction, final, as a `paid` or `failed` event under the
 *   provider event id its signed callback carries (so either one recorded first makes the other a
 *   replay); `rawBody` is the answer as received, hashed and never kept (R-SEC-2).
 * - `none`: the gateway says the order has no transaction.
 * - `no_answer`: no answer, an unreadable one, a transaction not final, or an inquiry not
 *   configured: nothing may be decided on it.
 */
export type OrderInquiry =
  | {
      readonly answer: 'transaction';
      readonly event: Extract<GatewayEvent, { readonly type: 'paid' | 'failed' }>;
      readonly rawBody: Buffer;
    }
  | { readonly answer: 'none' }
  | { readonly answer: 'no_answer' };

export interface PaymentPort {
  /**
   * An order for `gross_piasters` that expires no later than `latestExpiry`, where the gateway lets it
   * be set (ADR 0010 D4); with `payee`, split to the teacher at checkout where the gateway does (T056).
   * 006:T013 (R-510, FR-713): `saveCard` true asks the gateway to save the card for the automatic
   * charge, where the gateway takes the ask; a saved card arrives as a signed `card_saved` event.
   */
  createCheckout(
    enrollmentId: string,
    gross_piasters: Piasters,
    currency: string,
    latestExpiry: Date,
    payee?: CheckoutPayee,
    saveCard?: boolean,
  ): Promise<Checkout>;
  /**
   * 006:T014 (R-509, FR-714; SRS DEC-113 (2)): an automatic charge of a saved card, in two steps.
   * The gateway's order is created for `gross_piasters`, expiring no later than `latestExpiry`, with
   * the payee's split; its id is handed to `recordOrder`, which records it on the platform's order
   * (`paymentId`) and answers whether it did; only then is the payment sent with `cardToken`, once,
   * never again. Rejects with `ChargeRefusedError` before any request when refused; never called
   * under a database lock. `cardToken` is card detail (SC-707): sent to the gateway alone.
   */
  chargeSavedCard(
    paymentId: string,
    gross_piasters: Piasters,
    currency: string,
    latestExpiry: Date,
    cardToken: string,
    payee: CheckoutPayee | undefined,
    recordOrder: (gatewayOrderId: string) => Promise<boolean>,
  ): Promise<SavedCardCharge>;
  /** 006:T014 (SRS DEC-110, DEC-113 (1)): asks the gateway about an order, by its order id. */
  inquireOrder(gatewayOrderId: string): Promise<OrderInquiry>;
  /** End an unpaid order before a new checkout (FR-BOOK-12, ADR 0010 D6). Moves no money. */
  cancelCheckout(gatewayOrderId: string): Promise<CancelOutcome>;
  /**
   * The only way a payment or recipient status becomes known. Rejects with `EventSignatureError` on an
   * absent or invalid signature, and `MalformedEventError` on a signed body it cannot read. `query` is
   * the request's single-valued query parameters, where a gateway puts its signature there (T056).
   */
  verifyAndParseEvent(
    rawBody: Buffer,
    headers: Readonly<Record<string, string | undefined>>,
    query?: Readonly<Record<string, string | undefined>>,
  ): Promise<GatewayEvent>;
  /** Post-approval payout onboarding (FR-PAYG-13). Answers the gateway's recipient reference. */
  registerPayoutRecipient(teacherUserId: string, details: PayoutDetails): Promise<string>;
  /** Poll fallback for the payout gate (FR-PAYG-15). */
  getRecipientStatus(recipientRef: string): Promise<RecipientStatus>;
}
