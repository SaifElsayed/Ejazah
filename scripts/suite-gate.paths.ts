// T163: the paths the R-PROC-5 suite gate guards, in one file, because they are named before the
// modules that will fill them exist. Each suite has the paths whose change must carry a change to
// its tests, the paths it leaves out, and the tests that count. Patterns are repository-relative:
// `*` matches within one path segment, `**` across segments. Specs, Markdown and the violation
// fixtures never count as a change to guard (`IGNORED`).
//
// Gender (R-GENDER-1/2/3: what a requester of one gender may see of a teacher of the other):
//   - the kernel's requester-gender guard;
//   - the catalog module, which serves discovery and the teacher list (its README cites R-GENDER),
//     the first and only reader of teacher data across the gender line;
//   - any source file named for gender in the API or in the contracts package.
// Left out: the identity module, which captures gender but serves no list (what it may read from a
// client is R-GENDER-4's, held by T159's lint rule), and the mobile and admin apps, whose gender
// step renders a choice and filters nothing (PR #63 review, n1); and, by basename, the catalog files
// that serve no discovery (the subjects list, the credential rows and their review, T038: the
// owner's decision of 2026-10-18 on PR #76's review) and the module's entry, an export list that
// filters nothing, while `catalog.repository.ts`, the discovery repository, stays guarded. The tests that count are the
// adversarial suite's specs, not any file under its folder.
//
// Time (R-TIME-1/2: every session datetime is resolved in packages/time, across DST):
//   - the source of packages/time, whose DST specs are its own *.spec.ts files.
// Phase 3 adds the sessions module and its recurrence specs here when that code lands.
//
// Mobile (R-MOBILE-13, FR-210, research R-115: hiding an action in the UI is not authorization):
//   - the phone's feature trees, where a screen reaches a procedure; a change there carries a
//     change to the API module specs, where the refusal of the wrong caller is proved, so the
//     server test exists in the same pull request. The phone's own specs are `IGNORED` as every
//     spec is; the design system, the client and the routes are left out, since no action is hidden
//     there. The coupling is by path, as the gate is: a screen-only change carries a module spec
//     change too. Which spec holds which refusal is `pnpm check:authz`'s (T028).

/** Paths whose change must carry a change to `tests`. */
export interface Suite {
  readonly name: string;
  /** The constitution rule a refusal names: R-PROC-5 for the test suites, R-MOBILE-13 for the phone (FR-210). */
  readonly rule: string;
  readonly changes: readonly string[];
  /** Paths `changes` reaches that the suite leaves out. */
  readonly except: readonly string[];
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
  rule: 'R-PROC-5',
  changes: [
    'apps/api/src/platform/guards/requester-gender.ts',
    'apps/api/src/modules/catalog/**',
    'apps/api/**/*gender*',
    'packages/contracts/**/*gender*',
  ],
  except: [
    'apps/api/src/modules/identity/**',
    'apps/api/src/modules/catalog/subjects*',
    'apps/api/src/modules/catalog/credentials*',
    'apps/api/src/modules/catalog/credential-review*',
    'apps/api/src/modules/catalog/credentials-admin.router.ts',
    'apps/api/src/modules/catalog/index.ts',
  ],
  tests: ['tests/adversarial/**/*.spec.ts'],
  testsShown: 'the adversarial suite (tests/adversarial/**/*.spec.ts)',
};

export const TIME: Suite = {
  name: 'time',
  rule: 'R-PROC-5',
  changes: ['packages/time/src/**'],
  except: [],
  tests: ['packages/time/src/**/*.spec.ts'],
  testsShown: 'the DST specs of packages/time (packages/time/src/**/*.spec.ts)',
};

export const MOBILE: Suite = {
  name: 'mobile',
  rule: 'R-MOBILE-13',
  changes: ['apps/mobile/src/features/**'],
  except: [],
  tests: ['apps/api/src/modules/**/*.spec.ts'],
  testsShown: 'the API module specs that prove the refusals (apps/api/src/modules/**/*.spec.ts)',
};

export const SUITES: readonly Suite[] = [GENDER, TIME, MOBILE];
