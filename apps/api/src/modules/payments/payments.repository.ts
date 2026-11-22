// T077: the payments module's queries (ERD §7, ADR 0007). Phase 1 writes one: the record of a signed
// payout-recipient event in `payment_events`. Queries only, each on the transaction it is handed;
// `recipient-events.service.ts` holds the rules. T038 adds the order branch's: the order a gateway
// order id names, its lock, its status read under the lock, the record of an order event, and the
// order's move; `order-events.service.ts` holds the rules. 003:T102 adds the refunded total's read
// and write and the reported flag's instant, each under the order's lock.
//
// The insert is `INSERT … ON CONFLICT DO NOTHING` (Prisma's `skipDuplicates`), so a replayed
// `provider_event_id` is refused by the unique NOT NULL column itself and leaves the transaction
// usable: the caller learns "replay" from a count of zero (FR-PAYG-4, R-MONEY-8). A delivery racing
// the same event waits on the unique index until the first transaction ends, then counts zero if it
// committed. The table is append-only (`20261007000500_append_only_tables`), so nothing here updates
// or deletes a row of it. Since T004 the module's `_encrypted` column is reached here too, for the
// `reencrypt-columns` job.
import { type Piasters, piasters, toPlainNumber } from '@ijazah/money';

import type { EncryptedColumn, EncryptedValue } from '../../platform/crypto/encryption.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { lockRows } from '../../platform/db/row-lock.js';

type Client = Pick<Transaction, 'paymentEvent' | 'payment'>;

/** `payments.status` (ERD §7). */
export type OrderStatus = 'created' | 'paid' | 'failed' | 'expired' | 'refunded';

/** The event types of a gateway order: every `payment_events.event_type` but the recipient's. */
export type OrderEventType =
  | 'paid'
  | 'failed'
  | 'expired'
  | 'refunded'
  | 'refund_reported'
  // 006:T001 (R-510): a programme's card saved at a payment.
  | 'card_saved';

/** 003:T102 (DEC-82): what a refund is decided on, read under `lockOrder`. */
export interface OrderRefunds {
  readonly status: OrderStatus;
  readonly refunded_piasters: Piasters;
  readonly gross_piasters: Piasters;
}

/** An order as the branch finds it by the gateway's order id: its row and its enrollment. */
export interface OrderRef {
  readonly paymentId: string;
  readonly enrollmentId: string;
}

/** What an order was created for: its amount and currency (T056). */
export interface OrderCharge {
  readonly gross_piasters: Piasters;
  readonly currency: string;
}

/** A signed order event as it is kept: its order, and never the body, only its hash (R-SEC-2). */
export interface OrderEventRecord {
  readonly paymentId: string;
  readonly providerEventId: string;
  readonly eventType: OrderEventType;
  readonly signatureVerifiedAt: Date;
  readonly payloadHash: string;
  readonly receivedAt: Date;
}

/**
 * What a paid event reports, recorded as the gateway reported it (R-MONEY-5, FR-367): a fee or net
 * the event did not report is NULL, as the ERD lets it be (T056), never computed.
 */
export interface ReportedPayment {
  readonly gatewayTransactionId: string;
  readonly gateway_fee_piasters: Piasters | null;
  readonly net_piasters: Piasters | null;
}

function asColumn(reported_piasters: Piasters | null): bigint | null {
  return reported_piasters === null ? null : BigInt(toPlainNumber(reported_piasters));
}

/**
 * The order the gateway's order id names, or null when no row holds it. Read before any lock: an
 * order's enrollment never changes, and what the branch decides on is read again under the lock.
 */
export async function orderNamed(
  database: Pick<Transaction, 'payment'>,
  gatewayOrderId: string,
): Promise<OrderRef | null> {
  const order = await database.payment.findUnique({
    where: { gatewayOrderId },
    select: { id: true, enrollmentId: true },
  });
  return order === null ? null : { paymentId: order.id, enrollmentId: order.enrollmentId };
}

/**
 * Locks the order's enrollment, then the order, FOR UPDATE until the transaction ends: T005's one
 * order, the enrollment before the payment (the note under T038), so a sweep holding the enrollment
 * while it waits for the payment never meets this branch the other way round. The enrollment is
 * booking's row, locked as `row-lock.ts` allows (the order references it); no column of it is read.
 */
export async function lockOrder(
  tx: Transaction,
  { paymentId, enrollmentId }: OrderRef,
): Promise<void> {
  await lockRows(tx, 'enrollments', [enrollmentId]);
  await lockRows(tx, 'payments', [paymentId]);
}

/** 006:T005 (R-502): what an order pays for, as the confirm step decides on it. */
export interface OrderTerms {
  readonly kind: 'package' | 'assessment' | 'rest_in_full' | 'instalment';
  /** Set (1 and up) exactly on an `instalment` (ERD section 15 rule 70). */
  readonly instalmentMonth: number | null;
  /** The confirm step's per-order marker (V-3); null until it processed the order. */
  readonly confirmedAt: Date | null;
}

/** The order's terms; the caller holds the order's lock (`lockForConfirmation`'s `orders`). */
export function orderTermsOf(
  tx: Pick<Transaction, 'payment'>,
  paymentId: string,
): Promise<OrderTerms> {
  return tx.payment.findUniqueOrThrow({
    where: { id: paymentId },
    select: { kind: true, instalmentMonth: true, confirmedAt: true },
  });
}

