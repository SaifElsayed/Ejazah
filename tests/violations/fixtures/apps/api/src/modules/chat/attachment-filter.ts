// T026 fixture — VIOLATION of R-PROC-8, the commented-out-code half: a block of code left in the
// file behind comment markers. Version control already holds the previous version; a commented
// block only tells a later reader that somebody was unsure, and never which way it was resolved.
// Paired with `modules/booking/hold-expiry.ts`, which carries the bare-marker half. No TODO,
// FIXME or other marker word appears here, so each fixture proves its own half.
// Refused by proc/no-bare-marker.
export function allowedAttachmentExtensions(): readonly string[] {
  return ['pdf', 'txt'];
}

// export function allowedAttachmentExtensionsWithImages(): readonly string[] {
//   return ['pdf', 'txt', 'png', 'jpg'];
// }
