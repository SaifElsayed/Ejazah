// T031 and T032 of specs/004-sessions/tasks.md (FR-463 to FR-467; research R-311, "The student",
// "The teacher" and "Windows ending"; data-model.md §2.3, §3): the queries of the remedy's procedures
// and of `advance-remedies`' windows' ends, on sessions' own tables, each on the caller's
// transaction. The rules, the locks' order and the refusals are `remedy.service.ts`'.
//
// Every write is conditional on the state the service read under its locks, so a row another path
// moved meanwhile is left as it is and the service is told (`003:T005`'s rule 1). A soft-deleted
// session is left out.
//
// The sweep's two reads take no lock and are paged by id after a cursor (the follow-up under T028:
// no index covers them, R-DB-9; measured in Phase 6).
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { RemedyRowStatus } from './remedy-offer.repository.js';

type Client = Pick<Transaction, 'sessionRemedy'>;

/** A pending counter-proposal as its columns hold it. */
export interface PendingCounter {
  readonly slotId: string;
  readonly date: Date;
  readonly startTimeLocal: Date;
  readonly timezone: string;
  readonly proposedAt: Date;
}

/** A remedy as its procedures decide on it. */
export interface RemedyRow {
  readonly id: string;
  readonly sessionId: string;
  readonly status: RemedyRowStatus;
  readonly kind: 'makeup' | 'refund';
  readonly offeredAt: Date;
  readonly choiceClosesAt: Date;
  readonly proposedDate: Date | null;
  readonly snapshotAnswerWindowHours: number;
  readonly snapshotFirstSessionLeadHours: number;
  /** Set exactly while `counter_proposed` (rule 42). */
  readonly counter: PendingCounter | null;
}

interface RemedyColumns {
  readonly id: string;
  readonly sessionId: string;
  readonly status: RemedyRowStatus;
  readonly kind: 'makeup' | 'refund';
  readonly offeredAt: Date;
  readonly choiceClosesAt: Date;
  readonly proposedDate: Date | null;
  readonly snapshotAnswerWindowHours: number;
  readonly snapshotFirstSessionLeadHours: number;
  readonly counterSlotId: string | null;
  readonly counterDate: Date | null;
  readonly counterStartTimeLocal: Date | null;
  readonly counterTimezone: string | null;
  readonly counterProposedAt: Date | null;
}

function remedyOfColumns({
  counterSlotId,
  counterDate,
  counterStartTimeLocal,
  counterTimezone,
  counterProposedAt,
  ...remedy
}: RemedyColumns): RemedyRow {
  return {
    ...remedy,
    // Rule 42: the five `counter_*` columns are set together, exactly while `counter_proposed`.
    counter:
      counterSlotId === null ||
      counterDate === null ||
      counterStartTimeLocal === null ||
      counterTimezone === null ||
      counterProposedAt === null
        ? null
        : {
            slotId: counterSlotId,
            date: counterDate,
            startTimeLocal: counterStartTimeLocal,
            timezone: counterTimezone,
            proposedAt: counterProposedAt,
          },
  };
}

/** A remedy with its session's enrollment and two parties (sessions' own copies, ADR 0010). */
export interface RemedyWithParties extends RemedyRow {
  readonly enrollmentId: string;
  readonly studentUserId: string;
  readonly teacherUserId: string;
}

/** The remedy found by `where`, its session not soft-deleted; null when none. No lock. */
async function remedyWhere(
  tx: Client,
  where: { readonly id: string } | { readonly sessionId: string },
): Promise<RemedyWithParties | null> {
  const row = await tx.sessionRemedy.findFirst({
    where: { ...where, session: { deletedAt: null } },
    select: {
      id: true,
      sessionId: true,
      status: true,
      kind: true,
      offeredAt: true,
      choiceClosesAt: true,
      proposedDate: true,
      snapshotAnswerWindowHours: true,
      snapshotFirstSessionLeadHours: true,
      counterSlotId: true,
      counterDate: true,
      counterStartTimeLocal: true,
      counterTimezone: true,
      counterProposedAt: true,
      session: { select: { enrollmentId: true, studentUserId: true, teacherUserId: true } },
    },
  });
  if (row === null) return null;
  const { session, ...columns } = row;
  return { ...remedyOfColumns(columns), ...session };
}

