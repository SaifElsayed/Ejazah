// T031: the `checkout` namespace of the user surface (specs/003-booking/contracts/app-surface.md
// "`checkout` — payments"; FR-351 to FR-358, FR-380 to FR-386, FR-BOOK-12).
//
// `hold` places the slot hold, `pay` writes the enrollment and hands over the gateway's hosted
// checkout, `retry` creates a new order on the same hold; the three are keyed and return the first
// outcome on a repeat (FR-357), so each carries the kernel's idempotency key and is listed in
// `idempotent-procedures.ts`. `current` is what `CheckoutPrevious` shows, `continue` reopens the
// payable order's page (FR-BOOK-12 (c)), `status` is the enrollment as the server holds it: the phone
// renders success only from `confirmed` there (FR-380, R-HONEST-1). Every input names what is asked
// for and never who asks (R-GENDER-4). Money crosses as `_piasters` integers (R-MONEY-1); instants as
// UTC, a session with its local date, local start and zone beside them (R-TIME-6). The hosted
// checkout's address leaves the server only on `pay`, `retry` and `continue` (data-model §2.4.1).
import { z } from 'zod';

import { sessionPreview } from './booking.js';
import { subjectSummary } from './catalog.js';
import { idempotencyKey } from './idempotency-key.js';
import { calendarDate, timeZone } from './onboarding.js';
import {
  MAX_SESSION_COUNT,
  packagePricePiasters,
  packageTrack,
  sessionLengthMinutes,
} from './packages.js';
import { slotStartTimeLocal } from './slots.js';

/** ERD `enrollment_status`; `confirmed` is written only by `confirm-enrollment` (FR-366). */
export const enrollmentStatus = z.enum([
  'pending_payment',
  'confirmed',
  'completed',
  'terminated_no_show',
  'cancelled',
]);

/** ERD `cancellation_reason`: why an enrollment was cancelled (FR-363, SRS FR-PAYG-6). */
export const enrollmentCancellationReason = z.enum([
  'payment_expired',
  'payment_failed',
  'admin',
  'gender_correction',
  'teacher_suspended',
  'slot_unavailable',
  'checkout_abandoned',
  'account_deleted',
]);

/** ERD `payment_status`: a gateway order's status, moved only by its signed events (FR-365). */
export const paymentStatus = z.enum(['created', 'paid', 'failed', 'expired', 'refunded']);

/**
 * The gateway's hosted checkout: a web address the phone opens in the browser, never a scheme the
 * phone would run (`javascript:`, `file:`, the app's own). The stand-in serves it on the API's
 * origin, plain HTTP in development (contracts/gateway.md).
 */
export const checkoutUrl = z.url({ protocol: /^https?$/ });

/**
 * The one payment summary (FR-358): the teacher, then the package as subject, sessions and minutes
 * with its track, then the price. On `hold` and `current` the package's; on `status` the
 * enrollment's snapshot (FR-354).
 */
export const checkoutSummary = z.object({
  teacher: z.object({ teacherId: z.uuid(), displayName: z.string() }),
  subject: subjectSummary,
  track: packageTrack,
  sessionCount: z.int().min(1).max(MAX_SESSION_COUNT),
  sessionDurationMinutes: sessionLengthMinutes,
  price_piasters: packagePricePiasters,
});

/** One session of an enrollment, as every output carries it (FR-393, R-TIME-6). */
export const enrollmentSession = z.object({
  sequenceNumber: z.int().positive(),
  localDate: calendarDate,
  startTimeLocal: slotStartTimeLocal,
  timezone: timeZone,
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
});

export const checkoutHoldInput = z.object({
  packageId: z.uuid(),
  slotId: z.uuid(),
  idempotencyKey,
});

/**
 * Pay is accepted before this instant and refused from it (`HOLD_EXPIRED`): the hold's expiry minus
 * the grace, which is also the expiry of the order Pay creates (FR-355, FR-PAYG-6). The checkout's
 * countdown runs to it (FR-358). B30, additive (R-API-9).
 */
const checkoutPayBy = z.iso.datetime();

/** The hold, until when it lasts, and what the checkout screen shows (FR-358, FR-386). */
export const checkoutHoldOutput = z.object({
  holdId: z.uuid(),
  expiresAt: z.iso.datetime(),
  payBy: checkoutPayBy,
  summary: checkoutSummary,
  firstSession: sessionPreview,
  lastSession: sessionPreview,
});

/**
 * What the student saw on the summary when they pressed Pay (the owner's decisions of 2026-11-03):
 * the price, the session count, the length and the track, under the summary's own names. A package
 * that no longer matches refuses `SUMMARY_CHANGED` before any order, with nothing written.
 */
