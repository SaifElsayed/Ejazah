// T114: every test run starts with no provider variable (SC-005; PR #49 review m1, the owner's
// decision, option (c)).
//
// The suite is credential-free by construction: `tests/support/no-provider-keys.setup.ts`, registered
// in `setupFiles` by the root and the API package's Vitest configs, deletes every key
// `env.schema.ts` classifies as a provider's from `process.env` before any test file loads. This spec
// proves the two things that construction rests on:
//
//   1. Every key of the configuration schema is classified as a provider or a platform key, so a
//      new key cannot arrive unclassified (`tsc` refuses one too, through `satisfies`).
//   2. At test time every provider key is undefined, asserted after the database harness and the
//      schema check, the two modules that read `.env`, have loaded: a `.env` holding a provider key
//      does not bring it back.
import { describe, expect, it } from 'vitest';
import { envKeys, platformKeys, providerKeys } from '../../apps/api/src/platform/config/env.schema';
// Imported for their side effect: each reads `.env` as it loads.
import '../db-integrity/harness';
import '../../scripts/schema-check';

describe('a test run holds no provider variable (T114, SC-005)', () => {
  it('classifies every key of the schema as a provider or a platform key, and none as both', () => {
    expect([...providerKeys, ...platformKeys].sort()).toEqual([...envKeys].sort());
    expect(providerKeys.filter((key) => platformKeys.includes(key))).toEqual([]);
    expect(providerKeys.length).toBeGreaterThan(0);
  });

  it.each(providerKeys)(
    'starts with %s unset, even after the modules that read .env have loaded',
    (key) => {
      expect(process.env[key]).toBeUndefined();
    },
  );
});
