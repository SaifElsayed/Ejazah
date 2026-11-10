// T033 (FR-351, FR-363, ADR 0010 D1–D7): booking's queries on `slot_holds` and the cancellation of an
// enrollment awaiting payment, each on the caller's transaction. Queries only; the rules and the
// locks' order are `holds.service.ts`'s, which locks a row before it reads what it decides on here
// (T005's rule 1). A soft-deleted enrollment is left out by the client's extension (T148).
//
// A hold is active while `released_at` is NULL, even past `expires_at` (ERD §15 rules 17–18): the
// database never compares a hold with the clock, so "expired" is always asked with the caller's
// instant. Every read of holds is bounded: at most one active hold per slot and per student (the
// two partial unique indexes), and the ids a caller locked.
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { EnrollmentCancellationReason } from './enrollment-events.repository.js';

type Client = Pick<Transaction, 'slotHold' | 'enrollment'>;

/** A hold as the release and the placement read it. */
export interface HeldRow {
  readonly id: string;
  readonly slotId: string;
  readonly studentUserId: string;
  readonly enrollmentId: string | null;
  readonly expiresAt: Date;
}

/** Which active holds a lookup is about: those on a slot, those of a student, or either. */
export interface HoldScope {
  readonly slotId?: string;
  readonly studentUserId?: string;
}

/**
 * A hold to write; `enrollmentId` is set by FR-PAYG-19's re-hold, NULL at placement (ADR 0010 D2).
 * `packageId` and `sessionCount` are the package the hold is for and its session count the overlap
 * check ran on (B29, the owner's decision of 2026-11-03).
 */
export interface NewHold {
  readonly slotId: string;
  readonly studentUserId: string;
  readonly packageId: string;
  readonly sessionCount: number;
  readonly enrollmentId: string | null;
  readonly expiresAt: Date;
}

/** The active holds on the scope's slot or of its student (either, when both are given). */
function inScope(scope: HoldScope) {
  const either = [
    ...(scope.slotId === undefined ? [] : [{ slotId: scope.slotId }]),
    ...(scope.studentUserId === undefined ? [] : [{ studentUserId: scope.studentUserId }]),
  ];
  return { releasedAt: null, OR: either };
}

/** The ids of the scope's active holds expired at `at`, in id order (the order they are locked in). */
export async function expiredHoldIds(
  tx: Client,
  scope: HoldScope,
  at: Date,
): Promise<readonly string[]> {
  if (scope.slotId === undefined && scope.studentUserId === undefined) return [];
  const rows = await tx.slotHold.findMany({
    where: { ...inScope(scope), expiresAt: { lte: at } },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  return rows.map(({ id }) => id);
}

/** Of `ids`, the holds still active, in id order. */
export function activeHoldsByIds(tx: Client, ids: readonly string[]): Promise<HeldRow[]> {
  if (ids.length === 0) return Promise.resolve([]);
  return tx.slotHold.findMany({
    where: { id: { in: [...ids] }, releasedAt: null },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      slotId: true,
      studentUserId: true,
      enrollmentId: true,
      expiresAt: true,
    },
  });
}

/** The active holds on the slot or of the student, expired or not: at most two. */
export function activeHoldsOf(tx: Client, scope: Required<HoldScope>): Promise<HeldRow[]> {
  return tx.slotHold.findMany({
    where: inScope(scope),
    orderBy: { id: 'asc' },
    select: {
      id: true,
      slotId: true,
      studentUserId: true,
      enrollmentId: true,
      expiresAt: true,
    },
  });
}

/** Which active holds an account's end is about: those on a teacher's slots, or a student's (T041). */
export type ActiveHoldScope =
  { readonly slotIds: readonly string[] } | { readonly studentUserId: string };

/**
 * The ids of the scope's active holds, expired or not, in id order (the order they are locked in):
 * at most one per slot, and one of a student (ERD §15 rules 17–18). Read with no lock; the release
 * locks them and reads them again (T041).
 */
export async function activeHoldIds(
  tx: Client,
  scope: ActiveHoldScope,
): Promise<readonly string[]> {
  if ('slotIds' in scope && scope.slotIds.length === 0) return [];
  const rows = await tx.slotHold.findMany({
    where: {
      releasedAt: null,
      ...('slotIds' in scope
        ? { slotId: { in: [...scope.slotIds] } }
        : { studentUserId: scope.studentUserId }),
    },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  return rows.map(({ id }) => id);
}

/** Why a hold is released without conversion: `hold_release_reason` less `converted` (GAP-8). */
export type HoldReleaseReason =
  | 'expired'
  | 'checkout_abandoned'
  | 'slot_unavailable'
  | 'admin'
  | 'teacher_suspended'
  | 'account_deleted';

/**
 * Releases the still-active holds of `ids` at `at` with `reason`, by one conditional update; the
 * reason is written with `released_at` (T027 of specs/004-sessions; research R-323, GAP-8; ERD §15
 * rule 48).
 */
export async function markReleased(
  tx: Client,
  ids: readonly string[],
  at: Date,
  reason: HoldReleaseReason,
): Promise<void> {
  if (ids.length === 0) return;
  await tx.slotHold.updateMany({
    where: { id: { in: [...ids] }, releasedAt: null },
    data: { releasedAt: at, releaseReason: reason },
  });
}

/** Of `enrollmentIds`, those awaiting payment, in id order. */
export async function pendingAmong(
  tx: Client,
  enrollmentIds: readonly string[],
): Promise<readonly string[]> {
  if (enrollmentIds.length === 0) return [];
  const rows = await tx.enrollment.findMany({
    where: { id: { in: [...enrollmentIds] }, status: 'pending_payment' },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  return rows.map(({ id }) => id);
}

/** Cancels those of `enrollmentIds` still awaiting payment with `reason`, by one conditional update. */
export async function cancelPending(
  tx: Client,
  enrollmentIds: readonly string[],
  reason: EnrollmentCancellationReason,
): Promise<void> {
  if (enrollmentIds.length === 0) return;
  await tx.enrollment.updateMany({
    where: { id: { in: [...enrollmentIds] }, status: 'pending_payment' },
    data: { status: 'cancelled', cancellationReason: reason },
  });
}

/**
 * The enrollment's package and snapshot session count, read under its lock: what FR-PAYG-19's
 * re-hold records on the hold it writes for it (B29). Null when the enrollment is gone.
 */
export async function enrollmentTermsOf(
  tx: Client,
  enrollmentId: string,
): Promise<{ readonly packageId: string; readonly sessionCount: number } | null> {
  const row = await tx.enrollment.findUnique({
    where: { id: enrollmentId },
    select: { packageId: true, snapshotSessionCount: true },
  });
  return row === null ? null : { packageId: row.packageId, sessionCount: row.snapshotSessionCount };
}

/** Writes the hold and answers its id. */
export async function insertHold(tx: Client, hold: NewHold): Promise<string> {
  const { id } = await tx.slotHold.create({ data: hold, select: { id: true } });
  return id;
}

/**
 * The kernel's row lock, for the rows a hold's path decides on (T005): the two accounts and the slot
 * a hold and an enrollment reference by their foreign keys, and booking's own holds and enrollments.
 */
export { lockRows } from '../../platform/db/row-lock.js';
