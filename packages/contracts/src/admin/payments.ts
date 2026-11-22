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
import { teacherSharePercent } from '../platform.js';
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
  /**
   * One enrollment's orders alone (B42, T047; the note under T047, Q6 (a)): the link from
   * `/sessions` and `/cases`, no payment id crossing to them (FR-497). Additive (R-API-9).
   */
  enrollmentId: z.uuid().optional(),
});

/** A person the monitor names: their display name alone. */
const namedPerson = z.object({ displayName: z.string() });

/**
 * 006:T003 (ADR 0024, R-502; ERD `order_kind`): what an order pays for. `package` is today's order
 * and every order's before the programme; `assessment` a programme's first; `rest_in_full` and
 * `instalment` the offer's.
 */
export const orderKind = z.enum(['package', 'assessment', 'rest_in_full', 'instalment']);

/**
 * 006:T003 (R-509; ERD `decline_kind`): why an automatic order failed. A `soft` decline is retried; a
 * `hard` one, a refusal before the gateway (`no_payee`) included, never is.
 */
export const declineKind = z.enum(['soft', 'hard']);

/**
 * 006:T003 (admin-surface.md, `payments.monitor`): what each order adds for the programme, absent
 * until T018 answers them: its kind, its month (an `instalment` only), whether it is an automatic
 * charge of a saved card, and why an automatic one failed. Additive (R-API-9).
 */
const programmeOrderTerms = {
  kind: orderKind.optional(),
  instalmentMonth: z.int().min(1).optional(),
  automatic: z.boolean().optional(),
  declineKind: declineKind.optional(),
};

/** One gateway order as the list shows it (FR-400). */
export const paymentsListItem = z.object({
  paymentId: z.uuid(),
  ...programmeOrderTerms,
  gatewayOrderId: z.string(),
  createdAt: z.iso.datetime(),
  student: namedPerson,
  gross_piasters: reportedPiasters,
  /** Absent until the gateway reports it, a paid order included (FR-PAYG-7). */
  gatewayFee_piasters: reportedPiasters.optional(),
  net_piasters: reportedPiasters.optional(),
  /** 003:T104: the rate and the teacher's share kept on the order; absent before the commission. */
  teacherShareRatePercent: teacherSharePercent.optional(),
  teacherShare_piasters: reportedPiasters.optional(),
  /** 003:T102 (DEC-82): the order's refunded total, 0 until a refund is recorded. Additive (R-API-9). */
  refunded_piasters: reportedPiasters,
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
export const paymentEventType = z.enum([
  'paid',
  'failed',
  'expired',
  'refunded',
  // 003:T102 (Q-2 (a)'s safety net, DEC-82): a refund flagged on the original payment, no amount.
  'refund_reported',
  // 006:T003 (R-510; ERD changelog row 65): the gateway's token callback for a card the student
  // consented to save; added, additively (R-API-9). No card detail crosses with it.
  'card_saved',
]);

/**
 * ERD `enrollment_event_kind`: an outcome booking recorded for the enrollment (R-216); Phase 3's
 * `completed`, `terminated_no_show` and `restored` added by B42's T047 (the follow-up under T047;
 * additive, R-API-9); `slot_released` and `slot_hold_ended` by B42a's T069 (Q-69-1 (a), additive).
 */
export const enrollmentOutcomeKind = z.enum([
  'confirmed',
  'order_failed',
  'cancelled',
  'completed',
  'terminated_no_show',
  'restored',
  'slot_released',
  'slot_hold_ended',
  // 006:T003 (ADR 0024; ERD changelog row 65): a programme's offer sent, its pause, its resumption
  // by a paid month, and an administrator's reopen; added, additively (R-API-9).
  'programme_offered',
  'programme_paused',
  'programme_resumed',
  'programme_reopened',
]);

/**
 * Why a hold was released (ERD `hold_release_reason`; T001 of specs/004-sessions, data-model §2.12).
 */
export const holdReleaseReason = z.enum([
  'converted',
  'expired',
  'checkout_abandoned',
  'slot_unavailable',
  'admin',
  'teacher_suspended',
  'account_deleted',
]);

/**
 * One hold of the enrollment (T024 of specs/004-sessions; research R-323 GAP-8): placed, expiring,
 * and, once released, when and why. `releaseReason` is absent for a hold released before the reason
 * was recorded, which the panel reads «not recorded».
 */
export const paymentEnrollmentHold = z.object({
  holdId: z.uuid(),
  placedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  releasedAt: z.iso.datetime().optional(),
  releaseReason: holdReleaseReason.optional(),
});

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
  /** The enrollment's holds, oldest first (T024 of specs/004-sessions, GAP-8; additive, R-API-9). */
  holds: z.array(paymentEnrollmentHold),
});

/** One order of the enrollment the gateway reported paid (the note under T052, T082). */
export const paymentEnrollmentOrder = z.object({
  paymentId: z.uuid(),
  /** 006:T003: as on the list. */
  ...programmeOrderTerms,
  gatewayOrderId: z.string(),
  status: paymentStatus,
  createdAt: z.iso.datetime(),
});

