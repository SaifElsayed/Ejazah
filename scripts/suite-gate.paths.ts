// T163: the paths the R-PROC-5 suite gate guards, in one file, because they are named before the
// modules that will fill them exist. Each suite has the paths whose change must carry a change to
// its tests, and the tests that count. Patterns are repository-relative: `*` matches within one
// path segment, `**` across segments. Specs, Markdown and the violation fixtures never count as a
// change to guard (`IGNORED`).
//
// Gender (R-GENDER-1/2/3: what a requester of one gender may see of a teacher of the other):
//   - the kernel's requester-gender guard;
//   - the catalog module, which serves discovery and the teacher list (its README cites R-GENDER),
//     the first and only reader of teacher data across the gender line;
//   - any source file named for gender, wherever it lands.
// The identity module captures gender but serves no list; what it may read from a client is
// R-GENDER-4's, held by T159's lint rule, so it is not guarded here.
//
// Time (R-TIME-1/2: every session datetime is resolved in packages/time, across DST):
//   - the source of packages/time, whose DST specs are its own *.spec.ts files.
// Phase 3 adds the sessions module and its recurrence specs here when that code lands.

/** Paths whose change must carry a change to `tests`. */
export interface Suite {
  readonly name: string;
  readonly changes: readonly string[];
  readonly tests: readonly string[];
  /** The tests, as the refusal names them. */
  readonly testsShown: string;
}

export const IGNORED: readonly string[] = [
  '**/*.spec.ts',
  '**/*.spec.tsx',
  '**/*.md',
  'tests/violations/fixtures/**',
];

export const GENDER: Suite = {
  name: 'gender',
  changes: [
    'apps/api/src/platform/guards/requester-gender.ts',
    'apps/api/src/modules/catalog/**',
    'apps/**/*gender*',
    'packages/**/*gender*',
  ],
  tests: ['tests/adversarial/**'],
  testsShown: 'the adversarial suite under tests/adversarial/',
};

export const TIME: Suite = {
  name: 'time',
  changes: ['packages/time/src/**'],
  tests: ['packages/time/src/**/*.spec.ts'],
  testsShown: 'the DST specs of packages/time (packages/time/src/**/*.spec.ts)',
};

export const SUITES: readonly Suite[] = [GENDER, TIME];
