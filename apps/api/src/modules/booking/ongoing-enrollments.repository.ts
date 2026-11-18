// T080 of specs/004-sessions/tasks.md (FR-511; SRS FR-AUTH-14 as amended, DEC-67, DEC-69; the note
// under T080, Q-R11 (a), N4): whether an account has an ongoing enrollment, which refuses the
// person's own deletion. Read on the deletion's transaction after the account's lock (identity's
// `OngoingEnrollments` port, bound by `main.ts`): the paths that make an enrollment of the person
// ongoing lock the account first (`pay.service.ts`' payment, `confirmation.service.ts`'
// `lockForConfirmation`, the restore's `lockAccounts` in `sessions/restore.service.ts`, which a
// lift runs), so what this reads cannot change before the deletion commits (T005's rules,
// `platform/db/row-lock.ts`). No lock of its own.
//
// WHAT COUNTS (N4). An enrollment of the person, as student or teacher, `pending_payment` or
// `confirmed` (one paused by a teacher's suspension is `confirmed`); and the closing of the person's
// own ban (a student's `student_banned`) or ban or revocation (a teacher's `teacher_ended`) while its
// slot is held: its case open, `slot_released_at` NULL and the database's clock before the hold's
// end, through the one closing rule (sessions' `closingOf`, `latestEndCaseOf` and `restorableUntil`,
// the cases read through moderation's `compensationCasesAmong`, as `slotUses` reads them). Every
// other closing is not counted (a complaint's, a fault's, a deletion's, an administrator's direct
// end), nor the counterparty of a ban's closing, whose enrollment the other party's end closed.
//
// THE READS. One statement over the two parties' indexes for a live enrollment, which ends the
// question when it finds one; else the person's own held closings, over the same indexes (a student's
// `cancelled` `admin`, a teacher's `cancelled` `teacher_suspended`, each with `confirmed_at` set and
// `slot_released_at` NULL), bounded by the person's own closings, then one read of their cases. A
// soft-deleted enrollment is left out by the client's extension (T148).
import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import { compensationCasesAmong } from '../moderation/index.js';
import {
  type ClosingKind,
  closingOf,
  latestEndCaseOf,
  restorableUntil,
  type WindowDays,
  windowDaysOf,
} from '../sessions/index.js';

/** The closing of the person's own end, by the side they hold in the enrollment (N4). */
const OWN_CLOSING: Readonly<Record<'student' | 'teacher', ClosingKind>> = {
  student: 'student_banned',
  teacher: 'teacher_ended',
};

/** Whether `userId` has an ongoing enrollment, on the caller's transaction (this file's head). */
export async function hasOngoingEnrollment(
  tx: Transaction,
  userId: string,
  windowDays: WindowDays,
): Promise<boolean> {
  if (await hasLiveEnrollment(tx, userId)) return true;
  const closed = await tx.enrollment.findMany({
    where: {
      status: 'cancelled',
      confirmedAt: { not: null },
      slotReleasedAt: null,
      OR: [
        { studentUserId: userId, cancellationReason: 'admin' },
        { teacherUserId: userId, cancellationReason: 'teacher_suspended' },
      ],
    },
    orderBy: { id: 'asc' },
    select: { id: true, studentUserId: true, status: true, cancellationReason: true },
  });
  if (closed.length === 0) return false;
  const now = await clockTimestamp(tx);
  const casesOf = await compensationCasesAmong(
    tx,
    closed.map(({ id }) => id),
  );
  for (const { id, studentUserId, status, cancellationReason } of closed) {
    const closing = closingOf({
      status,
      lastCancellationReason: cancellationReason,
      endCase: latestEndCaseOf(casesOf.get(id) ?? []),
    });
    const own = OWN_CLOSING[studentUserId === userId ? 'student' : 'teacher'];
    if (closing === undefined || !closing.restorable || closing.kind !== own) continue;
    const until = await restorableUntil(closing.closingCase.createdAt, closing.kind, windowDays);
    if (now.getTime() < until.getTime()) return true;
  }
  return false;
}

/** Booking's count as identity's `OngoingEnrollments` port takes it. */
export interface OngoingEnrollmentsCount {
  hasOngoing(tx: Transaction, userId: string): Promise<boolean>;
  /** 005:T031: an enrollment `pending_payment` or `confirmed` only (`hasLiveEnrollment`). */
  live(tx: Transaction, userId: string): Promise<boolean>;
}

/** The count over the settings' two windows, bound once by `main.ts`. */
export function createOngoingEnrollments({
  settings,
}: {
  readonly settings: Pick<SettingsReader, 'read'>;
}): OngoingEnrollmentsCount {
  const windowDays = windowDaysOf(settings);
  return {
    hasOngoing: (tx, userId) => hasOngoingEnrollment(tx, userId, windowDays),
    live: hasLiveEnrollment,
  };
}

/**
 * Whether `userId` has an enrollment `pending_payment` or `confirmed` (a paused one is `confirmed`),
 * as student or teacher: the one statement over the two parties' indexes that ends T080's question
 * when it finds one, and (005:T031 of specs/005-certification; FR-630; the note under T031) the
 * `live` an administrator's deletion of a teacher asks first, with no closing counted. No lock of
 * its own: every path that makes an enrollment live locks the account first (this file's head).
 */
export async function hasLiveEnrollment(tx: Transaction, userId: string): Promise<boolean> {
  const live = await tx.enrollment.findFirst({
    where: {
      OR: [{ studentUserId: userId }, { teacherUserId: userId }],
      status: { in: ['pending_payment', 'confirmed'] },
    },
    select: { id: true },
  });
  return live !== null;
}

/**
 * 005:T031 (FR-630; the note under T031, Q-D1 (a)): the ids of every enrollment the person teaches,
 * id order, for identity's `OpenCases` port, which `main.ts` composes with moderation's
 * `openCompensationCasesAmong` (a case may stay open on an enrollment of any status). Read once by an
 * administrator's deletion of a teacher, on its transaction, over `enrollments_teacher_user_id_idx`:
 * ids only and bounded by the one teacher's enrollments, so it is read whole, never paged. No lock
 * of its own: the open cases are read after `live` (identity's `deletion.service.ts`, «THE RACE»).
 */
export async function enrollmentIdsOfTeacher(
  tx: Transaction,
  teacherUserId: string,
): Promise<readonly string[]> {
  const rows = await tx.enrollment.findMany({
    where: { teacherUserId },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  return rows.map(({ id }) => id);
}
