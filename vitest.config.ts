import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import base from './packages/config/vitest.base';

export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ['tests/**/*.spec.ts', 'apps/**/src/**/*.spec.ts', 'packages/**/src/**/*.spec.ts'],
      // Two violation fixtures are `*.spec.ts` files carrying `.only` and `.skip` — the very
      // prohibition they prove (T026, R-PROC-10) — so a collected one would silence the run.
      exclude: [...configDefaults.exclude, 'tests/violations/fixtures/**'],
    },
  }),
);
