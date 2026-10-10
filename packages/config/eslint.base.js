// Two rule sets, split by what they need (research R-10):
//   fast      - syntax only; editor and pre-commit hook
//   typeAware - needs the program; pipeline only
// Both consume the internal plugin, in which every rule is named for a constitution rule
// and every message ends with that identifier (FR-011). Wired by T004; T043 made the two sets
// agree on which files they cover and proved the split in `tests/lint-plugin/rule-sets.spec.ts`:
// the fast set never carries a program, the type-aware set always carries one that contains the
// linted file, and each set enables exactly the rules the plugin's catalog puts in it.
const path = require('node:path');
const tsParser = require('@typescript-eslint/parser');
const ijazah = require('./eslint-plugin-ijazah');
const boundaries = require('./eslint.boundaries');

const repositoryRoot = path.resolve(__dirname, '..', '..');

// One list of TypeScript extensions for every block below. The parser block, the fast rules block
// and the type-aware block used to name three different lists, so a `.mts` file was parsed and
// then checked against no rule at all in either set — a silent gap, where a file outside every
// tsconfig at least fails loudly. Under the type-aware set a TypeScript file is either in a
// program or a parse error; there is no third state in which the four type-aware rules quietly
// skip it.
const typescriptFiles = ['**/*.{ts,tsx,mts,cts}'];
const lintedFiles = ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'];

const ignores = [
  '**/dist/**',
  '**/build/**',
  '**/web-build/**',
  '**/node_modules/**',
  '**/.expo/**',
  '**/coverage/**',
  '**/.husky/_/**',
  // Design assets, not source. `docs/design/frames/` holds device chrome and artboards that
  // apps/mobile never imports; they carry raw colours on purpose and are not subject to the wall.
  'docs/**',
  // Violation fixtures (T019). Every file there breaks a rule on purpose, so `pnpm lint` must
  // not read them. `tests/violations/harness.ts` lints them through this very configuration with
  // the ignore list switched off — it is the one caller that is supposed to see them.
  'tests/violations/fixtures/**',
];

const fast = [
  { ignores },
  ...boundaries,
  {
    // Syntax only: the parser reads TypeScript but is never handed the program, so this set
    // stays fast enough for every keystroke and for the pre-commit hook (research R-10).
    files: typescriptFiles,
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
  },
  {
    files: lintedFiles,
    plugins: { ijazah },
    rules: ijazah.configs.fast.rules,
  },
];

const typeAware = [
  ...fast,
  {
    files: typescriptFiles,
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        // The program is what the four type-aware rules need and the reason this set runs in
        // the pipeline only (research R-10, R-13). The project service finds each file's own
        // tsconfig from the repository root, so the violation fixtures reach the program through
        // `tests/violations/fixtures/tsconfig.json` while staying out of the root build.
        tsconfigRootDir: repositoryRoot,
        projectService: {
          // Per-package test-runner configs sit outside every tsconfig on purpose: adding them
          // to a package's `include` would put them in the composite build and require that
          // package to declare the test runner. They carry no domain logic, so an inferred
          // program is enough for the four type-aware rules to run over them.
          allowDefaultProject: ['apps/*/vitest.config.ts', 'packages/*/vitest.config.ts'],
        },
      },
    },
    plugins: { ijazah },
    rules: ijazah.configs.typeAware.rules,
  },
  {
    // T140 (R-PROC-7, FR-008): a suppression that no longer suppresses anything fails the build
    // instead of outliving its ticket. No `files` key, so .js files are held too (PR #31, N1).
    // Here only, where every rule runs: in the fast set the four type-aware rules never run, so a
    // justified directive naming one of them is unused there by necessity, and `pnpm lint` and the
    // pre-commit hook keep ESLint's default warning (second review of PR #31, B1).
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
];

module.exports = { fast, typeAware };
