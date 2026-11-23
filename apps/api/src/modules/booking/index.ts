// PUBLIC ENTRY of the booking module (T017). Other modules import this file and nothing below it (R-API-3).
import type { Database } from '../../platform/db/prisma.repository.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type { CatalogUse } from '../catalog/index.js';
// T070 of specs/004-sessions: the window settings a closing's hold reads.
import { windowDaysOf } from '../sessions/index.js';
import { packageEnrollmentCounts, packageHasEnrollment } from './catalog-use.repository.js';
import {
  type DiscoveryCatalog,
  DiscoveryService,
  type DiscoveryServices,
} from './discovery.service.js';
import { createNearestSlots } from './nearest-slot.service.js';
import {
  SLOT_RELEASE_BUFFER_SETTING,
  slotInUse,
  slotReleaseBufferWeeks,
} from './slot-occupancy.service.js';
// 005:T011: the `Pairings` port's enrollment reads (at the end of this file).
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { PairingParty } from '../moderation/index.js';
import { enrollmentTermsById } from './enrollment-side.repository.js';
// 005:T013: `paired`'s one read on the pair (T011's follow-up).
import { pairedEnrollmentExists } from './enrollment-side.repository.js';

/**
 * What catalog's `CatalogUse` port asks of booking (T020, R-207), on the caller's transaction:
 * whether a slot is in use and whether a package has an enrollment. `slotInUse` takes R-205's
 * release since T026: the clock, and the buffer when a confirmed enrollment needs it.
 */
export { packageHasEnrollment } from './catalog-use.repository.js';
export { type SlotRelease, slotInUse } from './slot-occupancy.service.js';
/** Each of a teacher's packages' enrollments, for catalog's list (T018). */
export { packageEnrollmentCounts } from './catalog-use.repository.js';
/** The `order_failed` outcome the payments module's order branch appends (T038, R-214). */
export { recordOrderFailed } from './order-failed.repository.js';

/**
 * Catalog's `CatalogUse` port over booking's answers (T020, T026), bound once by `main.ts`: a slot's
 * release reads the clock, and `slot_release_buffer_weeks` when it needs it.
 */
export function createCatalogUse({
  settings,
  now = () => new Date(),
}: {
  readonly settings: SettingsReader;
  readonly now?: () => Date;
}): CatalogUse {
  const release = {
    now,
    bufferWeeks: () => settings.read(SLOT_RELEASE_BUFFER_SETTING, slotReleaseBufferWeeks),
    // T070 of specs/004-sessions: a closing's hold keeps the slot in use; its window read when needed.
    windowDays: windowDaysOf(settings),
  };
  return {
    slotInUse: (tx, slotId) => slotInUse(tx, slotId, release),
    packageHasEnrollment,
    packageEnrollmentCounts,
  };
}

/**
 * Booking's reads for discovery (T026, R-205): the nearest free slot of each teacher of a page, on
 * the caller's transaction, exported for the probe of its queries
 * (`tests/db-integrity/discovery-slots.spec.ts`).
 */
export { type NearestSlot, nearestFreeSlots } from './nearest-slot.service.js';

/** The `booking` namespace, mounted by `app.router.ts` (T032). */
export { bookingRouter } from './booking.router.js';
/**
 * `booking.slots`' services over the process's client (T032), and its read on the caller's
 * transaction over the owners' entries, exported for the probe of its queries
 * (`tests/db-integrity/booking-slots.spec.ts`).
 */
export {
  type BookingServices,
  type BookingStudent,
  bookingSlotsOf,
  bookingSlotsStore,
  createBookingServices,
} from './booking-slots.service.js';

/**
 * The lists (T049, FR-390 to FR-393, FR-395): the `enrollments` namespace and the teacher's
 * `teacher.students` and `teacher.today`, mounted by `app.router.ts`; their services are part of
 * `BookingServices`. The reads on the caller's transaction over the owners' entries, exported for
 * the probe of their queries (`tests/db-integrity/enrollment-lists.spec.ts`).
 */
export { enrollmentsRouter } from './enrollments.router.js';
export { teacherStudentsRouter, teacherTodayProcedure } from './teacher-students.router.js';
export {
  type EnrollmentListServices,
  type EnrollmentListsStore,
  enrollmentListsStore,
  studentEnrollmentOf,
  studentEnrollmentsOf,
  teacherStudentOf,
  teacherStudentsOf,
  teacherTodayOf,
} from './enrollment-lists.service.js';

