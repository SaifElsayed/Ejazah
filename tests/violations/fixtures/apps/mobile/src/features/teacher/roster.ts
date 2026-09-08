// T020 fixture support — a legal teacher-tree module, so the illegal imports of it resolve.
export interface RosterEntry {
  readonly enrollmentId: string;
}

export function rosterEntryIds(entries: readonly RosterEntry[]): readonly string[] {
  return entries.map((entry) => entry.enrollmentId);
}
