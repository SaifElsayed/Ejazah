import { configDefaults, defineConfig } from 'vitest/config';

// Coverage thresholds are declared PER PATH, never globally (research R-13).
// The 80% floor covers packages/money, packages/time and the kernel's guard and error paths (T086).
// A floor is never lowered (R-PROC-10); the covered surface only widens as modules arrive.
export default defineConfig({
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
      // Deliberately empty until T086. A global number here would be permanent — R-PROC-10 forbids
      // ever lowering a floor — and would be met by covering wiring code rather than rules.
      // T086 adds one glob key per covered path: packages/money, packages/time, and the kernel's
      // guard and error paths, each at 80%. Every other path carries no floor yet.
      thresholds: {},
    },
  },
});
