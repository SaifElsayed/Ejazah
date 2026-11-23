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
//
// 006:T005 (FR-701, FR-702, R-504; Q-5 (a)). A programme package is bought as its assessment
// (`programmes.service.ts`): the student saw one session at the assessment's length, at the fee, on
// a weekly time at least that long. Before the gateway, the target answers the kind `assessment`
// with no price, all the rest checked as above, and `payTermsOf` reads the programme's availability
// and answers the order's gross, the fee: `SUMMARY_CHANGED` when the fee or the length is no longer
// what the student saw, `CONFLICT` with its cause while the programme is closed. Under the locks
// the same is read again through the enrolment's reader, and the enrollment's snapshot is the
// assessment's: count 1, the assessment's length, the fee.
//
// 006:T009 (the owner's Q-C5 (a), SRS DEC-112; FR-BOOK-12 every way). While a programme order of the
// student is still payable (`programme.pay`'s, which has no hold), Pay on the student's own hold is
// refused `PREVIOUS_CHECKOUT` `payable` with that enrollment and the order's expiry: before the
// gateway, and again under the student's account (the accounts' lock, first in `enrollOnHold`),
// the lock `programme.pay`'s check and a new hold take first, so the two cannot both pass.
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
  readSlot,
  type SlotRow,
  teacherPackageOf,
} from '../catalog/index.js';
import { type PayableProgrammeOrderOf, previousCheckout } from './checkout-holds.service.js';
import { lockRows } from './holds.repository.js';
import { holdsStore } from './holds.service.js';
import {
  closedProgramme,
  fitsSlot,
  type ProgrammeReader,
  type PurchaseTerms,
  purchaseTermsOf,
  refusedStart,
} from './programmes.service.js';
import {
  insertEnrollment,
  linkActiveHold,
  type NewEnrollment,
  type PayHoldRow,
  studentHold,
} from './pay.repository.js';
import { activeProgrammeSlotsOf } from './programmes.repository.js';

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

/** A package's terms as it is now: today's own, or (006:T005) its assessment's, given. */
function termsNow(pkg: PackageRow, assessment: PurchaseTerms | undefined): PurchaseTerms {
  if (!pkg.isProgramme) {
    return {
      kind: 'package',
      sessionCount: pkg.sessionCount,
      sessionDurationMinutes: pkg.sessionDurationMinutes,
      price_piasters: pkg.price_piasters,
    };
  }
  if (assessment === undefined) throw new Error('pay: a programme package without its assessment');
  return assessment;
}

/**
 * How the package now differs from what the student saw or from what it is held against, as
 * `SUMMARY_CHANGED`'s details: empty when it does not. A deactivated package is `package: inactive`;
 * otherwise every field of the package as it now is. 006:T005: a programme package is compared by
 * its assessment's terms, `assessment`, on a weekly time at least the assessment's length.
 */
