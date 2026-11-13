// T068 (FR-142, FR-165): the one entry through which an account's end of service reaches the rest of
// the platform. A teacher's suspension, revocation and ban (and, since B16, a deletion) call
// `onAccountTerminated(tx, userId, cause)` inside their own transaction; Phase 2 and Phase 3
// subscribe their enrollment and session consequences here, so the identity module never imports
// them and the action's transaction is never changed to add one (research R-121). Since B16 the
// verification module subscribes the erasure of a deleted person's documents. One registry is built
// in `main.ts` and handed to every service that ends an account (B16 check, decision 2).
//
// T071 of specs/004-sessions (the first note under T071, Q5.2 (a)): the administrator who ended the
// account reaches every consequence as an optional fourth argument, `actor`, which `StandingService`'s
// `#end` passes; a self-deletion passes none. Booking's subscriber writes it as the closing
// administrator of a paused enrollment's `teacher_suspended` case (rule 46); the others ignore it.
import type { Transaction } from '../../platform/db/prisma.repository.js';

/** Why the account stops being served. */
export type TerminationCause = 'suspended' | 'approval_revoked' | 'banned' | 'account_deleted';

/** The administrator who ended the account (T071, Q5.2 (a)); absent for the person's own deletion. */
export interface TerminationActor {
  readonly adminId: string;
}

/** One module's consequence, run on the action's transaction; a throw rolls the action back. */
export type AccountConsequence = (
  tx: Transaction,
  userId: string,
  cause: TerminationCause,
  actor?: TerminationActor,
) => Promise<void>;

export class AccountConsequences {
  readonly #subscribers: AccountConsequence[] = [];

  /** Adds a consequence; subscribers run in the order they subscribed. */
  subscribe(consequence: AccountConsequence): void {
    this.#subscribers.push(consequence);
  }

  async onAccountTerminated(
    tx: Transaction,
    userId: string,
    cause: TerminationCause,
    actor?: TerminationActor,
  ): Promise<void> {
    for (const consequence of this.#subscribers) {
      // T071: the actor passed on only when there is one, so a subscriber sees the call as it was.
      await (actor === undefined
        ? consequence(tx, userId, cause)
        : consequence(tx, userId, cause, actor));
    }
  }
}
