// T020 fixture — VIOLATION of R-MOBILE-2 against the other role tree, for the same reason
// R-MOBILE-1 carries two cases: the prohibition is symmetric.
// Refused by boundaries/no-role-import-in-shared.
import { rosterEntryIds } from '../teacher/roster';

export function sharedHelper(): readonly string[] {
  return rosterEntryIds([]);
}