export const checkoutQuotedSummary = z.object({
  price_piasters: packagePricePiasters,
  sessionCount: z.int().min(1).max(MAX_SESSION_COUNT),
  sessionDurationMinutes: sessionLengthMinutes,
  track: packageTrack,
});

/** Pay on the hold, with the summary the student saw. */
export const checkoutPayInput = z.object({
  holdId: z.uuid(),
  quoted: checkoutQuotedSummary,
  idempotencyKey,
});

/** The hosted checkout handed over, and the order's expiry the countdown runs to (FR-358). */
export const checkoutHandover = z.object({
  checkoutUrl,
  orderExpiresAt: z.iso.datetime(),
});

export const checkoutPayOutput = checkoutHandover.extend({ enrollmentId: z.uuid() });

export const checkoutRetryInput = z.object({ enrollmentId: z.uuid(), idempotencyKey });

export const checkoutRetryOutput = checkoutHandover;

/**
 * The student's unexpired hold, if any: what `Checkout` and `CheckoutPrevious` show (FR-BOOK-12,
 * FR-358). `firstSession` and `lastSession` are the sessions the student would get if confirmed at
 * the read's instant, by FR-368's rule, as `booking.slots` previews them (FR-386; T085, additive).
 */
export const checkoutCurrentHold = z.object({
  holdId: z.uuid(),
  expiresAt: z.iso.datetime(),
  payBy: checkoutPayBy,
  /** Absent before Pay. */
  enrollmentId: z.uuid().optional(),
  summary: checkoutSummary,
  firstSession: sessionPreview,
  lastSession: sessionPreview,
  /** The enrollment's last order; `canContinue` while it is still payable. */
  lastOrder: z
    .object({ status: paymentStatus, expiresAt: z.iso.datetime(), canContinue: z.boolean() })
    .optional(),
});

/** `checkout.current`'s answer; an empty object when the student holds nothing. */
export const checkoutCurrentOutput = z.object({ hold: checkoutCurrentHold.optional() });

export const checkoutContinueInput = z.object({ enrollmentId: z.uuid() });

export const checkoutContinueOutput = checkoutHandover;

export const checkoutStatusInput = z.object({ enrollmentId: z.uuid() });

/**
 * The enrollment as the server holds it (FR-380 to FR-386): its status and reason, its last order
 * with the reference FR-384's message gives, its snapshot, its sessions once generated, and the
 * first session's quoted and actual local dates when they differ (FR-386). The order carries no
 * amount: the gateway's gross, fee and net stay in `modules/payments` (R-MONEY-6, ADR 0007), and
 * the price the student was charged is the snapshot's, `summary.price_piasters` (ERD `payments`).
 */
export const checkoutStatusOutput = z.object({
  status: enrollmentStatus,
  cancellationReason: enrollmentCancellationReason.optional(),
  lastOrder: z.object({
    status: paymentStatus,
    reference: z.string().min(1),
  }),
  summary: checkoutSummary,
  sessions: z.array(enrollmentSession).optional(),
  firstSessionMoved: z.object({ quoted: calendarDate, actual: calendarDate }).optional(),
});

export type EnrollmentStatus = z.infer<typeof enrollmentStatus>;
export type EnrollmentCancellationReason = z.infer<typeof enrollmentCancellationReason>;
export type PaymentStatus = z.infer<typeof paymentStatus>;
export type CheckoutSummary = z.infer<typeof checkoutSummary>;
export type EnrollmentSession = z.infer<typeof enrollmentSession>;
export type CheckoutHoldInput = z.infer<typeof checkoutHoldInput>;
export type CheckoutHoldOutput = z.infer<typeof checkoutHoldOutput>;
export type CheckoutQuotedSummary = z.infer<typeof checkoutQuotedSummary>;
export type CheckoutPayInput = z.infer<typeof checkoutPayInput>;
export type CheckoutHandover = z.infer<typeof checkoutHandover>;
export type CheckoutPayOutput = z.infer<typeof checkoutPayOutput>;
export type CheckoutRetryInput = z.infer<typeof checkoutRetryInput>;
export type CheckoutRetryOutput = z.infer<typeof checkoutRetryOutput>;
export type CheckoutCurrentHold = z.infer<typeof checkoutCurrentHold>;
export type CheckoutCurrentOutput = z.infer<typeof checkoutCurrentOutput>;
export type CheckoutContinueInput = z.infer<typeof checkoutContinueInput>;
export type CheckoutContinueOutput = z.infer<typeof checkoutContinueOutput>;
export type CheckoutStatusInput = z.infer<typeof checkoutStatusInput>;
export type CheckoutStatusOutput = z.infer<typeof checkoutStatusOutput>;
