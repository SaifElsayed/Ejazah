// T038: the `auth` namespace of the user surface (app-surface.md "`auth` — sign-in"; FR-120 to
// FR-123, FR-129, FR-135), contracts first so the phone foundation codes against them before T048
// implements. Every input is what a client sends and nothing it may not say: no gender, role or
// user id (R-GENDER-4), no timestamp (R-TIME-6). An instant in an output is an ISO-8601 string in
// UTC (contracts/README.md "Dates").
import { z } from 'zod';
import { emailAddress } from './platform.js';

/** The providers a person may sign in with (ADR 0012 D2). */
export const authProvider = z.enum(['google', 'apple']);

/** A password: length only, no composition rule; the breached check is the service's (FR-128). */
export const password = z.string().min(8).max(128);

/** A one-time code as the person types it: six digits (research R-104). */
export const oneTimeCode = z.string().regex(/^[0-9]{6}$/);

/** Where the app lands after a sign-in (FR-130, FR-137). */
export const landing = z.enum([
  'student_home',
  'teacher_application',
  'teacher_home',
  'restricted',
]);

/** A session: the two tokens and where to land. */
export const sessionOutput = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  landing,
});

/** `auth.providerNonce` → the nonce the next provider sign-in must carry, and when it lapses. */
export const providerNonceOutput = z.object({
  nonce: z.string().min(1),
  expiresAt: z.iso.datetime(),
});

export const signInWithProviderInput = z.object({
  provider: authProvider,
  identityToken: z.string().min(1),
  nonce: z.string().min(1),
  /** Apple's authorization code, exchanged at once for the refresh token (TN3194). */
  authorizationCode: z.string().min(1).optional(),
});

/** What the provider offered, for the onboarding form to prefill; the email only when verified. */
export const signInPrefill = z.object({
  displayName: z.string().optional(),
  email: emailAddress.optional(),
  emailVerified: z.boolean(),
});

export const signInWithProviderOutput = z.discriminatedUnion('outcome', [
  sessionOutput.extend({ outcome: z.literal('session') }),
  z.object({
    outcome: z.literal('onboarding'),
    onboardingToken: z.string().min(1),
    prefill: signInPrefill,
  }),
]);

export const requestSignUpCodeInput = z.object({ email: emailAddress });

export const verifySignUpCodeInput = z.object({ email: emailAddress, code: oneTimeCode });

export const verifySignUpCodeOutput = z.object({ onboardingToken: z.string().min(1) });

export const emailSignInInput = z.object({ email: emailAddress, password });

export const requestPasswordResetInput = z.object({ email: emailAddress });

export const resetPasswordInput = z.object({
  email: emailAddress,
  code: oneTimeCode,
  newPassword: password,
});

export const refreshInput = z.object({ refreshToken: z.string().min(1) });

export const refreshOutput = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
});

export type AuthProvider = z.infer<typeof authProvider>;
export type Landing = z.infer<typeof landing>;
export type SessionOutput = z.infer<typeof sessionOutput>;
export type SignInWithProviderOutput = z.infer<typeof signInWithProviderOutput>;
