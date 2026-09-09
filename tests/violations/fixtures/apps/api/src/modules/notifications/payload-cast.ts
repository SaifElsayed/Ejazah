// T026 fixture — VIOLATION of R-API-10, the `any` half: an escape hatch with no justification
// comment and no ticket. `as any` is not banned outright — it is banned undocumented, because an
// escape hatch nobody can date or attribute is a permanent hole rather than a debt record
// (constitution, "Escape hatches").
// The `@ts-ignore` half runs through a different mechanism (contracts/lint-rules.md) and carries
// its own fixture, `modules/moderation/report-count.ts`, for the reason T024 gives for splitting
// R-TIME-1.
// Refused by api/require-escape-hatch-reason.
export function toNotificationPayload(input: unknown): Record<string, unknown> {
  return input as any;
}
