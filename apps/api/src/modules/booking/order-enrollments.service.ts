// T052 (FR-400, research R-220): what the admin's payments monitor asks of booking, the module that
// owns `enrollments` and `enrollment_events` (R-API-6). The monitor's orders name their enrollment;
// booking answers its parties and state for a page of orders, and one enrollment's package, status,
// progress and outcomes for an order's detail. Read-only and with no lock, on the caller's
// transaction (`order-enrollments.repository.ts`); nothing here writes.
//
// DERIVED, NEVER STORED (FR-392, R-DB-4). Progress is the sessions module's `sessionProgress` over the
// enrollment's sessions and its snapshot's count, at the read's instant, as the lists derive it. The
// package line is the enrollment's snapshot, its subject named through catalog's entry.
//
// THE HOLDS (T024 of specs/004-sessions; research R-323 GAP-8): the enrollment's `slot_holds`, oldest
// first, each with its release and its reason when recorded, so the monitor shows why a hold ended.
import type { EnrollmentStatus, EnrollmentTerms, SubjectSummary } from '@ijazah/contracts';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { subjectSummariesOf } from '../catalog/index.js';
import {
  type EnrollmentSessionRow,
  sessionProgress,
  sessionsOfEnrollments,
} from '../sessions/index.js';
import type { EnrollmentCancellationReason } from './enrollment-events.repository.js';
import {
  type EnrollmentHoldRow,
  enrollmentsAmong,
  holdsOfEnrollment,
  type OrderEnrollmentRow,
  outcomesOf,
  type OutcomeRow,
} from './order-enrollments.repository.js';

export type {
  EnrollmentHoldRow,
  OutcomeRow as EnrollmentOutcomeRow,
} from './order-enrollments.repository.js';

/** An order's enrollment as the monitor's list shows it: whose it is and where it stands. */
export interface OrderEnrollmentParty {
  readonly studentUserId: string;
  readonly status: EnrollmentStatus;
}

/** An order's enrollment as the monitor's detail shows it (FR-400). */
export interface MonitoredEnrollment {
  readonly enrollmentId: string;
  readonly studentUserId: string;
  readonly teacherUserId: string;
  readonly status: EnrollmentStatus;
  readonly cancellationReason?: EnrollmentCancellationReason;
  readonly summary: EnrollmentTerms;
  /** Sessions consumed (FR-392). */
  readonly completed: number;
  /** The snapshot's session count. */
  readonly total: number;
  /** Every outcome booking recorded for the enrollment, oldest first. */
  readonly outcomes: readonly OutcomeRow[];
  /** The enrollment's holds, oldest first (T024 of specs/004-sessions, GAP-8). */
  readonly holds: readonly EnrollmentHoldRow[];
}

/** What the monitor's reads ask of the owners, each on the caller's transaction; faked in a spec. */
export interface OrderEnrollmentsStore {
  enrollmentsAmong(tx: Transaction, ids: readonly string[]): Promise<readonly OrderEnrollmentRow[]>;
  outcomesOf(tx: Transaction, enrollmentId: string): Promise<readonly OutcomeRow[]>;
  holdsOf(tx: Transaction, enrollmentId: string): Promise<readonly EnrollmentHoldRow[]>;
  sessionsOf(
    tx: Transaction,
    enrollmentIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly EnrollmentSessionRow[]>>;
  subjectsOf(tx: Transaction, ids: readonly string[]): Promise<ReadonlyMap<string, SubjectSummary>>;
}

/** The store over booking's own queries and the owners' entries (R-API-6). */
export const orderEnrollmentsStore: OrderEnrollmentsStore = {
  enrollmentsAmong,
  outcomesOf,
  holdsOf: holdsOfEnrollment,
  sessionsOf: sessionsOfEnrollments,
  subjectsOf: subjectSummariesOf,
};

/** Of `enrollmentIds`, each one's student and status; an enrollment no ordinary read returns is absent. */
export async function orderEnrollmentPartiesAmong(
  tx: Transaction,
  enrollmentIds: readonly string[],
  store: OrderEnrollmentsStore = orderEnrollmentsStore,
): Promise<ReadonlyMap<string, OrderEnrollmentParty>> {
  const rows = await store.enrollmentsAmong(tx, [...new Set(enrollmentIds)]);
  return new Map(
    rows.map((row) => [row.id, { studentUserId: row.studentUserId, status: row.status }] as const),
  );
}

/** The enrollment with its package, progress and outcomes at `now`; null when no read returns it. */
export async function monitoredEnrollmentOf(
  tx: Transaction,
  enrollmentId: string,
  now: Date,
  store: OrderEnrollmentsStore = orderEnrollmentsStore,
): Promise<MonitoredEnrollment | null> {
  const [row] = await store.enrollmentsAmong(tx, [enrollmentId]);
  if (row === undefined) return null;
  const [sessions, subjects, outcomes, holds] = await Promise.all([
    store.sessionsOf(tx, [row.id]),
    store.subjectsOf(tx, [row.snapshotSubjectId]),
    store.outcomesOf(tx, row.id),
    store.holdsOf(tx, row.id),
  ]);
  const subject = subjects.get(row.snapshotSubjectId);
  // `enrollments.snapshot_subject_id` is a foreign key to the subject (ERD `enrollments`).
  if (subject === undefined) throw new Error('payments monitor: an enrollment without its subject');
  const progress = sessionProgress(sessions.get(row.id) ?? [], {
    sessionCount: row.snapshotSessionCount,
    now,
  });
  return {
    enrollmentId: row.id,
    studentUserId: row.studentUserId,
    teacherUserId: row.teacherUserId,
    status: row.status,
    ...(row.cancellationReason === null ? {} : { cancellationReason: row.cancellationReason }),
    summary: {
      subject,
      track: row.snapshotTrack,
      sessionCount: row.snapshotSessionCount,
      sessionDurationMinutes:
        row.snapshotDurationMinutes as EnrollmentTerms['sessionDurationMinutes'],
    },
    completed: progress.completed,
    total: row.snapshotSessionCount,
    outcomes,
    holds,
  };
}
