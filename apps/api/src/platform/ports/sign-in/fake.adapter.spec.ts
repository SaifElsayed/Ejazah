// T022 — the sign-in port and its stand-in (specs/002-identity/contracts/ports.md "SignInPort",
// research R-103, R-API-5). Three operations in the project's own terms, none naming a vendor:
// verify an identity token given the nonce the server minted, exchange an authorization for the
// provider's refresh token, revoke a grant. The identity it returns carries `emailVerified` apart
// from the email, so a caller cannot read an unverified address as one (FR-121), and no token.
//
// The stand-in takes the documented unsigned fake token, so no key reaches a device (it is refused
// outside development and test, T168); it still compares the nonce it is handed with the token's
// field (the service owns the single-use mark; an adapter holds no Redis state), reports an
// unverified email as such, records every call and fails one when told (T122).
//
// The type checks are enforced by `pnpm typecheck` (CI stage 1), not by vitest.
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { StandInFailure } from '../stand-in.js';
import { FakeSignInAdapter, fakeIdentityToken } from './fake.adapter.js';
import {
  IdentityTokenError,
  type ProviderIdentity,
  type SignInPort,
  type SignInProvider,
} from './sign-in.port.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const NONCE = 'n_9f3a2c1d8b7e6f50';

function token(overrides: Partial<Parameters<typeof fakeIdentityToken>[0]> = {}): string {
  return fakeIdentityToken({
    provider: 'google',
    subject: 'sub-1001',
    email: 'amr.k@example.invalid',
    emailVerified: true,
    nonce: NONCE,
    ...overrides,
  });
}

describe('the sign-in port (T022, R-API-5)', () => {
  it('has three operations: verify an identity token, exchange an authorization, revoke a grant', () => {
    expectTypeOf<keyof SignInPort>().toEqualTypeOf<
      'verifyIdentityToken' | 'exchangeAuthorization' | 'revoke'
    >();
    expectTypeOf<SignInProvider>().toEqualTypeOf<'google' | 'apple'>();
  });

  it('returns the identity with the email and its verification apart, and no token', () => {
    expectTypeOf<ProviderIdentity>().toEqualTypeOf<{
      readonly provider: SignInProvider;
      readonly subject: string;
      readonly email: string | null;
      readonly emailVerified: boolean;
      readonly displayName: string | null;
    }>();
  });

  it('names no vendor in its operations or in the identity it returns', () => {
    const operations: readonly (keyof SignInPort)[] = [
      'verifyIdentityToken',
      'exchangeAuthorization',
      'revoke',
    ];
    const fields: readonly (keyof ProviderIdentity)[] = [
      'provider',
      'subject',
      'email',
      'emailVerified',
      'displayName',
    ];
    for (const name of [...operations, ...fields]) {
      expect(name.toLowerCase()).not.toMatch(/google|apple|firebase|auth0|cognito|oauth|jwt/);
    }
  });
});

