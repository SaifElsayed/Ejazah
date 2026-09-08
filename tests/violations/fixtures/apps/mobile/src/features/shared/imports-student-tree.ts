// T020 fixture — VIOLATION of R-MOBILE-2: shared code imports a role tree.
// Shared is what both roles may depend on; it depends on neither.
// Refused by boundaries/no-role-import-in-shared.
import { enrollmentIds } from '../student/enrollment';

export function sharedHelper(): readonly string[] {
  return enrollmentIds([]);
}
