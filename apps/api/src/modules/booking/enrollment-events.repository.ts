// T033 (R-216, FR-385, data-model §2.5): booking's one writer of `enrollment_events` rows, the
// append-only record of each outcome a later notification reads. Every confirmation, failed order
// and cancellation writes its row here, in the transaction that made it: T033's releases, T038's
// failed order, T039's confirmation and refusal, T040's sweeps, T041's terminations, and Phase 3's
// moves through sessions' `EnrollmentSide` (T008 of specs/004-sessions: `completed`,
// `terminated_no_show`, `cancelled` with `admin`, `restored`, which carry neither an order nor a
// reason, as rule 39's two checks require, `20261101120000_booking_pass`). The table is
// append-only for the application role (ERD §15 rule 21, data-model rule 39), so nothing here
// updates or deletes a row; the kind checks are the database's (a cancellation carries its reason
// and nothing else does; a confirmation and a failed order carry their order).
//
// No lock: a row references its enrollment and, for an order's outcome, its payment; the caller
// holds the enrollment's lock, and the payment's when it names one, taken in T005's order before it
// decided on the outcome. Neither references `users`.
//
// THE PAYMENT PUSHES (005:T016 of specs/005-certification; the note under T016, Q-N1 (a)). After
// the rows, each payment outcome is handed to the notice port the caller passes
// (`payment-outcome-notices.port.ts`), on the same transaction, for its enrollment's student, read
// here in one statement: the push's row is written with its record or not at all. A payment outcome
// with no port is refused before anything is written, so no caller loses a push silently; every
// other outcome needs none. The push's row references the student's `users` row: which lock the
// caller holds on it is kernel.md's row «a payment outcome's push» (005:T016).
import type { Transaction } from '../../platform/db/prisma.repository.js';
import {
  type PaymentNoticeKind,
  paymentNoticeOf,
  type PaymentOutcomeNotices,
} from './payment-outcome-notices.port.js';

/** `cancellation_reason`, as an `enrollment_events` row and an enrollment carry it (ADR 0010 D7). */
export type EnrollmentCancellationReason =
  | 'payment_expired'
  | 'payment_failed'
  | 'admin'
  | 'gender_correction'
  | 'teacher_suspended'
  | 'slot_unavailable'
  | 'checkout_abandoned'
  | 'account_deleted';

/** One outcome as its row records it; `occurredAt` is the instant of the transaction that made it. */
export type EnrollmentOutcome =
  | {
      readonly kind: 'confirmed' | 'order_failed';
      readonly enrollmentId: string;
      readonly paymentId: string;
      readonly occurredAt: Date;
    }
  | {
      readonly kind: 'cancelled';
      readonly enrollmentId: string;
      readonly cancellationReason: EnrollmentCancellationReason;
      readonly occurredAt: Date;
    }
  | {
      readonly kind: 'completed' | 'terminated_no_show' | 'restored';
      readonly enrollmentId: string;
      readonly occurredAt: Date;
    }
  | {
      // T069's two kinds (Q-69-2 (b)): a held slot's release (T070) and a hold's end (T074).
      readonly kind: 'slot_released' | 'slot_hold_ended';
      readonly enrollmentId: string;
      readonly occurredAt: Date;
    };

/** One outcome's row: its order on an order's outcome, its reason on a cancellation, else neither. */
function rowOf(outcome: EnrollmentOutcome) {
  const { enrollmentId, kind, occurredAt } = outcome;
  switch (outcome.kind) {
    case 'cancelled':
      return { enrollmentId, kind, cancellationReason: outcome.cancellationReason, occurredAt };
    case 'confirmed':
    case 'order_failed':
      return { enrollmentId, kind, paymentId: outcome.paymentId, occurredAt };
    default:
      return { enrollmentId, kind, occurredAt };
  }
}

/** The pushes `outcomes` give, each with its enrollment (005:T016). */
function noticesOf(
  outcomes: readonly EnrollmentOutcome[],
): { readonly enrollmentId: string; readonly type: PaymentNoticeKind }[] {
  return outcomes.flatMap((outcome) => {
    const type = paymentNoticeOf(outcome);
    return type === null ? [] : [{ enrollmentId: outcome.enrollmentId, type }];
  });
}

/** The students of `enrollmentIds`, in one statement on the caller's transaction. */
async function studentsOf(
  tx: Pick<Transaction, 'enrollment'>,
  enrollmentIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const rows = await tx.enrollment.findMany({
    where: { id: { in: [...new Set(enrollmentIds)] } },
    select: { id: true, studentUserId: true },
  });
  return new Map(rows.map(({ id, studentUserId }) => [id, studentUserId]));
}

/**
 * Writes one row per outcome, in one statement on the caller's transaction; none for none. Then
 * 005:T016: each payment outcome's push through `notices`, on the same transaction (this file's
 * head); a payment outcome with no `notices` is refused before anything is written.
 */
export async function recordEnrollmentEvents(
  tx: Transaction,
  outcomes: readonly EnrollmentOutcome[],
  notices?: PaymentOutcomeNotices,
): Promise<void> {
  if (outcomes.length === 0) return;
  const due = noticesOf(outcomes);
  if (due.length > 0 && notices === undefined) {
    throw new Error(
      'booking: a payment outcome is recorded with the notice port its push is written through (005:T016).',
    );
  }
  await tx.enrollmentEvent.createMany({ data: outcomes.map(rowOf) });
  if (due.length === 0 || notices === undefined) return;
  const students = await studentsOf(
    tx,
    due.map(({ enrollmentId }) => enrollmentId),
  );
  // One after another: the statements share the transaction's one connection.
  for (const { enrollmentId, type } of due) {
    const userId = students.get(enrollmentId);
    if (userId === undefined) throw new Error(`booking: no enrollment ${enrollmentId} to tell`);
    await notices.record(tx, { userId, type, payload: { enrollmentId } });
  }
}
