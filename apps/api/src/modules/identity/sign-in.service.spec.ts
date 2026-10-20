// T042: provider sign-in (FR-120 to FR-123, research R-102, R-103). The device asks for a nonce the
// server minted (`auth.providerNonce`), single-use in Redis for `provider_nonce_ttl_minutes`; a
// sign-in consumes it before the token is verified, so a captured token and nonce replay nothing.
// An unverified email is treated as absent. A new identity yields an onboarding token with the
// prefill; an existing one a session and its landing. An email that already belongs to another
// account is refused with that account's method, never signed in to or merged (FR-123). Over the
// real database, the sign-in stand-in and in-memory marks.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDatabase } from '../../platform/db/prisma.repository.js';
import { hashPassword } from '../../platform/crypto/hashing.js';
import {
  buildIdentity,
  createAccount,
  type Identity,
  openSpecDatabase,
  rowsNaming,
  rowsOf,
  specIdentityToken,
  uniqueEmail,
  uniqueSubject,
} from './__fixtures__/identity.js';

const database = openSpecDatabase();
afterAll(() => closeDatabase(database));

let identity: Identity;
beforeEach(() => {
  identity = buildIdentity(database);
});

async function token(
  provider: 'google' | 'apple',
  {
    subject = uniqueSubject(),
    email = uniqueEmail() as string | null,
    emailVerified = true,
  }: { subject?: string; email?: string | null; emailVerified?: boolean } = {},
) {
  const { nonce } = await identity.signIn.providerNonce();
  return {
    subject,
    email,
    nonce,
    request: {
      provider,
      nonce,
      identityToken: specIdentityToken({ provider, subject, email, emailVerified, nonce }),
    },
  };
}

describe('auth.providerNonce', () => {
  it('mints a fresh nonce that lapses after `provider_nonce_ttl_minutes`', async () => {
    const first = await identity.signIn.providerNonce();
    const second = await identity.signIn.providerNonce();
    expect(first.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second.nonce).not.toBe(first.nonce);
    expect(first.expiresAt).toBe('2026-10-20T08:10:00Z');
  });
});

