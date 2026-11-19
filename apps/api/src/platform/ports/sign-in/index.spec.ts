// T022 — the sign-in port's entry picks its adapter from `SIGN_IN_PROVIDER` (contracts/ports.md
// "Selection"). 002:T148 (B50): `live` serves the live adapter with GOOGLE_CLIENT_IDS and the process
// logger, and the entry refuses to build it without them, naming the key, as the configuration does.
// Building an adapter makes no request.
import { describe, expect, it, vi } from 'vitest';
import { FakeSignInAdapter } from './fake.adapter.js';
import { createSignInPort } from './index.js';
import { LiveSignInAdapter } from './live.adapter.js';

describe('the sign-in port entry (T022, FR-056)', () => {
  it('selects the stand-in', () => {
    expect(createSignInPort({ SIGN_IN_PROVIDER: 'fake' })).toBeInstanceOf(FakeSignInAdapter);
  });

  it('selects the live adapter with its audiences and the process logger (002:T148)', async () => {
    const log = { warn: vi.fn<(fields: object, message: string) => void>() };
    const port = createSignInPort(
      {
        SIGN_IN_PROVIDER: 'live',
        GOOGLE_CLIENT_IDS: ['web-placeholder.apps.googleusercontent.com'],
      },
      log,
    );

    expect(port).toBeInstanceOf(LiveSignInAdapter);
    // The logger handed in is the one the adapter writes its refusal line to.
    await expect(
      port.revoke({ provider: 'apple', refreshToken: 'refresh-placeholder' }),
    ).rejects.toThrow();
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('refuses to build the live adapter without GOOGLE_CLIENT_IDS, naming the key (002:T148)', () => {
    expect(() => createSignInPort({ SIGN_IN_PROVIDER: 'live' })).toThrow(
      'SIGN_IN_PROVIDER=live needs GOOGLE_CLIENT_IDS.',
    );
  });
});
