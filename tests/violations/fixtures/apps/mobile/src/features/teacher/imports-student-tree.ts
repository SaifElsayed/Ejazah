// T020 fixture — VIOLATION of R-MOBILE-1 in the other direction: the teacher tree reaches
// into the student tree. R-MOBILE-1 is symmetric, so it carries its own case.
// Refused by boundaries/no-cross-role-import.
import { enrollmentIds } from '../student/enrollment';

export function borrowedFromTheOtherRole(): readonly string[] {
  return enrollmentIds([]);
}
