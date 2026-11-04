// T049 (FR-390, FR-391, FR-395): booking's queries for the lists, on the caller's transaction, each
// scoped by the caller's own id so a row of another student or another teacher is never read
// (FR-395, M3). Read-only, no lock: nothing is decided on what they read (T005's rule 1 binds a
// path that decides on a row's state; these answer what a person is shown). A soft-deleted
// enrollment is left out by the client's extension (T148).
//
// THE TABS. Active is an enrollment the student is awaiting or holds (`pending_payment`,
// `confirmed`); the teacher's active tab leaves out one awaiting payment, whose student has not yet
// booked (`TeacherStudentsEmpty`: «يظهر هنا كل طالب يحجز باقة منك»). Ended is one that ran and
// stopped: `completed`, `terminated_no_show`, or `cancelled` after it was confirmed. An enrollment
// cancelled before it was ever confirmed (a checkout abandoned, expired, failed, or refused at
// confirmation) is no one's enrollment: it is on neither tab and neither detail answers it; the
// student reads it through `checkout.status` (FR-380 to FR-386). Each clause is written inside its
// query's `where`, so the confirmation path's gate reads it as a read (R-HONEST-1, T042).
import type { EnrollmentStatus, PackageTrack } from '@ijazah/contracts';
import type { Prisma } from '@prisma/client';

import type { Transaction } from '../../platform/db/prisma.repository.js';

/** One enrollment as the lists read it: its parties, its status and its snapshot's package line. */
export interface ListedEnrollmentRow {
  readonly id: string;
  readonly studentUserId: string;
  readonly teacherUserId: string;
  readonly status: EnrollmentStatus;
  readonly snapshotSubjectId: string;
  readonly snapshotTrack: PackageTrack;
  readonly snapshotSessionCount: number;
  readonly snapshotDurationMinutes: number;
}

/** Whose lists: the student's own or the teacher's own. */
export type ListParty = { readonly studentUserId: string } | { readonly teacherUserId: string };

function partyWhere(party: ListParty): Prisma.EnrollmentWhereInput {
  return 'studentUserId' in party
    ? { studentUserId: party.studentUserId }
    : { teacherUserId: party.teacherUserId };
}

/**
 * The student's active enrollments, in one statement over the `student_user_id` index. Not paged:
 * the tab is ordered by next session, which only the sessions know, so the order is made over the
 * whole tab. It stays small: at most one awaiting payment per active hold (§15 rule 18), and the
 * confirmed ones are the student's current packages, each on a weekly time no other of theirs
 * overlaps (§15 rule 19), until Phase 3 completes one after its final session.
 */
export function activeEnrollmentsOfStudent(
  tx: Pick<Transaction, 'enrollment'>,
  studentUserId: string,
): Promise<ListedEnrollmentRow[]> {
  return tx.enrollment.findMany({
    where: { studentUserId, status: { in: ['pending_payment', 'confirmed'] } },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      studentUserId: true,
      teacherUserId: true,
      status: true,
      snapshotSubjectId: true,
      snapshotTrack: true,
      snapshotSessionCount: true,
      snapshotDurationMinutes: true,
    },
  });
}

/**
 * The teacher's confirmed enrollments, in one statement over the `teacher_user_id` index. Not
 * paged, as the student's: each holds one of the teacher's weekly slots until its final week
 * (FR-394), and the slots never overlap (FR-317), until Phase 3 completes one after its final
 * session.
 */
export function activeEnrollmentsOfTeacher(
  tx: Pick<Transaction, 'enrollment'>,
  teacherUserId: string,
): Promise<ListedEnrollmentRow[]> {
  return tx.enrollment.findMany({
    where: { teacherUserId, status: 'confirmed' },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      studentUserId: true,
      teacherUserId: true,
      status: true,
      snapshotSubjectId: true,
      snapshotTrack: true,
      snapshotSessionCount: true,
      snapshotDurationMinutes: true,
    },
  });
}

/**
 * A page of the party's ended enrollments, newest first by id (a UUID v7, time-ordered), after the
 * enrollment `after` names; `studentUserIds` narrows a teacher's to those students. Keyset on the
 * primary key, `limit` rows at most.
 */
