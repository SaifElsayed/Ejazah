import { defineConfig } from 'vitest/config';

// Coverage thresholds are declared PER PATH, never globally (research R-13).
// The 80% floor covers packages/money, packages/time and the kernel's guard and error paths (T086).
// A floor is never lowered (R-PROC-10); the covered surface only widens as modules arrive.
export default defineConfig({
  test: {
    environment: 'node',
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
