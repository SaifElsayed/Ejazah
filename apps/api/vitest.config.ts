import { mergeConfig } from 'vitest/config';
import base from '../../packages/config/vitest.base';

// T114 (PR #49 review m1): the package's own run, `pnpm --filter @ijazah/api test`, starts with no
// provider key as the root run does (SC-005). The setup file is named by path, not imported, so the
// shared base config never reaches into `apps/api` (tests/support/no-provider-keys.setup.ts).
export default mergeConfig(base, {
  test: { setupFiles: ['../../tests/support/no-provider-keys.setup.ts'] },
});
