// T032 (R-205, R-209, FR-350, FR-386): `booking.slots`, the booking sheet's slots of one package.
//
// THE PREDICATE FIRST. The student names a package, never its teacher, so the package is read first
// (catalog's entry, an active one only) for its teacher alone, and identity's predicate is asked of
// that teacher with `purpose: 'book'` and the session's gender (R-201, T143, R-GENDER-4) before
// anything else is read. An unknown or inactive package and a teacher the student may not book
// answer the same `NOT_FOUND`, with no field (R-GENDER-2).
//
// THE SLOTS. Catalog's offered slots of the teacher (R-API-6) of exactly the package's length; of
// those, the ones free on their first session's date by T026's occupancy (`offerableOccurrences`:
// no active hold, no enrollment awaiting payment, a confirmed one's slot again from the week after
// its final session plus the buffer, FR-394); of those, the ones none of whose sessions overlaps
// one of the student's or the teacher's own sessions or a time their open remedies reserve (T027 of
// specs/004-sessions, H3), by the one check the hold applies too
// (`session-overlap.service.ts`, T033: every one of the package's sessions, not its first alone;
// FR-351, FR-BOOK-5, R-205). The first session is `firstOccurrenceAfter` with `first_session_lead_hours`
// from now in the slot's own zone, the call generation makes from the confirmation (T034); the last
// is the package's session count of consecutive weeks from it by `resolveOccurrences`, the call
// generation makes for the rest (R-209, FR-368, FR-386). No date is computed here (R-TIME-1); two
// instants are only compared.
//
// THE ZONES (R-TIME-6, ADR 0009 D5). A slot's day, start and both previews' local dates are in the
// zone the slot was saved in (FR-313), the one the enrollment will snapshot and generation will use;
// `startsAt` lets the phone show the student's own. `teacherTimezone` labels the teacher's line:
// the zone the answered slots share, and the teacher's current zone when none is answered or they
// do not share one (a teacher who moved and kept older slots, T016's note) — the one case the
// contract's single zone cannot label every slot of.
//
// Read-only: no lock, nothing written (T005's rule 1). The answer is a preview; the hold (T033)
// decides under its locks.
//
// 006:T005 (FR-701, R-504; U-1; Q-5 (a)). A programme package is offered as its assessment
// (`programmes.service.ts`): every active weekly time of the teacher at least the assessment's length
// (`assessment_duration_minutes`, 30 by default), each answered with its own length and its one
// session as both previews, the session checked at the assessment's length; none while the switch
// is off or the fee is unset, with no slot read. Every slot's sessions are also checked against the
// student's own active programmes' weekly times (`withProgrammeTimes`, the owner's hidden-times rule).
//
// THE CHECKOUT'S PREVIEWS (T085, FR-386). `checkout.current` previews the held slot through
// `sessionPreviewsOn`: the same first session, run and mapping as each slot of the sheet, from the
// read's instant, so the checkout shows the dates the sheet would show at that moment.
import type {
  BookingSlot,
  BookingSlotsInput,
  BookingSlotsOutput,
  SessionPreview,
} from '@ijazah/contracts';
import type { Occurrence } from '@ijazah/time';

import type { Database, Transaction } from '../../platform/db/prisma.repository.js';
import { transactionsOver } from '../../platform/db/transaction.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import type { RequesterGender } from '../../platform/guards/requester-gender.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import {
  type BookablePackage,
  bookablePackageOf,
  type OfferedSlot,
  offeredSlotsOf,
  programmeAvailabilityOf,
} from '../catalog/index.js';
import { accountTimezone, visibleTeachers } from '../identity/index.js';
import { windowDaysOf } from '../sessions/index.js';
import {
  createEnrollmentListServices,
  type EnrollmentIjazahRequests,
  type EnrollmentListServices,
} from './enrollment-lists.service.js';
import {
  type DiscoveryClock,
  FIRST_SESSION_LEAD_SETTING,
  type FirstSessionRule,
  firstSessionLeadHours,
  firstSessionOf,
  offerableOccurrences,
} from './nearest-slot.service.js';
import {
  bookingTermsOf,
  closedProgramme,
  fitsSlot,
  type ProgrammeReader,
  withProgrammeTimes,
} from './programmes.service.js';
import {
  freeOfPartiesSessions,
  type PackageSlot,
  packageSessionsOn,
  partiesBusyBetween,
  type SessionsBetween,
} from './session-overlap.service.js';
import {
  type OccupancyReads,
  occupancyOf,
  SLOT_RELEASE_BUFFER_SETTING,
  type SlotOccupancy,
  slotReleaseBufferWeeks,
} from './slot-occupancy.service.js';

