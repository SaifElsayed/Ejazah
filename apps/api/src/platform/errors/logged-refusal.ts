// T062's one-place refusal log (the note under T062 in specs/004-sessions/tasks.md) and PR #130's
// review, round 1, Minor 4 (the owner's decision of 2026-11-10, Q6): a refused call is logged once.
// `onError` (`app.module.ts`) writes one info line for every expected refusal, except one already
// logged where it was refused, with its reason: the kinds' input guard (an unreadable input, T108)
// and a module's own refusal (a session read or join, an outage record, and every refusal a module
// throws through its own logged `refusal(...)`). Whoever logs a refusal marks the error it throws
// here, and `onError` asks whether the call's error, or the error tRPC wrapped, carries the mark.
//
// The mark is held weakly, keyed by the error object, so it lives no longer than the error does.

/** The refusals already logged where they were thrown. */
const loggedRefusals = new WeakSet<object>();

/**
 * Marks `error` as already logged, with its reason, by whoever throws it, and answers it, so a
 * refusal is written `throw markRefusalLogged(new DomainError(…))` after its one log line.
 */
export function markRefusalLogged<TError extends object>(error: TError): TError {
  loggedRefusals.add(error);
  return error;
}

/** Whether `error` carries the mark «logged» (`markRefusalLogged`). */
export function isRefusalLogged(error: unknown): boolean {
  return typeof error === 'object' && error !== null && loggedRefusals.has(error);
}
