// T039 (R-215, FR-361, FR-362, FR-375, FR-PAYG-19, ADR 0010 D5): what the `confirm-enrollment` job
// asks of booking, each on the job's transaction. Booking owns `enrollments`, `slot_holds` and
// `enrollment_events` and is their only writer (R-208): the job decides which branch a paid order
// takes, and booking writes it.
//
// THE LOCKS (T005's rules, `platform/db/row-lock.ts`; the notes under T039). `lockForConfirmation`
// takes every lock the job's transaction needs, before anything is decided, in the one order: both
// accounts in one `lockRows(tx, 'users', …)` call, the slot, the active holds on the slot and of the
// student (the enrollment's own among them), the enrollments of those holds with this one in one
// call, then, through payments' `orders` handed in by the caller, those enrollments' orders in one
// call. Each table's rows in id order. The parties and the slot are read first with no lock, an
// enrollment's parties and slot never changing; what is decided on (the holds, the enrollment's
// state, its confirming order, and, by the caller, the order's status and the compensation cases)
// is read again under the locks. So what FR-PAYG-19's re-hold and the release then lock again
// (`reholdEnrollment`, `releaseHolds`) is already held: no hold can be added on the slot or for the
// student meanwhile, its insert referencing the locked slot and account, nor an order on a locked
// enrollment.
//
// CONFIRMING (`confirmEnrollment`, the only writer of `confirmed_at`, R-HONEST-1). The enrollment's
// hold is converted by a conditional update (`released_at IS NULL`), and only if one was converted
// is the enrollment confirmed, from `pending_payment` or `cancelled`, its reason back to NULL, with
// one `enrollment_events(confirmed)` row naming the order. No hold to convert answers so, and
// nothing is written: the caller takes the late branch (ADR 0010 D5's "decided by writing").
//
// REFUSING (`refuseEnrollment`, FR-362). The enrollment's active hold, if any, is released through
// the one release (`releaseHolds` under `slot_unavailable`, which cancels even an enrollment with a
// paid order, FR-363). An enrollment the release did not cancel is cancelled here: with
// `slot_unavailable` (the database refused it, or it was still awaiting payment), or, refused for a
// party (`party_restricted`) while already cancelled, with the reason it has (FR-362: "stays
// cancelled with its reason"). Either way one `enrollment_events(cancelled)` row records the
// refused paid event (FR-385). The compensation case is the caller's, through moderation's entry.
//
// THE PUSHES (005:T016 of specs/005-certification; the note under T016, Q-N1 (a)). Each outcome's
// record hands its push to the notice port the job passes (`payment-outcome-notices.port.ts`), on
// the job's transaction: `confirmed` → `payment_confirmed`. The push's row references the student, whose `users` row the job holds
// `FOR UPDATE` (`lockForConfirmation`, first). A refusal's own `cancelled` record pushes nothing
// (Q-A1 (b), the owner's answer of 2026-11-18), even with the reason `payment_expired` it keeps;
// its release, under `slot_unavailable`, pushes nothing either.
import type { Transaction } from '../../platform/db/prisma.repository.js';
import {
  type EnrollmentParties,
  type EnrollmentState,
  activeHoldIdsAround,
  confirmingOrderOf,
  convertHoldOf,
  enrollmentStateOf,
  markConfirmed,
  markRefused,
  partiesOf,
} from './confirmation.repository.js';
import {
  type EnrollmentCancellationReason,
  recordEnrollmentEvents,
} from './enrollment-events.repository.js';
import { activeHoldsByIds, activeHoldsOf, lockRows } from './holds.repository.js';
import { type OrderStandings, releaseHolds } from './holds.service.js';
import type { PaymentOutcomeNotices } from './payment-outcome-notices.port.js';

export type { EnrollmentParties };

/** The reasons R-219's terminations cancel an enrollment with (FR-PAYG-6 as amended 2026-11-01). */
const TERMINATION_REASONS: ReadonlySet<EnrollmentCancellationReason> = new Set([
  'admin',
  'teacher_suspended',
  'account_deleted',
  // 005:T014 of B47 (the owner's Q-G2 (c)): a gender correction cancels a pending enrollment with
  // its own reason, so a paid event landing after it takes branch 4's `party_restricted` case.
  'gender_correction',
]);

/** The states an enrollment reaches only by a confirmation. */
const CONFIRMED_STATES: ReadonlySet<EnrollmentState['status']> = new Set([
  'confirmed',
  'completed',
  'terminated_no_show',
]);

/** The enrollment as the confirm job decides on it, read under `lockForConfirmation`'s locks. */
export interface LockedEnrollment extends EnrollmentParties, EnrollmentState {
  /** The enrollment's active hold, or null when it has none (a late payment). */
  readonly activeHoldId: string | null;
  /** The order its `confirmed` event names, or null when it has none (FR-375). */
  readonly confirmingPaymentId: string | null;
  /** Confirmed once: `confirmed`, `completed` or `terminated_no_show`. */
  readonly confirmed: boolean;
  /** Cancelled by a party's suspension, ban, revocation or deletion (R-219, FR-362). */
  readonly cancelledByTermination: boolean;
}

/** The enrollment's parties and slot, read with no lock (the notes under T039). */
export function confirmationPartiesOf(
  tx: Transaction,
  enrollmentId: string,
): Promise<EnrollmentParties | null> {
  return partiesOf(tx, enrollmentId);
}

