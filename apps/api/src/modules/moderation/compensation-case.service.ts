// T035 (FR-362, FR-375, FR-DISPUTE-5; the owner's decisions of 2026-11-01, PR #109's review round
// 2): the system opens a compensation case on an enrollment, for a reason of a closed list, written
// to `disputes.reason` (no new column). One open case per enrollment and reason: a call while that
// case is open opens no second one and joins it (a second duplicate payment adds to the open
// `duplicate_payment` case, whose enrollment's paid orders the monitor lists, T052); a call after it
// was resolved or dismissed opens a new one; each reason is a case of its own. The case carries no
// amount (R-MONEY-6): an administrator decides it, outside this function (FR-DISPUTE-6).
//
// LOCKS (T005's rules). Nothing in the database keeps one open case per enrollment and reason, so
// the function locks the enrollment's row first and only then reads the open case (rule 1, lock then
// read): a second call for the same enrollment waits until the first commits, then reads its case
// and joins it. The insert references the enrollment, already locked, and no `users` row: the
// system raises the case, so `raised_by_user_id` stays NULL (ERD §10), and a session dispute's
// `session_id` stays NULL. In T005's order the enrollment comes after the accounts, the teacher's
// profile, the slot and the hold, so a caller may already hold any of those, and the enrollment's
// own row (the lock is then the one it holds). A caller must not hold a `payments` row's lock, nor
// another enrollment's with a greater id, when it calls (rule 2, one order, id order in a table).
// A path that closes a case (Phase 3's resolution) takes the enrollment's lock before it writes, or
// a call could join a case the same moment it is closed.
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { insertCase, lockCasesOf, openCaseOf } from './compensation-case.repository.js';

/** Why the system opened a case: the closed list `disputes.reason` takes for a compensation case. */
export const COMPENSATION_REASONS = [
  // FR-362: the database refused a late paid event's confirmation (FR-PAYG-19).
  'slot_unavailable',
  // FR-362: a party's account was restricted (R-219), or failed the parties' check before a late
  // confirmation (`isBookablePair`).
  'party_restricted',
  // FR-375: a second paid order on an enrollment already confirmed.
  'duplicate_payment',
  // Phase 3 (T004 of specs/004-sessions; research R-312, R-322, R-326; the ERD's changelog row 25:
  // a closed list in code, no column or check). An administrator's termination on a complaint
  // (`absence_termination`, in place of the removed `teacher_no_show_threshold`, ADR 0023); an
  // administrator's cancellation; a teacher's end; a student's suspension, ban and confirmed
  // fault (the second analysis, C1); a student's refund choice; a counter-proposal left
  // unanswered; a make-up the database refused on every attempt.
  'absence_termination',
  'admin_cancellation',
  'teacher_ended',
  'student_suspended',
  'student_banned',
  'student_fault_confirmed',
  'refund_choice',
  'counter_unanswered',
  'makeup_refused',
  // An administrator's manual case, its party being its reason (R-326).
  'admin_opened_for_student',
  'admin_opened_for_teacher',
] as const;

/**
 * The reasons Phase 2's covering rule reads (`caseInstantsAmong`; FR-362 of
 * `specs/003-booking/spec.md`, the note under it): Phase 2's three only, never one Phase 3 adds,
 * so no case of a teacher's end, a manual case or any other covers a second paid order, whose
 * `duplicate_payment` case then opens (FR-493; R-326; the owner's decision of 2026-11-06 on PR
 * #126's review, follow-up 1).
 */
export const COVERING_REASONS = [
  'slot_unavailable',
  'party_restricted',
  'duplicate_payment',
] as const;

export type CompensationReason = (typeof COMPENSATION_REASONS)[number];

/** The enrollment's open case of that reason, and whether this call opened it. */
export interface CompensationCase {
  readonly caseId: string;
  readonly opened: boolean;
}

/**
 * Opens the enrollment's compensation case of `reason`, or joins the one already open, on the
 * caller's transaction. Locks the enrollment's row first (see LOCKS above).
 */
export async function openCompensationCase(
  tx: Transaction,
  enrollmentId: string,
  reason: CompensationReason,
): Promise<CompensationCase> {
  await lockCasesOf(tx, enrollmentId);
  const open = await openCaseOf(tx, enrollmentId, reason);
  if (open !== null) return { caseId: open, opened: false };
  return { caseId: await insertCase(tx, enrollmentId, reason), opened: true };
}
