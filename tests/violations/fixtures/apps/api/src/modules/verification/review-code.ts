// T026 fixture — VIOLATION of R-PROC-7: a lint suppression with no justification and no ticket.
// The suppression is the violation, not the line under it. It is a real, used directive on
// purpose: once T040 lands, `db/no-weak-random` is genuinely silenced here and R-PROC-7 is the
// one prohibition left to report, so the fixture keeps the tree's one-rule promise in its end
// state rather than leaving a dangling directive behind.
// Until T040 lands, the harness prints `Unused eslint-disable directive` beside this fixture.
// That is the placeholder rule reporting nothing yet, a warning rather than an error, and it
// disappears the moment `db/no-weak-random` starts refusing the line below.
// R-PROC-7 and R-API-10 are separate prohibitions with separate rules (contracts/lint-rules.md),
// so no `any` and no `@ts-ignore` appears here.
// Refused by proc/require-suppression-reason.
export function reviewCode(): string {
  // eslint-disable-next-line ijazah/db/no-weak-random
  return Math.random().toString(36).slice(2);
}
