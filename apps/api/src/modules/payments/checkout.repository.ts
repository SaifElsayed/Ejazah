// T036, T037 (FR-BOOK-12, FR-354 to FR-357, FR-380 to FR-386; data-model §2.4): the checkout's queries
// on `payments`, each on the transaction it is handed. Queries only; `checkout.service.ts` holds the
// rules. The order event branch's queries (`payments.repository.ts`, T038) are reused for an order
// the gateway cancelled: it is locked, read and moved there as an event's order is.
//
// THE LOCK (T005's rules 1 and 2). `heldOrdersOf` expects the caller to hold the enrollment's row,
// finds its orders, locks them in one `lockRows(tx, 'payments', ids)` call in id order, and reads
// them again under the lock; an order cannot be added meanwhile, its insert referencing the locked
// enrollment. The insert of an order references its enrollment alone, which the caller holds.
// Every read is bounded: the orders of one enrollment (a handful: one per Pay or Retry), one order.
//
// 006:T001 (Q-2 (a)): `gateway_order_id` is NULL-able (ERD §15 rule 72), NULL only on a programme's
// automatic order, which T014 writes. The reads that hand the reference on as a string refuse a NULL
// as a broken invariant (`withGatewayOrderId`), never answer it as a reference or as no order.
import type { Piasters } from '@ijazah/money';
import { piasters, toPlainNumber } from '@ijazah/money';
import type { $Enums } from '@prisma/client';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { lockRows } from '../../platform/db/row-lock.js';
import type { HeldOrders, ProgrammePayOrders } from '../booking/index.js';
import type { OrderStatus } from './payments.repository.js';

type Client = Pick<Transaction, 'payment'>;

/** The order with its gateway reference; one without is a broken invariant on the checkout's path. */
function withGatewayOrderId<T extends { readonly gatewayOrderId: string | null }>(
  row: T,
): T & { readonly gatewayOrderId: string } {
  const { gatewayOrderId } = row;
  if (gatewayOrderId === null) {
    throw new Error('checkout: an order with no gateway id on a manual path');
  }
  return { ...row, gatewayOrderId };
}

/**
 * The orders of the enrollment a new checkout finds on the student's own hold (FR-BOOK-12): the last
 * one still payable (`created`, its `expires_at` after `at`), and whether one is paid. Expects the
 * caller to hold the enrollment's lock; takes the orders' after it.
 */
