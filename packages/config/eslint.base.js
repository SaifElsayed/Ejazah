// Two rule sets, split by what they need (research R-10):
//   fast      - syntax only; editor and pre-commit hook
//   typeAware - needs the program; pipeline only
// Both consume the internal plugin, in which every rule is named for a constitution rule
// and every message ends with that identifier (FR-011). Wired fully by T004 and T043.
const path = require('node:path');
const tsParser = require('@typescript-eslint/parser');
const ijazah = require('./eslint-plugin-ijazah');
const boundaries = require('./eslint.boundaries');

const repositoryRoot = path.resolve(__dirname, '..', '..');

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
    files: ['**/*.{ts,tsx,mts,cts}'],
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
    files: ['**/*.{ts,tsx,js,jsx,mjs,cjs}'],
    plugins: { ijazah },
    rules: ijazah.configs.fast.rules,
  },
];

const typeAware = [
  ...fast,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        // The program is what the four type-aware rules need and the reason this set runs in
        // the pipeline only (research R-10, R-13). T043 completes the wiring.
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
];

module.exports = { fast, typeAware };
