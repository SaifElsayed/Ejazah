import { defineConfig, mergeConfig } from 'vitest/config';
import base from './packages/config/vitest.base';

export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: [
        'tests/**/*.spec.ts',
        'apps/**/src/**/*.spec.ts',
        'packages/**/src/**/*.spec.ts',
      ],
    },
  }),
);
