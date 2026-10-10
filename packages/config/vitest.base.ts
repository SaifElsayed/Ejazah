import { configDefaults, defineConfig } from 'vitest/config';

// Coverage thresholds are declared PER PATH, never globally (research R-13).
// The 80% floor covers packages/money, packages/time and the kernel's guard and error paths (T086).
// A floor is never lowered (R-PROC-10); the covered surface only widens as modules arrive.
//
// T086: the four paths FR-062 names, as globs relative to the repository root, where the pipeline
// runs the suite. Vitest matches a threshold glob relative to the run's root, so a package's own
// run matches none of them and the floor is enforced by the root run. Strings only: this file never
// imports from apps/api. Each path joins `include` as well as `thresholds`, because Vitest 4
// reports only the files a test loaded unless `include` names them, so a guard or error file no
// spec imports would otherwise escape its floor instead of counting at 0%.
const coveredPaths = [
  'packages/money/src/**',
  'packages/time/src/**',
  'apps/api/src/platform/guards/**',
  'apps/api/src/platform/errors/**',
];

// All four measures, each at 80%. Lines and statements alone would pass a guard whose refusal branch
// never ran, and a guard or a money rule is mostly branches; functions catch an exported rule no test
// calls. Measured before setting it (full suite): every path is at or above 95% on all four.
const floor = { statements: 80, branches: 80, functions: 80, lines: 80 };

export default defineConfig({
  // T151: `@ijazah/time` and `@ijazah/money` publish built JavaScript to Node, and their TypeScript
  // source under the custom export condition `@ijazah/source`, so a test runs against the source
  // with no build first. Vitest resolves a workspace package through Vite's server environment,
  // whose conditions are `ssr.resolve.conditions`; `resolve.conditions` is not read there (tried).
  // Naming Vite's server defaults beside ours (`module` among them) sent `@aws-sdk` to its
  // extensionless `dist-es` build, so only the one condition is named.
  ssr: { resolve: { conditions: ['@ijazah/source'] } },
  test: {
    environment: 'node',
    // Vitest 4's defaults are `node_modules` and `.git` only — `dist` was dropped from them. Every
    // package here is `composite`, so `tsc --build` leaves a compiled copy of each spec beside the
    // source, and a package-level run collected both: `pnpm --filter @ijazah/time test` reported
    // eight cases for four. The root config sets an `include` that reaches `src` and nothing else,
    // so this only ever mattered per package — but it is stated once, here, because the reason is
    // the same everywhere: compiled output is a build artefact, never a test source.
    exclude: [...configDefaults.exclude, '**/dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: coveredPaths,
      // One glob key per covered path and no global number: a global one would be permanent —
      // R-PROC-10 forbids ever lowering a floor — and would be met by covering wiring code rather
      // than rules. Every other path carries no floor yet; a module joins when it is created.
      // Vitest names the failing glob, never a rule; R-PROC-5 is named by the pipeline step (T081).
      thresholds: Object.fromEntries(coveredPaths.map((path) => [path, floor])),
    },
  },
});
