// T024 fixture — VIOLATION of R-TIME-1: a session datetime constructed and resolved outside
// `packages/time`, by `Date` arithmetic. This is the bug that ships silently and detonates at
// the DST boundary — adding a week of milliseconds moves the wall-clock time by an hour across
// a transition, which is why R-TIME-2 requires each occurrence to be resolved independently.
// Refused by time/no-datetime-outside-package.
export function nextOccurrence(previousStartAt: Date): Date {
  return new Date(previousStartAt.getTime() + 7 * 24 * 60 * 60 * 1000);
}
