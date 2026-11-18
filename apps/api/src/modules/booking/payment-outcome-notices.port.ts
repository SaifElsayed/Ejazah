// 005:T016 of specs/005-certification (FR-619; SRS DEC-70; the note under T016, Q-N1 (a), Q-N2 (a),
// Q-N3 (a)): the payment pushes, produced where booking's one writer records each outcome
// (`recordEnrollmentEvents`, FR-385), on that record's own transaction.
//
// THE PORT. Booking names what it hands on and imports no `notifications`: `main.ts` and
// `worker.ts` bind `PaymentOutcomeNotices` to the notifications module's `NotificationWriter`. Each
// caller that can write a payment outcome hands it in, down to the writer.
//
// WHICH OUTCOME IS PUSHED (Q-N2 (a)): `confirmed` → `payment_confirmed`; `order_failed` →
// `payment_failed` (the student may still Retry on the hold); `cancelled` with `payment_expired` →
// `payment_expired`; `cancelled` with `payment_failed` → none, its order's failure having been
// pushed already; every other outcome, `slot_unavailable` included (not among DEC-70's kinds), →
// none. To the enrollment's student, with the enrollment's id only (R-HONEST-5). An order that fails
// and is then paid gets one push per outcome; a replayed event or a second run records no second
// outcome, so no second push.
//
// THE TRANSACTION'S OWN LIST (Q-N3 (a)). The writer queues its push on the transaction's
// after-commit list and refuses a transaction no list is bound to. A payment transaction has no
// request's list, so `withOutcomeNotices` gives it one: bound to the transaction while it runs,
// unbound when it ends, its work run once the transaction has committed and dropped when it rolls
// back or throws. The confirm job opens one per attempt, so a `'confirm'` attempt the database
// refuses drops its push, and the `'refuse'` attempt that follows has a list of its own.
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { bindToTransaction, RequestLive, unboundBus } from '../../platform/live/live-publisher.js';
import type { EnrollmentOutcome } from './enrollment-events.repository.js';

/** The payment kinds of v1.0 (FR-619; DEC-70), all members of `notification_type`. */
export type PaymentNoticeKind = 'payment_confirmed' | 'payment_failed' | 'payment_expired';

/** One push: the enrollment's student, its kind, the enrollment's id. */
export interface PaymentNotice {
  readonly userId: string;
  readonly type: PaymentNoticeKind;
  readonly payload: { readonly enrollmentId: string };
}

/** Where a payment outcome's push is recorded, on the record's transaction (bound by `main.ts`). */
export interface PaymentOutcomeNotices {
  record(tx: Transaction, notice: PaymentNotice): Promise<unknown>;
}

/** The push an outcome gives, or null (Q-N2 (a), this file's head). */
export function paymentNoticeOf(outcome: EnrollmentOutcome): PaymentNoticeKind | null {
  switch (outcome.kind) {
    case 'confirmed':
      return 'payment_confirmed';
    case 'order_failed':
      return 'payment_failed';
    case 'cancelled':
      return outcome.cancellationReason === 'payment_expired' ? 'payment_expired' : null;
    default:
      return null;
  }
}

/**
 * No event is ever added to this list, only the writer's work, whose failure the writer logs
 * itself (`enqueue_failed`); a publish that cannot happen has nothing to log.
 */
const NOTHING_PUBLISHED = { warn: () => undefined };

/**
 * Runs `work` on the transaction `open` opens, with an after-commit list of its own bound to it
 * (this file's head); answers the work's answer.
 */
export async function withOutcomeNotices<T>(
  open: (work: (tx: Transaction) => Promise<T>) => Promise<T>,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const list = new RequestLive(unboundBus, NOTHING_PUBLISHED);
  let answer: T;
  try {
    answer = await open(async (tx) => {
      const unbind = bindToTransaction(tx, list);
      try {
        return await work(tx);
      } finally {
        unbind();
      }
    });
  } catch (error: unknown) {
    list.drop();
    throw error;
  }
  list.flush();
  return answer;
}
