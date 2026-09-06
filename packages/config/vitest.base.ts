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
    },
  },
});
