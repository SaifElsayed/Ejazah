// T038 (R-214, FR-360, FR-365, FR-367; contracts/gateway.md "The webhook's order branch";
// ARCHITECTURE §8.1 steps 2 to 4): what the payment webhook does with an order event the port
// verified on its raw body (R-MONEY-9).
//
// ONE TRANSACTION, in T005's lock order: the order's enrollment, then the order (the note under
// T038), each FOR UPDATE; then the event is recorded in `payment_events` under its unique
// `provider_event_id` (R-MONEY-8), with the hash of the body and never the body (R-SEC-2); then the
// order's status, read again under the lock (T005's rule 1), moves if the event may move it:
//
//   created            → paid, failed or expired
//   failed or expired  → paid (the gateway's signed paid event is its word that the student paid)
//   paid               → refunded, and nothing else (a late failure or expiry undoes no payment)
//
// Any other event is recorded and changes nothing (data-model §3, FR-373). A move to `paid` records
// the transaction id, the fee and the net as the event reported them (FR-367, R-MONEY-5); every move
// clears the hosted page's address, kept only while the order is `created` (data-model §2.4); a move
// to `failed` appends the `order_failed` outcome through booking's entry (R-216, R-API-6), the hold
// left in place for a Retry (FR-365).
//
// A REPLAY (the provider event id already recorded) writes nothing. AFTER COMMIT, every paid event of
// a known order, a replay included, enqueues `confirm-enrollment({ paymentId })` under the job id
// `paymentId`, so an enqueue lost after a commit is recovered by the gateway's retry (PR #109's
// review, M2): a failed enqueue fails the request, and the gateway retries. The job decides what
// the payment means; this branch confirms nothing (R-HONEST-1).
//
// AN UNKNOWN ORDER (no `payments` row holds the gateway's order id) cannot be recorded, since an
// order event names its payment (ERD §15 rule 20): it is answered, written nowhere, and reported.
// The log line and the report name the provider event id and the type, never the order id or the
// body (R-SEC-2).
import { createHash } from 'node:crypto';

import type { Database, Transaction } from '../../platform/db/prisma.repository.js';
import { reportError } from '../../platform/errors/reporting.js';
import type { Logger } from '../../platform/logging/logger.js';
import type { GatewayEvent } from '../../platform/ports/payment/payment.port.js';
import {
  lockOrder,
  type OrderEventType,
  type OrderRef,
  type OrderStatus,
  orderNamed,
  PaymentsRepository,
  type ReportedPayment,
} from './payments.repository.js';
import type { Receipt } from './recipient-events.service.js';

/** A verified event of a gateway order. */
export type OrderEvent = Extract<GatewayEvent, { readonly type: OrderEventType }>;

/** Whether a verified event concerns a gateway order rather than a payout recipient. */
export function isOrderEvent(event: GatewayEvent): event is OrderEvent {
  return event.type !== 'recipient_verified' && event.type !== 'recipient_rejected';
}

/** Where `confirm-enrollment` is enqueued, by `main.ts` (job id `paymentId`; contracts/kernel.md). */
export interface ConfirmationQueue {
  enqueue(paymentId: string): Promise<void>;
}

/** Booking's entry the branch appends its outcome through (R-API-6). */
export interface OrderOutcomes {
  /** The caller holds the enrollment's row and then the payment's. */
  readonly recordOrderFailed: (
    tx: Transaction,
    enrollmentId: string,
    paymentId: string,
    occurredAt: Date,
  ) => Promise<void>;
}

export interface OrderEventsDependencies {
  readonly database: Pick<Database, '$transaction' | 'payment'>;
  readonly booking: OrderOutcomes;
  readonly confirmations: ConfirmationQueue;
  readonly log: Pick<Logger, 'warn'>;
  /** The process's error reporting (T111); replaced by a recorder in the specs. */
  readonly report?: (error: Error) => void;
  readonly now?: () => Date;
}

/** What the branch did: moved the order, recorded it alone, found it recorded, or found no order. */
export type OrderOutcome = 'moved' | 'unchanged' | 'replayed' | 'unknown_order';

/** A signed order event whose gateway order no `payments` row holds. */
export class UnknownOrderEventError extends Error {
  constructor(providerEventId: string, eventType: string) {
    super(`No order holds the ${eventType} event ${providerEventId}; it was not recorded.`);
    this.name = 'UnknownOrderEventError';
  }
}

/** The statuses each event moves an order from (the header's table). */
const MOVES_FROM: Readonly<Record<OrderEventType, readonly OrderStatus[]>> = {
  paid: ['created', 'failed', 'expired'],
  failed: ['created'],
  expired: ['created'],
  refunded: ['paid'],
};

export class OrderEventsService {
  readonly #database: Pick<Database, '$transaction' | 'payment'>;
  readonly #booking: OrderOutcomes;
  readonly #confirmations: ConfirmationQueue;
  readonly #log: Pick<Logger, 'warn'>;
  readonly #report: (error: Error) => void;
  readonly #now: () => Date;

  constructor({
    database,
    booking,
    confirmations,
    log,
    report = reportError,
    now = () => new Date(),
  }: OrderEventsDependencies) {
    this.#database = database;
    this.#booking = booking;
    this.#confirmations = confirmations;
    this.#log = log;
    this.#report = report;
    this.#now = now;
  }

  /** Records `event` and applies it once; what happened, for the webhook to acknowledge. */
  async record(event: OrderEvent, receipt: Receipt): Promise<OrderOutcome> {
    const order = await orderNamed(this.#database, event.gatewayOrderId);
    if (order === null) {
      this.#log.warn(
        { providerEventId: event.providerEventId, eventType: event.type },
        'No order holds a signed order event; nothing was recorded',
      );
      this.#report(new UnknownOrderEventError(event.providerEventId, event.type));
      return 'unknown_order';
    }
    const outcome = await this.#database.$transaction((tx) =>
      this.#apply(tx, order, event, receipt),
    );
    if (event.type === 'paid') await this.#confirmations.enqueue(order.paymentId);
    return outcome;
  }

  async #apply(
    tx: Transaction,
    order: OrderRef,
    event: OrderEvent,
    receipt: Receipt,
  ): Promise<OrderOutcome> {
    await lockOrder(tx, order);
    const payments = new PaymentsRepository(tx);
    const recorded = await payments.recordOrderEvent({
      paymentId: order.paymentId,
      providerEventId: event.providerEventId,
      eventType: event.type,
      signatureVerifiedAt: receipt.signatureVerifiedAt,
      payloadHash: createHash('sha256').update(receipt.rawBody).digest('hex'),
      receivedAt: receipt.receivedAt,
    });
    if (!recorded) return 'replayed';
    const status = await payments.statusOf(order.paymentId);
    if (!MOVES_FROM[event.type].includes(status)) return 'unchanged';
    await payments.moveOrder(order.paymentId, event.type, reportedBy(event));
    if (event.type === 'failed') {
      await this.#booking.recordOrderFailed(tx, order.enrollmentId, order.paymentId, this.#now());
    }
    return 'moved';
  }
}

/** What a paid event reported, as it reported it; nothing for any other event. */
function reportedBy(event: OrderEvent): ReportedPayment | undefined {
  if (event.type !== 'paid') return undefined;
  return {
    gatewayTransactionId: event.gatewayTransactionId,
    gateway_fee_piasters: event.gateway_fee_piasters,
    net_piasters: event.net_piasters,
  };
}
