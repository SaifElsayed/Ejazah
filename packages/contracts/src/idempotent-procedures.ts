// T018: the procedures a client may retry under an idempotency key (FR-106, R-DB-7;
// specs/002-identity/contracts/kernel.md "Idempotency", app-surface.md "Idempotency").
//
// Keying is a call the handler makes, so this list is what says which procedures key: the kernel's
// idempotency service accepts a scope from this list and nothing else, and the pipeline's output
// leak test (T027) asserts over the contract snapshot that none of these carries a token in its
// output, since a stored outcome is replayed as stored. `onboarding.complete` answers tokens and is
// therefore not here: its single use is the onboarding token's own `jti` mark.
//
// Additive-only once merged (R-API-9): a procedure joins when it is written, none leaves.

/** The keyed procedures of the user surface, by path. */
export const idempotentProcedures = [
  'teacher.application.submit',
  'account.delete',
  'teacher.payout.register',
  // Phase 2 (specs/003-booking/contracts/app-surface.md "Idempotent procedures").
  'teacher.packages.create',
  'teacher.slots.create',
  'checkout.hold',
  'checkout.pay',
  'checkout.retry',
] as const;

/** A scope the idempotency service accepts: one of the keyed procedures. */
export type IdempotentProcedure = (typeof idempotentProcedures)[number];

/** Whether `scope` names a keyed procedure. */
export function isIdempotentProcedure(scope: string): scope is IdempotentProcedure {
  return (idempotentProcedures as readonly string[]).includes(scope);
}
