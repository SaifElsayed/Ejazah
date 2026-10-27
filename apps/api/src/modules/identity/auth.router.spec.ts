// T048 — the `auth` namespace as the user surface serves it (app-surface.md "`auth` — sign-in" and
// "Rate-limit subjects"; FR-120 to FR-123, FR-129, FR-135).
//
// The router is thin: the input schema, the declared rate limit, one service call, the output
// schema. These cases prove the wiring through the caller kinds' middleware, as over HTTP: each
// procedure's kind and limit in its meta, what each one counts (the budget first, then the subject
// the contract names), and that a call reaches its service and answers in the published shape. What
// the services decide is proven by their own specs (B9); `auth.signOut`, the one signed-in
// procedure here, proves its kind's refusal for the authorization gate (T028, R-MOBILE-13).
import { hashLookupToken, hashPassword } from '../../platform/crypto/hashing.js';
import { closeDatabase } from '../../platform/db/prisma.repository.js';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buildIdentity,
  codeMailedTo,
  createAccount,
  type Identity,
  openSpecDatabase,
  rowsOf,
  specIdentityToken,
  uniqueEmail,
  uniqueSubject,
} from './__fixtures__/identity.js';
import { metaOf, SPEC_CLIENT, surfaceOf } from './__fixtures__/surface.js';

const database = openSpecDatabase();
afterAll(() => closeDatabase(database));

let identity: Identity;
let surface: ReturnType<typeof surfaceOf>;
beforeEach(() => {
  identity = buildIdentity(database);
  surface = surfaceOf(identity);
});

const PASSWORD = 'correct horse battery';

describe('the namespace', () => {
  it('declares every public procedure with the limit the contract names, and signOut as a user procedure', () => {
    const publicWith = (rateLimit: string) => ({ surface: 'app', caller: 'public', rateLimit });
    expect(metaOf('auth.providerNonce')).toEqual(publicWith('rate_limit_provider_nonce'));
    expect(metaOf('auth.signInWithProvider')).toEqual(publicWith('rate_limit_authentication'));
    expect(metaOf('auth.email.requestSignUpCode')).toEqual(publicWith('rate_limit_one_time_code'));
    expect(metaOf('auth.email.verifySignUpCode')).toEqual(publicWith('rate_limit_one_time_code'));
    expect(metaOf('auth.email.signIn')).toEqual(publicWith('rate_limit_authentication'));
    expect(metaOf('auth.email.requestPasswordReset')).toEqual(
      publicWith('rate_limit_one_time_code'),
    );
    expect(metaOf('auth.email.resetPassword')).toEqual(publicWith('rate_limit_authentication'));
    expect(metaOf('auth.refresh')).toEqual(publicWith('rate_limit_token_refresh'));
    expect(metaOf('auth.signOut')).toEqual({ surface: 'app', caller: 'user' });
  });
});

describe('auth.providerNonce', () => {
  it('counts the authentication budget, then the client address, and mints a nonce', async () => {
    const answer = await surface.anonymous().auth.providerNonce({});
    expect(answer).toEqual({ nonce: expect.any(String), expiresAt: '2026-10-20T08:10:00Z' });
    expect(surface.counts()).toEqual([
      ['rate_limit_authentication_budget', '*'],
      ['rate_limit_provider_nonce', SPEC_CLIENT],
    ]);
  });
});

