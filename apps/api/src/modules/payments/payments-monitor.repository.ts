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
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { OrderEventType, OrderStatus } from './payments.repository.js';

type Client = Pick<Transaction, 'payment' | 'paymentEvent'>;

/** One gateway order as the monitor reads it: the amounts as the gateway reported them. */
export interface MonitorOrderRow {
  readonly id: string;
  readonly enrollmentId: string;
  readonly gatewayOrderId: string;
  readonly gatewayTransactionId: string | null;
  readonly status: OrderStatus;
  readonly grossPiasters: bigint;
  readonly gatewayFeePiasters: bigint | null;
  readonly netPiasters: bigint | null;
  readonly currency: string;
  readonly createdAt: Date;
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
}

/** Up to `limit` orders, newest first, after `after`, of `status` when one is given. */
export function orderPage(
  tx: Pick<Transaction, 'payment'>,
  { status, after, limit }: OrderPageQuery,
): Promise<MonitorOrderRow[]> {
  return tx.payment.findMany({
    where: {
      ...(status === undefined ? {} : { status }),
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
      currency: true,
      createdAt: true,
    },
  });
}

/** The order of that id, or null. */
export function monitoredOrderOf(
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
      currency: true,
      createdAt: true,
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
export function paidOrdersOf(
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
      currency: true,
      createdAt: true,
    },
  });
}