export function endedEnrollmentPage(
  tx: Pick<Transaction, 'enrollment'>,
  party: ListParty,
  page: {
    readonly after?: string;
    readonly limit: number;
    readonly studentUserIds?: readonly string[];
  },
): Promise<ListedEnrollmentRow[]> {
  return tx.enrollment.findMany({
    where: {
      AND: [
        partyWhere(party),
        {
          OR: [
            { status: { in: ['completed', 'terminated_no_show'] } },
            { status: 'cancelled', confirmedAt: { not: null } },
          ],
        },
        ...(page.after === undefined ? [] : [{ id: { lt: page.after } }]),
        ...(page.studentUserIds === undefined
          ? []
          : [{ studentUserId: { in: [...page.studentUserIds] } }]),
      ],
    },
    orderBy: { id: 'desc' },
    take: page.limit,
    select: {
      id: true,
      studentUserId: true,
      teacherUserId: true,
      status: true,
      snapshotSubjectId: true,
      snapshotTrack: true,
      snapshotSessionCount: true,
      snapshotDurationMinutes: true,
    },
  });
}

/**
 * The students of the teacher's ended enrollments, each once, for the name search of the ended tab
 * (FR-391): the kernel's fold narrows these and nothing wider. Over the `teacher_user_id` index;
 * bounded by the teacher's students.
 */
export async function endedStudentIdsOf(
  tx: Pick<Transaction, 'enrollment'>,
  teacherUserId: string,
): Promise<string[]> {
  const rows = await tx.enrollment.findMany({
    where: {
      teacherUserId,
      OR: [
        { status: { in: ['completed', 'terminated_no_show'] } },
        { status: 'cancelled', confirmedAt: { not: null } },
      ],
    },
    distinct: ['studentUserId'],
    orderBy: { studentUserId: 'asc' },
    select: { studentUserId: true },
  });
  return rows.map(({ studentUserId }) => studentUserId);
}

/**
 * The party's own enrollment of that id when it is on one of the party's tabs, else null (M3): the
 * student's active or ended, the teacher's confirmed or ended.
 */
export function listedEnrollmentOf(
  tx: Pick<Transaction, 'enrollment'>,
  enrollmentId: string,
  party: ListParty,
): Promise<ListedEnrollmentRow | null> {
  if ('studentUserId' in party) {
    return tx.enrollment.findFirst({
      where: {
        id: enrollmentId,
        studentUserId: party.studentUserId,
        OR: [
          { status: { in: ['pending_payment', 'confirmed', 'completed', 'terminated_no_show'] } },
          { status: 'cancelled', confirmedAt: { not: null } },
        ],
      },
      select: {
        id: true,
        studentUserId: true,
        teacherUserId: true,
        status: true,
        snapshotSubjectId: true,
        snapshotTrack: true,
        snapshotSessionCount: true,
        snapshotDurationMinutes: true,
      },
    });
  }
  return tx.enrollment.findFirst({
    where: {
      id: enrollmentId,
      teacherUserId: party.teacherUserId,
      OR: [
        { status: { in: ['confirmed', 'completed', 'terminated_no_show'] } },
        { status: 'cancelled', confirmedAt: { not: null } },
      ],
    },
    select: {
      id: true,
      studentUserId: true,
      teacherUserId: true,
      status: true,
      snapshotSubjectId: true,
      snapshotTrack: true,
      snapshotSessionCount: true,
      snapshotDurationMinutes: true,
    },
  });
}

/** Of `enrollmentIds`, the teacher's own, for the sessions of the teacher's day. */
export function teacherEnrollmentsAmong(
  tx: Pick<Transaction, 'enrollment'>,
  teacherUserId: string,
  enrollmentIds: readonly string[],
): Promise<ListedEnrollmentRow[]> {
  if (enrollmentIds.length === 0) return Promise.resolve([]);
  return tx.enrollment.findMany({
    where: { teacherUserId, id: { in: [...enrollmentIds] } },
    select: {
      id: true,
      studentUserId: true,
      teacherUserId: true,
      status: true,
      snapshotSubjectId: true,
      snapshotTrack: true,
      snapshotSessionCount: true,
      snapshotDurationMinutes: true,
    },
  });
}
