// T008 of specs/004-sessions/tasks.md (research R-301, R-322, R-323 GAP-1; the third analysis, U3;
// contracts/kernel.md, "The composition root"): booking's implementation of sessions' `EnrollmentSide`
// port (`modules/sessions/enrollment-side.port.ts`), bound once by `main.ts` and `worker.ts`. Booking
// owns `enrollments` and `enrollment_events` and is the only writer of both (R-API-6), so every
// status move sessions asks for is written here, with its one `enrollment_events` row through
// booking's one writer, on the caller's transaction.
//
// THE MOVES (data-model.md §3, "Enrollment, this phase's moves"):
//   terminateNoShow  confirmed → terminated_no_show                     `terminated_no_show`
//   complete         confirmed → completed                              `completed`
//   restore          terminated_no_show, or cancelled `admin` → confirmed `restored`
//                    (`cancellation_reason` cleared, `confirmed_at` untouched, R-322)
//   cancel 'admin'   confirmed → cancelled `admin`                      `cancelled` with `admin`
// Each is one conditional update from its source states: the row the caller read under its lock is
// still in one of them, or the move changes nothing, writes no row and answers `false` for the
// caller to refuse and log. A row's `occurred_at` is this side's clock at the move.
//
// THE LOCKS. `lockEnrollments` takes the enrollments' rows through the kernel's `lockRows`, the one
// lock any function here names. The moves take none of their own: their update touches the row the
// caller holds, and their event row references only that enrollment. The reads take none.
import { z } from 'zod';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { LockedTable } from '../../platform/db/row-lock.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type {
  EnrollmentEventEntry,
  EnrollmentPageFilter,
  EnrollmentPageItem,
  EnrollmentSide,
  EnrollmentTerms,
} from '../sessions/index.js';
import { type EnrollmentOutcome, recordEnrollmentEvents } from './enrollment-events.repository.js';
import {
  enrollmentEventsOf,
  enrollmentsPage,
  enrollmentTermsById,
  lockRows,
  moveEnrollment,
  type MoveSource,
  type MoveTarget,
} from './enrollment-side.repository.js';

/** The page size of every admin list (SRS §3.14, FR-412). */
export const LIST_PAGE_SIZE_SETTING = 'admin_list_page_size';

const positiveWhole = z.int().positive();

/** What the port's functions read and write, each on the caller's transaction. */
export interface EnrollmentSideStore {
  enrollmentTermsById(tx: Transaction, id: string): Promise<EnrollmentTerms | null>;
  lockRows(tx: Transaction, table: LockedTable, ids: readonly string[]): Promise<void>;
  moveEnrollment(
    tx: Transaction,
    id: string,
    from: readonly MoveSource[],
    target: MoveTarget,
  ): Promise<boolean>;
  recordEnrollmentEvents(tx: Transaction, outcomes: readonly EnrollmentOutcome[]): Promise<void>;
  enrollmentEventsOf(tx: Transaction, enrollmentId: string): Promise<EnrollmentEventEntry[]>;
  enrollmentsPage(
    tx: Transaction,
    filter: EnrollmentPageFilter,
    cursor: string | undefined,
    take: number,
  ): Promise<EnrollmentPageItem[]>;
}

/** Booking's repositories, as `createEnrollmentSide` uses them by default. */
export const enrollmentSideStore: EnrollmentSideStore = {
  enrollmentTermsById,
  lockRows,
  moveEnrollment,
  recordEnrollmentEvents,
  enrollmentEventsOf,
  enrollmentsPage,
};

const FROM_CONFIRMED: readonly MoveSource[] = [{ status: 'confirmed' }];
const RESTORABLE: readonly MoveSource[] = [
  { status: 'terminated_no_show' },
  { status: 'cancelled', cancellationReason: 'admin' },
];

/** Sessions' `EnrollmentSide` over booking's rows (T008), bound once by the composition root. */
export function createEnrollmentSide({
  settings,
  now = () => new Date(),
  store = enrollmentSideStore,
}: {
  readonly settings: SettingsReader;
  readonly now?: () => Date;
  readonly store?: EnrollmentSideStore;
}): EnrollmentSide {
  /** Applies the move and, only when it moved, writes its one row. */
  const move = async (
    tx: Transaction,
    id: string,
    from: readonly MoveSource[],
    target: MoveTarget,
    outcome: (occurredAt: Date) => EnrollmentOutcome,
  ): Promise<boolean> => {
    if (!(await store.moveEnrollment(tx, id, from, target))) return false;
    await store.recordEnrollmentEvents(tx, [outcome(now())]);
    return true;
  };
  return {
    enrollmentFor: (tx, id) => store.enrollmentTermsById(tx, id),
    lockEnrollments: (tx, ids) => store.lockRows(tx, 'enrollments', ids),
    terminateNoShow: (tx, id) =>
      move(
        tx,
        id,
        FROM_CONFIRMED,
        { status: 'terminated_no_show', cancellationReason: null },
        (occurredAt) => ({ kind: 'terminated_no_show', enrollmentId: id, occurredAt }),
      ),
    complete: (tx, id) =>
      move(
        tx,
        id,
        FROM_CONFIRMED,
        { status: 'completed', cancellationReason: null },
        (occurredAt) => ({ kind: 'completed', enrollmentId: id, occurredAt }),
      ),
    restore: (tx, id) =>
      move(
        tx,
        id,
        RESTORABLE,
        { status: 'confirmed', cancellationReason: null },
        (occurredAt) => ({ kind: 'restored', enrollmentId: id, occurredAt }),
      ),
    cancel: (tx, id, reason) =>
      move(
        tx,
        id,
        FROM_CONFIRMED,
        { status: 'cancelled', cancellationReason: reason },
        (occurredAt) => ({
          kind: 'cancelled',
          enrollmentId: id,
          cancellationReason: reason,
          occurredAt,
        }),
      ),
    eventsOf: (tx, enrollmentId) => store.enrollmentEventsOf(tx, enrollmentId),
    enrollmentPage: async (tx, filter, cursor) => {
      const pageSize = await settings.read(LIST_PAGE_SIZE_SETTING, positiveWhole);
      const rows = await store.enrollmentsPage(tx, filter, cursor, pageSize + 1);
      const items = rows.slice(0, pageSize);
      const last = items.at(-1);
      return rows.length > pageSize && last !== undefined
        ? { items, nextCursor: last.enrollmentId }
        : { items };
    },
  };
}