/** The session's remedy, by the unique `session_id`; null when it has none. No lock. */
export function remedyRowOf(tx: Client, sessionId: string): Promise<RemedyWithParties | null> {
  return remedyWhere(tx, { sessionId });
}

/** The remedy by its id, with its session's parties; null when absent. No lock. */
export function remedyRowById(tx: Client, remedyId: string): Promise<RemedyWithParties | null> {
  return remedyWhere(tx, { id: remedyId });
}

/** `awaiting_choice` → `proposed`: the student's choice of a make-up; whether it moved the row. */
export async function chooseMakeup(tx: Client, remedyId: string): Promise<boolean> {
  const { count } = await tx.sessionRemedy.updateMany({
    where: { id: remedyId, status: 'awaiting_choice' },
    data: { status: 'proposed' },
  });
  return count === 1;
}

/** A counter-proposal as written: the slot, its local date and start, its zone, the instant. */
export interface CounterWrite {
  readonly slotId: string;
  readonly date: Date;
  readonly startTimeLocal: Date;
  readonly timezone: string;
  readonly proposedAt: Date;
}

/**
 * `awaiting_choice` or `proposed` → `counter_proposed` with the five `counter_*` columns set
 * (rule 42); whether it moved the row.
 */
export async function writeCounter(
  tx: Client,
  remedyId: string,
  counter: CounterWrite,
): Promise<boolean> {
  const { count } = await tx.sessionRemedy.updateMany({
    where: { id: remedyId, status: { in: ['awaiting_choice', 'proposed'] } },
    data: {
      status: 'counter_proposed',
      counterSlotId: counter.slotId,
      counterDate: counter.date,
      counterStartTimeLocal: counter.startTimeLocal,
      counterTimezone: counter.timezone,
      counterProposedAt: counter.proposedAt,
    },
  });
  return count === 1;
}

/**
 * `counter_proposed` → `proposed`, the five `counter_*` columns cleared, which releases the
 * counter's reserved time (H3): a decline, or an acceptance the database refused (A3); whether it
 * moved the row.
 */
export async function releaseCounter(tx: Client, remedyId: string): Promise<boolean> {
  const { count } = await tx.sessionRemedy.updateMany({
    where: { id: remedyId, status: 'counter_proposed' },
    data: {
      status: 'proposed',
      counterSlotId: null,
      counterDate: null,
      counterStartTimeLocal: null,
      counterTimezone: null,
      counterProposedAt: null,
    },
  });
  return count === 1;
}

/** A pending counter-proposal as the sweep reads it: enough to compute its answer window (D1). */
export interface PendingCounterDue {
  readonly remedyId: string;
  readonly counterProposedAt: Date;
  readonly snapshotAnswerWindowHours: number;
}

/**
 * The `counter_proposed` remedies, in id order after `after`, at most `limit`; a `frozen` one is
 * never among them. No lock: the sweep decides again under the hand-off's locks.
 */
export async function pendingCounters(
  tx: Client,
  after: string | undefined,
  limit: number,
): Promise<readonly PendingCounterDue[]> {
  const rows = await tx.sessionRemedy.findMany({
    where: {
      status: 'counter_proposed',
      session: { deletedAt: null },
      ...(after === undefined ? {} : { id: { gt: after } }),
    },
    orderBy: { id: 'asc' },
    take: limit,
    select: { id: true, counterProposedAt: true, snapshotAnswerWindowHours: true },
  });
  return rows.flatMap(({ id, counterProposedAt, snapshotAnswerWindowHours }) =>
    counterProposedAt === null
      ? []
      : [{ remedyId: id, counterProposedAt, snapshotAnswerWindowHours }],
  );
}

/**
 * The `proposed` and `awaiting_choice` remedies whose choice window has closed by `at`, in id order
 * after `after`, at most `limit`: the proposals H5 books, and the refused ones it retries. No lock.
 */
export async function choiceWindowsEnded(
  tx: Client,
  at: Date,
  after: string | undefined,
  limit: number,
): Promise<readonly string[]> {
  const rows = await tx.sessionRemedy.findMany({
    where: {
      status: { in: ['proposed', 'awaiting_choice'] },
      choiceClosesAt: { lte: at },
      session: { deletedAt: null },
      ...(after === undefined ? {} : { id: { gt: after } }),
    },
    orderBy: { id: 'asc' },
    take: limit,
    select: { id: true },
  });
  return rows.map(({ id }) => id);
}
