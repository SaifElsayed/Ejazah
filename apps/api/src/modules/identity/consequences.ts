// T068 (FR-142, FR-165): the one entry through which an account's end of service reaches the rest of
// the platform. A teacher's suspension, revocation and ban (and, since B16, a deletion) call
// `onAccountTerminated(tx, userId, cause)` inside their own transaction; Phase 2 and Phase 3
// subscribe their enrollment and session consequences here, so the identity module never imports
// them and the action's transaction is never changed to add one (research R-121). Since B16 the
// verification module subscribes the erasure of a deleted person's documents. One registry is built
// in `main.ts` and handed to every service that ends an account (B16 check, decision 2).
import type { Transaction } from '../../platform/db/prisma.repository.js';

/** Why the account stops being served. */
export type TerminationCause = 'suspended' | 'approval_revoked' | 'banned' | 'account_deleted';

/** One module's consequence, run on the action's transaction; a throw rolls the action back. */
export type AccountConsequence = (
  tx: Transaction,
  userId: string,
  cause: TerminationCause,
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
  ): Promise<void> {
    for (const consequence of this.#subscribers) await consequence(tx, userId, cause);
  }
}