/** A signed recipient event as it is kept: never the body, only its hash (R-SEC-2). */
export interface RecipientEventRecord {
  readonly providerEventId: string;
  readonly eventType: 'recipient_verified' | 'recipient_rejected';
  readonly signatureVerifiedAt: Date;
  readonly payloadHash: string;
  readonly receivedAt: Date;
}

export class PaymentsRepository {
  readonly #tx: Client;

  constructor(tx: Client) {
    this.#tx = tx;
  }

  /**
   * Records a recipient event, with no payment (rule 20: `payment_id` is NULL exactly for a
   * recipient event). False when its provider event id is already recorded: a replay.
   */
  async recordRecipientEvent(event: RecipientEventRecord): Promise<boolean> {
    const { count } = await this.#tx.paymentEvent.createMany({
      data: [{ ...event, paymentId: null }],
      skipDuplicates: true,
    });
    return count === 1;
  }

  /** Records an order event under its order. False when its provider event id is already recorded. */
  async recordOrderEvent(event: OrderEventRecord): Promise<boolean> {
    const { count } = await this.#tx.paymentEvent.createMany({
      data: [event],
      skipDuplicates: true,
    });
    return count === 1;
  }

  /** The amount and currency the order was created for (T056). */
  async chargeOf(paymentId: string): Promise<OrderCharge> {
    const { grossPiasters, currency } = await this.#tx.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: { grossPiasters: true, currency: true },
    });
    return { gross_piasters: piasters(Number(grossPiasters)), currency };
  }

  /** The order's status, read under `lockOrder`. */
  async statusOf(paymentId: string): Promise<OrderStatus> {
    const { status } = await this.#tx.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: { status: true },
    });
    return status;
  }

  /** 003:T102: the order's status, refunded total and gross, read under `lockOrder`. */
  async refundsOf(paymentId: string): Promise<OrderRefunds> {
    const { status, refundedPiasters, grossPiasters } = await this.#tx.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: { status: true, refundedPiasters: true, grossPiasters: true },
    });
    return {
      status,
      refunded_piasters: piasters(Number(refundedPiasters)),
      gross_piasters: piasters(Number(grossPiasters)),
    };
  }

  /** 003:T102: writes the order's refunded total `packages/money` computed, under `lockOrder`. */
  async recordRefundedTotal(paymentId: string, refunded_piasters: Piasters): Promise<void> {
    await this.#tx.payment.update({
      where: { id: paymentId },
      data: { refundedPiasters: BigInt(toPlainNumber(refunded_piasters)) },
      select: { id: true },
    });
  }

  /**
   * 003:T102 (Q-2 (a)'s safety net): sets `refund_reported_at` the first time the gateway flags a
   * refund on the order, never again (`WHERE refund_reported_at IS NULL`). True when it set it.
   */
  async markRefundReported(paymentId: string, at: Date): Promise<boolean> {
    const { count } = await this.#tx.payment.updateMany({
      where: { id: paymentId, refundReportedAt: null },
      data: { refundReportedAt: at },
    });
    return count === 1;
  }

  /**
   * Moves the order to `status`, with what a paid event reported, and clears its hosted page's
   * address: a moved order has left `created`, and the address is kept only while it is `created`
   * (data-model §2.4).
   */
  async moveOrder(
    paymentId: string,
    status: OrderStatus,
    reported: ReportedPayment | undefined,
  ): Promise<void> {
    await this.#tx.payment.update({
      where: { id: paymentId },
      data: {
        status,
        checkoutUrlEncrypted: null,
        ...(reported === undefined
          ? {}
          : {
              gatewayTransactionId: reported.gatewayTransactionId,
              gatewayFeePiasters: asColumn(reported.gateway_fee_piasters),
              netPiasters: asColumn(reported.net_piasters),
            }),
      },
      select: { id: true },
    });
  }
}

/**
 * `payments.checkout_url_encrypted`: the hosted checkout's address, kept while the order is
 * `created` (T004, data-model §2.4, R-DB-8), for the `reencrypt-columns` job (002:T134). An order
 * whose address is cleared is not a row to rewrite. A value is written only where the row still
 * holds the one read, so an address the application cleared meanwhile stays cleared.
 */
export function checkoutAddresses(database: Pick<Transaction, 'payment'>): EncryptedColumn {
  const orders = database.payment;
  return {
    column: 'payments.checkout_url_encrypted',
    page: async (after, limit) => {
      const rows = await orders.findMany({
        where: {
          checkoutUrlEncrypted: { not: null },
          ...(after === undefined ? {} : { id: { gt: after } }),
        },
        orderBy: { id: 'asc' },
        take: limit,
        select: { id: true, checkoutUrlEncrypted: true },
      });
      return rows.flatMap(({ id, checkoutUrlEncrypted: value }): EncryptedValue[] =>
        value === null ? [] : [{ id, value }],
      );
    },
    replace: async (id, stored, next) => {
      const { count } = await orders.updateMany({
        where: { id, checkoutUrlEncrypted: { equals: Uint8Array.from(stored) } },
        data: { checkoutUrlEncrypted: Uint8Array.from(next) },
      });
      return count === 1;
    },
  };
}