describe('the sign-in stand-in (T022)', () => {
  it('verifies the fake token whose nonce is the one it is handed', async () => {
    const identity = await new FakeSignInAdapter().verifyIdentityToken({
      provider: 'google',
      token: token(),
      nonce: NONCE,
    });
    expect(identity).toEqual({
      provider: 'google',
      subject: 'sub-1001',
      email: 'amr.k@example.invalid',
      emailVerified: true,
      displayName: null,
    });
  });

  it('reports an unverified email as such, never as an address a caller may trust', async () => {
    const identity = await new FakeSignInAdapter().verifyIdentityToken({
      provider: 'apple',
      token: token({ provider: 'apple', emailVerified: false }),
      nonce: NONCE,
    });
    expect(identity.email).toBe('amr.k@example.invalid');
    expect(identity.emailVerified).toBe(false);
  });

  it('reports no email as null and unverified', async () => {
    const identity = await new FakeSignInAdapter().verifyIdentityToken({
      provider: 'google',
      token: token({ email: null, emailVerified: false }),
      nonce: NONCE,
    });
    expect(identity).toMatchObject({ email: null, emailVerified: false });
  });

  it('refuses a token whose nonce is not the one it is handed, naming neither', async () => {
    let failure: unknown;
    try {
      await new FakeSignInAdapter().verifyIdentityToken({
        provider: 'google',
        token: token({ nonce: 'n_other' }),
        nonce: NONCE,
      });
    } catch (error: unknown) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(IdentityTokenError);
    expect((failure as IdentityTokenError).reason).toBe('nonce');
    expect((failure as Error).message).not.toContain(NONCE);
    expect((failure as Error).message).not.toContain('n_other');
  });

  it('refuses a token issued for another provider than the one asked', async () => {
    await expect(
      new FakeSignInAdapter().verifyIdentityToken({
        provider: 'apple',
        token: token({ provider: 'google' }),
        nonce: NONCE,
      }),
    ).rejects.toMatchObject({ name: 'IdentityTokenError', reason: 'issuer' });
  });

  it.each([
    // Three base64url segments, the shape of a signed token; built here so no scanner reads a secret.
    [
      'a signed-looking token',
      ['header', 'payload', 'sig'].map((p) => Buffer.from(p).toString('base64url')).join('.'),
    ],
    ['the wrong prefix', `real.google.sub-1.a@b.invalid.verified.${NONCE}`],
    ['no subject', `fake.google..a@b.invalid.verified.${NONCE}`],
    ['no verification flag', `fake.google.sub-1.a@b.invalid.${NONCE}`],
    ['an unknown provider', `fake.acme.sub-1.a@b.invalid.verified.${NONCE}`],
    ['nothing', ''],
  ])('refuses %s as a token', async (_name, bad) => {
    await expect(
      new FakeSignInAdapter().verifyIdentityToken({ provider: 'google', token: bad, nonce: NONCE }),
    ).rejects.toBeInstanceOf(IdentityTokenError);
  });

  it('exchanges an authorization for a fake refresh token and revokes a grant as a no-op', async () => {
    const signIn = new FakeSignInAdapter();
    const { refreshToken } = await signIn.exchangeAuthorization({
      provider: 'apple',
      code: 'c_authorization',
    });
    expect(refreshToken).toEqual(expect.any(String));
    expect(refreshToken.length).toBeGreaterThan(0);
    await expect(signIn.revoke({ provider: 'apple', refreshToken })).resolves.toBeUndefined();
  });

  it('writes nothing to the console or the process streams', async () => {
    const writes = [
      vi.spyOn(process.stdout, 'write'),
      vi.spyOn(process.stderr, 'write'),
      ...(['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
        vi.spyOn(console, method),
      ),
    ];
    await new FakeSignInAdapter().verifyIdentityToken({
      provider: 'google',
      token: token(),
      nonce: NONCE,
    });
    for (const write of writes) expect(write).not.toHaveBeenCalled();
  });
});

describe('the sign-in stand-in: records and induced failure (T122)', () => {
  it('records every call with its arguments, a refused one included', async () => {
    const signIn = new FakeSignInAdapter();
    const request = { provider: 'google', token: token(), nonce: NONCE } as const;
    await signIn.verifyIdentityToken(request);
    await signIn.exchangeAuthorization({ provider: 'apple', code: 'c_1' });
    await signIn.revoke({ provider: 'apple', refreshToken: 'r_1' });
    await expect(
      signIn.verifyIdentityToken({ ...request, nonce: 'n_other' }),
    ).rejects.toBeInstanceOf(IdentityTokenError);

    expect(signIn.calls).toEqual([
      { operation: 'verifyIdentityToken', args: [request] },
      { operation: 'exchangeAuthorization', args: [{ provider: 'apple', code: 'c_1' }] },
      { operation: 'revoke', args: [{ provider: 'apple', refreshToken: 'r_1' }] },
      { operation: 'verifyIdentityToken', args: [{ ...request, nonce: 'n_other' }] },
    ]);
  });

  it('fails a verification when told, then verifies again', async () => {
    const signIn = new FakeSignInAdapter();
    signIn.failNext('verifyIdentityToken');
    const request = { provider: 'google', token: token(), nonce: NONCE } as const;

    await expect(signIn.verifyIdentityToken(request)).rejects.toThrow(StandInFailure);
    await expect(signIn.verifyIdentityToken(request)).resolves.toMatchObject({
      subject: 'sub-1001',
    });
  });
});