describe('auth.signInWithProvider', () => {
  it('counts the budget, then the nonce, and answers a new identity with its onboarding token', async () => {
    const { nonce } = await identity.signIn.providerNonce();
    const email = uniqueEmail();
    const answer = await surface.anonymous().auth.signInWithProvider({
      provider: 'google',
      identityToken: specIdentityToken({
        provider: 'google',
        subject: uniqueSubject(),
        email,
        emailVerified: true,
        nonce,
      }),
      nonce,
    });
    expect(answer).toEqual({
      outcome: 'onboarding',
      onboardingToken: expect.any(String),
      prefill: { email, emailVerified: true },
    });
    expect(surface.counts()).toEqual([
      ['rate_limit_authentication_budget', '*'],
      ['rate_limit_authentication', nonce],
    ]);
  });

  it('answers a known identity with a session and its landing', async () => {
    const subject = uniqueSubject();
    await createAccount(database, { provider: { provider: 'apple', subject } });
    const { nonce } = await identity.signIn.providerNonce();
    const answer = await surface.anonymous().auth.signInWithProvider({
      provider: 'apple',
      identityToken: specIdentityToken({
        provider: 'apple',
        subject,
        email: null,
        emailVerified: false,
        nonce,
      }),
      nonce,
    });
    expect(answer).toEqual({
      outcome: 'session',
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      landing: 'student_home',
    });
  });

  it('refuses an input outside the schema before anything is counted', async () => {
    await expect(
      surface.anonymous().auth.signInWithProvider({
        provider: 'facebook' as 'google',
        identityToken: 'x',
        nonce: 'y',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(surface.counts()).toEqual([]);
  });
});

describe('auth.email', () => {
  it('requestSignUpCode counts the code budget, then the address in lower case, and mails a code', async () => {
    const address = uniqueEmail();
    await expect(
      surface.anonymous().auth.email.requestSignUpCode({ email: address.toUpperCase() }),
    ).resolves.toBeUndefined();
    expect(surface.counts()).toEqual([
      ['rate_limit_one_time_code_budget', '*'],
      ['rate_limit_one_time_code', address],
    ]);
    expect(codeMailedTo(identity.mails(), address)).toMatch(/^\d{6}$/);
  });

  it('verifySignUpCode counts the address alone and answers the onboarding token', async () => {
    const address = uniqueEmail();
    await identity.emailAuth.requestSignUpCode(address);
    const code = codeMailedTo(identity.mails(), address);
    const answer = await surface.anonymous().auth.email.verifySignUpCode({ email: address, code });
    expect(answer).toEqual({ onboardingToken: expect.any(String) });
    expect(surface.counts()).toEqual([['rate_limit_one_time_code', address]]);
  });

  it('signIn counts the budget, then the address, and signs a password account in', async () => {
    const address = uniqueEmail();
    await createAccount(database, { email: address, passwordHash: await hashPassword(PASSWORD) });
    const answer = await surface.anonymous().auth.email.signIn({
      email: address.toUpperCase(),
      password: PASSWORD,
    });
    expect(answer).toEqual({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      landing: 'student_home',
    });
    expect(surface.counts()).toEqual([
      ['rate_limit_authentication_budget', '*'],
      ['rate_limit_authentication', address],
    ]);
  });

  it('signIn answers SIGN_IN_FAILED for an address nobody holds', async () => {
    await expect(
      surface.anonymous().auth.email.signIn({ email: uniqueEmail(), password: PASSWORD }),
    ).rejects.toMatchObject({ cause: { code: 'SIGN_IN_FAILED' } });
  });

  it('requestPasswordReset counts the code budget, then the address, with one answer for all', async () => {
    const address = uniqueEmail();
    await expect(
      surface.anonymous().auth.email.requestPasswordReset({ email: address }),
    ).resolves.toBeUndefined();
    expect(surface.counts()).toEqual([
      ['rate_limit_one_time_code_budget', '*'],
      ['rate_limit_one_time_code', address],
    ]);
  });

  it('resetPassword counts the budget, then the address, and signs in with the new password', async () => {
    const address = uniqueEmail();
    await createAccount(database, { email: address, passwordHash: await hashPassword(PASSWORD) });
    await identity.emailAuth.requestPasswordReset(address);
    const code = codeMailedTo(identity.mails(), address);
    const answer = await surface.anonymous().auth.email.resetPassword({
      email: address,
      code,
      newPassword: 'another long phrase',
    });
    expect(answer).toEqual({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      landing: 'student_home',
    });
    expect(surface.counts()).toEqual([
      ['rate_limit_authentication_budget', '*'],
      ['rate_limit_authentication', address],
    ]);
  });
});

describe('auth.refresh', () => {
  it('counts the hash of the refresh token, never the client address, and rotates the pair', async () => {
    const { userId } = await createAccount(database);
    const { refreshToken } = await identity.sessions.issue(userId);
    const answer = await surface.anonymous().auth.refresh({ refreshToken });
    expect(answer).toEqual({ accessToken: expect.any(String), refreshToken: expect.any(String) });
    expect(answer.refreshToken).not.toBe(refreshToken);
    expect(surface.counts()).toEqual([['rate_limit_token_refresh', hashLookupToken(refreshToken)]]);
  });

  it('answers UNAUTHENTICATED for a token it does not know', async () => {
    await expect(
      surface.anonymous().auth.refresh({ refreshToken: 'not-a-token' }),
    ).rejects.toMatchObject({ cause: { code: 'UNAUTHENTICATED' } });
  });
});

describe('auth.signOut', () => {
  it('refuses an anonymous caller with UNAUTHENTICATED', async () => {
    await expect(surface.anonymous().auth.signOut({})).rejects.toMatchObject({
      cause: { code: 'UNAUTHENTICATED' },
    });
  });

  it("revokes the caller's own session, a restricted account's too (FR-137)", async () => {
    const { userId } = await createAccount(database, { accountStatus: 'suspended' });
    const { accessToken } = await identity.sessions.issue(userId);
    identity.clock.advance(1);
    const other = await identity.sessions.issue(userId);
    const caller = await surface.bearing(accessToken);
    await expect(caller.auth.signOut({})).resolves.toBeUndefined();
    await expect(identity.sessions.resolveUserSession(accessToken)).resolves.toBeNull();
    await expect(identity.sessions.resolveUserSession(other.accessToken)).resolves.not.toBeNull();
    const [first] = await rowsOf(database).sessions(userId);
    expect(first?.revokedReason).toBe('sign_out');
  });
});
