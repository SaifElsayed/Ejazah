// T008 of specs/004-sessions/tasks.md (research R-301, R-322, R-323 GAP-1; the third analysis, U3):
// booking's queries behind sessions' `EnrollmentSide` port (`enrollment-side.service.ts`), each on
// the caller's transaction. Queries only; a soft-deleted enrollment is left out by the client's
// extension (T148).
//
// The moves' source states sit in the `where` of their updates, which the confirmation gate reads as
// reads (`tests/pipeline/confirmation-path.spec.ts`); restore's write is a function of its own,
// `restoreEnrollment`, the gate's second allowed writer of the status (T008's follow-up, the
// owner's decision of 2026-11-07).
//
// No lock is taken here but by `lockRows`, the kernel's: the moves' conditional updates touch the
// one enrollment row the caller already holds (`EnrollmentSide.lockEnrollments`), and the reads
// (the enrollments, their events and the active holds of `slot_holds`) take none.
import type { $Enums } from '@prisma/client';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type {
  EnrollmentEventEntry,
  EnrollmentPageFilter,
  EnrollmentPageItem,
  EnrollmentTerms,
} from '../sessions/index.js';

type Client = Pick<Transaction, 'enrollment' | 'enrollmentEvent'>;

/**
 * The enrollment's snapshot, slot, status and two parties (the note under T064, B34); null when
 * there is none. 006:T010 (R-501 V-1; Q-8 (a)): and its `programmes` row's state, month count,
 * months paid and plan, in the same read, absent when it is no programme, for the completion gate.
 */
export async function enrollmentTermsById(tx: Client, id: string): Promise<EnrollmentTerms | null> {
  const row = await tx.enrollment.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      slotId: true,
      snapshotTrack: true,
      snapshotSlotTimezone: true,
      snapshotDurationMinutes: true,
      snapshotSessionCount: true,
      studentUserId: true,
      teacherUserId: true,
      programme: {
        select: { state: true, monthCount: true, monthsPaid: true, paymentPlan: true },
      },
    },
  });
  if (row === null) return null;
  return {
    id: row.id,
    status: row.status,
    slotId: row.slotId,
    track: row.snapshotTrack,
    timezone: row.snapshotSlotTimezone,
    durationMinutes: row.snapshotDurationMinutes,
    sessionCount: row.snapshotSessionCount,
    studentUserId: row.studentUserId,
    teacherUserId: row.teacherUserId,
    ...(row.programme === null ? {} : { programme: row.programme }),
  };
}

/**
 * 005:T013 (T011's follow-up on `Pairings.paired`, settled by its first caller): whether an
 * enrollment of any status joins the two people, either as the student; one read of at most one row
 * over the two parties' plain indexes (one direction each), never the user's whole history. A
 * soft-deleted enrollment is absent (the client's extension, T148). No lock.
 */
export async function pairedEnrollmentExists(
  tx: Client,
  userId: string,
  otherUserId: string,
): Promise<boolean> {
  const found = await tx.enrollment.findFirst({
    where: {
      OR: [
        { studentUserId: userId, teacherUserId: otherUserId },
        { studentUserId: otherUserId, teacherUserId: userId },
      ],
    },
    select: { id: true },
  });
  return found !== null;
}

/**
 * A move's target from `confirmed`: the status and the reason it then carries (null clears it).
 * Never `confirmed`: `moveEnrollment` writes the status from this value, which the confirmation
 * gate cannot read (`tests/pipeline/confirmation-path.spec.ts`, «NOT SEEN»), so the type keeps it
 * from confirming an enrollment; `restoreEnrollment` alone does (T008's follow-up, R-HONEST-1).
 */
export interface MoveTarget {
  readonly status: Exclude<$Enums.EnrollmentStatus, 'confirmed'>;
  readonly cancellationReason: $Enums.CancellationReason | null;
  /** T082: a direct end's reason both parties are shown (`admin_end_reason`, rule 51); else unwritten. */
  readonly adminEndReason?: string;
}

/**
 * Moves a `confirmed` enrollment to `target`, by one conditional update whose source state sits in
 * its `where`; answers whether it moved. `confirmed_at` is never written (R-HONEST-1).
 */
export async function moveEnrollment(tx: Client, id: string, target: MoveTarget): Promise<boolean> {
  const { count } = await tx.enrollment.updateMany({
    where: { id, status: 'confirmed' },
    data: {
      status: target.status,
      cancellationReason: target.cancellationReason,
      ...(target.adminEndReason === undefined ? {} : { adminEndReason: target.adminEndReason }),
    },
  });
  return count === 1;
}

/**
 * An administrator's restore (FR-455, R-322, ADR 0023): `terminated_no_show`, or `cancelled` with
 * the reason `admin`, of an enrollment a payment once confirmed (`confirmed_at` set) → `confirmed`,
 * the reason cleared, by one conditional update; answers whether it moved. The confirmation path's
 * second writer of the status (`tests/pipeline/confirmation-path.spec.ts`, ALLOWED), reached only
 * from `EnrollmentSide.restore`; it never writes `confirmed_at` (R-HONEST-1).
 *
 * T073 of specs/004-sessions (R-322's step 1 widened, DEC-66): also `cancelled` with the reason
 * `teacher_suspended`, a teacher's ban's or revocation's closing (a student's ban's is `admin`).
 * Which closing may be restored stays the caller's (sessions' one closing rule, `closingOf`). And
 * (T070's follow-up 2) `slot_released_at` is cleared, so a later closing holds the slot again; and
 * (T082) `admin_end_reason`, a direct end's reason, as `cancellation_reason` is (rule 51 refuses it
 * on a confirmed row).
 */
