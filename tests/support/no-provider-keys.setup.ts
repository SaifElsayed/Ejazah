// T114 (PR #49 review m1, option (c)): every test run starts with no provider key. Registered in
// `setupFiles` by the root `vitest.config.ts` and by `apps/api/vitest.config.ts`, so it runs in every
// worker before each test file loads, for `pnpm test` and for `pnpm --filter @ijazah/api test` alike.
// It deletes each key `env.schema.ts` classifies as a provider's, whatever the shell or a CI step set,
// so no test can depend on a third-party credential (SC-005).
//
// It lives here rather than in `packages/config/vitest.base.ts`, which every package's run shares:
// the shared config must not import `apps/api`, where the classification is, and a setup file named
// by path in each of the two configs keeps that import in a file of the test tree. Anything that loads
// `.env` after this runs must not bring a provider key back: the database harness and the schema
// check load only the two database URLs from it.
import { providerKeys } from '../../apps/api/src/platform/config/env.schema';

for (const key of providerKeys) {
  delete process.env[key];
}
