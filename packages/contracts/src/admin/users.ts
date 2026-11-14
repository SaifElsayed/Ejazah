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

/**
 * T077 of specs/004-sessions (FR-509; SRS FR-ADMIN-21, DEC-67): a document a deleted teacher once
 * approved keeps, by its metadata only: never its key or a link (PDPL minimisation); the link is
 * `teachers.keptData.documentLink`, one per press with a reason.
 */
export const userKeptDocument = z.object({
  id: z.uuid(),
  kind: z.enum(['national_id', 'passport', 'credential']),
  uploadedAt: z.iso.datetime(),
});

/**
 * T077: what a deleted teacher's profile keeps: the kept documents, whether the payout reference is
 * kept (never its value), the erasure date an administrator set (null for none) and the erasure
 * (null until it ran). A teacher never approved keeps nothing: no document, no payout.
 */
export const userKeptData = z.object({
  documents: z.array(userKeptDocument),
  payoutKept: z.boolean(),
  eraseAt: z.iso.datetime().nullable(),
  erasedAt: z.iso.datetime().nullable(),
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
  /**
   * T072 of specs/004-sessions (FR-502, FR-503; SRS DEC-69; the note under T072, Q9 (a)): the latest
   * hold end among the enrollments the account's ban or revocation closed whose slot is still held
   * (their case open, not released), each the closing case's opening plus `ban_restore_window_days`
   * through the one closing rule; it may already have passed. Null for none.
   */
  enrollmentsSlotHeldUntil: z.iso.datetime().nullable(),
  /**
   * B42b, T075 of specs/004-sessions (the note under T075, Q-O2 (a)): `ban_restore_window_days`,
   * the days a ban's or a revocation's closing holds its slot (DEC-66, DEC-69), for the panel's
   * `{days}` in the student's ban and the lifts. Additive (R-API-9).
   */
  banRestoreWindowDays: z.int().positive(),
  /**
   * T077 of specs/004-sessions (FR-509; SRS FR-ADMIN-21; the note under T077, N3): a deleted
   * teacher's kept data (`userKeptData`); absent for anyone else. Additive (R-API-9).
   */
  keptData: userKeptData.optional(),
  /**
   * T077 (SRS FR-ADMIN-21, Q-E (a)): for a live teacher, whether a deleted teacher's kept profile
   * holds the payout account this teacher registered; absent for anyone else. Additive (R-API-9).
   */
  payoutKeptOnDeletedTeacher: z.boolean().optional(),
});

export type UsersListInput = z.infer<typeof usersListInput>;
export type UsersListItem = z.infer<typeof usersListItem>;
export type UsersListOutput = z.infer<typeof usersListOutput>;
export type UsersGetInput = z.infer<typeof usersGetInput>;
export type UsersGetOutput = z.infer<typeof usersGetOutput>;
export type UserRepeatedAbsence = z.infer<typeof userRepeatedAbsence>;
export type UserKeptData = z.infer<typeof userKeptData>;