/** The `discovery` namespace, mounted by `app.router.ts` (T026). */
export { discoveryRouter } from './discovery.router.js';
export type {
  CatalogDiscoveryCard,
  CatalogDiscoveryPage,
  DiscoveryCatalog,
  DiscoveryServices,
} from './discovery.service.js';

/**
 * The `discovery` procedures' services (T026): catalog's discovery service through the seam, and
 * booking's nearest slots over the process's client.
 */
export function createDiscoveryServices({
  catalog,
  database,
  settings,
  now,
}: {
  readonly catalog: DiscoveryCatalog;
  readonly database: Database;
  readonly settings: SettingsReader;
  readonly now?: () => Date;
}): DiscoveryServices {
  return new DiscoveryService({
    catalog,
    nearest: createNearestSlots({ database, settings, ...(now === undefined ? {} : { now }) }),
  });
}

/**
 * Holds (T033, FR-351 to FR-353, FR-363, FR-PAYG-19, R-208), each on the caller's transaction:
 * placing one (`checkout.hold`, T036), releasing holds with their reason (FR-BOOK-12's new checkout,
 * T036; the sweeps, T040; the terminations, T041), releasing a slot's and a student's expired holds,
 * and FR-PAYG-19's re-hold of a paid enrollment (T039). The orders' standing is payments'
 * `orderStandingsOf`, handed in by the caller (R-208). `readHoldTerms` reads the hold's settings
 * before the caller's transaction; `payByOf` is the instant Pay stops being accepted (B30, FR-355,
 * FR-358); `holdsStore` is the placement's store over the owners' entries,
 * exported for the probes (`tests/db-integrity/hold-concurrency.spec.ts`).
 */
export {
  type EnrollmentToHold,
  type HeldRow,
  type HoldRequest,
  type HoldScope,
  type HoldsStore,
  holdsStore,
  type HoldStudent,
  type HoldTerms,
  type OrderStanding,
  type OrderStandings,
  payByOf,
  type PlacedHold,
  placeHold,
  readHoldTerms,
  type ReleasedHolds,
  type ReleaseReason,
  releaseExpiredHolds,
  releaseHolds,
  reholdEnrollment,
} from './holds.service.js';
/**
 * Booking's one writer of `enrollment_events` rows (T033, R-216, FR-385), on the caller's transaction
 * holding the enrollment's lock (and the payment's when the row names one).
 */
export {
  type EnrollmentCancellationReason,
  type EnrollmentOutcome,
  recordEnrollmentEvents,
} from './enrollment-events.repository.js';
/**
 * T008 of specs/004-sessions (R-301, R-322, R-323 GAP-1, U3): sessions' `EnrollmentSide` port over
 * booking's rows, each function on the caller's transaction, each status move with its
 * `enrollment_events` row; bound once by `main.ts` and `worker.ts`.
 */
export { createEnrollmentSide } from './enrollment-side.service.js';
/**
 * The confirm job's booking (T039, R-215, FR-361, FR-362, FR-375, FR-PAYG-19), each on the job's
 * transaction: an enrollment's parties read with no lock; every lock the confirmation takes, in
 * T005's order, and the enrollment read under them; `confirmEnrollment`, the only writer of
 * `confirmed_at` (R-HONEST-1); and the refusal of a paid event.
 */
export {
  type Confirmation,
  confirmationPartiesOf,
  confirmEnrollment,
  type EnrollmentParties,
  type LockedEnrollment,
  lockForConfirmation,
  type Refusal,
  refuseEnrollment,
} from './confirmation.service.js';
/**
 * The expiry sweeps' reads (T040, FR-364), on the caller's transaction and with no lock, the release
 * locking what it decides on: a page of the expired active holds with no enrollment (`expire-holds`)
 * and with one (`expire-pending-payments`); and, of some enrollments, those `confirm-enrollment` may
 * still take (awaiting payment or cancelled), for the sweep's hand-off of a paid order.
 */
export {
  awaitingConfirmationAmong,
  expiredCheckoutHoldIds,
  expiredEnrollmentHoldIds,
} from './hold-expiry.repository.js';
/**
 * What `payments`' checkout asks of booking (T036, FR-BOOK-12, FR-356, R-208), each on the caller's
 * transaction: a new checkout's hold with FR-BOOK-12's release of the student's own (its payable
 * order thrown as `PayableCheckout` for the caller to cancel outside any transaction), and a Retry's
 * enrollment and hold, read first and then locked in T005's order. T175: `checkoutTeacherName`, the
 * teacher's name through the visibility predicate, read again by `checkout.hold`'s replay.
 */
