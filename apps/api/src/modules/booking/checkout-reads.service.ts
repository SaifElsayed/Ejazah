// T037 (FR-358, FR-380 to FR-386, FR-BOOK-12 (c); R-208, M3): booking's reads for `checkout.current`
// and `checkout.status`, each on the caller's transaction. Read-only, no lock: nothing is decided
// on what they read, and each answers what the student is shown.
//
// THE CURRENT HOLD (`currentHoldOf`): the student's own active hold while it has not expired, with
// FR-358's summary of the package the hold names (`slot_holds.package_id`) as the package is now,
// so a student who comes back after the teacher changed it reads the new terms (the note under
// T045). The teacher's name is read through the visibility predicate with the session's gender: a
// teacher the student may no longer see answers no hold (R-GENDER-2); a termination releases such a
// hold (R-219). It carries the first and last session the student would get if confirmed at the
// read's instant (FR-386, FR-368; T085): the held slot, read through catalog's entry as Pay and the
// confirm job read it (`readSlot`), previewed by the booking sheet's own `sessionPreviewsOn` with the
// package's session count the summary shows and the lead the caller read.
//
// THE STATUS (`enrollmentStatusOf`): only the student's own enrollment (`NOT_FOUND` otherwise, M3),
// its status and reason as the database holds them (R-HONEST-1), the snapshot's summary, its
// sessions once generated, each with its local date, local start, zone and instants (FR-393), and
// the first session's move when session 1 is not on the date the checkout showed (FR-386, R-209).
import type { CheckoutStatusOutput, CheckoutSummary, SubjectSummary } from '@ijazah/contracts';
import { piasters } from '@ijazah/money';
import { calendarDateOf } from '@ijazah/time';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import type { RequesterGender } from '../../platform/guards/requester-gender.js';
import {
  type PackageRow,
  packageOwnerOf,
  readSlot,
  type SlotRow,
  subjectSummariesOf,
  teacherPackageOf,
} from '../catalog/index.js';
import { readTargetPerson, visibleTeachers } from '../identity/index.js';
import { type EnrollmentSessionRow, enrollmentSessionsOf } from '../sessions/index.js';
import { type SessionPreviews, sessionPreviewsOn } from './booking-slots.service.js';
import {
  type CheckoutEnrollmentRow,
  type CurrentHoldRow,
  ownCurrentHold,
  studentEnrollment,
} from './checkout-holds.repository.js';
import { summaryOf } from './checkout-holds.service.js';
import type { FirstSessionRule } from './nearest-slot.service.js';

/** What the reads read, each through its owner's entry; faked in a spec. */
export interface CheckoutReadsStore {
  ownCurrentHold(tx: Transaction, studentUserId: string): Promise<CurrentHoldRow | null>;
  /** A slot by its id, active or not: the held slot's weekday, local start, length and zone. */
  slotOf(tx: Transaction, slotId: string): Promise<SlotRow | null>;
  packageOwnerOf(tx: Transaction, packageId: string): Promise<string | null>;
  teacherPackageOf(
    tx: Transaction,
    teacherUserId: string,
    packageId: string,
  ): Promise<PackageRow | null>;
  /** The teacher's name when the requester may see the teacher, else null. */
  visibleTeacherName(
    tx: Transaction,
    requester: RequesterGender,
    teacherUserId: string,
  ): Promise<string | null>;
  /** The teacher's name as the enrollment's party, whatever the teacher's state now. */
  teacherName(tx: Transaction, teacherUserId: string): Promise<string>;
  studentEnrollment(
    tx: Transaction,
    enrollmentId: string,
    studentUserId: string,
  ): Promise<CheckoutEnrollmentRow | null>;
  subjectsOf(tx: Transaction, ids: readonly string[]): Promise<ReadonlyMap<string, SubjectSummary>>;
  sessionsOf(tx: Transaction, enrollmentId: string): Promise<readonly EnrollmentSessionRow[]>;
}

export const checkoutReadsStore: CheckoutReadsStore = {
  ownCurrentHold,
  slotOf: readSlot,
  packageOwnerOf,
  teacherPackageOf,
  visibleTeacherName: async (tx, requester, teacherUserId) => {
    const [teacher] = await visibleTeachers(tx, requester, {
      purpose: 'discover',
      teacherIds: [teacherUserId],
    });
    return teacher?.displayName ?? null;
  },
  teacherName: async (tx, teacherUserId) =>
    (await readTargetPerson(tx, teacherUserId))?.displayName ?? '',
  studentEnrollment,
  subjectsOf: subjectSummariesOf,
  sessionsOf: enrollmentSessionsOf,
};

