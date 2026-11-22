// 006:T005 (FR-701, FR-702, R-501, R-504, R-507; U-1, N-12; Q-5 (a)): the programme's side of a
// booking, on the caller's transaction.
//
// THE ASSESSMENT'S TERMS. A package with a count and a length (recitation, or an ijazah-track one
// made while the switch was off) is booked as today: its count, its length, on a weekly time of
// exactly that length, at its total. A programme package is booked as its assessment (R-504): one
// session at `assessment_duration_minutes` (30 by default) on any of the teacher's weekly times at
// least that long (FR-PROFILE-8 as amended by DEC-94), at `assessment_price_piasters`, the fee, and
// the order is of kind `assessment` (FR-701). While the switch is off or the fee is 0 the programme
// is closed and the package is neither offered nor booked (Q-5 (a)): `CONFLICT` with the cause
// `programme_disabled` or `assessment_fee_unset`. The availability is catalog's
// (`programmeAvailabilityOf`), read through a reader the caller binds, and only for a programme
// package.
//
// THE STUDENT'S OWN WEEKLY TIME (U-1, N-12; the owner's hidden-times rule of 2026-11-05). An active
// programme (`awaiting_offer`, `offered`, `active`, `paused`) keeps its weekly time for the months
// still to come, which have no sessions yet. Every path that places a session or a hold for the
// student reads that time as occupied: `booking.slots` and the hold (through
// `withProgrammeTimes`), and sessions' make-up proposal, counter options and a postponement's
// placement (through `EnrollmentSide.programmeTimesOf`), each leaving out the enrollment it places
// for. The time is the slot's weekday, start and length in the enrollment's zone, each week resolved
// on its own date by `packages/time` (R-TIME-2), never by adding intervals. No lock and no write: a
// caller that decides on it holds both accounts first, as for every busy time (T005's rule 2).
//
// THE PROGRAMME ROW (R-504). The confirm step writes the confirmed assessment's programme
// `awaiting_offer` on its transaction, once.
import type { Piasters } from '@ijazah/money';
import { calendarWeeksAfter, type DayOfWeek, localDateIn, resolveOccurrences } from '@ijazah/time';
import { calendarDaysBefore } from '@ijazah/time/calendar';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import {
  type BookablePackage,
  type PackageRow,
  type ProgrammeAvailability,
  readSlot,
  type SlotRow,
} from '../catalog/index.js';
import type { HeldTime } from '../sessions/index.js';
import {
  type ActiveProgrammeSlot,
  activeProgrammeSlotsOf,
  insertAwaitingOffer,
} from './programmes.repository.js';
import type { SessionsBetween } from './session-overlap.service.js';

/** The programme's availability now (catalog's `programmeAvailabilityOf`, bound to settings). */
export type ProgrammeReader = () => Promise<ProgrammeAvailability>;

/** Why a programme cannot start now (R-515; Q-5 (a)). */
export type ProgrammeStartRefusal = Extract<ProgrammeAvailability, { open: false }>['refusal'];

/** A reader for a caller with no settings bound: the programme closed, so nothing is sold by default. */
export const closedProgramme: ProgrammeReader = async () => ({
  open: false,
  refusal: 'programme_disabled',
});

/** What a booking of the package is: today's package, or a programme's assessment. */
export interface BookingTerms {
  readonly kind: 'package' | 'assessment';
  readonly sessionCount: number;
  readonly sessionDurationMinutes: number;
}

/** The terms and the price the order is created at. */
export interface PurchaseTerms extends BookingTerms {
  readonly price_piasters: Piasters;
}

/** Terms, or the closed programme's refusal. */
export type Booked<T> = T | { readonly refusal: ProgrammeStartRefusal };

/** The assessment's terms when the programme is open. */
async function assessmentOf(programme: ProgrammeReader): Promise<Booked<PurchaseTerms>> {
  const availability = await programme();
  if (!availability.open) return { refusal: availability.refusal };
  return {
    kind: 'assessment',
    sessionCount: 1,
    sessionDurationMinutes: availability.assessmentDurationMinutes,
    price_piasters: availability.assessmentPrice_piasters,
  };
}

/** The terms `pkg` is booked on (this file's head); the programme is read for a programme package only. */
export async function bookingTermsOf(
  pkg: BookablePackage,
  programme: ProgrammeReader,
): Promise<Booked<BookingTerms>> {
  if (!pkg.isProgramme) {
    return {
      kind: 'package',
      sessionCount: pkg.sessionCount,
      sessionDurationMinutes: pkg.sessionDurationMinutes,
    };
  }
  const terms = await assessmentOf(programme);
  if ('refusal' in terms) return terms;
  const { kind, sessionCount, sessionDurationMinutes } = terms;
  return { kind, sessionCount, sessionDurationMinutes };
}

/** The terms and the price `pkg` is bought at (this file's head). */
export async function purchaseTermsOf(
  pkg: PackageRow,
  programme: ProgrammeReader,
): Promise<Booked<PurchaseTerms>> {
  if (!pkg.isProgramme) {
    return {
      kind: 'package',
      sessionCount: pkg.sessionCount,
      sessionDurationMinutes: pkg.sessionDurationMinutes,
      price_piasters: pkg.price_piasters,
    };
  }
  return assessmentOf(programme);
}

