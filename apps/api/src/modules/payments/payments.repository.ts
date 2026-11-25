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
import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { lockRows } from '../../platform/db/row-lock.js';
import type { DeclineKind } from '../../platform/ports/payment/payment.port.js';

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

/** 006:T006 (R-502, FR-718): a month or the rest the confirm step already processed. */
export interface ProcessedProgrammeOrder {
  readonly kind: 'rest_in_full' | 'instalment';
  readonly instalmentMonth: number | null;
}

/**
 * The enrollment's `rest_in_full` and `instalment` orders the confirm step processed
 * (`confirmed_at` set), in the order it processed them (`confirmed_at`, then id: the awaited month is
 * walked from them, PR #156 r1 Major 1); the caller holds the orders' locks.
 */
export async function processedProgrammeOrdersOf(
  tx: Pick<Transaction, 'payment'>,
  enrollmentId: string,
): Promise<ProcessedProgrammeOrder[]> {
  const rows = await tx.payment.findMany({
    where: {
      enrollmentId,
      kind: { in: ['rest_in_full', 'instalment'] },
      confirmedAt: { not: null },
    },
    orderBy: [{ confirmedAt: 'asc' }, { id: 'asc' }],
    select: { kind: true, instalmentMonth: true },
  });
  return rows.flatMap(({ kind, instalmentMonth }) =>
    kind === 'rest_in_full' || kind === 'instalment' ? [{ kind, instalmentMonth }] : [],
  );
}

/**
 * 006:T006 (V-3): the confirm step's per-order marker, written once (`WHERE confirmed_at IS NULL`);
 * the caller holds the order's lock. 006:T009 (PR #156 r2 Follow-up 1): its instant is the
 * database's clock read here, under the locks (`clock_timestamp()`), never one the caller read
 * before them, so the walk (`confirmed_at`, id) follows the order the orders were settled in.
 */
export async function markOrderConfirmed(tx: Transaction, paymentId: string): Promise<void> {
  const at = await clockTimestamp(tx);
  await tx.payment.updateMany({
    where: { id: paymentId, confirmedAt: null },
    data: { confirmedAt: at },
  });
}

/**
 * 006:T014 (R-509; SRS DEC-113): an automatic charge's order as it is recorded, before any gateway
 * call: `created` with no gateway id until the gateway's order answers, or `failed` with a `hard`
 * decline when it was refused before the gateway (`no_payee`; ERD §15 rule 72 admits both NULL).
 */
export interface NewAutomaticOrder {
  readonly enrollmentId: string;
  readonly gateway: 'fake' | 'paymob';
  readonly gross_piasters: Piasters;
  readonly currency: string;
  readonly expiresAt: Date;
  readonly teacherShareRatePercent: number;
  readonly teacherShare_piasters: Piasters;
  readonly halfReleaseRatePercent: number | null;
  readonly instalmentMonth: number;
  readonly attempt: number;
  readonly status: 'created' | 'failed';
}

/** Writes the automatic order (above); its id. The caller holds the enrollment's lock. */
export async function insertAutomaticOrder(
  tx: Pick<Transaction, 'payment'>,
  order: NewAutomaticOrder,
): Promise<string> {
  const { gross_piasters, teacherShare_piasters, status, ...rest } = order;
  const { id } = await tx.payment.create({
    data: {
      ...rest,
      grossPiasters: BigInt(toPlainNumber(gross_piasters)),
      teacherSharePiasters: BigInt(toPlainNumber(teacherShare_piasters)),
      kind: 'instalment',
      automatic: true,
      status,
      ...(status === 'failed' ? { declineKind: 'hard' as const } : {}),
    },
    select: { id: true },
  });
  return id;
}

/** 006:T014: the programme's saved card's encrypted token, or null (the caller holds the programme). */
export async function programmeCardTokenOf(
  tx: Pick<Transaction, 'programmeCard'>,
  enrollmentId: string,
): Promise<Uint8Array | null> {
  const card = await tx.programmeCard.findUnique({
    where: { enrollmentId },
    select: { tokenEncrypted: true },
  });
  return card?.tokenEncrypted ?? null;
}

/**
 * 006:T014 (SRS DEC-113 (2)): records the gateway's order id on an automatic order still `created`
 * with none, under `lockOrder`; whether it did. The one guard of the token payment: only the call
 * that wrote the id sends it, so two calls for one order send one payment.
 */
export async function recordGatewayOrderId(
  tx: Pick<Transaction, 'payment'>,
  paymentId: string,
  gatewayOrderId: string,
): Promise<boolean> {
  const { count } = await tx.payment.updateMany({
    where: { id: paymentId, automatic: true, status: 'created', gatewayOrderId: null },
    data: { gatewayOrderId },
  });
  return count === 1;
}

/**
 * 006:T014: ends an automatic order no payment was sent for (`created`, no gateway id), under
 * `lockOrder`: `expired` (the gateway's order unanswered, or no id ever recorded: a soft decline), or
 * `failed` with a `hard` decline (refused before the gateway). Whether it moved.
 */
export async function closeUnsentAutomaticOrder(
  tx: Pick<Transaction, 'payment'>,
  paymentId: string,
  to: 'expired' | 'failed',
): Promise<boolean> {
  const { count } = await tx.payment.updateMany({
    where: { id: paymentId, automatic: true, status: 'created', gatewayOrderId: null },
    data: to === 'failed' ? { status: 'failed', declineKind: 'hard' } : { status: 'expired' },
  });
  return count === 1;
}

/**
 * 006:T021 (B-P4's conflict check, Q-1 (a) amended, the owner, 2026-11-25; SRS DEC-113;
 * kernel.md, 006:T021's row): an administrator's `charge_unknown` decision locks the month's
 * automatic order (`lockOrder`: the enrollment, already held by the decision, then the order) and
 * reads its status under the lock, so the gateway's answer (the inquiry's or the late callback's,
 * both under the same locks) lands wholly before or wholly after the decision. Null for an id that
 * is no automatic order of the enrollment.
 */
