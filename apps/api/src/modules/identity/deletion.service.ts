// T082 (FR-140 to FR-143, ADR 0015 D1 to D4): the deletion of an account, in the app and on the
// web. B16's step zero fixes the shapes the router, the web pages and the phone build against;
// lane A of B16 builds the bodies from T080's specs.
//
// - `deleteAccount` is `account.delete`: the typed word, a fresh proof that is the caller's own (a
//   provider token whose subject is one of the caller's `auth_identities`, or the password against
//   the caller's own hash), keyed through the kernel's idempotency (FR-106).
// - `requestWebCode` and `confirmWebDeletion` are the web pages' two steps (public-pages.md): the
//   first answers the same for every address and writes an `account_deletion` code only for an
//   account; the second runs the same deletion as `account.delete` when the code is right.
// - The deletion is one transaction (ADR 0015 D3) that calls the consequences registry with
//   `account_deleted`. Stored files are removed after the commit, and a key is cleared only once its
//   file is gone; a failed removal is retried by a job (B16 check, decision 1). The Apple revoke and
//   the confirmation mail run after the commit, outside the transaction (decisions 3 and 5).
import type { DeleteAccountInput } from '@ijazah/contracts';

import type { AccountConsequences } from './consequences.js';
import type { IdentityDependencies } from './session.service.js';

/** What the deletion is built over, beside the module's own dependencies; lane A adds the rest. */
export interface DeletionDependencies extends IdentityDependencies {
  readonly consequences: AccountConsequences;
}

export class DeletionService {
  constructor(_dependencies: DeletionDependencies) {}

  /** `account.delete`: the caller's own account, erased. */
  deleteAccount(_userId: string, _input: DeleteAccountInput): Promise<void> {
    return Promise.reject(new Error('T082: the deletion is built by lane A of B16.'));
  }

  /** The web's email step: the same answer and work for every address (public-pages.md). */
  requestWebCode(_email: string): Promise<void> {
    return Promise.reject(new Error('T082: the deletion is built by lane A of B16.'));
  }

  /** The web's confirm step: true when the code was right and the account is deleted. */
  confirmWebDeletion(_email: string, _code: string): Promise<boolean> {
    return Promise.reject(new Error('T082: the deletion is built by lane A of B16.'));
  }
}
