// T029 of specs/004-sessions/tasks.md (FR-423, FR-469; ADR 0018 D3): a make-up's booking's queries
// on sessions' own tables and the kernel's locks, each on the caller's transaction. The rules (which
// state books what, the time, the refusals) are `makeup-booking.service.ts`'.
//
// The remedy's write is conditional on the state the service read under its locks, so a row another
// path moved meanwhile is left as it is.
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { lockRows } from '../../platform/db/row-lock.js';
import type { RemedyStatus } from './completion.repository.js';

type Client = Pick<Transaction, 'session' | 'sessionRemedy'>;

/** A pending counter-proposal's slot, date, start and zone, as its columns hold them. */
export interface CounterToBook {
  readonly slotId: string;
  readonly date: Date;
  readonly startTimeLocal: Date;
  readonly timezone: string;
}

/** A remedy to book, with its session's parties and what its times are resolved from. */
export interface RemedyToBook {
  readonly id: string;
  readonly sessionId: string;
  readonly enrollmentId: string;
  readonly studentUserId: string;
  readonly teacherUserId: string;
  readonly status: RemedyStatus;
  readonly proposedDate: Date | null;
  readonly counter: CounterToBook | null;
}

/** The remedy and its session's parties, no lock; null when absent or its session soft-deleted. */
export async function remedyToBook(tx: Client, remedyId: string): Promise<RemedyToBook | null> {
  const row = await tx.sessionRemedy.findFirst({
    where: { id: remedyId, session: { deletedAt: null } },
    select: {
      id: true,
      sessionId: true,
      status: true,
      proposedDate: true,
      counterSlotId: true,
      counterDate: true,
      counterStartTimeLocal: true,
      counterTimezone: true,
      session: { select: { enrollmentId: true, studentUserId: true, teacherUserId: true } },
    },
  });
  if (row === null) return null;
  const { session, counterSlotId, counterDate, counterStartTimeLocal, counterTimezone } = row;
  return {
    id: row.id,
    sessionId: row.sessionId,
    status: row.status,
    proposedDate: row.proposedDate,
    ...session,
    // Rule 42: the `counter_*` columns are set together, exactly while `counter_proposed`.
    counter:
      counterSlotId === null ||
      counterDate === null ||
      counterStartTimeLocal === null ||
      counterTimezone === null
        ? null
        : {
            slotId: counterSlotId,
            date: counterDate,
            startTimeLocal: counterStartTimeLocal,
            timezone: counterTimezone,
          },
  };
}

/**
 * The enrollment's highest `sequence_number`, soft-deleted rows included, since the unique
 * `(enrollment_id, sequence_number)` covers them; 0 when it has none. The caller holds the
 * enrollment's lock, which every path inserting a session of it takes first.
 */
export async function lastSequenceOf(tx: Client, enrollmentId: string): Promise<number> {
  const { _max } = await tx.session.aggregate({
    where: { enrollmentId },
    _max: { sequenceNumber: true },
  });
  return _max.sequenceNumber ?? 0;
}

/** One make-up session as its row is written: the local fields the fact, the instants the cache. */
export interface NewMakeupRow {
  readonly enrollmentId: string;
  readonly teacherUserId: string;
  readonly studentUserId: string;
  readonly sequenceNumber: number;
  readonly makeupForSessionId: string;
  readonly scheduledDateLocal: Date;
  readonly scheduledStartTimeLocal: Date;
  readonly timezone: string;
  readonly scheduledStartAt: Date;
  readonly scheduledEndAt: Date;
}

/**
 * Inserts the make-up `scheduled` and answers its id. A row the database refuses as overlapping
 * another session of the teacher or the student (ERD §15 rule 19) is thrown as it is, for the
 * service to name (`isExclusionViolation`).
 */
export async function insertMakeup(tx: Client, row: NewMakeupRow): Promise<string> {
  const { id } = await tx.session.create({
    data: { ...row, status: 'scheduled' },
    select: { id: true },
  });
  return id;
}

/**
 * The remedy `booked` at `at` if it is still in one of `from`, the pending counter-proposal's five
 * columns cleared (rule 42); whether it moved the row.
 */
export async function markBooked(
  tx: Client,
  remedyId: string,
  from: readonly RemedyStatus[],
  at: Date,
): Promise<boolean> {
  const { count } = await tx.sessionRemedy.updateMany({
    where: { id: remedyId, status: { in: [...from] } },
    data: {
      status: 'booked',
      decidedAt: at,
      counterSlotId: null,
      counterDate: null,
      counterStartTimeLocal: null,
      counterTimezone: null,
      counterProposedAt: null,
    },
  });
  return count === 1;
}

/**
 * The slots the booking touches, `FOR UPDATE`, in one call in id order (L2). A remedy's
 * `counter_slot_id` references `availability_slots` by a foreign key, so sessions locks the rows
 * through `lockRows` only (the row-lock header's cross-table rule), reading no column of them.
 */
export async function lockSlots(tx: Transaction, ids: readonly string[]): Promise<void> {
  await lockRows(tx, 'availability_slots', ids);
}
