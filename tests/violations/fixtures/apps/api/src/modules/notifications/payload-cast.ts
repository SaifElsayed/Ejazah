// T026 fixture — VIOLATION of R-API-10, the `any` half: an escape hatch with no justification and
// no ticket. `as any` is not banned outright, only undocumented. The `@ts-ignore` half runs
// through a different mechanism and carries its own fixture, `modules/moderation/report-count.ts`.
// Refused by api/require-escape-hatch-reason.
export function toNotificationPayload(input: unknown): Record<string, unknown> {
  return input as any;
}
