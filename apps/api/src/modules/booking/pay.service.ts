// T036 (FR-354, FR-358, FR-386, R-208, R-209; ARCHITECTURE §8.1; the owner's decisions of
// 2026-11-03): what `checkout.pay` asks of booking, on the caller's transaction.
//
// THE HOLD'S PACKAGE. A hold records the package it was placed for and that package's session count
// at that moment (`slot_holds.package_id`, `slot_holds.session_count`; the owner's decision of
// 2026-11-03): Pay names the hold alone, a teacher may have several packages of the slot's length,
// and the hold's overlap check ran on that count (FR-351).
//
// BEFORE THE GATEWAY (`payTargetOf`), without a lock: the student's own hold (`NOT_FOUND` for an
// unknown one and another student's, M3), still open to Pay (`HOLD_EXPIRED` once released or
// expired; a hold Pay already linked answers it too: a new order on it is Retry's), and the package
// as it is now, compared with what the student saw (`SUMMARY_CHANGED`), so in the ordinary case no
// order is created for a summary that changed.
//
// UNDER THE LOCKS (`enrollOnHold`), in T005's order: both accounts in one call (an enrollment
// references both, the note under T033), the slot, the hold; then everything Pay decides on is read
// again: the teacher still visible and bookable and the student still active (FR-353), the package
// (read after the teacher's lock, so a package edit, which locks the teacher's account first, and a
// first enrollment never cross, T018 and the note under T036 of PR #115), compared again with what
// the student saw, with the count the hold checked and with the slot's length (`SUMMARY_CHANGED`,
// nothing written: the hold does not freeze the package); then the enrollment is written with the id the caller drew (the gateway was
// handed it), its snapshot and the first session's date the checkout shows by FR-368's rule from
// Pay's instant (R-209), and the hold linked to it by a conditional update that finds it still the
// student's, active, unexpired and unlinked (`HOLD_EXPIRED` otherwise, the transaction keeping
// nothing). The order is the caller's to insert after, referencing the enrollment.
//
// WHAT THE STUDENT SAW (the owner's decisions of 2026-11-03). `checkout.pay` sends the summary it
// showed: the price, the session count, the length and the track. `SUMMARY_CHANGED` when the package
// is inactive, when any of the four differs from the package now, when the package's count now
// differs from the count the hold's overlap check ran on (a student who read the new summary after
// the teacher changed the count still sends it, and is still refused: the hold was checked for the
// old one), or when its length differs from the held slot's. A refusal carries the package as it now
// is in `details` (`domain-error.ts`, `SUMMARY_CHANGED`).
import type { PackageTrack } from '@ijazah/contracts';
import type { Piasters } from '@ijazah/money';
import { type DayOfWeek, firstOccurrenceAfter } from '@ijazah/time';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { LockedTable } from '../../platform/db/row-lock.js';
import { DomainError, type FieldIssue } from '../../platform/errors/domain-error.js';
import type { RequesterGender } from '../../platform/guards/requester-gender.js';
import {
  bookablePackageOf,
  type PackageRow,
  type SlotRow,
  slotById,
  teacherPackageOf,
} from '../catalog/index.js';
import { lockRows } from './holds.repository.js';
import { holdsStore } from './holds.service.js';
import {
  insertEnrollment,
  linkActiveHold,
  type NewEnrollment,
  type PayHoldRow,
  studentHold,
} from './pay.repository.js';

/** What the student saw on the checkout's summary when they pressed Pay. */
export interface QuotedSummary {
  readonly price_piasters: Piasters;
  readonly sessionCount: number;
  readonly sessionDurationMinutes: number;
  readonly track: PackageTrack;
}

/** What the package is held against: the count the hold checked and the held slot's length. */
export interface HeldTerms {
  readonly sessionCount: number;
  readonly slotLengthMinutes: number;
}

/**
 * How the package now differs from what the student saw or from what it is held against, as
 * `SUMMARY_CHANGED`'s details: empty when it does not. A deactivated package is `package: inactive`;
 * otherwise every field of the package as it now is.
 */
