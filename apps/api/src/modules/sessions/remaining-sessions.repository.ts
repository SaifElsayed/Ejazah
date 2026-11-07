// T004 of specs/004-sessions/tasks.md (`003:T059`, FR-420, FR-484, FR-485; research R-313): the
// queries of an enrollment's end on sessions' own tables, each on the caller's transaction. The
// rules (which sessions, which remedies, to which case) are `remaining-sessions.service.ts`'.
//
// The writes are conditional on the state the service read under its locks (a session still
// `scheduled`, a remedy still open), so a row another path moved meanwhile is left as it is.
import type { Transaction } from '../../platform/db/prisma.repository.js';

type Client = Pick<Transaction, 'session' | 'sessionRemedy'>;

/** A session an enrollment's end cancels. */
export interface RemainingSession {
  readonly id: string;
  readonly enrollmentId: string;
}

/** A remedy still open: not yet booked, handed to a case or lapsed (data-model.md §3). */
export interface OpenRemedy {
  readonly id: string;
  readonly sessionId: string;
  readonly enrollmentId: string;
}

/** The statuses of an open remedy, `frozen` included (data-model.md §3, F1). */
export const OPEN_REMEDY_STATUSES = [
  'awaiting_choice',
  'proposed',
  'counter_proposed',
  'frozen',
] as const;

/** The pending counter-proposal's columns, cleared when the remedy is no longer open (rule 42). */
const NO_COUNTER = {
  counterSlotId: null,
  counterDate: null,
  counterStartTimeLocal: null,
  counterTimezone: null,
  counterProposedAt: null,
} as const;

/** The `scheduled` sessions of `enrollmentIds`, in id order; a soft-deleted one left out (T148). */
export async function scheduledSessionsOf(
  tx: Client,
  enrollmentIds: readonly string[],
): Promise<RemainingSession[]> {
  if (enrollmentIds.length === 0) return [];
  return tx.session.findMany({
    where: { enrollmentId: { in: [...enrollmentIds] }, status: 'scheduled' },
    orderBy: { id: 'asc' },
    select: { id: true, enrollmentId: true },
  });
}

/** Cancels those of `ids` still `scheduled`, as an administrator's cancellation, in one statement. */
export async function cancelByAdmin(tx: Client, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx.session.updateMany({
    where: { id: { in: [...ids] }, status: 'scheduled' },
    data: { status: 'cancelled_by_admin' },
  });
}

/** The open remedies of `enrollmentIds`' sessions, in id order; a soft-deleted session's left out. */
export async function openRemediesOf(
  tx: Client,
  enrollmentIds: readonly string[],
): Promise<OpenRemedy[]> {
  if (enrollmentIds.length === 0) return [];
  const rows = await tx.sessionRemedy.findMany({
    where: {
      status: { in: [...OPEN_REMEDY_STATUSES] },
      session: { enrollmentId: { in: [...enrollmentIds] }, deletedAt: null },
    },
    orderBy: { id: 'asc' },
    select: { id: true, sessionId: true, session: { select: { enrollmentId: true } } },
  });
  return rows.map(({ id, sessionId, session }) => ({
    id,
    sessionId,
    enrollmentId: session.enrollmentId,
  }));
}

/**
 * Hands those of `ids` still open to the case `caseId` (`refund_case`, `kind` unchanged), decided
 * at `at`, a pending counter-proposal withdrawn with it, in one statement.
 */
export async function handToCase(
  tx: Client,
  ids: readonly string[],
  caseId: string,
  at: Date,
): Promise<void> {
  if (ids.length === 0) return;
  await tx.sessionRemedy.updateMany({
    where: { id: { in: [...ids] }, status: { in: [...OPEN_REMEDY_STATUSES] } },
    data: { status: 'refund_case', caseId, decidedAt: at, ...NO_COUNTER },
  });
}

/** Lapses those of `ids` still open, nothing owed and no case, decided at `at`, in one statement. */
export async function lapse(tx: Client, ids: readonly string[], at: Date): Promise<void> {
  if (ids.length === 0) return;
  await tx.sessionRemedy.updateMany({
    where: { id: { in: [...ids] }, status: { in: [...OPEN_REMEDY_STATUSES] } },
    data: { status: 'lapsed', decidedAt: at, ...NO_COUNTER },
  });
}

/** The kernel's row lock, for the sessions and the remedies an enrollment's end decides on (T002). */
export { lockRows } from '../../platform/db/row-lock.js';
