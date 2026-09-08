// T020 fixture support — a legal student-tree module, so the illegal imports of it resolve.
export interface EnrollmentSummary {
  readonly enrollmentId: string;
}

export function enrollmentIds(summaries: readonly EnrollmentSummary[]): readonly string[] {
  return summaries.map((summary) => summary.enrollmentId);
}
