// T016: the `teacher.profile` namespace of the user surface (specs/003-booking/contracts/
// app-surface.md "`teacher.profile` — identity"; FR-310, FR-PROFILE-1, FR-PROFILE-7).
//
// `update` writes the bio and the qualification summary only: the display name stays
// `account.updateProfile`'s (T158) and the photo `POST /uploads/photos`'. The gender is shown on
// `get` and named by no input (R-GENDER-6). `published` is the visibility predicate's answer for
// this teacher as a same-gender student would get it (FR-315).
import { z } from 'zod';

import { gender } from './onboarding.js';
import { QUALIFICATION_MAX_LENGTH } from './teacher-application.js';

/** The longest bio the profile takes, in characters. Empty is allowed: the column holds `''`. */
export const BIO_MAX_LENGTH = 1000;

/** `teacher.profile.get`'s answer. */
export const teacherProfileGetOutput = z.object({
  displayName: z.string(),
  /** A signed, expiring link to the profile photo, when one is set. */
  photoUrl: z.string().optional(),
  bio: z.string(),
  qualificationSummary: z.string(),
  gender,
  published: z.boolean(),
});

/** The qualification has the application form's bound: the same column (FR-150). */
export const teacherProfileUpdateInput = z.object({
  bio: z.string().trim().max(BIO_MAX_LENGTH),
  qualificationSummary: z.string().trim().min(1).max(QUALIFICATION_MAX_LENGTH),
});

export const teacherProfileUpdateOutput = z.object({
  bio: z.string(),
  qualificationSummary: z.string(),
});

export type TeacherProfileGetOutput = z.infer<typeof teacherProfileGetOutput>;
export type TeacherProfileUpdateInput = z.infer<typeof teacherProfileUpdateInput>;
export type TeacherProfileUpdateOutput = z.infer<typeof teacherProfileUpdateOutput>;
