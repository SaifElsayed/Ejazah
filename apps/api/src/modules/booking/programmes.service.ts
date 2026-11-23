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
//
// THE OFFER (006:T007; FR-705, FR-706a; R-505, R-506, R-507; contracts/app-surface.md
// `programme.offer`). The teacher's offer after the delivered assessment: the student's level,
// readiness and the programme's expected length (texts), the session length and the count N.
// - The locks, kernel.md's one order (the owner's settled reading of B-P2's conflict check). The
//   enrollment is read once with no lock for its teacher; any other caller answers NOT_FOUND, as an
//   unknown id does. Then the teacher's `users` row, the lock every price writer takes («the
//   package's lock», kernel.md's 006:T002 row), so a price edit waits for the offer or the offer
//   reads the edited price; then the programme's row; then the enrollment's. The standing, the
//   state, session 1, the weekly time and the price are read under them.
// - One transaction, the keyed effect's: the offer, `pay_by_at` (the offer +
//   `programme_pay_rest_hours`, data-model.md «set at the offer») and ⌈N ÷ 4⌉ months on the
//   programme, moved to `offered`; the enrollment's snapshot (N + 1, the length, the total); and
//   (the owner's FU-A1 (a), 2026-11-23) one `programme_offered` enrollment event at the offer's
//   instant. Frozen after: `writeOffer` moves only `awaiting_offer`, and no other path writes them.
// - The amounts (K-5): the total N × the package's price for the length, and the months, are
//   `packages/money`'s through payments' entry, which `main.ts` hands in (booking imports nothing
//   of payments, R-208). Booking computes no amount.
// - The refusals (FR-733): `CONFLICT` with the cause as `details.cause`, nothing written, one line of
//   ids and a reason. `teacher_not_active` (the account not active, or not approved, under its
//   lock); `not_awaiting_offer` (the programme past `awaiting_offer`, or its enrollment no longer
//   `confirmed`); `assessment_not_delivered`; `offer_due_passed` (past `offerWindowOf`'s deadline);
//   `count_out_of_bounds` (1 to 200, the contract's bound, held here too); `length_exceeds_slot`.
// - `enrollment` to both parties after the commit, added inside the keyed effect: a replay sends none.
import type {
  ProgrammeOfferInput,
  ProgrammeOfferOutput,
  ProgrammeOfferRefusal,
} from '@ijazah/contracts';
import { MAX_PROGRAMME_SESSION_COUNT } from '@ijazah/contracts';
import type { Piasters, ProgrammeOfferAmounts } from '@ijazah/money';
import {
  addHours,
  calendarWeeksAfter,
  type DayOfWeek,
  localDateIn,
  resolveOccurrences,
} from '@ijazah/time';
import { calendarDaysBefore } from '@ijazah/time/calendar';

