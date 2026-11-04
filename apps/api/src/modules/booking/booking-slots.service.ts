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
// one of the student's or the teacher's own sessions, by the one check the hold applies too
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
} from '../catalog/index.js';
import { accountTimezone, visibleTeachers } from '../identity/index.js';
import { partiesSessionsBetween } from '../sessions/index.js';
import {
  type DiscoveryClock,
  FIRST_SESSION_LEAD_SETTING,
  type FirstSessionRule,
  firstSessionLeadHours,
  firstSessionOf,
  offerableOccurrences,
} from './nearest-slot.service.js';
import {
  freeOfPartiesSessions,
  type PackageSlot,
  packageSessionsOn,
  type SessionsBetween,
} from './session-overlap.service.js';
import {
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
  offeredSlotsOf(tx: Transaction, teacherIds: readonly string[]): Promise<OfferedSlot[]>;
  occupancyOf(
    tx: Transaction,
    slotIds: readonly string[],
    bufferWeeks: () => Promise<number>,
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
  sessionsBetween: partiesSessionsBetween,
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

/** One slot of the answer, with its previews. */
export function bookingSlotOf(
  { slot, first, sessions }: Offerable,
  pkg: Pick<BookablePackage, 'sessionCount' | 'sessionDurationMinutes'>,
): BookingSlot {
  return {
    slotId: slot.id,
    dayOfWeek: slot.dayOfWeek,
    startTimeLocal: slot.startTimeLocal.slice(0, -SECONDS.length),
    durationMinutes: pkg.sessionDurationMinutes,
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
 * slots of the package's length with their previews from `clock.now`.
 */
export async function bookingSlotsOf(
  tx: Transaction,
  store: BookingSlotsStore,
  student: BookingStudent,
  input: BookingSlotsInput,
  clock: DiscoveryClock,
): Promise<BookingSlotsOutput> {
  const pkg = await store.packageOf(tx, input.packageId);
  if (pkg === null || !(await store.bookable(tx, student.gender, pkg.teacherUserId))) {
    throw new DomainError('NOT_FOUND');
  }
  const slots = (await store.offeredSlotsOf(tx, [pkg.teacherUserId])).filter(
    ({ durationMinutes }) => durationMinutes === pkg.sessionDurationMinutes,
  );
  const occupancy = await store.occupancyOf(
    tx,
    slots.map(({ id }) => id),
    clock.bufferWeeks,
  );
  const free = offerableOccurrences(slots, occupancy, clock);
  const runs = free.map((one) => ({
    ...one,
    sessions: packageSessionsOn(one.slot, one.first, pkg.sessionCount),
  }));
  const parties = { studentUserId: student.userId, teacherUserId: pkg.teacherUserId };
  const offered = (await freeOfPartiesSessions(tx, store.sessionsBetween, parties, runs)).toSorted(
    bySoonest,
  );
  const teacherTimezone =
    sharedZoneOf(offered) ?? (await store.teacherTimezone(tx, pkg.teacherUserId));
  if (teacherTimezone === null) throw new Error('booking.slots: the bookable teacher has no zone');
  return { teacherTimezone, slots: offered.map((one) => bookingSlotOf(one, pkg)) };
}

/** `booking.*`'s services on the user surface (T032). */
export interface BookingServices {
  slots(student: BookingStudent, input: BookingSlotsInput): Promise<BookingSlotsOutput>;
}

/**
 * The booking services over the process's client: the lead read before the transaction, the reads
 * in one, the buffer only when a confirmed enrollment needs its release (as `createNearestSlots`).
 */
export function createBookingServices({
  database,
  settings,
  now = () => new Date(),
  store = bookingSlotsStore,
}: {
  readonly database: Database;
  readonly settings: SettingsReader;
  readonly now?: () => Date;
  readonly store?: BookingSlotsStore;
}): BookingServices {
  const transactions = transactionsOver(database);
  return {
    slots: async (student, input) => {
      const leadHours = await settings.read(FIRST_SESSION_LEAD_SETTING, firstSessionLeadHours);
      const clock: DiscoveryClock = {
        now: now(),
        leadHours,
        bufferWeeks: () => settings.read(SLOT_RELEASE_BUFFER_SETTING, slotReleaseBufferWeeks),
      };
      return transactions.run((tx) => bookingSlotsOf(tx, store, student, input, clock));
    },
  };
}