export const paymentsGetOutput = z.object({
  paymentId: z.uuid(),
  /** 006:T003: as on the list. */
  ...programmeOrderTerms,
  gatewayOrderId: z.string(),
  gatewayTransactionId: z.string().optional(),
  status: paymentStatus,
  createdAt: z.iso.datetime(),
  gross_piasters: reportedPiasters,
  gatewayFee_piasters: reportedPiasters.optional(),
  net_piasters: reportedPiasters.optional(),
  /** 003:T104: as on the list. */
  teacherShareRatePercent: teacherSharePercent.optional(),
  teacherShare_piasters: reportedPiasters.optional(),
  /** 003:T102 (DEC-82): as on the list. */
  refunded_piasters: reportedPiasters,
  /**
   * 003:T102 (Q-2 (a)'s safety net): when the gateway first flagged a refund on the original
   * payment, which reports no amount; absent while it has not. Additive (R-API-9).
   */
  refundReportedAt: z.iso.datetime().optional(),
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
export type HoldReleaseReason = z.infer<typeof holdReleaseReason>;
export type PaymentEnrollmentHold = z.infer<typeof paymentEnrollmentHold>;

// ---------------------------------------------------------------------------------------------
// 003:T110 (ADR 0025 D4, SRS DEC-85, DEC-86, FR-DISPUTE-6; the note under T110, Q-5 (a)):
// `payments.caseAmount`, what a compensation case that closes an enrollment shows, computed in
// `packages/money` from the enrollment's orders and sessions. An administrator decides the case and
// executes the amount by hand in the gateway's dashboard (DEC-82); no procedure moves money.
// Additive (R-API-9).

export const paymentsCaseAmountInput = z.object({ caseId: z.uuid() });

/** An amount the case shows, in whole piasters. */
const casePiasters = z.int().nonnegative();

/** A close that refunds sessions: the refund to the student and the release to the teacher. */
const sessionsRefund = {
  /** Refunded to the student: the sessions not taken. */
  refund_piasters: casePiasters,
  /** Released to the teacher (T105): the share of the sessions taken. */
  release_piasters: casePiasters,
  refunded_piasters: casePiasters,
};

/**
 * The amount by its cause. `refunded_piasters` is the refunds already recorded on the orders the
 * amount is computed from (T102), shown beside it and never taken off it (Q-C1 (a)).
 */
export const paymentsCaseAmount = z.discriminatedUnion('cause', [
  /**
   * A teacher's dropout on the ijazah track: the whole of every order, in three parts: the share
   * the gateway still holds and the platform's own part (both refunded through the gateway), and
   * the share already released (paid outside the code path).
   */
  z.object({
    cause: z.literal('ijazah_dropout'),
    total_piasters: casePiasters,
    held_piasters: casePiasters,
    platformPart_piasters: casePiasters,
    released_piasters: casePiasters,
    refunded_piasters: casePiasters,
  }),
  /** A teacher's dropout on recitation. */
  z.object({ cause: z.literal('recitation_dropout'), ...sessionsRefund }),
  /** A close on a complaint against the student. */
  z.object({ cause: z.literal('student_complaint_close'), ...sessionsRefund }),
  /**
   * 003:T124 (SRS DEC-91, FR-ADMIN-5, FR-AUTH-11; ADR 0018 D5; Q-7 (a), Q-7a (a), Q-7b (a)): a close
   * on the student's ban or a suspended student's confirmed fault, which earns no automatic refund.
   * Added, additively (R-API-9). What is not refunded stays where the gateway holds it, and no
   * further share is released; a refund the administrator decides is executed by hand in the
   * gateway's dashboard (DEC-82).
   */
  z.object({
    cause: z.literal('student_fault_close'),
    /**
     * A refund due: the sessions owed before the close (a teacher's absence, both parties' absence,
     * a cancellation by agreement or a postponement, not taken through a make-up), on both closes
     * (Q-7b (a)).
     */
    owed_piasters: casePiasters,
    /** The rest not taken: the administrator's decision in the case, with no refund shown for it. */
    decision_piasters: casePiasters,
    /** Released to the teacher (T105), as a complaint close: the share of the sessions taken. */
    release_piasters: casePiasters,
    refunded_piasters: casePiasters,
  }),
]);

/** Absent `amount`: the case's reason is not one that closes with an amount (Q-5 (a)). */
export const paymentsCaseAmountOutput = z.object({ amount: paymentsCaseAmount.optional() });

export type PaymentsCaseAmountInput = z.infer<typeof paymentsCaseAmountInput>;
export type PaymentsCaseAmount = z.infer<typeof paymentsCaseAmount>;
export type PaymentsCaseAmountOutput = z.infer<typeof paymentsCaseAmountOutput>;

// 006:T003: the programme's order terms.
export type OrderKind = z.infer<typeof orderKind>;
export type DeclineKind = z.infer<typeof declineKind>;