export async function restoreEnrollment(tx: Client, id: string): Promise<boolean> {
  const { count } = await tx.enrollment.updateMany({
    where: {
      id,
      confirmedAt: { not: null },
      OR: [
        { status: 'terminated_no_show' },
        { status: 'cancelled', cancellationReason: { in: ['admin', 'teacher_suspended'] } },
      ],
    },
    data: {
      status: 'confirmed',
      cancellationReason: null,
      slotReleasedAt: null,
      adminEndReason: null,
    },
  });
  return count === 1;
}

/**
 * 006:T017 (FR-725, R-513; B-P3 lane e's Q-e1 (a), the owner, 2026-11-24): an administrator's reopen
 * of a programme an approved stop closed: `cancelled` with the reason `programme_stopped`, of an
 * enrollment a payment once confirmed (`confirmed_at` set) → `confirmed`, the reason,
 * `slot_released_at` and `admin_end_reason` cleared as `restoreEnrollment` clears them, by one
 * conditional update; answers whether it moved. The confirmation path's third writer of the status
 * (`tests/pipeline/confirmation-path.spec.ts`, ALLOWED), reached only from the reopen's store
 * (`programme-requests.service.ts`); it never writes `confirmed_at` (R-HONEST-1).
 */
export async function reopenStoppedEnrollment(tx: Client, id: string): Promise<boolean> {
  const { count } = await tx.enrollment.updateMany({
    where: {
      id,
      status: 'cancelled',
      cancellationReason: 'programme_stopped',
      confirmedAt: { not: null },
    },
    data: {
      status: 'confirmed',
      cancellationReason: null,
      slotReleasedAt: null,
      adminEndReason: null,
    },
  });
  return count === 1;
}

/** The enrollment's `enrollment_events` rows, oldest first, the id breaking a tie; no payment. */
export async function enrollmentEventsOf(
  tx: Client,
  enrollmentId: string,
): Promise<EnrollmentEventEntry[]> {
  const rows = await tx.enrollmentEvent.findMany({
    where: { enrollmentId },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    select: { kind: true, cancellationReason: true, occurredAt: true },
  });
  return rows.map(({ kind, cancellationReason, occurredAt }) =>
    cancellationReason === null ? { kind, occurredAt } : { kind, cancellationReason, occurredAt },
  );
}

/**
 * Up to `take` enrollments matching `filter`, newest first by their time-ordered id, those before
 * `cursor` when it is given. T074 FU4: `everConfirmed` keeps the enrollments with `confirmed_at`
 * set, a read clause the confirmation gate reads as a read; each item carries its last
 * cancellation's reason and its release.
 */
export async function enrollmentsPage(
  tx: Client,
  filter: EnrollmentPageFilter,
  cursor: string | undefined,
  take: number,
): Promise<EnrollmentPageItem[]> {
  const ids = [
    ...(filter.enrollmentIds === undefined ? [] : [{ id: { in: [...filter.enrollmentIds] } }]),
    ...(cursor === undefined ? [] : [{ id: { lt: cursor } }]),
  ];
  const rows = await tx.enrollment.findMany({
    where: {
      AND: ids,
      ...(filter.status === undefined ? {} : { status: filter.status }),
      ...(filter.studentUserIds === undefined
        ? {}
        : { studentUserId: { in: [...filter.studentUserIds] } }),
      ...(filter.teacherUserIds === undefined
        ? {}
        : { teacherUserId: { in: [...filter.teacherUserIds] } }),
      // T074 FU4: written in the `where` itself, so the confirmation gate reads it as a read; an
      // empty filter filters nothing.
      confirmedAt: filter.everConfirmed === true ? { not: null } : {},
    },
    orderBy: { id: 'desc' },
    take,
    select: {
      id: true,
      studentUserId: true,
      teacherUserId: true,
      status: true,
      snapshotTrack: true,
      snapshotSessionCount: true,
      cancellationReason: true,
      slotReleasedAt: true,
    },
  });
  return rows.map((row) => ({
    enrollmentId: row.id,
    studentUserId: row.studentUserId,
    teacherUserId: row.teacherUserId,
    status: row.status,
    track: row.snapshotTrack,
    sessionCount: row.snapshotSessionCount,
    cancellationReason: row.cancellationReason,
    slotReleasedAt: row.slotReleasedAt,
  }));
}

/** An active hold as `heldTimesOf` reads it: its slot, its session count and its expiry. */
export interface ActiveHold {
  readonly slotId: string;
  readonly sessionCount: number;
  readonly expiresAt: Date;
}

/**
 * The active holds (`released_at` NULL, even past `expires_at`: `holds.repository.ts`' rule) of
 * `studentUserIds` or on `slotIds`, in id order; nothing asked for two empty lists. Bounded by the
 * two partial unique indexes: one active hold per student and one per slot.
 */
export async function activeHoldsAmong(
  tx: Pick<Transaction, 'slotHold'>,
  scope: { readonly studentUserIds: readonly string[]; readonly slotIds: readonly string[] },
): Promise<ActiveHold[]> {
  const either = [
    ...(scope.studentUserIds.length === 0
      ? []
      : [{ studentUserId: { in: [...scope.studentUserIds] } }]),
    ...(scope.slotIds.length === 0 ? [] : [{ slotId: { in: [...scope.slotIds] } }]),
  ];
  if (either.length === 0) return [];
  return tx.slotHold.findMany({
    where: { releasedAt: null, OR: either },
    orderBy: { id: 'asc' },
    select: { slotId: true, sessionCount: true, expiresAt: true },
  });
}

/** The kernel's row lock, for `EnrollmentSide.lockEnrollments` (T005). */
export { lockRows } from '../../platform/db/row-lock.js';
