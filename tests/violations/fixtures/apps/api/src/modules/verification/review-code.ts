// T026 fixture — VIOLATION of R-PROC-7: a lint suppression with no justification and no ticket.
// The suppression is the violation, not the line under it. It is a real directive on purpose, so
// once T040 lands `db/no-weak-random` is genuinely silenced and R-PROC-7 is the only prohibition
// left to report; until then the harness prints a severity-1 `Unused eslint-disable directive`
// beside this fixture, which is not a failure.
// Refused by proc/require-suppression-reason.
export function reviewCode(): string {
  // eslint-disable-next-line ijazah/db/no-weak-random
  return Math.random().toString(36).slice(2);
}