export function summaryChanges(
  pkg: Pick<
    PackageRow,
    'isActive' | 'price_piasters' | 'sessionCount' | 'sessionDurationMinutes' | 'track'
  > | null,
  quoted: QuotedSummary,
  held: HeldTerms,
): FieldIssue[] {
  if (pkg?.isActive !== true) return [{ path: 'package', code: 'inactive' }];
  if (
    pkg.price_piasters === quoted.price_piasters &&
    pkg.sessionCount === quoted.sessionCount &&
    pkg.sessionDurationMinutes === quoted.sessionDurationMinutes &&
    pkg.track === quoted.track &&
    pkg.sessionCount === held.sessionCount &&
    pkg.sessionDurationMinutes === held.slotLengthMinutes
  ) {
    return [];
  }
  return [
    { path: 'summary.price_piasters', code: String(pkg.price_piasters) },
    { path: 'summary.sessionCount', code: String(pkg.sessionCount) },
    { path: 'summary.sessionDurationMinutes', code: String(pkg.sessionDurationMinutes) },
    { path: 'summary.track', code: pkg.track },
  ];
}

function refuseChanged(issues: readonly FieldIssue[]): void {
  if (issues.length > 0) throw new DomainError('SUMMARY_CHANGED', undefined, { details: issues });
}

/** What Pay reads and writes, each through its owner's entry; faked in a spec. */
export interface PayStore {
  lockRows(tx: Transaction, table: LockedTable, ids: readonly string[]): Promise<void>;
  studentHold(tx: Transaction, holdId: string, studentUserId: string): Promise<PayHoldRow | null>;
  /** The package's teacher, or null for an inactive package. */
  packageTeacher(tx: Transaction, packageId: string): Promise<string | null>;
  teacherPackageOf(
    tx: Transaction,
    teacherUserId: string,
    packageId: string,
  ): Promise<PackageRow | null>;
  slotById(tx: Transaction, slotId: string): Promise<SlotRow | null>;
  visible(
    tx: Transaction,
    requester: RequesterGender,
    teacherUserId: string,
    purpose: 'discover' | 'book',
  ): Promise<boolean>;
  studentActive(tx: Transaction, userId: string): Promise<boolean>;
  insertEnrollment(tx: Transaction, enrollment: NewEnrollment): Promise<void>;
  linkActiveHold(
    tx: Transaction,
    hold: { readonly id: string; readonly studentUserId: string },
    enrollmentId: string,
    at: Date,
  ): Promise<boolean>;
}

/** Pay's store over booking's rows and catalog's and identity's entries. */
export function payStoreOver(): PayStore {
  return {
    lockRows,
    studentHold,
    packageTeacher: async (tx, packageId) =>
      (await bookablePackageOf(tx, packageId))?.teacherUserId ?? null,
    teacherPackageOf,
    slotById,
    visible: holdsStore.visible,
    studentActive: holdsStore.studentActive,
    insertEnrollment,
    linkActiveHold,
  };
}

/** The hold Pay is for, its package and teacher, read before the gateway. */
export interface PayTarget {
  readonly hold: PayHoldRow;
  readonly packageId: string;
  readonly teacherUserId: string;
  readonly price_piasters: Piasters;
}

/** The count the hold checked and the held slot's length. */
function heldTermsOf(hold: PayHoldRow, slot: SlotRow): HeldTerms {
  return { sessionCount: hold.sessionCount, slotLengthMinutes: slot.durationMinutes };
}

/** Whether the hold is still open to Pay at `at`: active, unexpired, not yet linked. */
function openToPay(hold: PayHoldRow, at: Date): boolean {
  return (
    hold.releasedAt === null &&
    hold.enrollmentId === null &&
    hold.expiresAt.getTime() > at.getTime()
  );
}