/** The current hold as `checkout.current` answers it, before payments adds its last order. */
export interface CurrentHold extends SessionPreviews {
  readonly holdId: string;
  readonly expiresAt: Date;
  readonly enrollmentId: string | null;
  readonly summary: CheckoutSummary;
}

/**
 * The student's own hold unexpired at `rule.now`, its package's summary now and the sessions it
 * would get if confirmed then by `rule`'s lead, or null (this file's head).
 */
export async function currentHoldOf(
  tx: Transaction,
  student: { readonly userId: string; readonly gender: RequesterGender },
  rule: FirstSessionRule,
  store: CheckoutReadsStore = checkoutReadsStore,
): Promise<CurrentHold | null> {
  const hold = await store.ownCurrentHold(tx, student.userId);
  if (hold === null || hold.expiresAt.getTime() <= rule.now.getTime()) return null;
  const teacherUserId = await store.packageOwnerOf(tx, hold.packageId);
  if (teacherUserId === null) return null;
  const [pkg, displayName, slot] = await Promise.all([
    store.teacherPackageOf(tx, teacherUserId, hold.packageId),
    store.visibleTeacherName(tx, student.gender, teacherUserId),
    store.slotOf(tx, hold.slotId),
  ]);
  if (pkg === null || displayName === null) return null;
  // `slot_holds.slot_id` is a foreign key to the slot (ERD `slot_holds`), as Pay reads it.
  if (slot === null) throw new Error('checkout: a hold without its slot');
  return {
    holdId: hold.id,
    expiresAt: hold.expiresAt,
    enrollmentId: hold.enrollmentId,
    summary: summaryOf({ teacherId: teacherUserId, displayName }, pkg),
    ...sessionPreviewsOn(slot, rule, pkg.sessionCount),
  };
}

/** The status as `checkout.status` answers it, before payments adds its last order. */
export type EnrollmentStatusAnswer = Omit<CheckoutStatusOutput, 'lastOrder'> & {
  readonly enrollmentId: string;
};

/** The seconds a `time` column's local time carries, which the contract's `HH:MM` leaves out. */
const SECONDS = ':00';

/** The student's own enrollment as the server holds it (this file's head); `NOT_FOUND` otherwise. */
export async function enrollmentStatusOf(
  tx: Transaction,
  studentUserId: string,
  enrollmentId: string,
  store: CheckoutReadsStore = checkoutReadsStore,
): Promise<EnrollmentStatusAnswer> {
  const enrollment = await store.studentEnrollment(tx, enrollmentId, studentUserId);
  if (enrollment === null) throw new DomainError('NOT_FOUND');
  const [displayName, subjects, sessions] = await Promise.all([
    store.teacherName(tx, enrollment.teacherUserId),
    store.subjectsOf(tx, [enrollment.snapshotSubjectId]),
    store.sessionsOf(tx, enrollment.id),
  ]);
  const subject = subjects.get(enrollment.snapshotSubjectId);
  if (subject === undefined) throw new Error('checkout: an enrollment without its subject');
  const summary = summaryOf(
    { teacherId: enrollment.teacherUserId, displayName },
    {
      subject,
      track: enrollment.snapshotTrack,
      sessionCount: enrollment.snapshotSessionCount,
      sessionDurationMinutes:
        enrollment.snapshotDurationMinutes as PackageRow['sessionDurationMinutes'],
      price_piasters: piasters(Number(enrollment.snapshotPricePiasters)),
    },
  );
  const quoted = calendarDateOf(enrollment.quotedFirstSessionLocalDate);
  const [first] = sessions;
  return {
    enrollmentId: enrollment.id,
    status: enrollment.status,
    ...(enrollment.cancellationReason === null
      ? {}
      : { cancellationReason: enrollment.cancellationReason }),
    summary,
    ...(sessions.length === 0
      ? {}
      : {
          sessions: sessions.map((one) => ({
            sequenceNumber: one.sequenceNumber,
            localDate: one.localDate,
            startTimeLocal: one.startTimeLocal.slice(0, -SECONDS.length),
            timezone: one.timezone,
            startsAt: one.startsAt.toISOString(),
            endsAt: one.endsAt.toISOString(),
          })),
        }),
    ...(first === undefined || first.localDate === quoted
      ? {}
      : { firstSessionMoved: { quoted, actual: first.localDate } }),
  };
}
