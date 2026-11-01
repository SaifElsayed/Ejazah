// T038: the `auth` namespace of the user surface (app-surface.md "`auth` — sign-in"; FR-120 to
// FR-123, FR-129, FR-135), contracts first so the phone foundation codes against them before T048
// implements. Every input is what a client sends and nothing it may not say: no gender, role or
// user id (R-GENDER-4), no timestamp (R-TIME-6). An instant in an output is an ISO-8601 string in
// UTC (contracts/README.md "Dates").
import { z } from 'zod';
import { emailAddress } from './platform.js';
import { password } from './password.js';

/** The providers a person may sign in with (ADR 0012 D2). */
export const authProvider = z.enum(['google', 'apple']);

// Every token a client sends is bounded (PR #80 review, finding 5): a provider's identity token is
// a JWT of a few kilobytes, an opaque token of this platform far less, a nonce or a code less still.
/** An identity token a provider issued to the device. */
export const identityToken = z.string().min(1).max(4096);
/** A nonce `auth.providerNonce` minted. */
export const nonce = z.string().min(1).max(256);
/** Apple's authorization code. */
export const authorizationCode = z.string().min(1).max(2048);
/** A token this platform issued: access, refresh or onboarding. */
export const platformToken = z.string().min(1).max(4096);

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
  accessToken: platformToken,
  refreshToken: platformToken,
  landing,
});

/** `auth.providerNonce` → the nonce the next provider sign-in must carry, and when it lapses. */
export const providerNonceOutput = z.object({
  nonce,
  expiresAt: z.iso.datetime(),
});

export const signInWithProviderInput = z.object({
  provider: authProvider,
  identityToken,
  nonce,
  /** Apple's authorization code, exchanged at once for the refresh token (TN3194). */
  authorizationCode: authorizationCode.optional(),
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
    onboardingToken: platformToken,
    prefill: signInPrefill,
  }),
]);

/**
 * The password the person chose may come with the request (T137), so a breached one is told at the
 * step that holds its field; the bounds are onboarding's, and the breached check is the service's.
 */
export const requestSignUpCodeInput = z.object({
  email: emailAddress,
  password: password.optional(),
});

export const verifySignUpCodeInput = z.object({ email: emailAddress, code: oneTimeCode });

export const verifySignUpCodeOutput = z.object({ onboardingToken: platformToken });

export const emailSignInInput = z.object({ email: emailAddress, password });

export const requestPasswordResetInput = z.object({ email: emailAddress });

export const resetPasswordInput = z.object({
  email: emailAddress,
  code: oneTimeCode,
  newPassword: password,
});

export const refreshInput = z.object({ refreshToken: platformToken });

export const refreshOutput = z.object({
  accessToken: platformToken,
  refreshToken: platformToken,
});

export type AuthProvider = z.infer<typeof authProvider>;
export type Landing = z.infer<typeof landing>;
export type SessionOutput = z.infer<typeof sessionOutput>;
export type SignInWithProviderOutput = z.infer<typeof signInWithProviderOutput>;