describe('the nonce', () => {
  it('is consumed once: the same token and nonce are refused the second time', async () => {
    const { request } = await token('google');
    await expect(identity.signIn.signInWithProvider(request)).resolves.toMatchObject({
      outcome: 'onboarding',
    });
    await expect(identity.signIn.signInWithProvider(request)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('is refused when the server never minted it, or after it lapsed', async () => {
    const subject = uniqueSubject();
    const nonce = 'n'.repeat(43);
    await expect(
      identity.signIn.signInWithProvider({
        provider: 'google',
        nonce,
        identityToken: specIdentityToken({
          provider: 'google',
          subject,
          email: null,
          emailVerified: false,
          nonce,
        }),
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const lapsed = await token('google');
    identity.clock.advance(10 * 60);
    await expect(identity.signIn.signInWithProvider(lapsed.request)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('is spent even when the token is then refused, and the port never saw the refused nonce twice', async () => {
    const { request } = await token('google');
    const otherNonce = await identity.signIn.providerNonce();
    // A token carrying another nonce than the one presented: the stand-in refuses it.
    const mismatched = {
      ...request,
      identityToken: request.identityToken.replace(request.nonce, otherNonce.nonce),
    };
    await expect(identity.signIn.signInWithProvider(mismatched)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(identity.signIn.signInWithProvider(request)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    expect(identity.signInPort.calls).toHaveLength(1);
  });
});

describe('a new identity', () => {
  it('yields an onboarding token with the verified email and nothing written', async () => {
    const { request, subject, email } = await token('google');
    const answer = await identity.signIn.signInWithProvider(request);
    expect(answer).toEqual({
      outcome: 'onboarding',
      onboardingToken: expect.stringMatching(/^v1\./),
      prefill: { email, emailVerified: true },
    });
    await expect(rowsNaming([subject, email ?? ''])).resolves.toEqual([]);
  });

  it('treats an unverified email as absent: no prefill, no conflict', async () => {
    const taken = await createAccount(database, {
      provider: { provider: 'apple', subject: uniqueSubject() },
    });
    const { request } = await token('google', { email: taken.email, emailVerified: false });
    await expect(identity.signIn.signInWithProvider(request)).resolves.toEqual({
      outcome: 'onboarding',
      onboardingToken: expect.any(String),
      prefill: { emailVerified: false },
    });
  });

  it('exchanges Apple’s authorization code at once and carries the grant unreadable in the token', async () => {
    const { request } = await token('apple');
    const answer = await identity.signIn.signInWithProvider({
      ...request,
      authorizationCode: 'apple-code',
    });
    const exchanges = identity.signInPort.calls.filter(
      (call) => call.operation === 'exchangeAuthorization',
    );
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0]?.args[0]).toEqual({ provider: 'apple', code: 'apple-code' });
    const onboardingToken = answer.outcome === 'onboarding' ? answer.onboardingToken : '';
    const payload = Buffer.from(onboardingToken.split('.')[1] ?? '', 'base64url').toString();
    expect(payload).not.toContain('fake-refresh');
    expect(payload).not.toContain('apple-code');
  });
});

describe('an existing identity', () => {
  it('yields a session and its landing, with no exchange', async () => {
    const subject = uniqueSubject();
    const account = await createAccount(database, {
      role: 'teacher',
      provider: { provider: 'apple', subject },
    });
    const { request } = await token('apple', { subject, email: account.email });
    const answer = await identity.signIn.signInWithProvider({ ...request, authorizationCode: 'c' });
    expect(answer).toMatchObject({ outcome: 'session', landing: 'teacher_application' });
    if (answer.outcome !== 'session') throw new Error('expected a session');
    await expect(identity.sessions.resolveUserSession(answer.accessToken)).resolves.toMatchObject({
      userId: account.userId,
    });
    expect(
      identity.signInPort.calls.filter((call) => call.operation === 'exchangeAuthorization'),
    ).toEqual([]);
  });

  it('lands a suspended account on the restricted screen', async () => {
    const subject = uniqueSubject();
    await createAccount(database, {
      accountStatus: 'suspended',
      provider: { provider: 'google', subject },
    });
    const { request } = await token('google', { subject });
    await expect(identity.signIn.signInWithProvider(request)).resolves.toMatchObject({
      outcome: 'session',
      landing: 'restricted',
    });
  });
});

describe('an email that belongs to another account (FR-123)', () => {
  it.each([
    ['google', { provider: 'apple' as const }, 'apple'],
    ['apple', { provider: 'google' as const }, 'google'],
    ['google', 'password' as const, 'email'],
  ] as const)(
    'a %s sign-in over an account of %o is refused with its method (%s), nothing signed in or merged',
    async (provider, owner, method) => {
      const account = await createAccount(database, {
        ...(owner === 'password'
          ? { passwordHash: await hashPassword('correct horse battery') }
          : { provider: { provider: owner.provider, subject: uniqueSubject() } }),
      });
      const { request, subject } = await token(provider, { email: account.email });
      await expect(identity.signIn.signInWithProvider(request)).rejects.toMatchObject({
        code: 'EMAIL_IN_USE_BY_OTHER_METHOD',
        details: [{ path: 'email', code: method }],
      });
      await expect(rowsNaming([subject])).resolves.toEqual([]);
      await expect(rowsOf(database).sessionCount(account.userId)).resolves.toBe(0);
    },
  );

  it('compares the address without its case', async () => {
    const account = await createAccount(database, {
      provider: { provider: 'apple', subject: uniqueSubject() },
    });
    const { request } = await token('google', { email: account.email.toUpperCase() });
    await expect(identity.signIn.signInWithProvider(request)).rejects.toMatchObject({
      code: 'EMAIL_IN_USE_BY_OTHER_METHOD',
    });
  });
});
