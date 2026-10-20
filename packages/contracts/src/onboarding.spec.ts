// T046: the `onboarding` schemas of contracts/app-surface.md ("`onboarding` — the first sign-in").
// Written by T038 (B5) before this spec, so it passed on its first run (note under T046).
// `onboarding.complete` is the one input that carries `gender` and `role` (the allow-list,
// R-GENDER-4); the password is optional on the schema, since the service requires it exactly when
// the token's identity is an email; the date of birth is a calendar date (R-TIME-6).
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { authorityAllowList } from './authority-allow-list.js';
import * as onboarding from './onboarding.js';
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

const complete = {
  onboardingToken: 'token',
  role: 'teacher',
  displayName: 'سارة عادل',
  gender: 'female',
  dateOfBirth: '1990-04-12',
  timezone: 'Africa/Cairo',
  termsVersion: '2026-10',
} as const;

describe('the onboarding inputs', () => {
  const inputs = inputsOf(onboarding);

  it('are the two of the contract', () => {
    expect(inputs.map(([name]) => name).sort()).toEqual([
      'onboardingCompleteInput',
      'requestEmailCodeInput',
    ]);
  });

  it('carry gender and role on `complete` alone, as the allow-list says', () => {
    expect(authorityAllowList).toEqual({ onboardingCompleteInput: ['gender', 'role'] });
    expect(Object.keys(onboarding.requestEmailCodeInput.shape)).not.toContain('gender');
    expect(Object.keys(onboarding.requestEmailCodeInput.shape)).not.toContain('role');
    expect(onboarding.onboardingCompleteInput.shape).toHaveProperty('gender');
    expect(onboarding.onboardingCompleteInput.shape).toHaveProperty('role');
  });

  it('name no user id and no timestamp', () => {
    for (const [name, schema] of inputs) {
      for (const field of Object.keys(schema.shape)) {
        expect(field, `${name}.${field}`).not.toMatch(FORBIDDEN_FIELD);
      }
    }
  });

  it('take `complete` without a password, an email or a code, and with them', () => {
    expect(onboarding.onboardingCompleteInput.safeParse(complete).success).toBe(true);
    expect(
      onboarding.onboardingCompleteInput.safeParse({
        ...complete,
        password: 'a'.repeat(PASSWORD_MIN_LENGTH),
        email: 'sara@example.com',
        emailCode: '123456',
      }).success,
    ).toBe(true);
  });

  it('bound the password by the one pair of bounds', () => {
    for (const length of [PASSWORD_MIN_LENGTH - 1, PASSWORD_MAX_LENGTH + 1]) {
      expect(
        onboarding.onboardingCompleteInput.safeParse({ ...complete, password: 'a'.repeat(length) })
          .success,
        String(length),
      ).toBe(false);
    }
  });

  it('take one role of two and one gender of two', () => {
    expect(onboarding.role.options).toEqual(['student', 'teacher']);
    expect(onboarding.gender.options).toEqual(['male', 'female']);
    expect(
      onboarding.onboardingCompleteInput.safeParse({ ...complete, role: 'admin' }).success,
    ).toBe(false);
  });

  it('take the date of birth as a calendar date, never an instant', () => {
    for (const dateOfBirth of ['1990-04-12T00:00:00Z', '12/04/1990', '1990-13-01']) {
      expect(
        onboarding.onboardingCompleteInput.safeParse({ ...complete, dateOfBirth }).success,
        dateOfBirth,
      ).toBe(false);
    }
  });

  it('take a display name of two to eighty characters, trimmed', () => {
    expect(
      onboarding.onboardingCompleteInput.safeParse({ ...complete, displayName: ' س ' }).success,
    ).toBe(false);
    expect(
      onboarding.onboardingCompleteInput.safeParse({ ...complete, displayName: 'a'.repeat(81) })
        .success,
    ).toBe(false);
  });
});
