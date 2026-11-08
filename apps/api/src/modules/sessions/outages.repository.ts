// T016 of specs/004-sessions/tasks.md (FR-445, FR-462, FR-495; research R-307; data-model.md §2.5
// and §3): the queries of a provider outage window on sessions' own tables, each on the caller's
// transaction. The rules (which sessions, the locks, the order) are `outages.service.ts`'.
//
// `provider_outages` is append-only for the application role (rule 44: UPDATE, DELETE and TRUNCATE
// revoked), so a window is inserted once and never edited. The reclassification is conditional on
// the state the service read under its locks: a session still settled (`done`, `*_no_show`,
// `under_threshold`), so one disputed or moved meanwhile is left as it is.
import type { Transaction } from '../../platform/db/prisma.repository.js';

type Client = Pick<Transaction, 'session' | 'providerOutage'>;

/** The settled outcomes an outage window reclassifies (data-model.md §3, the last session row). */
export const OUTAGE_RECLASSIFIABLE = [
  'done',
  'student_no_show',
  'teacher_no_show',
  'both_no_show',
  'under_threshold',
] as const;

/** A window `[startsAt, endsAt)`, its start held and its end not. */
export interface OutageWindow {
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/** A session a window overlaps that it may reclassify. */
export interface OverlappedSession {
  readonly id: string;
  readonly enrollmentId: string;
}

/** Inserts the window, recorded by `recordedByAdminId` with `reason`; its id. */
export async function insertOutage(
  tx: Client,
  outage: OutageWindow & { readonly reason: string; readonly recordedByAdminId: string },
): Promise<string> {
  const { id } = await tx.providerOutage.create({ data: { ...outage }, select: { id: true } });
  return id;
}

/**
 * The sessions `window` overlaps that are settled and still inside their dispute window (their
 * scheduled end after `endedAfter`, the read's instant less `dispute_window_hours`), by id; with
 * `ids`, only those of them. A `disputed` session has another status and is left out. Over the
 * sessions' instants, bounded by the window and the dispute window; no lock.
 */
export async function reclassifiableSessions(
  tx: Client,
  window: OutageWindow,
  endedAfter: Date,
  ids?: readonly string[],
): Promise<readonly OverlappedSession[]> {
  return tx.session.findMany({
    where: {
      ...(ids === undefined ? {} : { id: { in: [...ids] } }),
      status: { in: [...OUTAGE_RECLASSIFIABLE] },
      scheduledStartAt: { lt: window.endsAt },
      scheduledEndAt: { gt: window.startsAt },
      AND: [{ scheduledEndAt: { gt: endedAfter } }],
    },
    orderBy: { id: 'asc' },
    select: { id: true, enrollmentId: true },
  });
}

/** Moves those of `ids` still settled to `provider_outage`, in one statement. */
export async function reclassify(tx: Client, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx.session.updateMany({
    where: { id: { in: [...ids] }, status: { in: [...OUTAGE_RECLASSIFIABLE] } },
    data: { status: 'provider_outage' },
  });
}

/** One window as the list shows it; the recorder by id, its name the admin module's (R-API-6). */
export interface OutageRow {
  readonly outageId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly reason: string;
  readonly recordedByAdminId: string;
}

/** Up to `take` windows, newest first by their time-ordered id, after `cursor`; no lock. */
export async function outagesPage(
  tx: Client,
  cursor: string | undefined,
  take: number,
): Promise<OutageRow[]> {
  const rows = await tx.providerOutage.findMany({
    where: cursor === undefined ? {} : { id: { lt: cursor } },
    orderBy: { id: 'desc' },
    take,
    select: { id: true, startsAt: true, endsAt: true, reason: true, recordedByAdminId: true },
  });
  return rows.map(({ id, ...row }) => ({ outageId: id, ...row }));
}