import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { lockRows } from '../../platform/db/row-lock.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import type { LivePublisher } from '../../platform/live/live-publisher.js';
import { positiveWhole } from '../../platform/settings/registry.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import {
  type BookablePackage,
  type PackageRow,
  priceForLength,
  type ProgrammeAvailability,
  readSlot,
  type SlotRow,
  teacherPackageOf,
} from '../catalog/index.js';
import { lockAccount, readStanding } from '../identity/index.js';
import {
  type EnrollmentSessionRow,
  enrollmentSessionsOf,
  type HeldTime,
} from '../sessions/index.js';
import { recordEnrollmentEvents } from './enrollment-events.repository.js';
import {
  type ActiveProgrammeSlot,
  activeProgrammeSlotsOf,
  type FrozenOffer,
  insertAwaitingOffer,
  type OfferEnrollment,
  offerEnrollmentOf,
  writeOffer,
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

// ---------------------------------------------------------------------------------------------
// 006:T007: the offer (this file's head, THE OFFER).

/** §3.14: the teacher's hours to send the offer after the delivered assessment (24 by default). */
export const PROGRAMME_OFFER_HOURS_SETTING = 'programme_offer_hours';
/** §3.14: the student's hours to pay the rest after the offer, `pay_by_at` (48 by default). */
export const PROGRAMME_PAY_REST_HOURS_SETTING = 'programme_pay_rest_hours';

/** R-505: the statuses that settle session 1 as delivered (consumed: the fee kept either way). */
const DELIVERED: ReadonlySet<EnrollmentSessionRow['status']> = new Set(['done', 'student_no_show']);

/** Where the offer's window stands: not opened while the assessment is undelivered (R-505). */
export type OfferWindow =
  { readonly delivered: false } | { readonly delivered: true; readonly offerDueAt: Date };

/**
 * 006:T007, T008's seam (B-P2, Q-3 (a) amended): the offer's deadline, derived from session 1's
 * current outcome on every read, never stored by the offer. Before the offer the enrollment holds
 * session 1 and its make-ups alone (each make-up takes max + 1, R-507), so the delivered assessment
 * is the latest to end among those settled `done` or `student_no_show`; a teacher's no-show, a
 * both-no-show, an agreement, a postponement or an open dispute has none until its make-up is
 * delivered. The deadline is its scheduled end + `programme_offer_hours`. T008 replaces this body
 * with sessions' outcome chain, its writing of `offer_due_at` and an administrator's extension.
 */
export function offerWindowOf(
  sessions: readonly EnrollmentSessionRow[],
  offerHours: number,
): OfferWindow {
  const delivered = sessions.filter(({ status }) => DELIVERED.has(status));
  if (delivered.length === 0) return { delivered: false };
  const end = Math.max(...delivered.map(({ endsAt }) => endsAt.getTime()));
  return { delivered: true, offerDueAt: new Date(addHours(new Date(end), offerHours)) };
}

/** What the offer reads and writes, over the owners' entries (catalog, identity, sessions). */
export interface ProgrammeOfferStore {
  offerEnrollmentOf(tx: Transaction, enrollmentId: string): Promise<OfferEnrollment | null>;
  lockAccount(tx: Transaction, userId: string): Promise<void>;
  readStanding(tx: Transaction, userId: string): ReturnType<typeof readStanding>;
  lockProgramme(tx: Transaction, enrollmentId: string): Promise<void>;
  lockEnrollment(tx: Transaction, enrollmentId: string): Promise<void>;
  sessionsOf(tx: Transaction, enrollmentId: string): Promise<readonly EnrollmentSessionRow[]>;
  readSlot(tx: Transaction, slotId: string): Promise<SlotRow | null>;
  packageOf(tx: Transaction, teacherUserId: string, packageId: string): Promise<PackageRow | null>;
  writeOffer(tx: Transaction, enrollmentId: string, offer: FrozenOffer): Promise<boolean>;
  /** FU-A1 (a): the offer's `programme_offered` row, on the offer's transaction. */
  recordOffered(tx: Transaction, enrollmentId: string, occurredAt: Date): Promise<void>;
}

export const programmeOfferStore: ProgrammeOfferStore = {
  offerEnrollmentOf,
  lockAccount,
  readStanding,
  lockProgramme: (tx, enrollmentId) => lockRows(tx, 'programmes', [enrollmentId]),
  lockEnrollment: (tx, enrollmentId) => lockRows(tx, 'enrollments', [enrollmentId]),
  sessionsOf: enrollmentSessionsOf,
  readSlot,
  packageOf: teacherPackageOf,
  writeOffer,
  recordOffered: (tx, enrollmentId, occurredAt) =>
    recordEnrollmentEvents(tx, [{ kind: 'programme_offered', enrollmentId, occurredAt }]),
};

/** The lines the offer writes: ids and a reason. */
export interface ProgrammeLog {
  info(fields: Readonly<Record<string, unknown>>, message: string): void;
}

/** What the programme's services are built over; `main.ts` binds them. */
export interface ProgrammeServiceDependencies {
  readonly idempotency: Pick<IdempotencyService<Transaction>, 'run'>;
  readonly settings: SettingsReader;
  /** Payments' `programmeOfferAmountsOf` (K-5), handed in: booking imports nothing of payments. */
  readonly amounts: (
    sessionPrice_piasters: Piasters,
    sessionCount: number,
  ) => ProgrammeOfferAmounts;
  readonly log: ProgrammeLog;
  /** The database's clock on the transaction (`clock_timestamp()`), the offer's instant. */
  readonly clock?: (tx: Transaction) => Promise<Date>;
  readonly store?: ProgrammeOfferStore;
}

/** The `programme` procedures' services (006:T007: `programme.offer`). */
export interface ProgrammeServices {
  offer(
    teacherUserId: string,
    input: ProgrammeOfferInput,
    live: Pick<LivePublisher, 'afterCommit'>,
  ): Promise<ProgrammeOfferOutput>;
}

/** The programme's services over `dependencies` (this file's head, THE OFFER). */
export function createProgrammeServices(
  dependencies: ProgrammeServiceDependencies,
): ProgrammeServices {
  const offers = new ProgrammeOffers(dependencies);
  return { offer: (teacherUserId, input, live) => offers.offer(teacherUserId, input, live) };
}

/** The ids an offer's lines carry: never a name or the offer's words. */
interface OfferIds {
  readonly teacherUserId: string;
  readonly enrollmentId: string;
}

/** The offer's two windows, in hours, read before its transaction. */
interface OfferHours {
  readonly offer: number;
  readonly payRest: number;
}

class ProgrammeOffers {
  readonly #dependencies: ProgrammeServiceDependencies;
  readonly #store: ProgrammeOfferStore;
  readonly #clock: (tx: Transaction) => Promise<Date>;

  constructor(dependencies: ProgrammeServiceDependencies) {
    this.#dependencies = dependencies;
    this.#store = dependencies.store ?? programmeOfferStore;
    this.#clock = dependencies.clock ?? clockTimestamp;
  }

  /** `programme.offer` (this file's head, THE OFFER). */
  async offer(
    teacherUserId: string,
    { idempotencyKey, ...input }: ProgrammeOfferInput,
    live: Pick<LivePublisher, 'afterCommit'>,
  ): Promise<ProgrammeOfferOutput> {
    const { idempotency, settings } = this.#dependencies;
    const [offerHours, payRestHours] = await Promise.all([
      settings.read(PROGRAMME_OFFER_HOURS_SETTING, positiveWhole),
      settings.read(PROGRAMME_PAY_REST_HOURS_SETTING, positiveWhole),
    ]);
    const hours: OfferHours = { offer: offerHours, payRest: payRestHours };
    return idempotency.run(
      { scope: 'programme.offer', key: idempotencyKey, actorId: teacherUserId, input },
      async (tx) => {
        const { answer, studentUserId } = await this.#offerLocked(tx, teacherUserId, input, hours);
        live.afterCommit([teacherUserId, studentUserId], {
          type: 'enrollment',
          enrollmentId: input.enrollmentId,
        });
        return answer;
      },
    );
  }

  /** The offer on the keyed effect's transaction, in kernel.md's order (this file's head). */
  async #offerLocked(
    tx: Transaction,
    teacherUserId: string,
    input: Omit<ProgrammeOfferInput, 'idempotencyKey'>,
    hours: OfferHours,
  ): Promise<{ readonly answer: ProgrammeOfferOutput; readonly studentUserId: string }> {
    const store = this.#store;
    const ids: OfferIds = { teacherUserId, enrollmentId: input.enrollmentId };
    const seen = await store.offerEnrollmentOf(tx, input.enrollmentId);
    if (seen === null || seen.teacherUserId !== teacherUserId) throw new DomainError('NOT_FOUND');
    await store.lockAccount(tx, teacherUserId);
    if (!isActiveTeacher(await store.readStanding(tx, teacherUserId))) {
      throw this.#refused(ids, 'teacher_not_active');
    }
    await store.lockProgramme(tx, seen.id);
    await store.lockEnrollment(tx, seen.id);
    const enrollment = await store.offerEnrollmentOf(tx, seen.id);
    if (enrollment === null || enrollment.teacherUserId !== teacherUserId) {
      throw new DomainError('NOT_FOUND');
    }
    if (enrollment.state !== 'awaiting_offer' || enrollment.status !== 'confirmed') {
      throw this.#refused(ids, 'not_awaiting_offer');
    }
    const window = offerWindowOf(await store.sessionsOf(tx, enrollment.id), hours.offer);
    if (!window.delivered) throw this.#refused(ids, 'assessment_not_delivered');
    const now = await this.#clock(tx);
    if (now.getTime() > window.offerDueAt.getTime()) throw this.#refused(ids, 'offer_due_passed');
    if (input.sessionCount < 1 || input.sessionCount > MAX_PROGRAMME_SESSION_COUNT) {
      throw this.#refused(ids, 'count_out_of_bounds');
    }
    const slot = await store.readSlot(tx, enrollment.slotId);
    // `enrollments.slot_id` is a foreign key to the slot (ERD `enrollments`).
    if (slot === null) throw new Error('programme.offer: an enrollment without its slot');
    if (input.durationMinutes > slot.durationMinutes) {
      throw this.#refused(ids, 'length_exceeds_slot');
    }
    const amounts = this.#dependencies.amounts(
      await this.#priceFor(tx, enrollment, input.durationMinutes),
      input.sessionCount,
    );
    const moved = await store.writeOffer(tx, enrollment.id, {
      level: input.level,
      readiness: input.readiness,
      expectedLength: input.expectedLength,
      offeredAt: now,
      payByAt: new Date(addHours(now, hours.payRest)),
      monthCount: amounts.monthCount,
      snapshot: {
        // The offer's sessions and the assessment, session 1 (R-501, R-506).
        sessionCount: input.sessionCount + 1,
        durationMinutes: input.durationMinutes,
        price_piasters: amounts.total_piasters,
      },
    });
    if (!moved) throw this.#refused(ids, 'not_awaiting_offer');
    await store.recordOffered(tx, enrollment.id, now);
    this.#dependencies.log.info({ ...ids, reason: 'offered' }, 'A programme offer was sent');
    return {
      answer: {
        total_piasters: amounts.total_piasters,
        sessionPrice_piasters: amounts.sessionPrice_piasters,
        monthCount: amounts.monthCount,
      },
      studentUserId: enrollment.studentUserId,
    };
  }

  /** The programme package's price for the length, read under the teacher's lock. */
  async #priceFor(
    tx: Transaction,
    enrollment: OfferEnrollment,
    minutes: ProgrammeOfferInput['durationMinutes'],
  ): Promise<Piasters> {
    const pkg = await this.#store.packageOf(tx, enrollment.teacherUserId, enrollment.packageId);
    // A programme's enrollment was booked on a programme package (R-504), never edited back (R-503).
    if (pkg === null || !pkg.isProgramme) {
      throw new Error('programme.offer: a programme whose package has no programme prices');
    }
    return priceForLength(pkg.prices, minutes);
  }

  /** A refusal, its one line logged (FR-733). */
  #refused(ids: OfferIds, refusal: ProgrammeOfferRefusal): DomainError {
    this.#dependencies.log.info({ ...ids, reason: refusal }, 'A programme offer was refused');
    return markRefusalLogged(
      new DomainError('CONFLICT', undefined, { details: [{ path: 'cause', code: refusal }] }),
    );
  }
}

/** An approved teacher whose account is active, read under the account's lock. */
function isActiveTeacher(standing: Awaited<ReturnType<typeof readStanding>>): boolean {
  return (
    standing?.accountStatus === 'active' && standing.teacher?.verificationStatus === 'approved'
  );
}
