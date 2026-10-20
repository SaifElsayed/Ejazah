// T048 — the `onboarding` namespace as the user surface serves it (app-surface.md "`onboarding` —
// the first sign-in" and "Rate-limit subjects"; FR-124 to FR-127).
//
// Thin, as `auth` is: these cases prove the kinds, the limits and their subjects, and that a call
// reaches its service and answers in the published shape. `complete` counts the hash of the
// onboarding token, never parsing it in `subjectOf`, is not keyed (its `jti` is its single use),
// and writes the account in the request's language (the session's, or the default for an
// anonymous caller; the phone sets the chosen language after landing).
import { hashLookupToken } from '../../platform/crypto/hashing.js';
import { closeDatabase } from '../../platform/db/prisma.repository.js';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buildIdentity,
  codeMailedTo,
  type Identity,
  openSpecDatabase,
  rowsOf,
  uniqueEmail,
  uniqueSubject,
} from './__fixtures__/identity.js';
import { metaOf, surfaceOf } from './__fixtures__/surface.js';

const database = openSpecDatabase();
afterAll(() => closeDatabase(database));

let identity: Identity;
let surface: ReturnType<typeof surfaceOf>;
beforeEach(() => {
  identity = buildIdentity(database);
  surface = surfaceOf(identity);
});

function providerToken(email: string | null, emailVerified: boolean): Promise<string> {
  return identity.onboarding.mint({
    kind: 'provider',
    provider: 'google',
    subject: uniqueSubject(),
    email,
    emailVerified,
    displayName: null,
  });
}

const profile = {
  role: 'student' as const,
  displayName: 'Amina',
  gender: 'female' as const,
  dateOfBirth: '2001-03-04',
  timezone: 'Africa/Cairo',
  termsVersion: '2026-10',
};

describe('the namespace', () => {
  it('declares both procedures public, with the limits the contract names', () => {
    expect(metaOf('onboarding.requestEmailCode')).toEqual({
      surface: 'app',
      caller: 'public',
      rateLimit: 'rate_limit_one_time_code',
    });
    expect(metaOf('onboarding.complete')).toEqual({
      surface: 'app',
      caller: 'public',
      rateLimit: 'rate_limit_authentication',
    });
  });
});

describe('onboarding.requestEmailCode', () => {
  it('counts the code budget, then the address in lower case, and mails a code', async () => {
    const onboardingToken = await providerToken(null, false);
    const address = uniqueEmail();
    await expect(
      surface.anonymous().onboarding.requestEmailCode({
        onboardingToken,
        email: address.toUpperCase(),
      }),
    ).resolves.toBeUndefined();
    expect(surface.counts()).toEqual([
      ['rate_limit_one_time_code_budget', '*'],
      ['rate_limit_one_time_code', address],
    ]);
    expect(codeMailedTo(identity.mails(), address)).toMatch(/^\d{6}$/);
  });

  it('refuses a token whose identity already has a verified email', async () => {
    const onboardingToken = await providerToken(uniqueEmail(), true);
    await expect(
      surface.anonymous().onboarding.requestEmailCode({ onboardingToken, email: uniqueEmail() }),
    ).rejects.toMatchObject({ cause: { code: 'VALIDATION_FAILED' } });
  });
});

describe('onboarding.complete', () => {
  it("counts the onboarding token's hash, writes the account in the request's language and lands it", async () => {
    const email = uniqueEmail();
    const onboardingToken = await providerToken(email, true);
    const answer = await surface.anonymous().onboarding.complete({ onboardingToken, ...profile });
    expect(answer).toEqual({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      landing: 'student_home',
    });
    expect(surface.counts()).toEqual([
      ['rate_limit_authentication', hashLookupToken(onboardingToken)],
    ]);
    const user = await rowsOf(database).userByEmail(email);
    expect(user?.preferredLanguage).toBe('ar');
  });

  it('lands a teacher on the application, and refuses the same token a second time', async () => {
    const onboardingToken = await providerToken(uniqueEmail(), true);
    const input = { onboardingToken, ...profile, role: 'teacher' as const };
    await expect(surface.anonymous().onboarding.complete(input)).resolves.toMatchObject({
      landing: 'teacher_application',
    });
    await expect(surface.anonymous().onboarding.complete(input)).rejects.toMatchObject({
      cause: { code: 'ONBOARDING_TOKEN_INVALID' },
    });
  });
});