export {
  type CheckoutEnrollmentRow,
  type CheckoutHold,
  type CheckoutHoldDependencies,
  type CheckoutHoldStore,
  checkoutHoldStore,
  checkoutTeacherName,
  type HeldOrders,
  type HeldOrdersOf,
  lockOrderTarget,
  type OrderTargetStore,
  orderTargetStore,
  PayableCheckout,
  type PayableOrder,
  placeCheckoutHold,
  previousCheckout,
  type RetryTarget,
  retryTargetOf,
  summaryOf,
} from './checkout-holds.service.js';
/**
 * `checkout.current`'s and `checkout.status`'s reads (T037, FR-358, FR-380 to FR-386), each on the
 * caller's transaction: the student's own unexpired hold with its package's summary now, and the
 * student's own enrollment as the server holds it.
 */
export {
  type CheckoutReadsStore,
  checkoutReadsStore,
  type CurrentHold,
  currentHoldOf,
  type EnrollmentStatusAnswer,
  enrollmentStatusOf,
} from './checkout-reads.service.js';
/** The student's own enrollment of that id, or null (T037, M3), on the caller's transaction. */
export { studentEnrollment as studentCheckoutEnrollment } from './checkout-holds.repository.js';
/**
 * `checkout.pay`'s part (T036, FR-354, FR-386, R-209; the owner's decisions of 2026-11-03): the
 * checks before the gateway, and the transaction that writes the enrollment with the id the caller
 * drew and links the hold, each on the caller's transaction; `summaryChanges` is
 * `SUMMARY_CHANGED`'s comparison. The hold's package is its `slot_holds.package_id`, the count its
 * overlap check ran on its `session_count`.
 */
export {
  type Enrolment,
  enrollOnHold,
  type HeldTerms,
  type PayStore,
  payStoreOver,
  type PayOrderTerms,
  type PayTarget,
  payTargetOf,
  payTermsOf,
  type QuotedSummary,
  summaryChanges,
} from './pay.service.js';
/**
 * Booking's consequence of an account's end (T041, R-219, FR-PAYG-6), subscribed to identity's
 * `AccountConsequences` by `main.ts` with payments' `orderStandingsOf`: the holds on an ended
 * teacher's slots and an ended student's own hold released, their enrollments awaiting payment
 * cancelled with one `enrollment_events` row each, on the termination's transaction after its
 * account lock.
 */
export {
  type ActiveHoldScope,
  type ConfirmedEnrollment,
  type TerminationDependencies,
  type TerminationStore,
  terminationStore,
  terminationSubscriber,
} from './termination.subscriber.js';
/**
 * T004 of specs/004-sessions (FR-487, R-327): of some people, those a party of an enrollment with an
 * open matter, whose files a deletion and `erase-deleted-files` leave in place; no lock. Bound by
 * `main.ts` to identity's `FileHold` port and by `worker.ts` to the job's `held`.
 */
export { heldFileOwnersAmong } from './held-files.service.js';
/**
 * T080 of specs/004-sessions (FR-511; SRS FR-AUTH-14 as amended, DEC-67; the note under T080,
 * Q-R11 (a), N4): whether an account has an ongoing enrollment, on the deletion's transaction after
 * the account's lock. Bound by `main.ts` to identity's `OngoingEnrollments` port, as `FileHold` is.
 */
export {
  createOngoingEnrollments,
  hasOngoingEnrollment,
  type OngoingEnrollmentsCount,
} from './ongoing-enrollments.repository.js';
/**
 * T034 of specs/004-sessions (kernel.md's `party_*` row; the owner's decision of 2026-11-11 on
 * lane A's questions, item 3): the account's active holds, the ones this subscriber releases,
 * locked in one call, and the enrollments they were placed for; a dispute's `party_*` ruling takes
 * them after the slots' keys and before the enrollments.
 */
export { type LockedHolds, lockActiveHoldsOf } from './termination.subscriber.js';
/**
 * Each enrollment's session length (T048, ADR 0009 D2), for the time zone re-resolution job, on the
 * caller's transaction and with no lock.
 */
