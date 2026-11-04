// T052: the administrator surface's `payments` namespace, the read-only monitor of every gateway
// order (specs/003-booking/contracts/admin-surface.md; FR-400 to FR-402, FR-PAYG-7, FR-PAYG-11,
// FR-ADMIN-18, research R-220).
//
// Two reads and nothing else (FR-401): `payments.list`, newest first, keyset pages of
// `admin_list_page_size`, filtered by status and searched by an order reference (exactly) or a
// student's name (by its folded prefix, R-203); `payments.get`, one order with its amounts, its
// gateway references, its enrollment's package and progress, and its events.
//
// THE AMOUNTS are what the gateway reported (R-MONEY-5): gross, fee and net, the panel formatting
// them with two decimals and never computing one from another. Fee and net are absent until the
// gateway reports them (FR-PAYG-7), which a paid order's gateway may never do, and the panel shows
// a dash for an absent one, whatever the status. This file and the panel's `pages/payments/` are
// the only places outside the payments module and the payment port where the gateway's amount
// names may be written (`paymentFolders`, the owner's decision of 2026-11-04).
// Money crosses as `_piasters` integers (R-MONEY-1).
import { z } from 'zod';

import { enrollmentCancellationReason, enrollmentStatus, paymentStatus } from '../checkout.js';
import { enrollmentTerms } from '../enrollments.js';
import { adminSearch } from './admins.js';

/** An amount the gateway reported, in whole piasters (ERD `payments`). */
const reportedPiasters = z.int().nonnegative();

/** A page of the list starts after this order; orders are listed by their time-ordered id. */
export const paymentsListCursor = z.uuid();

export const paymentsListInput = z.object({
  status: paymentStatus.optional(),
  /** An order reference, matched exactly, or the start of a student's name, folded (R-203). */
  search: adminSearch.optional(),
  cursor: paymentsListCursor.optional(),
});

/** A person the monitor names: their display name alone. */
const namedPerson = z.object({ displayName: z.string() });

/** One gateway order as the list shows it (FR-400). */
export const paymentsListItem = z.object({
  paymentId: z.uuid(),
  gatewayOrderId: z.string(),
  createdAt: z.iso.datetime(),
  student: namedPerson,
  gross_piasters: reportedPiasters,
  /** Absent until the gateway reports it, a paid order included (FR-PAYG-7). */
  gatewayFee_piasters: reportedPiasters.optional(),
  net_piasters: reportedPiasters.optional(),
  status: paymentStatus,
  /** The order is paid and its enrollment was cancelled (a `slot_unavailable` refusal, FR-PAYG-19). */
  enrollmentCancelled: z.boolean(),
});

export const paymentsListOutput = z.object({
  items: z.array(paymentsListItem),
  /** Present while more orders follow the page. */
  nextCursor: paymentsListCursor.optional(),
});

export const paymentsGetInput = z.object({ paymentId: z.uuid() });

/** ERD `payment_event_type`, of a gateway order: its signed events. */
export const paymentEventType = z.enum(['paid', 'failed', 'expired', 'refunded']);

/** ERD `enrollment_event_kind`: an outcome booking recorded for the enrollment (R-216). */
export const enrollmentOutcomeKind = z.enum(['confirmed', 'order_failed', 'cancelled']);

/** The order's enrollment: its package, its status and its progress (FR-400). */
export const paymentEnrollment = z.object({
  enrollmentId: z.uuid(),
  summary: enrollmentTerms,
  teacher: namedPerson,
  status: enrollmentStatus,
  cancellationReason: enrollmentCancellationReason.optional(),
  /** Sessions consumed, derived from the sessions (FR-392). */
  completed: z.int().nonnegative(),
  /** The package's session count. */
  total: z.int().min(1),
});

/** One order of the enrollment the gateway reported paid (the note under T052, T082). */
export const paymentEnrollmentOrder = z.object({
  paymentId: z.uuid(),
  gatewayOrderId: z.string(),
  status: paymentStatus,
  createdAt: z.iso.datetime(),
});

export const paymentsGetOutput = z.object({
  paymentId: z.uuid(),
  gatewayOrderId: z.string(),
  gatewayTransactionId: z.string().optional(),
  status: paymentStatus,
  createdAt: z.iso.datetime(),
  gross_piasters: reportedPiasters,
  gatewayFee_piasters: reportedPiasters.optional(),
  net_piasters: reportedPiasters.optional(),
  currency: z.string().length(3),
  student: namedPerson,
  /** Absent only for an enrollment no ordinary read returns (a soft-deleted one, ERD §0). */
  enrollment: paymentEnrollment.optional(),
  /** The order's signed events, as received, oldest first. */
  events: z.array(z.object({ eventType: paymentEventType, receivedAt: z.iso.datetime() })),
  /**
   * The enrollment's outcomes that concern this order, oldest first: its confirmation or its
   * failure by this order, and every cancellation of the enrollment.
   */
  outcomes: z.array(
    z.object({
      kind: enrollmentOutcomeKind,
      cancellationReason: enrollmentCancellationReason.optional(),
      occurredAt: z.iso.datetime(),
    }),
  ),
  /**
   * Every order of the enrollment the gateway reported paid, this one included, oldest first: a
   * compensation case covers each of them, and nothing records which order a case is for
   * (the note under T052, the owner's decision of 2026-11-03).
   */
  paidOrders: z.array(paymentEnrollmentOrder),
});

export type PaymentsListInput = z.infer<typeof paymentsListInput>;
export type PaymentsListItem = z.infer<typeof paymentsListItem>;
export type PaymentsListOutput = z.infer<typeof paymentsListOutput>;
export type PaymentsGetInput = z.infer<typeof paymentsGetInput>;
export type PaymentsGetOutput = z.infer<typeof paymentsGetOutput>;
export type PaymentEnrollment = z.infer<typeof paymentEnrollment>;
export type PaymentEventType = z.infer<typeof paymentEventType>;
export type EnrollmentOutcomeKind = z.infer<typeof enrollmentOutcomeKind>;