/** The student asking, from the session: never from input (R-GENDER-4). */
export interface BookingStudent {
  readonly userId: string;
  readonly gender: RequesterGender;
}

/** What the sheet reads, each through its owner's entry, on the caller's transaction. */
export interface BookingSlotsStore {
  packageOf(tx: Transaction, packageId: string): Promise<BookablePackage | null>;
  /** Whether the predicate admits the teacher for booking to a requester of this gender. */
  bookable(tx: Transaction, requester: RequesterGender, teacherUserId: string): Promise<boolean>;
  /** 006:T004: `programmeMinMinutes`, the assessment's length, offers a programme package's slots. */
  offeredSlotsOf(
    tx: Transaction,
    teacherIds: readonly string[],
    programmeMinMinutes?: number,
  ): Promise<OfferedSlot[]>;
  occupancyOf(
    tx: Transaction,
    slotIds: readonly string[],
    reads: OccupancyReads,
  ): Promise<ReadonlyMap<string, SlotOccupancy>>;
  sessionsBetween: SessionsBetween;
  teacherTimezone(tx: Transaction, teacherUserId: string): Promise<string | null>;
}

/** The store over the owners' entries (R-API-6). */
export const bookingSlotsStore: BookingSlotsStore = {
  packageOf: bookablePackageOf,
  bookable: async (tx, requester, teacherUserId) =>
    (await visibleTeachers(tx, requester, { purpose: 'book', teacherIds: [teacherUserId] }))
      .length === 1,
  offeredSlotsOf,
  occupancyOf,
  // T027: the parties' sessions and the times their open remedies reserve (H3); 006:T005 (U-1):
  // and the student's own active programmes' weekly times.
  sessionsBetween: withProgrammeTimes(partiesBusyBetween),
  teacherTimezone: accountTimezone,
};

/** A free slot with its first session by FR-368's rule, and every session of the package on it. */
interface Offerable {
  readonly slot: OfferedSlot;
  readonly first: Occurrence;
  readonly sessions: readonly Occurrence[];
}

/** The seconds a `time` column carries and the contract's `HH:MM` does not (as T019's slots). */
const SECONDS = ':00';

/** A run's first and last session as previewed: the requested local dates generation stores (ADR 0009 D1). */
export interface SessionPreviews {
  readonly firstSession: SessionPreview;
  readonly lastSession: SessionPreview;
}

function previewsOf(first: Occurrence, sessions: readonly Occurrence[]): SessionPreviews {
  const last = sessions.at(-1) ?? first;
  return {
    firstSession: { localDate: first.requestedLocalDate, startsAt: first.startsAt },
    lastSession: { localDate: last.requestedLocalDate, startsAt: last.startsAt },
  };
}

/** One slot of the answer, with its previews; `durationMinutes` the slot's length (006:T005). */
export function bookingSlotOf({ slot, first, sessions }: Offerable): BookingSlot {
  return {
    slotId: slot.id,
    dayOfWeek: slot.dayOfWeek,
    startTimeLocal: slot.startTimeLocal.slice(0, -SECONDS.length),
    // `availability_slots.duration_minutes` is 30, 45 or 60 by its check (ERD section 15 rule 37).
    durationMinutes: slot.durationMinutes as BookingSlot['durationMinutes'],
    ...previewsOf(first, sessions),
  };
}

/**
 * The first and last of `sessionCount` sessions on `slot` if confirmed by `rule` (FR-368, FR-386),
 * as the sheet previews each slot: `checkout.current`'s dates for the held slot (T085).
 */
export function sessionPreviewsOn(
  slot: PackageSlot,
  rule: FirstSessionRule,
  sessionCount: number,
): SessionPreviews {
  const first = firstSessionOf(slot, rule);
  return previewsOf(first, packageSessionsOn(slot, first, sessionCount));
}

/** The zone the slots share, or undefined when there are none or they do not share one. */
function sharedZoneOf(offerable: readonly Offerable[]): string | undefined {
  const zones = new Set(offerable.map(({ slot }) => slot.timezone));
  return zones.size === 1 ? [...zones][0] : undefined;
}

/** Soonest first session first, then the slot's id, so the order is stable. */
function bySoonest(a: Offerable, b: Offerable): number {
  if (a.first.startsAt !== b.first.startsAt) return a.first.startsAt < b.first.startsAt ? -1 : 1;
  return a.slot.id < b.slot.id ? -1 : 1;
}

