// T052 (FR-400, FR-PAYG-7, research R-220): the payments module's queries for the admin's monitor,
// each on the caller's transaction. Read-only, no lock: the monitor decides nothing on what it reads
// and writes nothing (FR-401; T005's rule 1 binds the paths that decide).
//
// BOUNDED AND INDEXED. A page of orders is read newest first by the primary key, whose UUID v7 is
// time-ordered, after the cursor's id and at most `limit` rows, the status a filter on that scan (no
// index on it; ERD §14 adds none until a query is measurably slow, R-DB-9). One order is read by its
// primary key; its events by `payment_events_payment_id_idx`; an enrollment's paid orders by
// `payments_enrollment_id_idx`, an enrollment holding a few orders at most (a failed attempt, a
// Retry, a second payment).
//
// 006:T001 (Q-2 (a)): `gateway_order_id` is NULL-able (ERD §15 rule 72), NULL only on a programme's
// automatic order the gateway has not answered or that was refused before it. 006:T018 (the
// follow-up carried from T014, option (d), the owner's «موافق» of 2026-11-24): the rows keep the
// NULL, so a page holding such an order is listed whole; only the contract's edge maps it to `''`
// (`payments-monitor.service.ts`). Each read also selects the programme's terms of the order (its
// kind, its month, whether it is automatic and why it failed), columns of the same row.
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { OrderEventType, OrderStatus } from './payments.repository.js';

type Client = Pick<Transaction, 'payment' | 'paymentEvent'>;

/** One gateway order as the monitor reads it: the amounts as the gateway reported them. */
export interface MonitorOrderRow {
  readonly id: string;
  readonly enrollmentId: string;
  /** NULL only on an automatic order the gateway has not answered or that was refused before it. */
  readonly gatewayOrderId: string | null;
  readonly gatewayTransactionId: string | null;
  readonly status: OrderStatus;
  readonly grossPiasters: bigint;
  readonly gatewayFeePiasters: bigint | null;
  readonly netPiasters: bigint | null;
  /** 003:T104: the rate and the teacher's share kept on the order; null before the commission. */
  readonly teacherShareRatePercent: number | null;
  readonly teacherSharePiasters: bigint | null;
  /** 003:T102 (DEC-82): the refunded total, and when a refund was first flagged with no amount. */
  readonly refundedPiasters: bigint;
  readonly refundReportedAt: Date | null;
  readonly currency: string;
  readonly createdAt: Date;
  /** 006:T018: what the order pays for, an `instalment`'s month, automatic, and why it failed. */
  readonly kind: 'package' | 'assessment' | 'rest_in_full' | 'instalment';
  readonly instalmentMonth: number | null;
  readonly automatic: boolean;
  readonly declineKind: 'soft' | 'hard' | null;
}

/** One signed event of an order, as received. */
export interface MonitorEventRow {
  readonly eventType: OrderEventType;
  readonly receivedAt: Date;
}

/** A page of the monitor's scan: after which order, at most how many, of which status. */
export interface OrderPageQuery {
  readonly status?: OrderStatus | undefined;
  /** The page starts after this order, newest first. */
  readonly after?: string | undefined;
  readonly limit: number;
  /** One enrollment's orders alone (B42, T047; the note under T047, Q6 (a)). */
  readonly enrollmentId?: string | undefined;
}

/**
 * Up to `limit` orders, newest first, after `after`, of `status` and of `enrollmentId` when given;
 * an enrollment's orders over `payments_enrollment_id_idx`, an enrollment holding a few at most.
 */
export async function orderPage(
  tx: Pick<Transaction, 'payment'>,
  { status, after, limit, enrollmentId }: OrderPageQuery,
): Promise<MonitorOrderRow[]> {
  return tx.payment.findMany({
    where: {
      ...(status === undefined ? {} : { status }),
      ...(enrollmentId === undefined ? {} : { enrollmentId }),
      ...(after === undefined ? {} : { id: { lt: after } }),
    },
    orderBy: { id: 'desc' },
    take: limit,
    select: {
      id: true,
      enrollmentId: true,
      gatewayOrderId: true,
      gatewayTransactionId: true,
      status: true,
      grossPiasters: true,
      gatewayFeePiasters: true,
      netPiasters: true,
      teacherShareRatePercent: true,
      teacherSharePiasters: true,
      refundedPiasters: true,
      refundReportedAt: true,
      currency: true,
      createdAt: true,
      kind: true,
      instalmentMonth: true,
      automatic: true,
      declineKind: true,
    },
  });
}

/** The order of that id, or null. */
export async function monitoredOrderOf(
  tx: Pick<Transaction, 'payment'>,
  paymentId: string,
): Promise<MonitorOrderRow | null> {
  return tx.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      enrollmentId: true,
      gatewayOrderId: true,
      gatewayTransactionId: true,
      status: true,
      grossPiasters: true,
      gatewayFeePiasters: true,
      netPiasters: true,
      teacherShareRatePercent: true,
      teacherSharePiasters: true,
      refundedPiasters: true,
      refundReportedAt: true,
      currency: true,
      createdAt: true,
      kind: true,
      instalmentMonth: true,
      automatic: true,
      declineKind: true,
    },
  });
}

/** The order's signed events, oldest first, the id breaking a tie. */
export async function orderEventsOf(tx: Client, paymentId: string): Promise<MonitorEventRow[]> {
  const rows = await tx.paymentEvent.findMany({
    where: { paymentId },
    orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
    select: { eventType: true, receivedAt: true },
  });
  return rows.flatMap(({ eventType, receivedAt }) =>
    // An order's events are of its own kinds; a recipient event names no order (ERD §15.20).
    eventType === 'recipient_verified' || eventType === 'recipient_rejected'
      ? []
      : [{ eventType, receivedAt }],
  );
}

/** Every order of the enrollment the gateway reported paid, a refunded one included, oldest first. */
export async function paidOrdersOf(
  tx: Pick<Transaction, 'payment'>,
  enrollmentId: string,
): Promise<MonitorOrderRow[]> {
  return tx.payment.findMany({
    where: { enrollmentId, status: { in: ['paid', 'refunded'] } },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      enrollmentId: true,
      gatewayOrderId: true,
      gatewayTransactionId: true,
      status: true,
      grossPiasters: true,
      gatewayFeePiasters: true,
      netPiasters: true,
      teacherShareRatePercent: true,
      teacherSharePiasters: true,
      refundedPiasters: true,
      refundReportedAt: true,
      currency: true,
      createdAt: true,
      kind: true,
      instalmentMonth: true,
      automatic: true,
      declineKind: true,
    },
  });
}

/**
 * 006:T018 (admin-surface.md `programmes.get`, «its orders by kind»): every order of the enrollment,
 * oldest first, by `payments_enrollment_id_idx`: a programme's are its assessment, the rest or its
 * months, and each month's automatic attempts (at most five a month, R-508), so a few hundred at most.
 */
export async function enrollmentOrdersOf(
  tx: Pick<Transaction, 'payment'>,
  enrollmentId: string,
): Promise<MonitorOrderRow[]> {
  return tx.payment.findMany({
    where: { enrollmentId },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      enrollmentId: true,
      gatewayOrderId: true,
      gatewayTransactionId: true,
      status: true,
      grossPiasters: true,
      gatewayFeePiasters: true,
      netPiasters: true,
      teacherShareRatePercent: true,
      teacherSharePiasters: true,
      refundedPiasters: true,
      refundReportedAt: true,
      currency: true,
      createdAt: true,
      kind: true,
      instalmentMonth: true,
      automatic: true,
      declineKind: true,
    },
  });
}
