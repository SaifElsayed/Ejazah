// T025 fixture — VIOLATION of R-GENDER-5: a repository method that returns teachers and never
// takes the requester's gender. The word `gender` appears nowhere in this signature, which is
// the whole prohibition: SRS §3.7.1 states the pairing predicate once, in this module's
// repository, and R-GENDER-5 exists so no unfiltered method survives for a student-facing path
// to call. A caller of `listTeachersForSubject` cannot filter what it never received.
//
// The legal counterpart — the same method taking the requester's gender — is deliberately
// absent. A rule that merely looks for the word somewhere in the file would go green against a
// fixture that carried both, and this suite proves refusal, not discrimination.
//
// Syntax cannot tell a filtered method from an unfiltered one (contracts/lint-rules.md), so the
// rule resolves the return type and the case is `typeAware`. Nothing here imports the database
// client: holding it would be legal in a `*.repository.ts` file, but a query would put this
// module against `teacher_profiles`, which packages/config/module-tables.json assigns to
// `identity`, and `api/table-ownership` (R-API-6) would refuse the same file a second time.
// Returning rows without querying keeps this a one-rule fixture.
// Refused by gender/require-requester-gender.
export interface TeacherCard {
  readonly id: string;
  readonly displayName: string;
  readonly averageRating: number | null;
}

export async function listTeachersForSubject(subjectId: string): Promise<readonly TeacherCard[]> {
  return [{ id: subjectId, displayName: '', averageRating: null }];
}
