// T027 of specs/004-sessions/tasks.md (FR-466; research R-311, "Reservation"; R-320, H3; the notes
// under T027): the remedies that reserve time, read from sessions' own tables on the caller's
// transaction with no lock (the callers that decide on them hold both accounts first, `003:T005`'s
// rule 2). No row reserves a time (plan.md decision 2): the reservation is read from the remedy.
//
// Which remedies reserve: an open one that is not `frozen` (`awaiting_choice`, `proposed`,
// `counter_proposed`): its proposal from the offer until it settles, and a pending counter-proposal
// during its answer window, which the service compares with the clock. A `frozen` remedy keeps its
// `proposed_date` (T005's note) and reserves nothing (the note under T027, B34's (b)).
//
// Which remedies keep their enrollment's slot in use (Q1 (a)): every open one, `frozen` included
// (data-model.md §3, F1), until it settles, so the proposal's start, the slot's local start, cannot
// move under it. Booking learns of it through this module's entry, never by reading the table
// (R-API-6).
//
// Bounded: a person's open remedies are among their own sessions, few; a soft-deleted session's
// remedy is left out.
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { OPEN_REMEDY_STATUSES } from './remaining-sessions.repository.js';

type Client = Pick<Transaction, 'sessionRemedy'>;

/** The statuses whose remedy reserves time: open and not frozen (H3; the note under T027). */
export const RESERVING_STATUSES = ['awaiting_choice', 'proposed', 'counter_proposed'] as const;

/** A pending counter-proposal's date, start and zone, as its columns hold them. */
export interface PendingCounter {
  readonly slotId: string;
  readonly date: Date;
  readonly startTimeLocal: Date;
  readonly timezone: string;
  readonly proposedAt: Date;
}

/** A remedy that reserves time, with what its times are resolved from. */
export interface ReservingRemedyRow {
  readonly remedyId: string;
  readonly sessionId: string;
  readonly enrollmentId: string;
  readonly status: (typeof RESERVING_STATUSES)[number];
  readonly proposedDate: Date | null;
  readonly counter: PendingCounter | null;
  readonly snapshotAnswerWindowHours: number;
}

/** The reserving remedies of the sessions `userIds` teach or attend, in id order. */
export async function reservingRemediesOf(
  tx: Client,
  userIds: readonly string[],
): Promise<ReservingRemedyRow[]> {
  if (userIds.length === 0) return [];
  const rows = await tx.sessionRemedy.findMany({
    where: {
      status: { in: [...RESERVING_STATUSES] },
      session: {
        deletedAt: null,
        OR: [{ studentUserId: { in: [...userIds] } }, { teacherUserId: { in: [...userIds] } }],
      },
    },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      sessionId: true,
      status: true,
      proposedDate: true,
      counterSlotId: true,
      counterDate: true,
      counterStartTimeLocal: true,
      counterTimezone: true,
      counterProposedAt: true,
      snapshotAnswerWindowHours: true,
      session: { select: { enrollmentId: true } },
    },
  });
  return rows.map((row) => ({
    remedyId: row.id,
    sessionId: row.sessionId,
    enrollmentId: row.session.enrollmentId,
    // The query reads only these statuses.
    status: row.status as ReservingRemedyRow['status'],
    proposedDate: row.proposedDate,
    // Rule 42: the five `counter_*` columns are set together, exactly while `counter_proposed`.
    counter:
      row.counterSlotId === null ||
      row.counterDate === null ||
      row.counterStartTimeLocal === null ||
      row.counterTimezone === null ||
      row.counterProposedAt === null
        ? null
        : {
            slotId: row.counterSlotId,
            date: row.counterDate,
            startTimeLocal: row.counterStartTimeLocal,
            timezone: row.counterTimezone,
            proposedAt: row.counterProposedAt,
          },
    snapshotAnswerWindowHours: row.snapshotAnswerWindowHours,
  }));
}

/** Of `enrollmentIds`, those with an open remedy, `frozen` included (Q1 (a)). */
export async function enrollmentsWithOpenRemedyAmong(
  tx: Client,
  enrollmentIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (enrollmentIds.length === 0) return new Set();
  const rows = await tx.sessionRemedy.findMany({
    where: {
      status: { in: [...OPEN_REMEDY_STATUSES] },
      session: { enrollmentId: { in: [...enrollmentIds] }, deletedAt: null },
    },
    select: { session: { select: { enrollmentId: true } } },
  });
  return new Set(rows.map(({ session }) => session.enrollmentId));
}
