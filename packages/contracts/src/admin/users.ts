// T058 of specs/004-sessions (FR-481, FR-459, FR-451, FR-426; SRS FR-ADMIN-4; research R-318;
// contracts/admin-surface.md, "`users`"): the user directory, two reads in Phase 1's `users`
// namespace beside `users.requireIdentity`, served by the verification module over identity's and
// sessions' entries.
//
// `users.list`: every user, deleted ones included, newest first by the time-ordered id, in pages of
// `admin_list_page_size`; `name` is the start of a display name, folded (R-203). A deleted user has
// no name (FR-426: the panel shows its stand-in).
//
// `users.get`: FR-ADMIN-4's fields exactly. The person is `targetUserId`, not the contract's first
// `userId`: a `userId` key is refused in any input (R-GENDER-4, `no-authority-in-input`), as
// `users.requireIdentity`'s `targetUserId` is named (admin-surface.md:124). The date of birth never
// crosses: it is read only to derive `isMinor` (R-DB-4), the minor's data being sensitive (PDPL).
// `verificationStatus` is the teacher profile's, null for an account with none; `role` is null only
// for an account without its role row, which no account created through onboarding lacks (ERD §15
// rule 24). `repeatedAbsences` is a teacher's only: the enrollments FR-451 marks, with the count.
import { z } from 'zod';

import { accountStatus, teacherVerificationStatus } from '../account.js';
import { enrollmentStatus } from '../checkout.js';
import { gender, role } from '../onboarding.js';
import { adminSearch } from './admins.js';
import { monitorParty } from './sessions.js';

/** A page of the list starts after this user; users are listed newest first by their time-ordered id. */
export const usersListCursor = z.uuid();

export const usersListInput = z.object({
  /** The start of the user's display name, folded (R-203). */
  name: adminSearch.optional(),
  cursor: usersListCursor.optional(),
});

/** One user of the list. */
export const usersListItem = z.object({
  userId: z.uuid(),
  /** The display name; null for a deleted user (FR-426). */
  displayName: z.string().nullable(),
  deleted: z.boolean(),
  role: role.nullable(),
  accountStatus,
});

export const usersListOutput = z.object({
  items: z.array(usersListItem),
  /** Present while more users follow the page. */
  nextCursor: usersListCursor.optional(),
});

export const usersGetInput = z.object({ targetUserId: z.uuid() });

/** The profile details FR-ADMIN-4 names, as admin-surface.md reads them: no document, photo or date of birth. */
export const userProfile = z.object({
  /** Null for a deleted user (FR-426). */
  displayName: z.string().nullable(),
  email: z.string().nullable(),
  /** The account's sign-up instant (`users.created_at`). */
  joinedAt: z.iso.datetime(),
  deleted: z.boolean(),
  /** A teacher's bio and qualification summary, for an account with a teacher profile. */
  teacher: z.object({ bio: z.string(), qualification: z.string() }).optional(),
});

/** An enrollment of the teacher's that FR-451 marks, with its student, its status and its count. */
export const userRepeatedAbsence = z.object({
  enrollmentId: z.uuid(),
  student: monitorParty,
  status: enrollmentStatus,
  teacherNoShows: z.int().nonnegative(),
});

export const usersGetOutput = z.object({
  userId: z.uuid(),
  profile: userProfile,
  role: role.nullable(),
  /** The gender the person declared (FR-AUTH-3). */
  gender,
  /** Derived from the date of birth when read, never stored (R-DB-4). */
  isMinor: z.boolean(),
  /** The teacher profile's `verification_status`; null for an account with no teacher profile. */
  verificationStatus: teacherVerificationStatus.nullable(),
  accountStatus,
  /** FR-459: the cancellation requests the user made, `recent` within `cancellation_requests_recent_days`. */
  cancellationRequests: z.object({
    total: z.int().nonnegative(),
    recent: z.int().nonnegative(),
  }),
  /** A teacher's only (FR-451, SRS FR-ADMIN-4 as amended on 2026-11-05). */
  repeatedAbsences: z.array(userRepeatedAbsence).optional(),
});

export type UsersListInput = z.infer<typeof usersListInput>;
export type UsersListItem = z.infer<typeof usersListItem>;
export type UsersListOutput = z.infer<typeof usersListOutput>;
export type UsersGetInput = z.infer<typeof usersGetInput>;
export type UsersGetOutput = z.infer<typeof usersGetOutput>;
export type UserRepeatedAbsence = z.infer<typeof userRepeatedAbsence>;