export function summaryChanges(
  pkg: PackageRow | null,
  quoted: QuotedSummary,
  held: HeldTerms,
  assessment?: PurchaseTerms,
): FieldIssue[] {
  if (pkg?.isActive !== true) return [{ path: 'package', code: 'inactive' }];
  const terms = termsNow(pkg, assessment);
  if (
    terms.price_piasters === quoted.price_piasters &&
    terms.sessionCount === quoted.sessionCount &&
    terms.sessionDurationMinutes === quoted.sessionDurationMinutes &&
    pkg.track === quoted.track &&
    terms.sessionCount === held.sessionCount &&
    fitsSlot(terms, held.slotLengthMinutes)
  ) {
    return [];
  }
  return [
    { path: 'summary.price_piasters', code: String(terms.price_piasters) },
    { path: 'summary.sessionCount', code: String(terms.sessionCount) },
    { path: 'summary.sessionDurationMinutes', code: String(terms.sessionDurationMinutes) },
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
  /**
   * 006:T009 (Q-C5 (a)): the student's programme order still payable at `at`, or null: booking's
   * active programmes of the student, then payments' answer among them (no lock).
   */
  programmeOrderOf(
    tx: Transaction,
    studentUserId: string,
    at: Date,
  ): Promise<{ readonly enrollmentId: string; readonly expiresAt: Date } | null>;
}

/**
 * Pay's store over booking's rows and catalog's and identity's entries; 006:T009 (Q-C5 (a)):
 * `programmeOrders`, payments' read of a payable programme order, handed in by the caller
 * (booking imports nothing of payments, R-208).
 */
export function payStoreOver(programmeOrders: PayableProgrammeOrderOf): PayStore {
  return {
    programmeOrderOf: async (tx, studentUserId, at) => {
      const programmes = await activeProgrammeSlotsOf(tx, [studentUserId]);
      if (programmes.length === 0) return null;
      return programmeOrders(
        tx,
        programmes.map(({ enrollmentId }) => enrollmentId),
        at,
      );
    },
    lockRows,
    studentHold,
    packageTeacher: async (tx, packageId) =>
      (await bookablePackageOf(tx, packageId))?.teacherUserId ?? null,
    teacherPackageOf,
    slotById: readSlot,
    visible: holdsStore.visible,
    studentActive: holdsStore.studentActive,
    insertEnrollment,
    linkActiveHold,
  };
}

/**
 * The hold Pay is for, its package and teacher, read before the gateway; 006:T005: the order's
 * kind, and the package's price, null for an assessment, which `payTermsOf` prices at the fee.
 */
export type PayTarget = {
  readonly hold: PayHoldRow;
  readonly packageId: string;
  readonly teacherUserId: string;
} & (
  | { readonly kind: 'package'; readonly price_piasters: Piasters }
  | { readonly kind: 'assessment'; readonly price_piasters: null }
);

/** 006:T005: the assessment as the student saw it, checked by `payTermsOf` against the fee. */
function seenAssessment(quoted: QuotedSummary): PurchaseTerms {
  return {
    kind: 'assessment',
    sessionCount: 1,
    sessionDurationMinutes: quoted.sessionDurationMinutes,
    price_piasters: quoted.price_piasters,
  };
}

/** The count the hold checked and the held slot's length. */
function heldTermsOf(hold: PayHoldRow, slot: SlotRow): HeldTerms {
  return { sessionCount: hold.sessionCount, slotLengthMinutes: slot.durationMinutes };
}

/**
 * 006:T009 (the owner's Q-C5 (a), SRS DEC-112; FR-BOOK-12): Pay is refused `PREVIOUS_CHECKOUT`
 * `payable`, with that enrollment and the order's expiry, while a programme order of the student is
 * still payable, as a payable checkout refuses `programme.pay`.
 */
async function refuseOverProgrammeOrder(
  tx: Transaction,
  store: PayStore,
  studentUserId: string,
  at: Date,
): Promise<void> {
  const payable = await store.programmeOrderOf(tx, studentUserId, at);
  if (payable !== null) {
    throw previousCheckout(payable.enrollmentId, 'payable', payable.expiresAt);
  }
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
  // 006:T009 (Q-C5 (a)): before the gateway, so no order is created for a refused Pay.
  await refuseOverProgrammeOrder(tx, store, request.studentUserId, request.at);
  const { packageId } = hold;
  const teacherUserId = await store.packageTeacher(tx, packageId);
  const [pkg, slot] = await Promise.all([
    teacherUserId === null ? null : store.teacherPackageOf(tx, teacherUserId, packageId),
    store.slotById(tx, hold.slotId),
  ]);
  if (slot === null) throw new Error('pay: a hold without its slot');
  refuseChanged(summaryChanges(pkg, quoted, heldTermsOf(hold, slot), seenAssessment(quoted)));
  if (pkg === null || teacherUserId === null) throw new Error('pay: unreachable');
  return pkg.isProgramme
    ? { hold, packageId, teacherUserId, kind: 'assessment', price_piasters: null }
    : { hold, packageId, teacherUserId, kind: 'package', price_piasters: pkg.price_piasters };
}

/** The order Pay creates: its kind and its gross. */
export interface PayOrderTerms {
  readonly kind: PurchaseTerms['kind'];
  readonly price_piasters: Piasters;
}

/**
 * 006:T005: the order's kind and gross before the gateway: the package's total, or the assessment
 * at the fee, the fee and the length checked against what the student saw (`SUMMARY_CHANGED`), a
 * closed programme refused `CONFLICT` with its cause. No lock, nothing written.
 */
export async function payTermsOf(
  target: PayTarget,
  quoted: QuotedSummary,
  programme: ProgrammeReader,
): Promise<PayOrderTerms> {
  if (target.kind === 'package') {
    return { kind: 'package', price_piasters: target.price_piasters };
  }
  const availability = await programme();
  if (!availability.open) throw refusedStart(availability.refusal);
  const assessmentPrice_piasters = availability.assessmentPrice_piasters;
  if (
    assessmentPrice_piasters !== quoted.price_piasters ||
    availability.assessmentDurationMinutes !== quoted.sessionDurationMinutes
  ) {
    refuseChanged([
      { path: 'summary.price_piasters', code: String(assessmentPrice_piasters) },
      { path: 'summary.sessionCount', code: '1' },
      {
        path: 'summary.sessionDurationMinutes',
        code: String(availability.assessmentDurationMinutes),
      },
      { path: 'summary.track', code: quoted.track },
    ]);
  }
  return { kind: 'assessment', price_piasters: assessmentPrice_piasters };
}

/** What `enrollOnHold` writes with, beside the target. */
export interface Enrolment {
  readonly student: { readonly userId: string; readonly gender: RequesterGender };
  readonly enrollmentId: string;
  readonly at: Date;
  readonly leadHours: number;
  readonly quoted: QuotedSummary;
  /** 006:T005: the programme's availability, read for a programme package only; none, closed. */
  readonly programme?: ProgrammeReader;
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
  // 006:T009 (Q-C5 (a)): read again under the student's account, which `programme.pay` takes first.
  await refuseOverProgrammeOrder(tx, store, student.userId, at);
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
  const now =
    pkg === null ? null : await purchaseTermsOf(pkg, enrolment.programme ?? closedProgramme);
  if (pkg?.isActive === true && now !== null && 'refusal' in now) throw refusedStart(now.refusal);
  const terms = now === null || 'refusal' in now ? undefined : now;
  refuseChanged(summaryChanges(pkg, enrolment.quoted, heldTermsOf(hold, slot), terms));
  if (pkg === null || terms === undefined) throw new Error('pay: unreachable');
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
    price_piasters: terms.price_piasters,
    sessionCount: terms.sessionCount,
    sessionDurationMinutes: terms.sessionDurationMinutes,
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