export async function heldOrdersOf(
  tx: Transaction,
  enrollmentId: string,
  at: Date,
): Promise<HeldOrders> {
  const found = await tx.payment.findMany({
    where: { enrollmentId },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  if (found.length === 0) return { payable: null, paid: false };
  await lockRows(
    tx,
    'payments',
    found.map(({ id }) => id),
  );
  const orders = await tx.payment.findMany({
    where: { enrollmentId },
    orderBy: { id: 'asc' },
    select: { id: true, gatewayOrderId: true, status: true, expiresAt: true },
  });
  const payable = orders.filter(
    ({ status, expiresAt }) => status === 'created' && expiresAt.getTime() > at.getTime(),
  );
  const latest = payable.at(-1);
  const last = latest === undefined ? undefined : withGatewayOrderId(latest);
  return {
    payable:
      last === undefined
        ? null
        : { paymentId: last.id, gatewayOrderId: last.gatewayOrderId, expiresAt: last.expiresAt },
    paid: orders.some(({ status }) => status === 'paid'),
  };
}

/** `payments.gateway` (ERD §7): which gateway took the order. */
export type PaymentGateway = $Enums.PaymentGateway;

/** An order to record as the gateway created it (FR-354, FR-367): `created`, its address encrypted. */
export interface NewOrder {
  readonly id: string;
  readonly enrollmentId: string;
  readonly gateway: PaymentGateway;
  readonly gatewayOrderId: string;
  readonly gross_piasters: Piasters;
  readonly currency: string;
  readonly expiresAt: Date;
  readonly checkoutUrlEncrypted: Uint8Array;
  /** T104: the rate read when the order was created, and the share it gave (ADR 0025 D1). */
  readonly teacherShareRatePercent: number;
  readonly teacherShare_piasters: Piasters;
  /**
   * 003:T105 (ADR 0025 D2, D6): the ijazah half's percent read when an `ijazah_track` order was
   * created; null on every other order (ERD §15 rule 64).
   */
  readonly halfReleaseRatePercent: number | null;
  /**
   * 006:T005 (R-502, FR-701; the owner's approval of 2026-11-22): what the order pays for, a
   * package as today or a programme's `assessment`; 006:T009: `rest_in_full` and `instalment`,
   * `programme.pay`'s; the automatic ones are T014's.
   */
  readonly kind: 'package' | 'assessment' | 'rest_in_full' | 'instalment';
  /** 006:T009: an instalment's month, written exactly on an `instalment` (ERD §15 rule 70). */
  readonly instalmentMonth?: number;
  /** 006:T009 (Q-4 (a)): the consent to save the card, on a programme order paid by hand (rule 82). */
  readonly cardConsentAt?: Date;
}

/** Writes the order. The caller holds its enrollment's lock. */
export async function insertOrder(tx: Client, order: NewOrder): Promise<void> {
  const { gross_piasters, checkoutUrlEncrypted, teacherShare_piasters, ...rest } = order;
  await tx.payment.create({
    data: {
      ...rest,
      grossPiasters: BigInt(toPlainNumber(gross_piasters)),
      teacherSharePiasters: BigInt(toPlainNumber(teacherShare_piasters)),
      checkoutUrlEncrypted: Uint8Array.from(checkoutUrlEncrypted),
      status: 'created',
    },
    select: { id: true },
  });
}

/** An order as `checkout.continue` reads it before it decrypts anything (data-model §2.4.1). */
export interface AddressedOrder {
  readonly id: string;
  readonly enrollmentId: string;
  /** The gateway's order reference, FR-384's `reference`. */
  readonly gatewayOrderId: string;
  readonly status: OrderStatus;
  readonly expiresAt: Date;
  readonly checkoutUrlEncrypted: Uint8Array | null;
}

/** The order of that id, or null. */
export async function orderById(tx: Client, paymentId: string): Promise<AddressedOrder | null> {
  const row = await tx.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      enrollmentId: true,
      gatewayOrderId: true,
      status: true,
      expiresAt: true,
      checkoutUrlEncrypted: true,
    },
  });
  return row === null ? null : withGatewayOrderId(row);
}

/** The enrollment's latest order (ids are UUIDv7, so the greatest is the latest), or null. */
export async function lastOrderOf(
  tx: Client,
  enrollmentId: string,
): Promise<AddressedOrder | null> {
  const row = await tx.payment.findFirst({
    where: { enrollmentId },
    orderBy: { id: 'desc' },
    select: {
      id: true,
      enrollmentId: true,
      gatewayOrderId: true,
      status: true,
      expiresAt: true,
      checkoutUrlEncrypted: true,
    },
  });
  return row === null ? null : withGatewayOrderId(row);
}

/** The gateway's reference of the order, as FR-384's message gives it. */
export async function orderReferenceOf(tx: Client, paymentId: string): Promise<string | null> {
  const row = await tx.payment.findUnique({
    where: { id: paymentId },
    select: { gatewayOrderId: true },
  });
  return row === null ? null : withGatewayOrderId(row).gatewayOrderId;
}

// ---------------------------------------------------------------------------------------------
// 006:T009 (FR-710, R-509, R-511): what `programme.pay` reads of the orders.

/** The programme's assessment order, as the first payment copies it (R-511): its gross, its rates. */
export interface AssessmentOrder {
  /** The assessment's fee as paid: the rest in full is the total less it (FR-711). */
  readonly gross_piasters: Piasters;
  readonly teacherShareRatePercent: number;
  readonly halfReleaseRatePercent: number | null;
}

