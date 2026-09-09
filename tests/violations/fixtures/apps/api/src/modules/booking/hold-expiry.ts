// T026 fixture — VIOLATION of R-PROC-8, the marker half: a bare TODO with no ticket reference.
// A marker nobody can resolve to a tracked piece of work is not a plan; it is a note that
// outlives the person who wrote it.
// The commented-out-code half is a different thing to detect and carries its own fixture,
// `modules/chat/attachment-filter.ts`, for the reason T024 gives for splitting R-TIME-1.
// Refused by proc/no-bare-marker.

// TODO: release the hold once the order expires
export function holdsToRelease(): readonly string[] {
  return [];
}
