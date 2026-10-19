// T022 — the sign-in port's entry picks its adapter from `SIGN_IN_PROVIDER`, the stand-in being
// the only member until the live adapter's task adds it (contracts/ports.md "Selection").
import { describe, expect, it } from 'vitest';
import { FakeSignInAdapter } from './fake.adapter.js';
import { createSignInPort } from './index.js';

describe('the sign-in port entry (T022, FR-056)', () => {
  it('selects the stand-in', () => {
    expect(createSignInPort({ SIGN_IN_PROVIDER: 'fake' })).toBeInstanceOf(FakeSignInAdapter);
  });
});
