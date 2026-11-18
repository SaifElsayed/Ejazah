// 003:T105: the user surface's `teacher.dues.get`, the teacher's «مستحقاتي» (SRS DEC-81, DEC-89;
// ADR 0025 D2; the note under T105 and the owner's «تمام موافق» of 2026-11-17).
//
// The teacher's own releases only: one row per package or programme part (a recitation package; the
// ijazah half; the ijazah rest; a close's release), each with its amount and its state: `held`, with
// when it would fall due; `due`, awaiting the administrator; or `paid`, with its date. Two totals on
// top, held and paid. `deductions` is «عليه»: his own share of each refund recorded on his orders
// (the refund × the order's rate, rounded up, Q-6 as revised). No order line and no student's name
// crosses here: no order, enrollment or student id either. Money crosses as `_piasters` integers
// (R-MONEY-1).
import { z } from 'zod';

/** A whole number of piasters (ERD §0). */
const amountPiasters = z.int().nonnegative();

/** Why a release falls due (ERD §7, `share_release_milestone`). */
export const shareReleaseMilestone = z.enum([
  'recitation_end',
  'ijazah_half',
  'ijazah_end',
  'teacher_dropout',
  'student_complaint_close',
]);

/** Where a release stands: computed and not yet due, due and awaiting the mark, or marked paid. */
export const shareReleaseState = z.enum(['held', 'due', 'paid']);

/** One of the teacher's releases, as «مستحقاتي» shows it. */
export const teacherDuesRelease = z.object({
  part: shareReleaseMilestone,
  amount_piasters: amountPiasters,
  state: shareReleaseState,
  /**
   * When it falls due: for `held`, when it would by its rule (after the last session's dispute
   * window, «لو مفيش شكوى»), absent while no session tells it; for `due` and `paid`, when it fell due.
   */
  fallsDueAt: z.iso.datetime().optional(),
  /** Whether an open case keeps a `held` release from falling due now. */
  waitsForCase: z.boolean(),
  /** When the administrator marked it paid; `paid` only. */
  paidAt: z.iso.datetime().optional(),
});

/** One refund recorded on the teacher's orders: his own share of it, and the closing case's reason. */
export const teacherDuesDeduction = z.object({
  share_piasters: amountPiasters,
  /** The reason of the enrollment's closing case, when one closed it (one of the case reasons). */
  caseReason: z.string().max(64).optional(),
});

export const teacherDuesGetOutput = z.object({
  held_piasters: amountPiasters,
  paid_piasters: amountPiasters,
  releases: z.array(teacherDuesRelease),
  deductions: z.array(teacherDuesDeduction),
});

export type ShareReleaseMilestone = z.infer<typeof shareReleaseMilestone>;
export type ShareReleaseState = z.infer<typeof shareReleaseState>;
export type TeacherDuesRelease = z.infer<typeof teacherDuesRelease>;
export type TeacherDuesDeduction = z.infer<typeof teacherDuesDeduction>;
export type TeacherDuesGetOutput = z.infer<typeof teacherDuesGetOutput>;
