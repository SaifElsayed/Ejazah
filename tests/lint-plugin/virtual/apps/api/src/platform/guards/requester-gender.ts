// The requester's gender brand, as the specs of T046 see it (contracts/lint-rules.md).
//
// `gender/require-requester-gender` recognises `RequesterGender` by where its brand is declared: a
// file whose path ends, as a run of segments, in `apps/api/src/platform/guards/requester-gender.ts`.
// The cases of `tests/lint-plugin/require-requester-gender.spec.ts` exist only in memory, but a
// type they import has to be declared somewhere the compiler can read, so this stub sits on disk
// at the mirrored path under the virtual tree. It stays after T138 declares the real file: the
// specs never depend on it, and a brand declared anywhere but this path proves the refusal.
//
// The shape is the one T138 names: the gender value of ERD §2 branded with a `unique symbol` that
// is declared and never exported, the money-brand technique of research R-3.
declare const requesterGenderBrand: unique symbol;

export type RequesterGender = ('male' | 'female') & { readonly [requesterGenderBrand]: true };