function sortedUnique(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

/**
 * Takes the confirm job's locks in T005's order (this file's head) and reads the enrollment under
 * them. The caller holds no lock; `orders` is payments' `orderStandingsOf`, which locks the
 * enrollments' orders after them.
 */
export async function lockForConfirmation(
  tx: Transaction,
  parties: EnrollmentParties,
  dependencies: { readonly orders: OrderStandings },
): Promise<LockedEnrollment> {
  // 005:T016 (the follow-up under T016, fixed in B48): with the students of the slot's and the
  // student's active holds, read with no lock, so the re-hold's release of another student's expired
  // hold records that student's push holding the account already (kernel.md, «a push recorded by a
  // producer»).
  const around = await activeHoldsOf(tx, {
    slotId: parties.slotId,
    studentUserId: parties.studentUserId,
  });
  await lockRows(
    tx,
    'users',
    sortedUnique([
      parties.studentUserId,
      parties.teacherUserId,
      ...around.map(({ studentUserId }) => studentUserId),
    ]),
  );
  await lockRows(tx, 'availability_slots', [parties.slotId]);
  const holdIds = await activeHoldIdsAround(tx, parties);
  if (holdIds.length > 0) await lockRows(tx, 'slot_holds', holdIds);
  const held = await activeHoldsByIds(tx, holdIds);
  const enrollmentIds = sortedUnique([
    parties.id,
    ...held.flatMap(({ enrollmentId }) => (enrollmentId === null ? [] : [enrollmentId])),
  ]);
  await lockRows(tx, 'enrollments', enrollmentIds);
  await dependencies.orders(tx, enrollmentIds);
  const [state, confirmingPaymentId] = await Promise.all([
    enrollmentStateOf(tx, parties.id),
    confirmingOrderOf(tx, parties.id),
  ]);
  return {
    ...parties,
    ...state,
    activeHoldId: held.find(({ enrollmentId }) => enrollmentId === parties.id)?.id ?? null,
    confirmingPaymentId,
    confirmed: CONFIRMED_STATES.has(state.status),
    cancelledByTermination:
      state.status === 'cancelled' &&
      state.cancellationReason !== null &&
      TERMINATION_REASONS.has(state.cancellationReason),
  };
}

/** Which order confirms which enrollment, and when. */
export interface Confirmation {
  readonly enrollmentId: string;
  readonly paymentId: string;
  readonly at: Date;
}

/**
 * Converts the enrollment's active hold and confirms it with one `confirmed` row naming the order
 * (FR-361, R-HONEST-1); `'no_active_hold'`, writing nothing, when it has no hold to convert. The
 * caller holds `lockForConfirmation`'s locks. 005:T016: `payment_confirmed` through `notices`.
 */
export async function confirmEnrollment(
  tx: Transaction,
  { enrollmentId, paymentId, at }: Confirmation,
  notices: PaymentOutcomeNotices,
): Promise<'confirmed' | 'no_active_hold'> {
  if (!(await convertHoldOf(tx, enrollmentId, at))) return 'no_active_hold';
  if (!(await markConfirmed(tx, enrollmentId, at))) {
    throw new Error(`Enrollment ${enrollmentId} is neither awaiting payment nor cancelled`);
  }
  await recordEnrollmentEvents(
    tx,
    [{ kind: 'confirmed', enrollmentId, paymentId, occurredAt: at }],
    notices,
  );
  return 'confirmed';
}

/** Why a paid event is refused (FR-362): the database refused it, or a party may not book. */
export type Refusal = 'slot_unavailable' | 'party_restricted';

/** The reason a refused enrollment is cancelled with (this file's head). */
function refusedReason(
  enrollment: LockedEnrollment,
  refusal: Refusal,
): EnrollmentCancellationReason {
  if (refusal === 'party_restricted' && enrollment.status === 'cancelled') {
    return enrollment.cancellationReason ?? 'slot_unavailable';
  }
  return 'slot_unavailable';
}

/**
 * Refuses the enrollment's paid event (FR-362): its active hold released, the enrollment cancelled
 * and one `cancelled` row, as this file's head says. The caller holds `lockForConfirmation`'s
 * locks, taken in this transaction, and opens the compensation case.
 */
export async function refuseEnrollment(
  tx: Transaction,
  enrollment: LockedEnrollment,
  refusal: Refusal,
  dependencies: {
    readonly at: Date;
    readonly orders: OrderStandings;
    /** 005:T016: handed to the release; a refusal itself pushes nothing (Q-A1 (b)). */
    readonly notices: PaymentOutcomeNotices;
  },
): Promise<EnrollmentCancellationReason> {
  if (enrollment.activeHoldId !== null) {
    const { cancelled } = await releaseHolds(
      tx,
      [enrollment.activeHoldId],
      'slot_unavailable',
      dependencies,
    );
    const own = cancelled.find(({ enrollmentId }) => enrollmentId === enrollment.id);
    if (own !== undefined) return own.reason;
  }
  const reason = refusedReason(enrollment, refusal);
  if (!(await markRefused(tx, enrollment.id, reason))) {
    throw new Error(`Enrollment ${enrollment.id} is neither awaiting payment nor cancelled`);
  }
  await recordEnrollmentEvents(
    tx,
    [
      {
        kind: 'cancelled',
        enrollmentId: enrollment.id,
        cancellationReason: reason,
        occurredAt: dependencies.at,
      },
    ],
    // Q-A1 (b), the owner's answer of 2026-11-18: the refused paid event's record pushes nothing,
    // so an enrollment already cancelled for an expired payment is not told so twice.
    'without_push',
  );
  return reason;
}