export { sessionLengthsOf } from './session-lengths.repository.js';
/**
 * The admin's payments monitor's reads (T052, FR-400, R-220), on the caller's transaction with no
 * lock: a page of orders' enrollments, each one's student and status, and one enrollment's package,
 * status, progress and outcomes. `payments` reads them here and never reads `enrollments` itself.
 */
export {
  type MonitoredEnrollment,
  monitoredEnrollmentOf,
  type OrderEnrollmentParty,
  orderEnrollmentPartiesAmong,
} from './order-enrollments.service.js';
// 003:T105 (Q-B1-6 (a), the owner's answer of 2026-11-18): the same read of some enrollments in one
// statement (their parties, status, track and count), for payments' releases of the teacher's share.
export { enrollmentsAmong, type OrderEnrollmentRow } from './order-enrollments.repository.js';
/**
 * T070 of specs/004-sessions (FR-503; SRS FR-CANCEL-9, DEC-69; contracts/admin-surface.md,
 * `enrollments.releaseSlot`): the administrator surface's `enrollments` namespace, mounted by
 * `admin.router.ts` (the integration's line, N9), and the release it calls on the administrator call's
 * transaction, composed by the admin module.
 */
export { enrollmentsAdminRouter } from './enrollments-admin.router.js';
export {
  createHeldSlotRelease,
  type HeldSlotRelease,
  type SlotReleaseDependencies,
} from './slot-release.service.js';
/**
 * T074 of specs/004-sessions (FR-505; DEC-69; the note under T074, Q-R1 (a), N1, N2, Q-R4 (a)): the
 * hourly sweep that records, once, the end of each held closing's hold (one `enrollment_events` row
 * `slot_hold_ended`), each enrollment on its own transaction under its lock; built and scheduled by
 * `jobs/close-slot-holds.ts`.
 */
export {
  createSlotHoldEndSweep,
  type SlotHoldEndDependencies,
  type SlotHoldEndRun,
  type SlotHoldEndStore,
  slotHoldEndStore,
  type SlotHoldEndSweep,
} from './slot-hold-end.sweep.js';

// ---------------------------------------------------------------------------------------------
// 005:T006 (FR-603, FR-608; the note under T006, Q1 (a), Q4 (a), Q-A3 (a)): the enrollment an
// ijazah request is sent from, read by certification on its transaction (its parties, snapshot
// subject and track, status; no lock of its own), and the port `EnrollmentIjazahRequests` the
// enrollment reads' `ijazahRequest` comes through, which `main.ts` binds to certification's entry
// and hands to `createBookingServices` (booking imports no certification).
export { type IjazahEnrollmentRow, ijazahEnrollmentOf } from './ijazah-enrollment.repository.js';
export type { EnrollmentIjazahRequests } from './enrollment-lists.service.js';

// ---------------------------------------------------------------------------------------------
// 005:T011 (FR-611, FR-614; research R-408; the note under T011): moderation's
// `Pairings.partyOfEnrollment` and `Pairings.paired`, bound by `main.ts`, each on the caller's
// transaction with no lock (an enrollment's parties never change); a soft-deleted enrollment is
// absent from both reads (the client's extension, T148). The parties are compared, never their
// genders (Q-R5 (a)).

/** The enrollment and the other party when `userId` is one of its two; else null, as an unknown id. */
export async function partyOfEnrollment(
  tx: Transaction,
  enrollmentId: string,
  userId: string,
): Promise<PairingParty | null> {
  const terms = await enrollmentTermsById(tx, enrollmentId);
  if (terms === null) return null;
  if (terms.studentUserId === userId) {
    return { enrollmentId: terms.id, counterpartUserId: terms.teacherUserId };
  }
  if (terms.teacherUserId === userId) {
    return { enrollmentId: terms.id, counterpartUserId: terms.studentUserId };
  }
  return null;
}

/**
 * Whether an enrollment of any status joins the two people, either as the student (ADR 0006).
 * 005:T013 settles T011's follow-up: one read of at most one row on the pair
 * (`pairedEnrollmentExists`), no longer every enrollment of `userId`.
 */
export function paired(tx: Transaction, userId: string, otherUserId: string): Promise<boolean> {
  return pairedEnrollmentExists(tx, userId, otherUserId);
}

