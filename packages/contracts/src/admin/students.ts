// T005 of specs/004-sessions (`002:T144`; FR-421, FR-486; R-313): the administrator surface's
// `students` namespace (admin-surface.md "`students` — a student's standing"). Each action carries its
// mandatory reason, which reaches the audit log (`student.suspend`, `student.ban`,
// `student.reinstate`); each answers nothing. The person's field is `studentUserId`, not the
// contract's first `userId`: a field named `userId` is refused in any input (R-GENDER-4,
// `no-authority-in-input`), as `teacherUserId` and Phase 1's `targetUserId` are named (the owner's
// decision of 2026-11-07).
import { z } from 'zod';

import { idempotencyKey } from '../idempotency-key.js';
import { adminReason } from './admins.js';

export const studentsActionInput = z.object({ studentUserId: z.uuid(), reason: adminReason });

// T072 of specs/004-sessions (FR-502; SRS FR-ADMIN-5 as amended, DEC-66, DEC-69; admin-surface.md,
// `students.liftBan`, `teachers.liftBan`, `teachers.liftRevocation`): a ban or a revocation lifted,
// at any time, with a mandatory reason, keyed under the administrator's idempotency key. Each
// enrollment the ban or the revocation closed is restored as `sessions.restore` restores one; one
// refused stays ended with its case open, the answer naming its cause. Refused `CONFLICT` with
// `details.cause` `not_banned`, `not_revoked` or `restore_failed`, and `NOT_FOUND`, each writing
// nothing. The lifts' shared schemas live here; `teachers.ts` reuses them.

/**
 * Why a lift left one enrollment ended: a restore's cause found before its first write (R-322; the
 * note under T072, Q7 (a)), or (Q10 (a)) `gender_mismatch`, the pairing's two genders differing.
 */
export const banLiftEnrollmentCause = z.enum([
  'not_restorable',
  'case_closed',
  'party_restricted',
  'slot_inactive',
  'slot_changed',
  'slot_taken',
  'time_taken',
  'refunded',
  'gender_mismatch',
]);

/** One enrollment the ban or the revocation closed, as the lift left it. */
export const banLiftEnrollment = z.object({
  enrollmentId: z.uuid(),
  restored: z.boolean(),
  /** Present when not restored. */
  cause: banLiftEnrollmentCause.optional(),
});

/**
 * Why a whole lift was refused, as `CONFLICT`'s `details.cause`: the person not banned, the teacher
 * not revoked, or (Q7 (a)) a restore refused after its first write (`no_free_week`, or the
 * database's exclusion at the insert), the refusal naming the enrollment.
 */
export const banLiftRefusalCause = z.enum(['not_banned', 'not_revoked', 'restore_failed']);

/** What a lift answers: each enrollment the ban or the revocation closed, in id order. */
export const banLiftOutput = z.object({ enrollments: z.array(banLiftEnrollment) });

export const studentsLiftBanInput = z.object({
  studentUserId: z.uuid(),
  reason: adminReason,
  idempotencyKey,
});

export type BanLiftEnrollmentCause = z.infer<typeof banLiftEnrollmentCause>;
export type BanLiftEnrollment = z.infer<typeof banLiftEnrollment>;
export type BanLiftRefusalCause = z.infer<typeof banLiftRefusalCause>;
export type BanLiftOutput = z.infer<typeof banLiftOutput>;
export type StudentsLiftBanInput = z.infer<typeof studentsLiftBanInput>;
