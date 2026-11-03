// T033 (R-216, FR-385, data-model §2.5): booking's one writer of `enrollment_events` rows, the
// append-only record of each outcome a later notification reads. Every confirmation, failed order
// and cancellation writes its row here, in the transaction that made it: T033's releases, T038's
// failed order, T039's confirmation and refusal, T040's sweeps, T041's terminations. The table is
// append-only for the application role (ERD §15 rule 21, data-model rule 39), so nothing here
// updates or deletes a row; the kind checks are the database's (a cancellation carries its reason
// and nothing else does; a confirmation and a failed order carry their order).
//
// No lock: a row references its enrollment and, for an order's outcome, its payment; the caller
// holds the enrollment's lock, and the payment's when it names one, taken in T005's order before it
// decided on the outcome. Neither references `users`.
import type { Transaction } from '../../platform/db/prisma.repository.js';

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
    };

/** Writes one row per outcome, in one statement on the caller's transaction; none for none. */
export async function recordEnrollmentEvents(
  tx: Pick<Transaction, 'enrollmentEvent'>,
  outcomes: readonly EnrollmentOutcome[],
): Promise<void> {
  if (outcomes.length === 0) return;
  await tx.enrollmentEvent.createMany({
    data: outcomes.map((outcome) =>
      outcome.kind === 'cancelled'
        ? {
            enrollmentId: outcome.enrollmentId,
            kind: outcome.kind,
            cancellationReason: outcome.cancellationReason,
            occurredAt: outcome.occurredAt,
          }
        : {
            enrollmentId: outcome.enrollmentId,
            kind: outcome.kind,
            paymentId: outcome.paymentId,
            occurredAt: outcome.occurredAt,
          },
    ),
  });
}
