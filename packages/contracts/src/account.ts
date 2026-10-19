// T038: the `account` namespace of the user surface (app-surface.md "`account` — the signed-in
// person"; FR-131, FR-132, FR-137, FR-140, FR-141, FR-166), contracts first so the phone foundation
// codes against them before T049 implements. `account.me` names every field a client may see and
// nothing of another person; the date of birth is the caller's own (FR-138). No input names
// gender, role or user id (R-GENDER-4) and none names a timestamp (R-TIME-6).
import { z } from 'zod';
import { identityToken, nonce, password } from './auth.js';
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

export const deleteAccountInput = z.object({
  confirmation: deletionConfirmation,
  reauth: deletionReauth,
});

export const identityDocumentType = z.enum(['national_id', 'passport']);

export const identityVerificationGetOutput = z.object({
  open: z.boolean(),
  reason: z.string().optional(),
  requestedAt: z.iso.datetime().optional(),
  documentType: identityDocumentType.optional(),
  submittedAt: z.iso.datetime().optional(),
});

export const identityVerificationSubmitInput = z.object({
  documentType: identityDocumentType,
  /** The id `POST /uploads/documents` returned and the caller owns (public-pages.md). */
  documentId: z.uuid(),
});

export type MeOutput = z.infer<typeof meOutput>;
export type AccountStatus = z.infer<typeof accountStatus>;
export type SignInMethod = z.infer<typeof signInMethod>;
