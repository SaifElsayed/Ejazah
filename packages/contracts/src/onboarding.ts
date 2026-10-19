// T038: the `onboarding` namespace of the user surface (app-surface.md "`onboarding` — the first
// sign-in"; FR-124 to FR-127), contracts first so the phone foundation codes against them before
// T048 implements.
//
// `onboardingCompleteInput` is the one input schema of this package that carries `gender` and
// `role`: the declarations themselves, made once by the person before any account exists
// (R-GENDER-6). `authority-allow-list.ts` names this schema with exactly those two fields, and
// `gender/no-authority-in-input` reads that list; every other input is refused them. A date of
// birth is a calendar date, never an instant (R-TIME-6, contracts/README.md "Dates").
import { z } from 'zod';
import { emailAddress, termsVersion } from './platform.js';
import { oneTimeCode, password, sessionOutput } from './auth.js';

/** The signed, stateless token a proven identity rides in until `complete` (research R-102). */
export const onboardingToken = z.string().min(1);

export const role = z.enum(['student', 'teacher']);

export const gender = z.enum(['male', 'female']);

export const displayName = z.string().trim().min(2).max(80);

/** A calendar date, `YYYY-MM-DD`. */
export const calendarDate = z.iso.date();

/** An IANA zone name; whether the time package knows it is the service's check. */
export const timeZone = z.string().min(1).max(64);

export const requestEmailCodeInput = z.object({ onboardingToken, email: emailAddress });

export const onboardingCompleteInput = z.object({
  onboardingToken,
  role,
  displayName,
  gender,
  dateOfBirth: calendarDate,
  timezone: timeZone,
  termsVersion,
  /** Required exactly when the token's identity is an email; refused otherwise. */
  password: password.optional(),
  /** Both required exactly when the token's identity has no verified email. */
  email: emailAddress.optional(),
  emailCode: oneTimeCode.optional(),
});

export const onboardingCompleteOutput = sessionOutput;

export type Role = z.infer<typeof role>;
export type Gender = z.infer<typeof gender>;
export type OnboardingCompleteInput = z.infer<typeof onboardingCompleteInput>;
