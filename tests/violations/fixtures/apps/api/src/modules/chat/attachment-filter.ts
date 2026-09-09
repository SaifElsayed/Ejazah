// T026 fixture — VIOLATION of R-PROC-8, the commented-out-code half: a block of dead code left
// behind comment markers. The bare-marker half is `modules/booking/hold-expiry.ts`, so no marker
// word appears here.
// Refused by proc/no-bare-marker.
export function allowedAttachmentExtensions(): readonly string[] {
  return ['pdf', 'txt'];
}

// export function allowedAttachmentExtensionsWithImages(): readonly string[] {
//   return ['pdf', 'txt', 'png', 'jpg'];
// }
