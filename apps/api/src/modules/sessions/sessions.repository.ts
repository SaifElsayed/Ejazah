// T026 (R-205, FR-394, FR-BOOK-10): the sessions module's reads that booking asks through this
// module's entry, so booking never reads the `sessions` table (R-API-6). The reads run on the
// caller's transaction and take no lock. A soft-deleted session is left out by the client's extension
// (T148). T034: generation's one write, an enrollment's sessions in one statement, on the
// confirmation's transaction, whose caller holds the locks (`generation.service.ts`). T032: the
// times of a student's sessions in a window, for the booking sheet; read-only, no lock. T033 widens
// it to the student's and the teacher's, for the one overlap check the hold and the sheet share
// (FR-351, FR-BOOK-5).
import { calendarDateOf, type LocalDate } from '@ijazah/time';

import type { Transaction } from '../../platform/db/prisma.repository.js';

/**
 * Of `enrollmentIds`, each enrollment's latest `scheduled_date_local`, its final session's requested
 * local date (ADR 0009 D1), in one grouped statement over `(enrollment_id, sequence_number)`'s
 * index. An enrollment with no session is absent.
 */
export async function lastSessionDateOf(
  tx: Pick<Transaction, 'session'>,
  enrollmentIds: readonly string[],
): Promise<ReadonlyMap<string, LocalDate>> {
  const dates = new Map<string, LocalDate>();
  if (enrollmentIds.length === 0) return dates;
  const groups = await tx.session.groupBy({
    by: ['enrollmentId'],
    where: { enrollmentId: { in: [...enrollmentIds] } },
    _max: { scheduledDateLocal: true },
  });
  for (const { enrollmentId, _max } of groups) {
    if (_max.scheduledDateLocal !== null) {
      dates.set(enrollmentId, calendarDateOf(_max.scheduledDateLocal));
    }
  }
  return dates;
}

/** A session's time, as the parties' own sessions are read for the booking sheet and the hold. */
export interface SessionTime {
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/** The statuses that free a session's time, as the overlap constraints read them (ERD §15 rule 19). */
const TIME_FREEING_STATUSES = ['cancelled_by_agreement', 'cancelled_by_admin'] as const;

/**
 * The times of the student's and the teacher's sessions that hold time in `[from, to)` (T032, T033,
 * R-205, FR-350, FR-351, FR-BOOK-5), as one list: every status but the two cancellations, a
 * soft-deleted one left out by the client's extension, so a booking leaves out what
 * `sessions_student_no_overlap` and `sessions_teacher_no_overlap` would refuse. Over the
 * `student_user_id` and `teacher_user_id` indexes; bounded by the window, since those constraints
 * keep each party's sessions from overlapping one another.
 */
export async function partiesSessionsBetween(
  tx: Pick<Transaction, 'session'>,
  parties: { readonly studentUserId: string; readonly teacherUserId: string },
  window: { readonly from: Date; readonly to: Date },
): Promise<readonly SessionTime[]> {
  const rows = await tx.session.findMany({
    where: {
      OR: [{ studentUserId: parties.studentUserId }, { teacherUserId: parties.teacherUserId }],
      status: { notIn: [...TIME_FREEING_STATUSES] },
      scheduledStartAt: { lt: window.to },
      scheduledEndAt: { gt: window.from },
    },
    orderBy: { scheduledStartAt: 'asc' },
    select: { scheduledStartAt: true, scheduledEndAt: true },
  });
  return rows.map(({ scheduledStartAt, scheduledEndAt }) => ({
    startsAt: scheduledStartAt,
    endsAt: scheduledEndAt,
  }));
}

/** One `sessions` row as generation writes it (T034, ADR 0009 D1–D2). */
export interface NewSessionRow {
  readonly enrollmentId: string;
  readonly teacherUserId: string;
  readonly studentUserId: string;
  readonly sequenceNumber: number;
  readonly scheduledDateLocal: Date;
  readonly scheduledStartTimeLocal: Date;
  readonly timezone: string;
  readonly scheduledStartAt: Date;
  readonly scheduledEndAt: Date;
  readonly status: 'scheduled';
}

/**
 * Inserts `rows` in one statement on the caller's transaction (T034, FR-369): a row the database
 * refuses (ERD §15 rule 19's exclusions) refuses the statement, so none of them is written, and the
 * refusal is thrown as it is for the caller to name (`isExclusionViolation`, T006).
 */
export async function insertSessions(
  tx: Pick<Transaction, 'session'>,
  rows: readonly NewSessionRow[],
): Promise<void> {
  await tx.session.createMany({ data: [...rows] });
}
