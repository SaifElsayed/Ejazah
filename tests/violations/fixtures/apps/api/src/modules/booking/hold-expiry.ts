// T026 fixture — VIOLATION of R-PROC-8, the marker half: a marker comment carrying no ticket
// reference. The trigger word appears only on the violating line below, never in this header, so
// the rule cannot prove itself on its own explanation. The commented-out-code half is
// `modules/chat/attachment-filter.ts`.
// Refused by proc/no-bare-marker.

// TODO: release the hold once the order expires
export function holdsToRelease(): readonly string[] {
  return [];
}