/** Whether a weekly time of `slotMinutes` takes the booking: exactly its length, or at least the assessment's. */
export function fitsSlot(terms: BookingTerms, slotMinutes: number): boolean {
  return terms.kind === 'assessment'
    ? slotMinutes >= terms.sessionDurationMinutes
    : slotMinutes === terms.sessionDurationMinutes;
}

/** A closed programme's refusal, `CONFLICT` with its cause (contracts' `programmeStartRefusal`). */
export function refusedStart(refusal: ProgrammeStartRefusal): DomainError {
  return new DomainError('CONFLICT', undefined, { details: [{ path: 'cause', code: refusal }] });
}

/** What the weekly times are read from: booking's programmes and catalog's slot. */
export interface ProgrammeTimesStore {
  activeProgrammeSlotsOf(
    tx: Transaction,
    studentUserIds: readonly string[],
    exceptEnrollmentId?: string,
  ): Promise<ActiveProgrammeSlot[]>;
  readSlot(tx: Transaction, slotId: string): Promise<SlotRow | null>;
}

export const programmeTimesStore: ProgrammeTimesStore = { activeProgrammeSlotsOf, readSlot };

/** Whether `[startsAt, endsAt)` overlaps `window`; a range holds its start and not its end. */
function overlaps(time: HeldTime, window: { readonly from: Date; readonly to: Date }): boolean {
  return time.startsAt < window.to && window.from < time.endsAt;
}

/**
 * The weekly time's occurrences overlapping `window`, week by week from the day before the window's
 * first local date (an occurrence begun the evening before still overlaps it), each resolved on its
 * own date in `timezone`.
 */
function weeksOf(slot: SlotRow, timezone: string, window: { from: Date; to: Date }): HeldTime[] {
  const weekly = {
    // `availability_slots.day_of_week` is 0 to 6 by its check (ERD §15 rule 37); the package asserts it.
    dayOfWeek: slot.dayOfWeek as DayOfWeek,
    startTimeLocal: slot.startTimeLocal,
    durationMinutes: slot.durationMinutes,
    timezone,
  };
  const times: HeldTime[] = [];
  let from = calendarDaysBefore(localDateIn(window.from, timezone), 1);
  for (;;) {
    const [occurrence] = resolveOccurrences(weekly, { fromLocalDate: from, count: 1 });
    if (occurrence === undefined) throw new Error('resolveOccurrences answered no occurrence');
    const time = { startsAt: new Date(occurrence.startsAt), endsAt: new Date(occurrence.endsAt) };
    if (time.startsAt.getTime() >= window.to.getTime()) return times;
    if (overlaps(time, window)) times.push(time);
    from = calendarWeeksAfter(occurrence.requestedLocalDate, 1);
  }
}

/**
 * The occurrences of the weekly times of `studentUserIds`' active programmes that overlap `window`,
 * `exceptEnrollmentId`'s left out, by start (this file's head). No lock.
 */
export async function programmeTimesOf(
  tx: Transaction,
  studentUserIds: readonly string[],
  window: { readonly from: Date; readonly to: Date },
  options: { readonly exceptEnrollmentId?: string; readonly store?: ProgrammeTimesStore } = {},
): Promise<HeldTime[]> {
  const store = options.store ?? programmeTimesStore;
  const programmes = await store.activeProgrammeSlotsOf(
    tx,
    [...new Set(studentUserIds)].sort(),
    options.exceptEnrollmentId,
  );
  if (programmes.length === 0) return [];
  const slots = await Promise.all(
    programmes.map(async ({ slotId, timezone }) => {
      const slot = await store.readSlot(tx, slotId);
      // `enrollments.slot_id` is a foreign key to the slot (ERD `enrollments`).
      if (slot === null) throw new Error('programmeTimesOf: a programme without its slot');
      return weeksOf(slot, timezone, window);
    }),
  );
  return slots.flat().sort((one, other) => one.startsAt.getTime() - other.startsAt.getTime());
}

/** `base`'s busy times with the student's own programmes' weekly times (U-1). */
export function withProgrammeTimes(
  base: SessionsBetween,
  read: (
    tx: Transaction,
    studentUserIds: readonly string[],
    window: { readonly from: Date; readonly to: Date },
  ) => Promise<readonly HeldTime[]> = programmeTimesOf,
): SessionsBetween {
  return async (tx, parties, window) => {
    const [own, programme] = await Promise.all([
      base(tx, parties, window),
      read(tx, [parties.studentUserId], window),
    ]);
    return [...own, ...programme];
  };
}

/** The confirmed assessment's programme, `awaiting_offer`, once (R-504). The caller holds the enrollment. */
export function startProgramme(tx: Transaction, enrollmentId: string): Promise<void> {
  return insertAwaitingOffer(tx, enrollmentId);
}