// 005:T031 of specs/005-certification (FR-630; R-414; the note under T031, Q-D1 (a)): what an
// administrator's deletion of a teacher reads of booking, on the deletion's transaction after the
// account's lock: `live` is `createOngoingEnrollments`' second method (above), and the teacher's
// enrollment ids, which `main.ts` composes with moderation's `openCompensationCasesAmong` into
// identity's `OpenCases` port.
export { enrollmentIdsOfTeacher, hasLiveEnrollment } from './ongoing-enrollments.repository.js';

// ---------------------------------------------------------------------------------------------
// 005:T013 (FR-615; research R-409; contracts/admin-surface.md, `genderFlags.get`): a person's
// `confirmed` enrollments, as student or teacher, in id order, with no lock (a soft-deleted one
// left out), for the admin module's preview of what a gender correction would end.
export { confirmedEnrollmentsOf } from './termination.repository.js';

// ---------------------------------------------------------------------------------------------
// 005:T016 of specs/005-certification (FR-619; SRS DEC-70; the note under T016, Q-N1 (a) to Q-N3
// (a)): the payment pushes. `PaymentOutcomeNotices` is the port booking's one writer of
// `enrollment_events` rows hands each payment outcome to, on its transaction; `main.ts` and
// `worker.ts` bind it to the notifications module's `NotificationWriter`. `withOutcomeNotices` runs
// a payment transaction with an after-commit list of its own bound to it, so the writer queues the
// push once that transaction has committed.
export {
  type PaymentNotice,
  type PaymentNoticeKind,
  type PaymentOutcomeNotices,
  withOutcomeNotices,
} from './payment-outcome-notices.port.js';
// 005:T016 (the follow-up under T016, fixed in B48): the students a payment path pushes, key-shared
// first by a path that holds no lock yet (payments' order events, the sweeps).
export { keyShareStudentsOfEnrollments } from './enrollment-events.repository.js';
export { keyShareStudentsOfHolds } from './holds.repository.js';

// ---------------------------------------------------------------------------------------------
// 006:T005 of specs/006-programme (FR-701, R-504; U-1, N-12): the programme's side of a booking. A
// reader that answers the programme closed, for a caller with no settings bound; the confirmed
// assessment's programme row, written `awaiting_offer` by the confirm step on its transaction; and
// the student's active programmes' weekly times in a window, which `EnrollmentSide` answers to
// sessions.
export {
  closedProgramme,
  type ProgrammeReader,
  programmeTimesOf,
  startProgramme,
} from './programmes.service.js';

// 006:T007 of specs/006-programme (FR-705; R-505, R-506; K-5): the `programme` namespace's services
// (`programme.offer`, part of `BookingServices`), built over the kernel's idempotency, the settings
// and payments' `programmeOfferAmountsOf`, which `main.ts` hands in (booking imports nothing of
// payments, R-208); its router, mounted by `app.router.ts`. `offerWindowOf` is the offer's
// deadline from session 1's outcome, T008's seam.
export { programmesRouter } from './programmes.router.js';
export {
  createProgrammeServices,
  offerWindowOf,
  type ProgrammeServiceDependencies,
  type ProgrammeServices,
} from './programmes.service.js';

// ---------------------------------------------------------------------------------------------
// 006:T008 of specs/006-programme (FR-706, FR-706a, FR-706b, FR-709; R-505, R-508, R-510, R-513;
// B-P2's conflict check, Q-2 (a), Q-3 (a) amended, Q-7 (a)): the windows as pure functions and their
// step for T015's sweep (`advance-programmes` runs `createProgrammeWindows`' step under each
// programme's row lock); the administrators' `programmes.decide` (`programmes-admin.router.ts`,
// mounted under `programmes` by `admin.router.ts`), over the services `main.ts` builds; and the close
// hook's payments' entry, which the composition root hands in (booking imports no payments, R-208).
export {
  type NoOfferFacts,
  noOfferStep,
  offerDueOf,
  payByPassed,
  type PayStep,
  type PayWindowFacts,
  payWindowStep,
} from './programmes.rules.js';
export {
  createProgrammeWindows,
  type ProgrammeWindowDependencies,
  type ProgrammeWindows,
  type WindowStepOutcome,
} from './programmes.service.js';
export {
  createProgrammeDecisions,
  type ProgrammeDecision,
  type ProgrammeDecisionDependencies,
  type ProgrammeDecisions,
} from './programme-requests.service.js';
export { type DeleteProgrammeCard } from './programme-close.service.js';
export { programmesAdminRouter } from './programmes-admin.router.js';
