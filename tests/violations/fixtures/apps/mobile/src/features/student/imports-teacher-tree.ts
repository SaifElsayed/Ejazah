// T020 fixture — VIOLATION of R-MOBILE-1: the student tree reaches into the teacher tree.
// Refused by boundaries/no-cross-role-import.
import { rosterEntryIds } from '../teacher/roster';

export function borrowedFromTheOtherRole(): readonly string[] {
  return rosterEntryIds([]);
}
