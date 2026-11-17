// T038: the `account` namespace of the user surface (app-surface.md "`account` — the signed-in
// person"; FR-131, FR-132, FR-137, FR-140, FR-141, FR-166), contracts first so the phone foundation
// codes against them before T049 implements. `account.me` names every field a client may see and
// nothing of another person; the date of birth is the caller's own (FR-138). No input names
// gender, role or user id (R-GENDER-4) and none names a timestamp (R-TIME-6).
import { z } from 'zod';

import { idempotencyKey } from './idempotency-key.js';
import { identityToken, landing, nonce } from './auth.js';
import { password } from './password.js';
import { calendarDate, displayName, gender, role, timeZone } from './onboarding.js';
import { emailAddress } from './platform.js';

export const language = z.enum(['ar', 'en']);

/** ERD §2, `users.account_status`. */
export const accountStatus = z.enum(['active', 'suspended', 'verification_required', 'banned']);

export const signInMethod = z.enum(['google', 'apple', 'email']);

/** What the applicant sees of the application (data-model §3); `not_started` before the first submission. */
export const teacherApplicationStatus = z.enum([
  'not_started',
  'in_review',
  'needs_document',
  'rejected',
  'banned',
  'approved',
]);

/** ERD §2, `teacher_profiles.verification_status`. */
export const teacherVerificationStatus = z.enum([
  'pending',
  'approved',
  'rejected',
  'suspended',
  'banned',
  'revoked',
]);

export const payoutSummary = z.object({
  configured: z.boolean(),
  verified: z.boolean(),
  rejectedReason: z.string().optional(),
});

export const meOutput = z.object({
  userId: z.uuid(),
  role,
  displayName: z.string(),
  /** Null for a provider account whose provider reported no verified address. */
  email: emailAddress.nullable(),
  gender,
  /** The caller's own, shown locked on the profile editor; never another person's. */
  dateOfBirth: calendarDate,
  preferredLanguage: language,
  timezone: timeZone,
  signInMethod,
  memberSince: z.iso.datetime(),
  accountStatus,
  /**
   * Where the app lands this account now, by the rule a sign-in answers with (T052: the guard's
   * landing at launch reads it here, so the rule lives on the server only).
   */
  landing,
  /** A signed, expiring link to the profile photo, when one is set. */
  photoUrl: z.string().optional(),
  teacher: z
    .object({
      applicationStatus: teacherApplicationStatus,
      verificationStatus: teacherVerificationStatus,
      payout: payoutSummary,
    })
    .optional(),
});

export const updateProfileInput = z.object({ displayName: displayName.optional() });

export const setLanguageInput = z.object({ language });

export const setTimezoneInput = z.object({ timezone: timeZone });

export const reportDeviceTimezoneInput = z.object({ timezone: timeZone });

/** The typed word, in either language (ADR 0015 D1). */
export const deletionConfirmation = z.enum(['حذف', 'DELETE']);

/** A fresh proof that must be the caller's own (ADR 0015 D2). */
export const deletionReauth = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('provider'), identityToken, nonce }),
  z.object({ kind: z.literal('password'), password }),
]);

/** `account.delete` is keyed (app-surface.md, "What every procedure guarantees"; B16 check, decision 6). */
export const deleteAccountInput = z.object({
  confirmation: deletionConfirmation,
  reauth: deletionReauth,
  idempotencyKey,
});

export const identityDocumentType = z.enum(['national_id', 'passport']);

/**
 * T115: how the person's latest closed request ended and when; a `replaced` one carries the reason
 * of the open request that replaced it. An `expired` request shows no outcome, and a `satisfied` one
 * shows only while no request is open (T128).
 */
export const identityVerificationOutcome = z.object({
  status: z.enum(['satisfied', 'replaced']),
  resolvedAt: z.iso.datetime(),
  reason: z.string().optional(),
});

export const identityVerificationGetOutput = z.object({
  open: z.boolean(),
  reason: z.string().optional(),
  requestedAt: z.iso.datetime().optional(),
  documentType: identityDocumentType.optional(),
  submittedAt: z.iso.datetime().optional(),
  lastOutcome: identityVerificationOutcome.optional(),
});

export const identityVerificationSubmitInput = z.object({
  documentType: identityDocumentType,
  /** The id `POST /uploads/documents` returned and the caller owns (public-pages.md). */
  documentId: z.uuid(),
});

export type MeOutput = z.infer<typeof meOutput>;
export type TeacherApplicationStatus = z.infer<typeof teacherApplicationStatus>;
export type AccountStatus = z.infer<typeof accountStatus>;
export type SignInMethod = z.infer<typeof signInMethod>;
export type IdentityDocumentType = z.infer<typeof identityDocumentType>;
export type DeleteAccountInput = z.infer<typeof deleteAccountInput>;
export type IdentityVerificationGetOutput = z.infer<typeof identityVerificationGetOutput>;
export type IdentityVerificationOutcome = z.infer<typeof identityVerificationOutcome>;

// T004 of specs/005-certification (FR-602; ADR 0019 D1; app-surface.md, `account.certificateName.set`):
// the student's full name as the certificate prints it, entered once; afterwards only an
// administrator changes it (`users.setCertificateName`). Its bounds are the display name's
// (`onboarding.ts`), no document naming others. It refuses a control character (`\p{Cc}`: a line
// break, a NUL) and the direction controls, the embeddings and overrides U+202A–U+202E and the
// isolates U+2066–U+2069: printed on a permanent certificate, either would garble the line or make
// two names look alike (#145 r1 Minor 2; the chat file name's `\p{Cc}` precedent, `chat.ts`).
export const certificateName = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[^\p{Cc}\u202A-\u202E\u2066-\u2069]+$/u);

/** Keyed (app-surface.md, "App surface: Phase 4 additions"); refused `already_set` once a name is held. */
export const certificateNameSetInput = z.object({ name: certificateName, idempotencyKey });

export const certificateNameSetOutput = z.object({ name: z.string() });

export type CertificateNameSetInput = z.infer<typeof certificateNameSetInput>;
export type CertificateNameSetOutput = z.infer<typeof certificateNameSetOutput>;

// T005 of specs/005-certification (FR-620; R-405; app-surface.md, `account.pushToken.register` and
// `.remove`): the phone's push token, registered when the application starts and removed at sign-out.
// The token is the provider's own opaque string, bounded as the sign-in provider's tokens are
// (`auth.ts`, `identityToken`); it is stored encrypted and looked up by its hash, and no answer
// echoes it. The platform is ERD §2's `device_push_tokens.platform`.
export const devicePlatform = z.enum(['ios', 'android']);

export const pushToken = z.string().min(1).max(4096);

export const pushTokenRegisterInput = z.object({ token: pushToken, platform: devicePlatform });

export const pushTokenRemoveInput = z.object({ token: pushToken });

export type DevicePlatform = z.infer<typeof devicePlatform>;
export type PushTokenRegisterInput = z.infer<typeof pushTokenRegisterInput>;
export type PushTokenRemoveInput = z.infer<typeof pushTokenRemoveInput>;