/** Pay's checks before the gateway, without a lock (this file's head). */
export async function payTargetOf(
  tx: Transaction,
  request: { readonly studentUserId: string; readonly holdId: string; readonly at: Date },
  quoted: QuotedSummary,
  store: PayStore,
): Promise<PayTarget> {
  const hold = await store.studentHold(tx, request.holdId, request.studentUserId);
  if (hold === null) throw new DomainError('NOT_FOUND');
  if (!openToPay(hold, request.at)) throw new DomainError('HOLD_EXPIRED');
  const { packageId } = hold;
  const teacherUserId = await store.packageTeacher(tx, packageId);
  const [pkg, slot] = await Promise.all([
    teacherUserId === null ? null : store.teacherPackageOf(tx, teacherUserId, packageId),
    store.slotById(tx, hold.slotId),
  ]);
  if (slot === null) throw new Error('pay: a hold without its slot');
  refuseChanged(summaryChanges(pkg, quoted, heldTermsOf(hold, slot)));
  if (pkg === null || teacherUserId === null) throw new Error('pay: unreachable');
  return { hold, packageId, teacherUserId, price_piasters: pkg.price_piasters };
}

/** What `enrollOnHold` writes with, beside the target. */
export interface Enrolment {
  readonly student: { readonly userId: string; readonly gender: RequesterGender };
  readonly enrollmentId: string;
  readonly at: Date;
  readonly leadHours: number;
  readonly quoted: QuotedSummary;
}

/**
 * Pay's transaction on booking's side (this file's head): locks, reads again, writes the enrollment
 * and links the hold. Takes every lock it needs, the caller holding none; the caller inserts the
 * order after it. Any refusal is thrown and the transaction must keep nothing.
 */
export async function enrollOnHold(
  tx: Transaction,
  target: PayTarget,
  enrolment: Enrolment,
  store: PayStore,
): Promise<void> {
  const { student, at } = enrolment;
  const { hold, teacherUserId, packageId } = target;
  await store.lockRows(tx, 'users', [...new Set([student.userId, teacherUserId])].sort());
  await store.lockRows(tx, 'availability_slots', [hold.slotId]);
  await store.lockRows(tx, 'slot_holds', [hold.id]);
  if (!(await store.visible(tx, student.gender, teacherUserId, 'discover'))) {
    throw new DomainError('NOT_FOUND');
  }
  if (!(await store.visible(tx, student.gender, teacherUserId, 'book'))) {
    throw new DomainError('NOT_BOOKABLE');
  }
  if (!(await store.studentActive(tx, student.userId))) {
    throw new DomainError('ACCOUNT_NOT_ACTIVE');
  }
  const [pkg, slot] = await Promise.all([
    store.teacherPackageOf(tx, teacherUserId, packageId),
    store.slotById(tx, hold.slotId),
  ]);
  if (slot === null) throw new Error('pay: a hold without its slot');
  refuseChanged(summaryChanges(pkg, enrolment.quoted, heldTermsOf(hold, slot)));
  if (pkg === null) throw new Error('pay: unreachable');
  const first = firstOccurrenceAfter(
    // `availability_slots.day_of_week` is 0 to 6 by its check (ERD §15 rule 37); the package asserts it.
    { ...slot, dayOfWeek: slot.dayOfWeek as DayOfWeek },
    at,
    enrolment.leadHours,
  );
  await store.insertEnrollment(tx, {
    id: enrolment.enrollmentId,
    studentUserId: student.userId,
    teacherUserId,
    packageId,
    slotId: hold.slotId,
    price_piasters: pkg.price_piasters,
    sessionCount: pkg.sessionCount,
    sessionDurationMinutes: pkg.sessionDurationMinutes,
    subjectId: pkg.subject.id,
    track: pkg.track,
    slotTimezone: slot.timezone,
    purchasedAt: at,
    quotedFirstSessionLocalDate: first.requestedLocalDate,
  });
  if (!(await store.linkActiveHold(tx, hold, enrolment.enrollmentId, at))) {
    throw new DomainError('HOLD_EXPIRED');
  }
}
