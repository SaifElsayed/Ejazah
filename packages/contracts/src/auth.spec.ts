// T046: the `auth` schemas of contracts/app-surface.md ("`auth` — sign-in"). The schemas were written
// by T038 (B5) so the phone could code against them first; this spec holds them to the contract, so
// it passed on its first run (note under T046). No input names a user id or a timestamp (R-TIME-6:
// nothing client-supplied is an instant), and none carries an authority field (R-GENDER-4).
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import * as auth from './auth.js';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './password.js';

/** Every `…Input` object schema a module exports, by name. */
function inputsOf(module: Readonly<Record<string, unknown>>): [string, z.ZodObject][] {
  return Object.entries(module).filter(
    (entry): entry is [string, z.ZodObject] =>
      entry[0].endsWith('Input') && entry[1] instanceof z.ZodObject,
  );
}

/** A field name that would carry a user id or an instant from the client. */
const FORBIDDEN_FIELD = /^userId$|At$|^timestamp$|^expires/;

const SIX = '123456';
const EMAIL = 'sara@example.com';

describe('the auth inputs', () => {
  const inputs = inputsOf(auth);

  it('are the seven of the contract', () => {
    expect(inputs.map(([name]) => name).sort()).toEqual(
      [
        'emailSignInInput',
        'refreshInput',
        'requestPasswordResetInput',
        'requestSignUpCodeInput',
        'resetPasswordInput',
        'signInWithProviderInput',
        'verifySignUpCodeInput',
      ].sort(),
    );
  });

  it('name no user id, no timestamp, no gender and no role', () => {
    for (const [name, schema] of inputs) {
      for (const field of Object.keys(schema.shape)) {
        expect(field, `${name}.${field}`).not.toMatch(FORBIDDEN_FIELD);
        expect(['gender', 'role'], `${name}.${field}`).not.toContain(field);
      }
    }
  });

  it('take a provider sign-in with its server nonce, the Apple code optional', () => {
    const input = { provider: 'apple', identityToken: 't', nonce: 'n' };
    expect(auth.signInWithProviderInput.safeParse(input).success).toBe(true);
    expect(
      auth.signInWithProviderInput.safeParse({ ...input, authorizationCode: 'c' }).success,
    ).toBe(true);
    expect(auth.signInWithProviderInput.safeParse({ ...input, provider: 'facebook' }).success).toBe(
      false,
    );
    expect(auth.signInWithProviderInput.safeParse({ ...input, nonce: '' }).success).toBe(false);
  });

  it('take a code of six digits only', () => {
    expect(auth.verifySignUpCodeInput.safeParse({ email: EMAIL, code: SIX }).success).toBe(true);
    for (const code of ['12345', '1234567', '12345a', ' 12345']) {
      expect(auth.verifySignUpCodeInput.safeParse({ email: EMAIL, code }).success, code).toBe(
        false,
      );
    }
  });

  it('bound the password of a sign-in and of a reset by the one pair of bounds', () => {
    const short = 'a'.repeat(PASSWORD_MIN_LENGTH - 1);
    const long = 'a'.repeat(PASSWORD_MAX_LENGTH + 1);
    expect(auth.emailSignInInput.safeParse({ email: EMAIL, password: short }).success).toBe(false);
    expect(
      auth.resetPasswordInput.safeParse({ email: EMAIL, code: SIX, newPassword: long }).success,
    ).toBe(false);
    expect(
      auth.resetPasswordInput.safeParse({
        email: EMAIL,
        code: SIX,
        newPassword: 'a'.repeat(PASSWORD_MIN_LENGTH),
      }).success,
    ).toBe(true);
  });

  it('refuse an address that is not one', () => {
    expect(auth.requestSignUpCodeInput.safeParse({ email: 'not-an-address' }).success).toBe(false);
  });

  // T137: the sign-up code request may carry the password, so a breached one is told at the first
  // step; its bounds are onboarding's, the one pair.
  it('take the sign-up password optionally, by the one pair of bounds', () => {
    const at = (password?: string) =>
      auth.requestSignUpCodeInput.safeParse(
        password === undefined ? { email: EMAIL } : { email: EMAIL, password },
      );
    expect(at().success).toBe(true);
    expect(at('a'.repeat(PASSWORD_MIN_LENGTH)).success).toBe(true);
    expect(at('a'.repeat(PASSWORD_MIN_LENGTH)).data).toEqual({
      email: EMAIL,
      password: 'a'.repeat(PASSWORD_MIN_LENGTH),
    });
    expect(at('a'.repeat(PASSWORD_MIN_LENGTH - 1)).success).toBe(false);
    expect(at('a'.repeat(PASSWORD_MAX_LENGTH + 1)).success).toBe(false);
  });
});

describe('the auth outputs', () => {
  it('land on one of the four landings', () => {
    expect(auth.landing.options).toEqual([
      'student_home',
      'teacher_application',
      'teacher_home',
      'restricted',
    ]);
  });

  it('answer a provider sign-in with a session or an onboarding token and its prefill', () => {
    const session = { accessToken: 'a', refreshToken: 'r', landing: 'student_home' };
    expect(
      auth.signInWithProviderOutput.safeParse({ outcome: 'session', ...session }).success,
    ).toBe(true);
    expect(
      auth.signInWithProviderOutput.safeParse({
        outcome: 'onboarding',
        onboardingToken: 'o',
        prefill: { emailVerified: false },
      }).success,
    ).toBe(true);
    expect(
      auth.signInWithProviderOutput.safeParse({ outcome: 'onboarding', onboardingToken: 'o' })
        .success,
    ).toBe(false);
  });

  it('answer the nonce with its expiry as an instant', () => {
    expect(
      auth.providerNonceOutput.safeParse({ nonce: 'n', expiresAt: '2026-10-20T08:10:00Z' }).success,
    ).toBe(true);
    expect(auth.providerNonceOutput.safeParse({ nonce: 'n', expiresAt: 'soon' }).success).toBe(
      false,
    );
  });
});
