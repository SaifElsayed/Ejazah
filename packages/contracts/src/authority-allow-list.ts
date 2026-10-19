// T038: the one exception to R-GENDER-4's input rule, per schema and per field (R-GENDER-6,
// FR-139; app-surface.md "What every procedure of this surface guarantees").
//
// No input schema of this package may carry `gender`, `role`, `userId` or `user_id`
// (`gender/no-authority-in-input`): the requester's identity comes from the server-held session.
// `onboarding.complete` is the one procedure that takes `gender` and `role`, because they are the
// declarations themselves, made once by the person before any account exists; its schema is listed
// here with exactly those two fields, and the lint rule reads this list. T029's test maps the schema
// to its procedure through the contract snapshot and asserts the list holds this one schema with
// these two fields and nothing else. Keyed by the exported schema name, since the rule sees schema
// objects and not procedure paths.
//
// The rule reads this file as text (it runs without a TypeScript loader), so each entry stays on
// one line in the form `<schemaName>: ['<field>', '<field>']`.

/** Input schema name → the authority fields that schema alone may carry. */
export const authorityAllowList = {
  onboardingCompleteInput: ['gender', 'role'],
} as const satisfies Readonly<Record<string, readonly ('gender' | 'role')[]>>;

export type AuthorityAllowList = typeof authorityAllowList;
