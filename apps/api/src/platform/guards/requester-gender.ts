// T138: the requester's gender, as a type no caller can produce by accident (FR-046, R-GENDER-5;
// contracts/kernel.md "Request context", contracts/lint-rules.md `gender/require-requester-gender`).
//
// A teacher-returning repository method must take this type, never a plain gender value, so a query
// that shows teachers cannot be written without the requester's own gender. The brand is a
// `unique symbol` declared here and never exported, the money-brand technique of research R-3, so a
// plain `'male'` is not assignable and no other file can name the key to build one. The request
// context (`apps/api/src/surfaces/context.ts`) is the only place outside a spec file that may mint
// it, from the server-held session (R-GENDER-4); a caller kind narrows the context and never mints.
//
// The lint rule recognises the brand by this file's path, not by the key's name, so a brand of the
// same name declared anywhere else is refused. Server-only: kept out of `packages/contracts`,
// because no client needs it and nothing published there may later be removed (R-API-9).

/** The gender value of ERD §2 (`users.gender`), unbranded: what the session stores. */
export type Gender = 'male' | 'female';

declare const requesterGenderBrand: unique symbol;

/** The gender of the caller making this request, as the server-held session records it. */
export type RequesterGender = Gender & { readonly [requesterGenderBrand]: true };
