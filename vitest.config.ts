import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import base from './packages/config/vitest.base';

// Two projects (B8, T035–T037). `node` is every spec the repository had before: the API, the
// packages, the scripts and the pipeline tests. `admin` is the administrator panel's specs, rendered
// in jsdom with React Testing Library; a browser module resolves a workspace package through Vite's
// client conditions, so the `@ijazah/source` condition is named there beside Vite's defaults, as
// `vitest.base.ts` names it for the server environment (watch line under T018).
const nodeExclude = [
  ...configDefaults.exclude,
  // Two violation fixtures are `*.spec.ts` files carrying `.only` and `.skip` — the very
  // prohibition they prove (T026, R-PROC-10). Collected, they run as real tests: the `.only`
  // one passes and the `.skip` one reports skipped, and in CI Vitest refuses a `.only`
  // outright (`allowOnly`), failing the run.
  'tests/violations/fixtures/**',
  // B6: the phone's specs run on Jest with jest-expo (owner's decision, 2026-10-19), from
  // `apps/mobile/jest.config.js` and the pipeline's own step; Vitest cannot load React Native.
  'apps/mobile/**',
  // B8: the panel's specs run in the `admin` project below.
  'apps/admin/**',
];

export default mergeConfig(
  base,
  defineConfig({
    test: {
      // T114 (PR #49 review m1): every run starts with no provider key (SC-005).
      setupFiles: ['tests/support/no-provider-keys.setup.ts'],
      projects: [
        {
          extends: true,
          test: {
            name: 'node',
            include: [
              'tests/**/*.spec.ts',
              'apps/**/src/**/*.spec.ts',
              'packages/**/src/**/*.spec.ts',
            ],
            exclude: nodeExclude,
          },
        },
        {
          extends: true,
          resolve: {
            conditions: ['@ijazah/source', 'module', 'browser', 'development|production'],
          },
          test: {
            name: 'admin',
            environment: 'jsdom',
            include: ['apps/admin/src/**/*.spec.{ts,tsx}'],
            exclude: [...configDefaults.exclude, '**/dist/**'],
            setupFiles: ['apps/admin/src/test/setup.ts'],
            // The render harness reads the design's stylesheet as text (`components.css?raw`) to
            // know every class it defines; Vitest blanks a stylesheet it is not told to process.
            css: { include: [/components\.css/] },
          },
        },
      ],
    },
  }),
);