/** The enrollment's assessment order the confirm step processed (`confirmed_at` set). */
export async function assessmentOrderOf(
  tx: Client,
  enrollmentId: string,
): Promise<AssessmentOrder> {
  const row = await tx.payment.findFirst({
    where: { enrollmentId, kind: 'assessment', confirmedAt: { not: null } },
    orderBy: { id: 'asc' },
    select: { grossPiasters: true, teacherShareRatePercent: true, halfReleaseRatePercent: true },
  });
  // An offered programme's assessment was confirmed by the step that wrote its programme (R-504),
  // and every programme order carries a rate (T104).
  if (row === null || row.teacherShareRatePercent === null) {
    throw new Error(`Enrollment ${enrollmentId} has no processed assessment order with its rate`);
  }
  return {
    gross_piasters: piasters(Number(row.grossPiasters)),
    teacherShareRatePercent: row.teacherShareRatePercent,
    halfReleaseRatePercent: row.halfReleaseRatePercent,
  };
}

/** The kinds that pay for a programme's rest (R-502). */
const PROGRAMME_ORDER_KINDS: ReadonlySet<string> = new Set(['rest_in_full', 'instalment']);

/**
 * Of `enrollmentIds`, each one's orders as a new checkout reads them (`heldOrdersOf`'s answer), and
 * (PR #158 r1 Major 1) whether a programme order is paid and not yet processed by the confirm step
 * (`confirmed_at` NULL); the orders locked in one call after the caller's enrollments (T005).
 */
export async function checkoutOrdersAmong(
  tx: Transaction,
  enrollmentIds: readonly string[],
  at: Date,
): Promise<ReadonlyMap<string, ProgrammePayOrders>> {
  const where = { enrollmentId: { in: [...enrollmentIds] } };
  const found = await tx.payment.findMany({ where, orderBy: { id: 'asc' }, select: { id: true } });
  const answer = new Map<string, ProgrammePayOrders>();
  if (found.length === 0) return answer;
  await lockRows(
    tx,
    'payments',
    found.map(({ id }) => id),
  );
  const orders = await tx.payment.findMany({
    where,
    orderBy: { id: 'asc' },
    select: {
      id: true,
      enrollmentId: true,
      gatewayOrderId: true,
      status: true,
      expiresAt: true,
      kind: true,
      confirmedAt: true,
    },
  });
  // In id order, a UUIDv7's creation order: the last payable order met is the latest.
  for (const order of orders) {
    const before = answer.get(order.enrollmentId) ?? {
      payable: null,
      paid: false,
      programmeProcessing: false,
    };
    const payable = order.status === 'created' && order.expiresAt.getTime() > at.getTime();
    const last = payable ? withGatewayOrderId(order) : null;
    answer.set(order.enrollmentId, {
      payable:
        last === null
          ? before.payable
          : { paymentId: last.id, gatewayOrderId: last.gatewayOrderId, expiresAt: last.expiresAt },
      paid: before.paid || order.status === 'paid',
      programmeProcessing:
        before.programmeProcessing ||
        (order.status === 'paid' &&
          order.confirmedAt === null &&
          PROGRAMME_ORDER_KINDS.has(order.kind)),
    });
  }
  return answer;
}

/** Among `enrollmentIds`, a programme order still payable at `at`, or null; no lock. */
export async function payableProgrammeOrderAmong(
  tx: Client,
  enrollmentIds: readonly string[],
  at: Date,
): Promise<{ readonly enrollmentId: string; readonly expiresAt: Date } | null> {
  return tx.payment.findFirst({
    where: {
      enrollmentId: { in: [...enrollmentIds] },
      kind: { in: ['rest_in_full', 'instalment'] },
      status: 'created',
      expiresAt: { gt: at },
    },
    orderBy: { id: 'desc' },
    select: { enrollmentId: true, expiresAt: true },
  });
}
