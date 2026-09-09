// T022 fixture — VIOLATION of R-MOBILE-9: a date formatted for display by hand, outside the
// locale-aware formatters in `lib/`. The instant arrives already resolved, so nothing here
// constructs or resolves a datetime and R-TIME-1 has nothing to say (R-MOBILE-9 owns display).
// Refused by mobile/no-manual-format.
export function sessionDateLabel(scheduledStartAt: Date): string {
  return scheduledStartAt.toLocaleDateString('ar-EG');
}