export async function lockedAutomaticOrderStatus(
  tx: Transaction,
  ref: OrderRef,
): Promise<OrderStatus | null> {
  await lockOrder(tx, ref);
  const row = await tx.payment.findFirst({
    where: { id: ref.paymentId, enrollmentId: ref.enrollmentId, automatic: true },
    select: { status: true },
  });
  return row?.status ?? null;
}

/**
 * 006:T014 (SRS DEC-110 (3)): an automatic order the gateway says has no transaction, `expired`
 * (a soft decline), under `lockOrder`; whether it moved. 006:T021 (Q-1 (a) amended): also an
 * administrator's approval of a `charge_unknown` item («no charge found in the gateway»), under the
 * lock `lockedAutomaticOrderStatus` took; no gateway call.
 */
export async function expireAutomaticOrder(
  tx: Pick<Transaction, 'payment'>,
  paymentId: string,
): Promise<boolean> {
  const { count } = await tx.payment.updateMany({
    where: { id: paymentId, automatic: true, status: 'created' },
    data: { status: 'expired' },
  });
  return count === 1;
}

/** 006:T014: what the inquiry decides on of an automatic order, read with no lock. */
export interface AutomaticOrderState {
  readonly enrollmentId: string;
  readonly automatic: boolean;
  readonly status: OrderStatus;
  readonly gatewayOrderId: string | null;
  readonly declineKind: DeclineKind | null;
  readonly expiresAt: Date;
}

export function automaticOrderOf(
  tx: Pick<Transaction, 'payment'>,
  paymentId: string,
): Promise<AutomaticOrderState> {
  return tx.payment.findUniqueOrThrow({
    where: { id: paymentId },
    select: {
      enrollmentId: true,
      automatic: true,
      status: true,
      gatewayOrderId: true,
      declineKind: true,
      expiresAt: true,
    },
  });
}

/** 006:T015: a programme month's latest automatic order, as the sweep decides on it. */
export interface MonthAutomaticOrder {
  readonly paymentId: string;
  readonly status: OrderStatus;
  readonly expiresAt: Date;
  readonly declineKind: DeclineKind | null;
  readonly attempt: number;
  /** Its `updated_at` once `failed` (the failure's instant); null otherwise. */
  readonly failedAt: Date | null;
}

/** 006:T015: a programme month's orders and whether a card is saved (never a card detail). */
export interface ProgrammeMonthOrders {
  readonly cardSaved: boolean;
  readonly payable: boolean;
  readonly processing: boolean;
  readonly automatic: MonthAutomaticOrder | null;
}

/**
 * 006:T015 (R-508; SRS DEC-110, DEC-113): the enrollment's programme orders (`rest_in_full`,
 * `instalment`) as the sweep's month `month` reads them, with no lock (the sweep's step holds the
 * enrollment, which every order's move takes first): whether one is `created` and unexpired at `at`
 * (payable), whether one is paid and not yet processed by the confirm step (`confirmed_at` NULL), and
 * the month's latest automatic order by id (a UUIDv7's creation order); and whether a card is saved,
 * its key only (never a card detail, SC-707). Two statements over `payments_enrollment_id_idx` and
 * `programme_cards`' primary key, bounded by the enrollment's few orders.
 */
export async function programmeMonthOrdersOf(
  tx: Pick<Transaction, 'payment' | 'programmeCard'>,
  enrollmentId: string,
  month: number,
  at: Date,
): Promise<ProgrammeMonthOrders> {
  const card = await tx.programmeCard.findUnique({
    where: { enrollmentId },
    select: { enrollmentId: true },
  });
  const orders = await tx.payment.findMany({
    where: { enrollmentId, kind: { in: ['rest_in_full', 'instalment'] } },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      status: true,
      expiresAt: true,
      confirmedAt: true,
      automatic: true,
      instalmentMonth: true,
      attempt: true,
      declineKind: true,
      updatedAt: true,
    },
  });
  const latest = orders.filter((one) => one.automatic && one.instalmentMonth === month).at(-1);
  return {
    cardSaved: card !== null,
    payable: orders.some((one) => one.status === 'created' && one.expiresAt > at),
    processing: orders.some((one) => one.status === 'paid' && one.confirmedAt === null),
    automatic:
      latest === undefined
        ? null
        : {
            paymentId: latest.id,
            status: latest.status,
            expiresAt: latest.expiresAt,
            declineKind: latest.declineKind,
            attempt: latest.attempt ?? 0,
            failedAt: latest.status === 'failed' ? latest.updatedAt : null,
          },
  };
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

  /**
   * 006:T013 (R-510, FR-713): the instant the student consented to save the card on this order
   * (`card_consent_at`, ERD §15 rule 82), or null; read under `lockOrder`.
   */
  async cardConsentOf(paymentId: string): Promise<Date | null> {
    const { cardConsentAt } = await this.#tx.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: { cardConsentAt: true },
    });
    return cardConsentAt;
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
  /**
   * 006:T014 (SRS DEC-113, Q-10 (a) adjusted): the decline kind the inquiry's authenticated answer
   * gave, written once on a `failed` automatic order (`WHERE decline_kind IS NULL`), under
   * `lockOrder`. True when it wrote it.
   */
  async recordDeclineKind(paymentId: string, declineKind: DeclineKind): Promise<boolean> {
    const { count } = await this.#tx.payment.updateMany({
      where: { id: paymentId, automatic: true, status: 'failed', declineKind: null },
      data: { declineKind },
    });
    return count === 1;
  }

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
