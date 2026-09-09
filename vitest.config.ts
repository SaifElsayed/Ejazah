import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import base from './packages/config/vitest.base';

export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ['tests/**/*.spec.ts', 'apps/**/src/**/*.spec.ts', 'packages/**/src/**/*.spec.ts'],
      // Violation fixtures (T019) are broken on purpose, and two of them (T026, R-PROC-10) are
      // `*.spec.ts` files carrying `.only` and `.skip` — that is the prohibition they exist to
      // prove. `tests/**/*.spec.ts` above would otherwise collect them, and a collected `.only`
      // would silence every other test in the run. This is the runner's half of the exclusion
      // the root `tsconfig.json` and `packages/config/eslint.base.js` already carry.
      exclude: [...configDefaults.exclude, 'tests/violations/fixtures/**'],
    },
  }),
);