/**
 * `booking.slots` on the caller's transaction: `NOT_FOUND` for an unknown or inactive package or a
 * teacher the student may not book, asked before anything else is read; otherwise the offerable
 * slots of the package's length with their previews from `clock.now`. 006:T005: `programme`, the
 * programme's availability, read for a programme package only (this file's head).
 */
export async function bookingSlotsOf(
  tx: Transaction,
  store: BookingSlotsStore,
  student: BookingStudent,
  input: BookingSlotsInput,
  clock: DiscoveryClock,
  programme: ProgrammeReader = closedProgramme,
): Promise<BookingSlotsOutput> {
  const pkg = await store.packageOf(tx, input.packageId);
  if (pkg === null || !(await store.bookable(tx, student.gender, pkg.teacherUserId))) {
    throw new DomainError('NOT_FOUND');
  }
  const terms = await bookingTermsOf(pkg, programme);
  if ('refusal' in terms) {
    const zone = await store.teacherTimezone(tx, pkg.teacherUserId);
    if (zone === null) throw new Error('booking.slots: the bookable teacher has no zone');
    return { teacherTimezone: zone, slots: [] };
  }
  const assessmentMinutes = terms.kind === 'assessment' ? terms.sessionDurationMinutes : undefined;
  const slots = (await store.offeredSlotsOf(tx, [pkg.teacherUserId], assessmentMinutes)).filter(
    ({ durationMinutes }) => fitsSlot(terms, durationMinutes),
  );
  const occupancy = await store.occupancyOf(
    tx,
    slots.map(({ id }) => id),
    clock,
  );
  const free = offerableOccurrences(slots, occupancy, clock);
  const runs = free.map((one) => ({
    ...one,
    sessions: packageSessionsOn(
      { ...one.slot, durationMinutes: terms.sessionDurationMinutes },
      one.first,
      terms.sessionCount,
    ),
  }));
  const parties = { studentUserId: student.userId, teacherUserId: pkg.teacherUserId };
  const offered = (await freeOfPartiesSessions(tx, store.sessionsBetween, parties, runs)).toSorted(
    bySoonest,
  );
  const teacherTimezone =
    sharedZoneOf(offered) ?? (await store.teacherTimezone(tx, pkg.teacherUserId));
  if (teacherTimezone === null) throw new Error('booking.slots: the bookable teacher has no zone');
  return { teacherTimezone, slots: offered.map((one) => bookingSlotOf(one)) };
}

/**
 * `booking.*`'s services on the user surface (T032): the booking sheet's slots, and the lists
 * (T049: `enrollments.*`, `teacher.students.*`, `teacher.today`; `enrollment-lists.service.ts`).
 */
export interface BookingServices extends EnrollmentListServices {
  slots(student: BookingStudent, input: BookingSlotsInput): Promise<BookingSlotsOutput>;
}

/**
 * The booking services over the process's client: the lead read before the transaction, the reads
 * in one, the buffer only when a confirmed enrollment needs its release (as `createNearestSlots`);
 * the lists' over the same client and clock (T049).
 */
export function createBookingServices({
  database,
  settings,
  ijazahRequests,
  now = () => new Date(),
  store = bookingSlotsStore,
}: {
  readonly database: Database;
  readonly settings: SettingsReader;
  /**
   * 005:T006 (the note under T006, Q4 (a)): the enrollment reads' ijazah request, certification's,
   * bound by `main.ts`.
   */
  readonly ijazahRequests: EnrollmentIjazahRequests;
  readonly now?: () => Date;
  readonly store?: BookingSlotsStore;
}): BookingServices {
  const transactions = transactionsOver(database);
  return {
    ...createEnrollmentListServices({ database, settings, ijazahRequests }),
    slots: async (student, input) => {
      const leadHours = await settings.read(FIRST_SESSION_LEAD_SETTING, firstSessionLeadHours);
      const clock: DiscoveryClock = {
        now: now(),
        leadHours,
        bufferWeeks: () => settings.read(SLOT_RELEASE_BUFFER_SETTING, slotReleaseBufferWeeks),
        // T070 of specs/004-sessions: a closing's hold reads its window.
        windowDays: windowDaysOf(settings),
      };
      return transactions.run((tx) =>
        bookingSlotsOf(tx, store, student, input, clock, () => programmeAvailabilityOf(settings)),
      );
    },
  };
}
