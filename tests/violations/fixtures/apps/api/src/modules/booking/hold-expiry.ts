// T026 fixture — VIOLATION of R-PROC-8, the marker half: a bare TODO with no ticket reference.
// The commented-out-code half is `modules/chat/attachment-filter.ts`.
// Refused by proc/no-bare-marker.

// TODO: release the hold once the order expires
export function holdsToRelease(): readonly string[] {
  return [];
}
