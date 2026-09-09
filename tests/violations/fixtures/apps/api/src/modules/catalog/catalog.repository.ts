// T025 fixture — VIOLATION of R-GENDER-5: a repository method that returns teachers and never
// takes the requester's gender, so a caller cannot filter what it never received. The legal
// counterpart is deliberately absent, or a rule that merely greps for the word would go green.
// Nothing imports the database client on purpose: a query here would put this module against
// `teacher_profiles`, which module-tables.json assigns to `identity`, and R-API-6 would refuse
// the same file a second time.
// Refused by gender/require-requester-gender.
export interface TeacherCard {
  readonly id: string;
  readonly displayName: string;
  readonly averageRating: number | null;
}

export async function listTeachersForSubject(subjectId: string): Promise<readonly TeacherCard[]> {
  return [{ id: subjectId, displayName: '', averageRating: null }];
}
