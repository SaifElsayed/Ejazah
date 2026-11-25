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
//
// THE FIRST PAYMENT (006:T009; FR-710, R-509; FR-BOOK-12). `checkedProgrammePay` is `programme.pay`'s
// check, run by payments' checkout before the gateway and again on the recording transaction. The
// programme is read with no lock for its student (anyone else NOT_FOUND); then, in kernel.md's one
// order, both accounts (the lock a new hold takes first, so the two never pass each other), the
// student's unexpired own hold, the programme, the enrollments (the programme's and the hold's) and,
// through payments' `orders`, their orders; the instant is the database's clock. Refused, with one
// line of ids and a reason: `not_offered` (not `offered`, or the enrollment no longer `confirmed`),
// `pay_by_passed`, `party_suspended` (a `teacher_suspended` or `student_suspended` case open), and
// `PREVIOUS_CHECKOUT` while the own hold's order is paid or payable, or an order of the programme
// itself is payable, or (PR #158 r1 Major 1) paid and not yet processed by the confirm step
// (`processing`). The owner's Q-C1 (a): the confirm step records the payment on the programme
// (`recordProgrammePaid`: `offered` to `active` with its plan, then the months paid).
import type {
  ProgrammeActionInput,
  ProgrammeActionOutput,
  ProgrammeAutoRenewOffRefusal,
  ProgrammeCancelRefusal,
  ProgrammeOfferInput,
  ProgrammeOfferOutput,
  ProgrammeOfferRefusal,
  ProgrammePayRefusal,
  ProgrammeRenewRefusal,
  ProgrammeGetInput,
  ProgrammeGetOutput,
  ProgrammeRequestInput,
  ProgrammeRequestOutput,
} from '@ijazah/contracts';
import type {
  ProgrammeOrderItem,
  ProgrammeRequestItem,
  ProgrammesGetOutput,
  ProgrammesQueueInput,
  ProgrammesQueueOutput,
} from '@ijazah/contracts/admin';
import { MAX_PROGRAMME_SESSION_COUNT, sessionLengthMinutes } from '@ijazah/contracts';
import { type Piasters, perSession, type ProgrammeOfferAmounts } from '@ijazah/money';
import {
  addDays,
  addHours,
  calendarWeeksAfter,
  type DayOfWeek,
  localDateIn,
  resolveOccurrences,
} from '@ijazah/time';
import { calendarDaysBefore } from '@ijazah/time/calendar';

import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { keyShareRows, type LockedTable, lockRows } from '../../platform/db/row-lock.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import { type LivePublisher, publisherOn } from '../../platform/live/live-publisher.js';
import {
  positiveWhole,
  programmeChargeRetryDays,
  programmePayReminderHours,
  wholeNonNegative,
} from '../../platform/settings/registry.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type { Transactions } from '../../platform/db/transaction.repository.js';
import {
  type BookablePackage,
  type PackageRow,
  priceForLength,
  type ProgrammeAvailability,
  readSlot,
  type SlotRow,
  teacherPackageOf,
} from '../catalog/index.js';
import { displayNamesOf, lockAccount, readStanding } from '../identity/index.js';
import { openCaseOf } from '../moderation/index.js';
import {
  type AssessmentOutcome,
  assessmentOutcome,
  type HeldTime,
  sessionsOfEnrollments,
} from '../sessions/index.js';
import { ownActiveHold } from './checkout-holds.repository.js';
import { type HeldOrders, previousCheckout } from './checkout-holds.service.js';
import { recordEnrollmentEvents } from './enrollment-events.repository.js';
import { activeHoldsByIds, type HeldRow } from './holds.repository.js';
import {
  type DeleteProgrammeCard,
  endProgramme,
  noProgrammeCardYet,
  type ProgrammeEndStore,
} from './programme-close.service.js';
import {
  insertRequest,
  lastExtendedAt,
  lastRequestAt,
  openRequestExists,
} from './programme-requests.repository.js';
import {
  type ProgrammeRequestDependencies,
  type ProgrammeRequestStore,
  requestProgramme,
  STOP_REQUEST_DAYS,
  stopRequestFromOf,
} from './programme-requests.service.js';
import {
  type ActiveProgrammeSlot,
  activeProgrammeSlotsOf,
  type FrozenOffer,
  insertAwaitingOffer,
  type OfferEnrollment,
  openItemsPage,
  type PausedProgramme,
  pausedPage,
  type ProgrammeRequestView,
  programmeRequestsOf,
  type ProgrammeView,
  programmeViewOf,
  type QueuedProgramme,
  queuedProgrammesAmong,
  offerEnrollmentOf,
  type PayEnrollment,
  payEnrollmentOf,
  type ProgrammeFacts,
  programmeFactsOf,
  type ProgrammeMonthRow,
  programmeMonthOf,
  type ProgrammePayment,
  type ProgrammeState,
  withdrawOpenItem,
  writeAttempt,
  writeFirstFailure,
  writeNextDue,
  writeOffer,
  writeOfferDue,
  writePaused,
  withdrawOpenStop,
  writeProgrammePaid,
} from './programmes.repository.js';
import {
  inquiryDue,
  type MonthAction,
  type MonthFacts,
  type MonthOrders,
  type MonthSession,
  type MonthStepKind,
  monthStepOf,
  nextDueOf,
  nextOccurrenceAt,
  noOfferStep,
  offerDueOf,
  payByPassed,
  payWindowStep,
} from './programmes.rules.js';
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

/**
 * 006:T016 (FR-722, FR-724; B-P3's conflict check; FU-A1 (a)): what the paid month's record reads
 * and writes, over booking's rows; stood in by a spec.
 */
export interface ProgrammePaidStore {
  writeProgrammePaid(
    tx: Transaction,
    enrollmentId: string,
    payment: ProgrammePayment,
  ): Promise<boolean>;
  withdrawOpenStop(tx: Transaction, enrollmentId: string): Promise<string | null>;
  /** FU-A1 (a): the resume's `programme_resumed` row, on the paid month's transaction. */
  recordResumed(tx: Transaction, enrollmentId: string, occurredAt: Date): Promise<void>;
  programmeFactsOf(tx: Transaction, enrollmentId: string): Promise<ProgrammeFacts | null>;
  /** The database's clock on the transaction (`clock_timestamp()`). */
  clock(tx: Transaction): Promise<Date>;
}

export const programmePaidStore: ProgrammePaidStore = {
  writeProgrammePaid,
  withdrawOpenStop,
  recordResumed: (tx, enrollmentId, occurredAt) =>
    recordEnrollmentEvents(tx, [{ kind: 'programme_resumed', enrollmentId, occurredAt }]),
  programmeFactsOf,
  clock: clockTimestamp,
};

/**
 * 006:T009 (the owner's Q-C1 (a)): the programme's payment, recorded by the confirm step under the
 * programme's lock (`programmes.repository.ts`' `writeProgrammePaid`). 006:T016 (FR-722, FR-724;
 * B-P3's conflict check; FU-A1 (a)): every paid month lands here, an automatic one after a pause
 * included. A `paused` programme is resumed (`active`, `paused_at` cleared) with one
 * `programme_resumed` enrollment event at the database's instant on the same transaction, one line
 * and `enrollment` to both parties after the commit (the transaction's bound publisher: none in the
 * worker, N-15); an open stop request is withdrawn with one line of ids and the reason. `log` is the
 * confirm step's.
 */
export async function recordProgrammePaid(
  tx: Transaction,
  enrollmentId: string,
  payment: ProgrammePayment,
  log?: ProgrammeLog,
  store: ProgrammePaidStore = programmePaidStore,
): Promise<void> {
  const resumed = await store.writeProgrammePaid(tx, enrollmentId, payment);
  const withdrawn = await store.withdrawOpenStop(tx, enrollmentId);
  if (withdrawn !== null) {
    log?.info(
      { enrollmentId, requestId: withdrawn, reason: 'renewed' },
      'A programme stop request was withdrawn by a paid month',
    );
  }
  if (!resumed) return;
  await store.recordResumed(tx, enrollmentId, await store.clock(tx));
  log?.info({ enrollmentId, reason: 'resumed' }, 'A paused programme was resumed by a paid month');
  const facts = await store.programmeFactsOf(tx, enrollmentId);
  if (facts !== null) {
    publisherOn(tx)?.afterCommit([facts.studentUserId, facts.teacherUserId], {
      type: 'enrollment',
      enrollmentId,
    });
  }
}

export type { ProgrammePayment };

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

/** Where the offer's window stands: not opened while the assessment is undelivered (R-505). */
export type OfferWindow =
  { readonly delivered: false } | { readonly delivered: true; readonly offerDueAt: Date };

/**
 * 006:T008 (B-P2, Q-3 (a) amended; T007's seam replaced): the offer's window, derived from session
 * 1's current outcome chain (sessions' `assessmentOutcome`) and an administrator's latest extension
 * of a `no_offer` item on every read, never set once (`programmes.rules.ts`' `offerDueOf`). Open
 * only once session 1, or its make-up, is delivered (`done` or `student_no_show`); ended with no
 * make-up pending (N-2) or waiting for one, the assessment is not delivered.
 */
export function offerWindowOf(
  outcome: AssessmentOutcome,
  extendedAt: Date | null,
  offerHours: number,
): OfferWindow {
  const offerDueAt = offerDueOf({ outcome, extendedAt, offerHours });
  if (outcome.kind !== 'delivered' || offerDueAt === null) return { delivered: false };
  return { delivered: true, offerDueAt };
}

/** What the offer reads and writes, over the owners' entries (catalog, identity, sessions). */
export interface ProgrammeOfferStore {
  offerEnrollmentOf(tx: Transaction, enrollmentId: string): Promise<OfferEnrollment | null>;
  lockAccount(tx: Transaction, userId: string): Promise<void>;
  readStanding(tx: Transaction, userId: string): ReturnType<typeof readStanding>;
  lockProgramme(tx: Transaction, enrollmentId: string): Promise<void>;
  lockEnrollment(tx: Transaction, enrollmentId: string): Promise<void>;
  /** 006:T008 (Q-3 (a) amended): session 1's outcome chain, sessions' entry. */
  assessmentOutcome(tx: Transaction, enrollmentId: string): Promise<AssessmentOutcome>;
  /** 006:T008: the latest `extended` `no_offer` item's decision instant. */
  lastExtendedAt(tx: Transaction, enrollmentId: string): Promise<Date | null>;
  /** 006:T008 (Q-3 (a) amended): the derived deadline written while `awaiting_offer`. */
  writeOfferDue(tx: Transaction, enrollmentId: string, offerDueAt: Date | null): Promise<void>;
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
  assessmentOutcome,
  lastExtendedAt: (tx, enrollmentId) => lastExtendedAt(tx, enrollmentId, 'no_offer'),
  writeOfferDue,
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
  /**
   * 006:T008 (Q-2 (a)): payments' `deleteProgrammeCard` for the close hook (T013: the card
   * deleted), bound by `main.ts` through `createBookingServices`; none where a caller binds none.
   */
  readonly deleteProgrammeCard?: DeleteProgrammeCard;
  /** 006:T008: the cancellation's reads and the programme's own end, stood in by a spec. */
  readonly cancelStore?: ProgrammeCancelStore;
  readonly end?: ProgrammeEndStore;
  /** 006:T008: the refusal request's reads and writes, stood in by a spec. */
  readonly requests?: ProgrammeRequestStore;
  /**
   * 006:T015 (PR #158 r2 Follow-up 1, Q-8 (a)): payments' `checkoutOrdersAmong`, which the
   * cancellation reads under its locks to refuse `payment_processing`; a caller that binds none
   * reads no order.
   */
  readonly orders?: CheckoutOrdersAmong;
  /**
   * 006:T018 (app-surface.md `programme.get`): the read's transactions and payments' reads (the
   * payee, the month's orders, the student's card), bound by `createBookingServices` from what
   * `main.ts` hands in; `programme.get` fails loudly where none is bound.
   */
  readonly reads?: {
    readonly transactions: Transactions;
    readonly payments: ProgrammeReadPayments;
  };
}

/**
 * The `programme` procedures' services (006:T007: `programme.offer`; 006:T008: `programme.cancel`
 * and `programme.request`).
 */
export interface ProgrammeServices {
  offer(
    teacherUserId: string,
    input: ProgrammeOfferInput,
    live: Pick<LivePublisher, 'afterCommit'>,
  ): Promise<ProgrammeOfferOutput>;
  cancel(
    studentUserId: string,
    input: ProgrammeActionInput,
    live: Pick<LivePublisher, 'afterCommit'>,
  ): Promise<ProgrammeActionOutput>;
  request(
    teacherUserId: string,
    input: ProgrammeRequestInput,
    live: Pick<LivePublisher, 'afterCommit'>,
  ): Promise<ProgrammeRequestOutput>;
  /** 006:T018 (FR-726): `programme.get`, either party's. */
  get(userId: string, input: ProgrammeGetInput): Promise<ProgrammeGetOutput>;
  /** 006:T016 (FR-713a, DEC-95): `programme.autoRenewOff`, the student's. */
  autoRenewOff(
    studentUserId: string,
    input: ProgrammeActionInput,
    live: Pick<LivePublisher, 'afterCommit'>,
  ): Promise<ProgrammeActionOutput>;
}

/** The programme's services over `dependencies` (this file's head, THE OFFER; 006:T008 below). */
export function createProgrammeServices(
  dependencies: ProgrammeServiceDependencies,
): ProgrammeServices {
  const offers = new ProgrammeOffers(dependencies);
  const requestDependencies: ProgrammeRequestDependencies = {
    log: dependencies.log,
    // 006:T017: the stop's `programme_stop_request_days`, on the database's clock.
    settings: dependencies.settings,
    ...(dependencies.clock === undefined ? {} : { clock: dependencies.clock }),
    ...(dependencies.requests === undefined ? {} : { store: dependencies.requests }),
  };
  return {
    offer: (teacherUserId, input, live) => offers.offer(teacherUserId, input, live),
    cancel: (studentUserId, input, live) =>
      cancelProgramme(studentUserId, input, live, dependencies),
    request: (teacherUserId, { idempotencyKey, ...input }, live) =>
      dependencies.idempotency.run(
        { scope: 'programme.request', key: idempotencyKey, actorId: teacherUserId, input },
        (tx) => requestProgramme(tx, teacherUserId, input, live, requestDependencies),
      ),
    autoRenewOff: (studentUserId, input, live) =>
      turnAutoRenewOff(studentUserId, input, live, dependencies),
    get: async (userId, { enrollmentId }) => {
      const { reads } = dependencies;
      if (reads === undefined) throw new Error('programme.get: its reads are not bound');
      const { settings } = dependencies;
      // 006:T019, T020 (B-P4): with the stop's days and the reminder's hours, read together.
      const [earlyDays, stopDays, reminderHours] = await Promise.all([
        settings.read(PROGRAMME_RENEW_EARLY_DAYS_SETTING, wholeNonNegative),
        settings.read(STOP_REQUEST_DAYS, positiveWhole),
        settings.read(PROGRAMME_PAY_REMINDER_HOURS_SETTING, programmePayReminderHours),
      ]);
      return reads.transactions.run((tx) =>
        readProgramme(tx, userId, enrollmentId, {
          payments: reads.payments,
          earlyDays,
          stopDays,
          reminderHours,
        }),
      );
    },
  };
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
    const window = offerWindowOf(
      await store.assessmentOutcome(tx, enrollment.id),
      await store.lastExtendedAt(tx, enrollment.id),
      hours.offer,
    );
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
    // 006:T008 (Q-3 (a) amended): the column holds the last derived deadline.
    await store.writeOfferDue(tx, enrollment.id, window.offerDueAt);
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

// ---------------------------------------------------------------------------------------------
// 006:T008 (FR-706, FR-706a, FR-706b, FR-709; R-505, R-508, R-510, R-513; Q-2 (a), Q-3 (a) amended;
// contracts/app-surface.md `programme.cancel`): the student's cancellation and the windows' step.
//
// THE CANCELLATION (`programme.cancel`, `offer_declined`). The student's, before any payment of the
// rest: the programme `awaiting_offer` or `offered`. Keyed (`programme.cancel`). The programme read
// once with no lock for its student, anyone else NOT_FOUND as an unknown id; then the programme's row
// and the enrollment's (kernel.md's order), read again under them; then booking's own end
// (`endProgramme`): the enrollment `cancelled` `offer_declined`, what is left of it cancelled, its
// event, and the close hook, which withdraws an open item (a `pay_blocked` one among them, FR-706b)
// and calls payments' card entry. The fee is kept (DEC-94). Refused `CONFLICT` with the cause, nothing
// written, one line: `rest_paid` once the rest is paid (`active`, `paused`), `closed` once closed or
// the enrollment no longer `confirmed`, and (PR #158 r1 Follow-up 1 (a), the owner, «صلح ومتابعة أ»;
// FR-BOOK-15, «after the assessment») `assessment_not_settled` until session 1's outcome chain
// (sessions' `assessmentOutcome`, read as the windows' step reads it) is consumed, `done` or
// `student_no_show`: still to come, waiting for a make-up, or ended with no assessment held; and
// (006:T015, PR #158 r2 Follow-up 1, Q-8 (a)) `payment_processing` while a programme order of the
// enrollment is payable, or paid and not yet processed by the confirm step (payments'
// `checkoutOrdersAmong`, handed in as `orders`, its rows locked after the enrollment's).
// `enrollment` to both parties after the commit.
//
// THE WINDOWS' STEP (R-508's step 1, for T015's `advance-programmes`). One programme in a transaction
// of its own, under its row lock: the teacher's `users` row key-shared first (an item's insert
// key-shares it through its foreign key, and `programme.offer` and `programme.request` take that row
// `FOR UPDATE` before the programme, kernel.md, 006:T008's row), then the programme's row, then the
// enrollment's; read again under them, a programme whose enrollment is not `confirmed` is left alone,
// and (006:T015, R-508, N-1) so is one with an open `teacher_suspended` or `student_suspended` case.
// - `awaiting_offer`: the deadline derived from session 1's outcome chain and the latest extension
//   (`noOfferStep`), written when it changed (Q-3 (a) amended); the `no_offer` item once per deadline.
// - `offered`: past `pay_by_at` with no `pay_blocked` item open, payments' «unverified in live mode»
//   read at that instant (FR-706b); the `pay_blocked` item once per deadline, or the lapse
//   (`offer_lapsed`, through `endProgramme`) (`payWindowStep`). 006:T015 («pending», A-1; Q-8 (a)):
//   neither while a programme order is payable, or paid and not yet processed by the confirm step
//   (payments' `checkoutOrdersAmong`, `orders`, its rows locked after the enrollment's).
// Each item and each lapse writes one info line of ids and the reason; `enrollment` to both parties
// after the commit on the transaction's bound publisher (none in a worker until T015 binds one).
// Double run (R-API-14): the second run reads the item open, or the programme closed, and does
// nothing.

/** What the cancellation reads, over booking's rows and sessions' entry. */
export interface ProgrammeCancelStore {
  programmeFactsOf(tx: Transaction, enrollmentId: string): Promise<ProgrammeFacts | null>;
  lockProgramme(tx: Transaction, enrollmentId: string): Promise<void>;
  lockEnrollment(tx: Transaction, enrollmentId: string): Promise<void>;
  assessmentOutcome(tx: Transaction, enrollmentId: string): Promise<AssessmentOutcome>;
}

export const programmeCancelStore: ProgrammeCancelStore = {
  programmeFactsOf,
  lockProgramme: (tx, enrollmentId) => lockRows(tx, 'programmes', [enrollmentId]),
  lockEnrollment: (tx, enrollmentId) => lockRows(tx, 'enrollments', [enrollmentId]),
  assessmentOutcome,
};

/** The states the student may cancel in: before any payment of the rest. */
const CANCELLABLE: ReadonlySet<ProgrammeState> = new Set(['awaiting_offer', 'offered']);

/**
 * 006:T015 («pending», A-1; PR #158 r2 Follow-up 1, Q-8 (a)): whether a programme order of the
 * enrollment is payable, or paid and not yet processed by the confirm step, in payments' answer.
 */
function orderPending(
  orders: ReadonlyMap<string, ProgrammePayOrders>,
  { enrollmentId }: { readonly enrollmentId: string },
): boolean {
  const own = orders.get(enrollmentId);
  return own !== undefined && (own.payable !== null || own.programmeProcessing);
}

/** `programme.cancel` (this section's head, THE CANCELLATION). */
export function cancelProgramme(
  studentUserId: string,
  { idempotencyKey, ...input }: ProgrammeActionInput,
  live: Pick<LivePublisher, 'afterCommit'>,
  dependencies: ProgrammeServiceDependencies,
): Promise<ProgrammeActionOutput> {
  const store = dependencies.cancelStore ?? programmeCancelStore;
  const ids = { studentUserId, enrollmentId: input.enrollmentId };
  const refused = (cause: ProgrammeCancelRefusal): DomainError => {
    dependencies.log.info({ ...ids, reason: cause }, 'A programme cancellation was refused');
    return markRefusalLogged(
      new DomainError('CONFLICT', undefined, { details: [{ path: 'cause', code: cause }] }),
    );
  };
  return dependencies.idempotency.run(
    { scope: 'programme.cancel', key: idempotencyKey, actorId: studentUserId, input },
    async (tx) => {
      const seen = await store.programmeFactsOf(tx, input.enrollmentId);
      if (seen === null || seen.studentUserId !== studentUserId) throw new DomainError('NOT_FOUND');
      await store.lockProgramme(tx, seen.enrollmentId);
      await store.lockEnrollment(tx, seen.enrollmentId);
      const facts = await store.programmeFactsOf(tx, seen.enrollmentId);
      if (facts === null) throw new DomainError('NOT_FOUND');
      if (facts.status !== 'confirmed' || facts.state === 'closed') throw refused('closed');
      if (!CANCELLABLE.has(facts.state)) throw refused('rest_paid');
      if ((await store.assessmentOutcome(tx, facts.enrollmentId)).kind !== 'delivered') {
        throw refused('assessment_not_settled');
      }
      if (dependencies.orders !== undefined) {
        const at = await (dependencies.clock ?? clockTimestamp)(tx);
        if (orderPending(await dependencies.orders(tx, [facts.enrollmentId], at), facts)) {
          throw refused('payment_processing');
        }
      }
      const ended = await endProgramme(tx, facts.enrollmentId, 'offer_declined', {
        deleteProgrammeCard: dependencies.deleteProgrammeCard ?? noProgrammeCardYet,
        log: dependencies.log,
        ...(dependencies.clock === undefined ? {} : { clock: dependencies.clock }),
        ...(dependencies.end === undefined ? {} : { end: dependencies.end }),
      });
      if (!ended) throw refused('closed');
      live.afterCommit([facts.studentUserId, facts.teacherUserId], {
        type: 'enrollment',
        enrollmentId: facts.enrollmentId,
      });
      return { ok: true as const };
    },
  );
}

/** What one programme's windows' step did. */
export type WindowStepOutcome = 'none' | 'no_offer_raised' | 'pay_blocked_raised' | 'lapsed';

/** The windows' step for T015's sweep (this section's head, THE WINDOWS' STEP). */
export interface ProgrammeWindows {
  step(enrollmentId: string): Promise<WindowStepOutcome>;
}

/** The sweep's two items. */
type ItemKind = 'no_offer' | 'pay_blocked';

/** What the windows' step reads and writes, over booking's rows and the owners' entries. */
export interface ProgrammeWindowStore {
  programmeFactsOf(tx: Transaction, enrollmentId: string): Promise<ProgrammeFacts | null>;
  keyShareTeacher(tx: Transaction, teacherUserId: string): Promise<void>;
  lockProgramme(tx: Transaction, enrollmentId: string): Promise<void>;
  lockEnrollment(tx: Transaction, enrollmentId: string): Promise<void>;
  assessmentOutcome(tx: Transaction, enrollmentId: string): Promise<AssessmentOutcome>;
  lastExtendedAt(tx: Transaction, enrollmentId: string): Promise<Date | null>;
  openRequestExists(tx: Transaction, enrollmentId: string, kind: ItemKind): Promise<boolean>;
  lastRequestAt(tx: Transaction, enrollmentId: string, kind: ItemKind): Promise<Date | null>;
  writeOfferDue(tx: Transaction, enrollmentId: string, offerDueAt: Date | null): Promise<void>;
  insertItem(
    tx: Transaction,
    item: {
      readonly enrollmentId: string;
      readonly teacherUserId: string;
      readonly kind: ItemKind;
    },
  ): Promise<string>;
  /** 006:T015 (R-508, N-1): moderation's open case of `reason`, read under the enrollment's lock. */
  openCaseOf(tx: Transaction, enrollmentId: string, reason: string): Promise<string | null>;
}

export const programmeWindowStore: ProgrammeWindowStore = {
  openCaseOf,
  programmeFactsOf,
  keyShareTeacher: (tx, teacherUserId) => keyShareRows(tx, 'users', [teacherUserId]),
  lockProgramme: (tx, enrollmentId) => lockRows(tx, 'programmes', [enrollmentId]),
  lockEnrollment: (tx, enrollmentId) => lockRows(tx, 'enrollments', [enrollmentId]),
  assessmentOutcome,
  lastExtendedAt: (tx, enrollmentId) => lastExtendedAt(tx, enrollmentId, 'no_offer'),
  openRequestExists,
  lastRequestAt,
  writeOfferDue,
  insertItem: (tx, { enrollmentId, teacherUserId, kind }) =>
    insertRequest(tx, { enrollmentId, teacherUserId, kind }),
};

/** What the windows' step is built over (T015 binds it in the worker). */
export interface ProgrammeWindowDependencies {
  readonly transactions: Transactions;
  readonly settings: SettingsReader;
  /** Payments' «unverified in live mode» (`createProgrammePayee`), handed in. */
  readonly payee: {
    unverifiedInLiveMode(tx: Transaction, teacherUserId: string): Promise<boolean>;
  };
  readonly deleteProgrammeCard: DeleteProgrammeCard;
  /**
   * 006:T015 («pending», A-1; Q-8 (a)): payments' `checkoutOrdersAmong`, read past `pay_by_at`
   * under the enrollment's lock: a payable or paid, unconfirmed programme order holds the lapse.
   */
  readonly orders: CheckoutOrdersAmong;
  readonly log: ProgrammeLog;
  /** The database's clock on the transaction (`clock_timestamp()`). */
  readonly clock?: (tx: Transaction) => Promise<Date>;
  readonly store?: ProgrammeWindowStore;
  readonly end?: ProgrammeEndStore;
}

/** 006:T015 (R-508, analyze N-1; PR #153 r1 Minor 2): the cases a suspension pauses the sweep with. */
export const SWEEP_SUSPENSIONS = ['teacher_suspended', 'student_suspended'] as const;

/** Whether a suspension case is open on the enrollment, one query at a time on the transaction. */
async function suspensionOpen(
  tx: Transaction,
  enrollmentId: string,
  openCase: (tx: Transaction, enrollmentId: string, reason: string) => Promise<string | null>,
): Promise<boolean> {
  for (const reason of SWEEP_SUSPENSIONS) {
    if ((await openCase(tx, enrollmentId, reason)) !== null) return true;
  }
  return false;
}

/** The windows' step over `dependencies` (this section's head, THE WINDOWS' STEP). */
export function createProgrammeWindows(
  dependencies: ProgrammeWindowDependencies,
): ProgrammeWindows {
  const store = dependencies.store ?? programmeWindowStore;
  const clock = dependencies.clock ?? clockTimestamp;

  const awaitingOffer = async (
    tx: Transaction,
    facts: ProgrammeFacts,
    now: Date,
  ): Promise<WindowStepOutcome> => {
    const offerHours = await dependencies.settings.read(
      PROGRAMME_OFFER_HOURS_SETTING,
      positiveWhole,
    );
    const outcome = await store.assessmentOutcome(tx, facts.enrollmentId);
    const extendedAt = await store.lastExtendedAt(tx, facts.enrollmentId);
    const openItem = await store.openRequestExists(tx, facts.enrollmentId, 'no_offer');
    const lastItemAt = await store.lastRequestAt(tx, facts.enrollmentId, 'no_offer');
    const step = noOfferStep({ outcome, extendedAt, offerHours, now, openItem, lastItemAt });
    if (step.offerDueAt?.getTime() !== facts.offerDueAt?.getTime()) {
      await store.writeOfferDue(tx, facts.enrollmentId, step.offerDueAt);
    }
    if (!step.raise) return 'none';
    await store.insertItem(tx, { ...facts, kind: 'no_offer' });
    return 'no_offer_raised';
  };

  const offeredUnpaid = async (
    tx: Transaction,
    facts: ProgrammeFacts,
    now: Date,
  ): Promise<WindowStepOutcome> => {
    // `pay_by_at` is set with the offer (R-505; rule 76 sets `offered_at` in `offered`).
    if (facts.payByAt === null) throw new Error('advance-programmes: an offer without pay_by_at');
    if (!payByPassed(now, facts.payByAt)) return 'none';
    // 006:T015 («pending», A-1; Q-8 (a)): a first payment under way, or paid and not yet processed.
    if (orderPending(await dependencies.orders(tx, [facts.enrollmentId], now), facts)) {
      return 'none';
    }
    const openItem = await store.openRequestExists(tx, facts.enrollmentId, 'pay_blocked');
    const step = payWindowStep({
      now,
      payByAt: facts.payByAt,
      openItem,
      lastItemAt: await store.lastRequestAt(tx, facts.enrollmentId, 'pay_blocked'),
      // Read only when it decides: past `pay_by_at` with no item open (FR-706b, «at that instant»).
      unverifiedInLiveMode:
        !openItem && (await dependencies.payee.unverifiedInLiveMode(tx, facts.teacherUserId)),
    });
    if (step === 'raise_pay_blocked') {
      await store.insertItem(tx, { ...facts, kind: 'pay_blocked' });
      return 'pay_blocked_raised';
    }
    if (step === 'none') return 'none';
    const lapsed = await endProgramme(tx, facts.enrollmentId, 'offer_lapsed', {
      deleteProgrammeCard: dependencies.deleteProgrammeCard,
      log: dependencies.log,
      clock,
      ...(dependencies.end === undefined ? {} : { end: dependencies.end }),
    });
    return lapsed ? 'lapsed' : 'none';
  };

  return {
    step: (enrollmentId) =>
      dependencies.transactions.run(async (tx): Promise<WindowStepOutcome> => {
        const seen = await store.programmeFactsOf(tx, enrollmentId);
        if (seen === null) return 'none';
        await store.keyShareTeacher(tx, seen.teacherUserId);
        await store.lockProgramme(tx, enrollmentId);
        await store.lockEnrollment(tx, enrollmentId);
        const facts = await store.programmeFactsOf(tx, enrollmentId);
        if (facts?.status !== 'confirmed') return 'none';
        // 006:T015 (R-508, N-1): a suspension pauses; read again under the locks the sweep chose by.
        if (await suspensionOpen(tx, enrollmentId, store.openCaseOf)) return 'none';
        const now = await clock(tx);
        let outcome: WindowStepOutcome = 'none';
        if (facts.state === 'awaiting_offer') outcome = await awaitingOffer(tx, facts, now);
        if (facts.state === 'offered') outcome = await offeredUnpaid(tx, facts, now);
        if (outcome !== 'none') {
          dependencies.log.info({ enrollmentId, reason: outcome }, 'A programme window acted');
          publisherOn(tx)?.afterCommit([facts.studentUserId, facts.teacherUserId], {
            type: 'enrollment',
            enrollmentId,
          });
        }
        return outcome;
      }),
  };
}

// ---------------------------------------------------------------------------------------------
// 006:T009: the first payment's checks (this file's head, THE FIRST PAYMENT).

/** What `programme.pay` creates its order from, read and checked under the locks (R-509). */
export interface ProgrammePayTarget {
  readonly enrollmentId: string;
  readonly studentUserId: string;
  readonly teacherUserId: string;
  readonly track: 'recitation' | 'ijazah_track';
  /** The offer + `programme_pay_rest_hours`: the order expires no later (R-509). */
  readonly payByAt: Date;
  /** The offer's count N, the assessment left out (R-501). */
  readonly offerSessionCount: number;
  /** The offer's total, N × the session price (R-506). */
  readonly total_piasters: Piasters;
}

/**
 * One enrollment's orders as a first payment reads them: `HeldOrders`, and (PR #158 r1 Major 1)
 * whether a programme order (`rest_in_full`, `instalment`) is paid and not yet processed by the
 * confirm step (`confirmed_at` NULL): the earlier payment «still being processed» (FR-BOOK-12).
 */
export interface ProgrammePayOrders extends HeldOrders {
  readonly programmeProcessing: boolean;
}

/**
 * Payments' answer for the enrollments a first payment touches, on the caller's transaction
 * holding their locks; it locks their orders after them (T005): each one's last payable order,
 * whether one is paid, and whether a programme order is paid and not yet confirmed.
 */
export type CheckoutOrdersAmong = (
  tx: Transaction,
  enrollmentIds: readonly string[],
  at: Date,
) => Promise<ReadonlyMap<string, ProgrammePayOrders>>;

/** What the check reads and locks, over booking's rows and moderation's entry. */
export interface ProgrammePayStore {
  payEnrollmentOf(tx: Transaction, enrollmentId: string): Promise<PayEnrollment | null>;
  lockRows(tx: Transaction, table: LockedTable, ids: readonly string[]): Promise<void>;
  ownActiveHold(tx: Transaction, studentUserId: string): Promise<HeldRow | null>;
  activeHoldsByIds(tx: Transaction, ids: readonly string[]): Promise<readonly HeldRow[]>;
  openCaseOf(tx: Transaction, enrollmentId: string, reason: string): Promise<string | null>;
  /** The database's clock on the transaction (`clock_timestamp()`). */
  clock(tx: Transaction): Promise<Date>;
}

export const programmePayStore: ProgrammePayStore = {
  payEnrollmentOf,
  lockRows,
  ownActiveHold,
  activeHoldsByIds,
  openCaseOf,
  clock: clockTimestamp,
};

/** The suspensions a first payment waits out (PR #153 r1 Minor 2): a suspension pauses. */
const PAY_SUSPENSIONS = SWEEP_SUSPENSIONS;

/** `programme.pay`'s own refusals (contracts' `programmePayRefusal`), the check's part. */
type PayRefusal = Extract<ProgrammePayRefusal, 'not_offered' | 'pay_by_passed' | 'party_suspended'>;

/**
 * `programme.pay`'s check (this file's head, THE FIRST PAYMENT), run by payments' checkout before
 * the gateway and again on the record's transaction: the programme read with no lock for its
 * student (anyone else NOT_FOUND); then, in kernel.md's one order, both accounts, the student's
 * unexpired own hold, the programme, the enrollments (the programme's and the hold's), and, through
 * payments' `orders`, their orders; what it decides on read again under them, the instant the
 * database's clock.
 */
export async function checkedProgrammePay(
  tx: Transaction,
  {
    studentUserId,
    enrollmentId,
  }: { readonly studentUserId: string; readonly enrollmentId: string },
  dependencies: {
    readonly orders: CheckoutOrdersAmong;
    readonly log: ProgrammeLog;
    readonly store?: ProgrammePayStore;
  },
): Promise<ProgrammePayTarget> {
  const store = dependencies.store ?? programmePayStore;
  const refused = (reason: PayRefusal | 'previous_checkout', error: DomainError): DomainError => {
    dependencies.log.info(
      { studentUserId, enrollmentId, reason },
      'A programme payment was refused',
    );
    return markRefusalLogged(error);
  };
  const cause = (reason: PayRefusal) =>
    refused(
      reason,
      new DomainError('CONFLICT', undefined, { details: [{ path: 'cause', code: reason }] }),
    );
  const seen = await store.payEnrollmentOf(tx, enrollmentId);
  if (seen === null || seen.studentUserId !== studentUserId) throw new DomainError('NOT_FOUND');
  await store.lockRows(tx, 'users', [...new Set([studentUserId, seen.teacherUserId])].sort());
  const at = await store.clock(tx);
  const heldEnrollment = await ownHeldEnrollment(tx, store, studentUserId, at);
  const enrollmentIds = [...new Set([enrollmentId, ...heldEnrollment])].sort();
  await store.lockRows(tx, 'programmes', [enrollmentId]);
  await store.lockRows(tx, 'enrollments', enrollmentIds);
  const programme = await store.payEnrollmentOf(tx, enrollmentId);
  if (programme === null || programme.studentUserId !== studentUserId) {
    throw new DomainError('NOT_FOUND');
  }
  if (programme.state !== 'offered' || programme.status !== 'confirmed' || !programme.payByAt) {
    throw cause('not_offered');
  }
  if (at.getTime() > programme.payByAt.getTime()) throw cause('pay_by_passed');
  // One query at a time on the one transaction (PR #156 r1 nit: pg's «already executing» warning).
  for (const reason of PAY_SUSPENSIONS) {
    if ((await store.openCaseOf(tx, enrollmentId, reason)) !== null) {
      throw cause('party_suspended');
    }
  }
  const orders = await dependencies.orders(tx, enrollmentIds, at);
  for (const held of heldEnrollment) {
    const standing = orders.get(held);
    if (standing?.paid === true) {
      throw refused('previous_checkout', previousCheckout(held, 'processing'));
    }
    if (standing?.payable) {
      const { expiresAt } = standing.payable;
      throw refused('previous_checkout', previousCheckout(held, 'payable', expiresAt));
    }
  }
  const own = orders.get(enrollmentId);
  if (own?.payable) {
    const { expiresAt } = own.payable;
    throw refused('previous_checkout', previousCheckout(enrollmentId, 'payable', expiresAt));
  }
  // PR #158 r1 Major 1: paid at the gateway, the confirm step not run yet (the programme still
  // `offered`), as the own hold's paid order above.
  if (own?.programmeProcessing === true) {
    throw refused('previous_checkout', previousCheckout(enrollmentId, 'processing'));
  }
  return {
    enrollmentId,
    studentUserId,
    teacherUserId: programme.teacherUserId,
    track: programme.track,
    payByAt: programme.payByAt,
    offerSessionCount: programme.offerSessionCount,
    total_piasters: programme.total_piasters,
  };
}

/**
 * The enrollment of the student's own hold while it has not expired at `at`, its row locked and
 * read again (FR-BOOK-12); none for no hold, an expired one, or one with no enrollment yet.
 */
async function ownHeldEnrollment(
  tx: Transaction,
  store: Pick<ProgrammePayStore, 'ownActiveHold' | 'lockRows' | 'activeHoldsByIds'>,
  studentUserId: string,
  at: Date,
): Promise<string[]> {
  const own = await store.ownActiveHold(tx, studentUserId);
  if (own === null || own.expiresAt.getTime() <= at.getTime()) return [];
  await store.lockRows(tx, 'slot_holds', [own.id]);
  const [held] = await store.activeHoldsByIds(tx, [own.id]);
  if (held === undefined || held.expiresAt.getTime() <= at.getTime()) return [];
  return held.enrollmentId === null ? [] : [held.enrollmentId];
}

// ---------------------------------------------------------------------------------------------
// 006:T015 (FR-714, FR-717, FR-721; R-507, R-508, R-509; SRS DEC-110, DEC-113; B-P3's conflict
// check, Q-1 (a), Q-3 (a); Q-10 (a) adjusted): THE MONTHS, the sweep's steps on a paid programme
// (`active` or `paused`), for `advance-programmes`.
//
// THE SURVEY. One read with no lock (`survey`): the programme, its paid month's sessions, its weekly
// time and payments' answer of the month's orders, decided by `programmes.rules.ts`' `monthStepOf`:
// the steps that may act now (`item`, `retry`, `due`, `pause`, in that order; `due` also when the
// derived due point moved), and the month's automatic order the gateway is asked about on this
// minute (`inquiryDue`). The sweep asks (payments' `inquire`, never under a lock) before the steps.
//
// EACH STEP (`step`), a transaction of its own, in kernel.md's order: the teacher's `users` row
// key-shared (an item's insert key-shares it, as the windows' step), the programme's row, the
// enrollment's; read again under them; a programme whose enrollment is not `confirmed`, that is not
// `active` or `paused`, or that has an open `teacher_suspended` or `student_suspended` case (a
// suspension pauses, N-1) is left alone. Then the due point derived (Q-3 (a)) and written when it
// moved, payments' answer of the month's orders read under the enrollment's lock (every order's move
// takes it first), and the step's action decided again:
// - `withdraw_item` / `raise_item`: the `charge_unknown` item withdrawn, or opened once (Q-1 (a));
// - `failed`: the month's first failure written once (`first_failure_at`);
// - `due` / `retry`: payments' `record` writes the month's automatic order on this transaction
//   (`created`, no gateway id, expiring in `slot_hold_ttl_minutes`; or `failed`/`hard` with no payee
//   in live mode), and the programme its attempt (0: the failure and the retries cleared; n:
//   `retries_done` n); the gateway is called by the returned `charge`, which the sweep runs after the
//   commit, once, never under a lock (R-509);
// - `pause`: `paused` since the next occurrence's start, one `programme_paused` enrollment event on
//   the same transaction (FU-A1 (a)), and `enrollment` to both parties after the commit on the
//   transaction's bound publisher (N-15).
// One info line per action, ids and a reason only; nothing for no action.
// Double run (R-API-14): every step reads the state it moves from under the lock: a second run finds
// the order recorded, the failure written, the item open or withdrawn, or the programme paused, and
// does nothing; each write is a conditional update besides.

/** §3.14: the days after a soft-declined automatic charge it is retried on ([1, 3, 5, 7]). */
export const PROGRAMME_CHARGE_RETRY_DAYS_SETTING = 'programme_charge_retry_days';
/** §3.14 (DEC-113): the unanswered asks before the `charge_unknown` item (6). */
export const PROGRAMME_CHARGE_INQUIRY_TRIES_SETTING = 'programme_charge_inquiry_tries';
/** §3.14: the checkout's lifetime, an automatic order's and the asks' interval (10 minutes). */
const SLOT_HOLD_TTL_SETTING = 'slot_hold_ttl_minutes';

/**
 * Payments' answer of a programme's month `month` (its orders, and whether a card is saved), read
 * with no lock on the caller's transaction; under the step's enrollment lock, which every order's
 * move takes first, it cannot change before the commit. Handed in (booking imports no payments).
 */
export type MonthOrdersOf = (
  tx: Transaction,
  enrollmentId: string,
  month: number,
  at: Date,
) => Promise<MonthOrders>;

/** What the sweep hands payments for a month's automatic charge (payments' request's shape). */
export interface ProgrammeChargeRequest {
  readonly enrollmentId: string;
  readonly teacherUserId: string;
  readonly instalmentMonth: number;
  readonly attempt: number;
  readonly offerTotal_piasters: Piasters;
  readonly offerSessionCount: number;
}

/** What payments' `record` wrote; `charge` is run once, after the step's commit. */
export type RecordedProgrammeCharge =
  | { readonly outcome: 'no_card' }
  | { readonly outcome: 'refused'; readonly paymentId: string }
  | {
      readonly outcome: 'recorded';
      readonly paymentId: string;
      readonly charge: () => Promise<unknown>;
    };

/** Payments' automatic charge, as the sweep's steps record it (handed in). */
export interface ProgrammeCharges {
  record(tx: Transaction, request: ProgrammeChargeRequest): Promise<RecordedProgrammeCharge>;
}

/** What the month steps read and write, over booking's rows and the owners' entries. */
export interface ProgrammeMonthStore {
  programmeMonthOf(tx: Transaction, enrollmentId: string): Promise<ProgrammeMonthRow | null>;
  keyShareTeacher(tx: Transaction, teacherUserId: string): Promise<void>;
  lockProgramme(tx: Transaction, enrollmentId: string): Promise<void>;
  lockEnrollment(tx: Transaction, enrollmentId: string): Promise<void>;
  openCaseOf(tx: Transaction, enrollmentId: string, reason: string): Promise<string | null>;
  /** Sessions' entry: the enrollment's sessions with their months. */
  sessionsOf(tx: Transaction, enrollmentId: string): Promise<readonly MonthSession[]>;
  readSlot(tx: Transaction, slotId: string): Promise<SlotRow | null>;
  openItemExists(tx: Transaction, enrollmentId: string): Promise<boolean>;
  lastItemAt(tx: Transaction, enrollmentId: string): Promise<Date | null>;
  insertItem(
    tx: Transaction,
    item: { readonly enrollmentId: string; readonly teacherUserId: string },
  ): Promise<string>;
  withdrawItem(tx: Transaction, enrollmentId: string): Promise<boolean>;
  writeNextDue(tx: Transaction, enrollmentId: string, nextDueAt: Date | null): Promise<void>;
  writeFirstFailure(tx: Transaction, enrollmentId: string, at: Date): Promise<boolean>;
  writeAttempt(tx: Transaction, enrollmentId: string, attempt: number): Promise<boolean>;
  writePaused(tx: Transaction, enrollmentId: string, pausedAt: Date): Promise<boolean>;
  /** FU-A1 (a): the pause's `programme_paused` row, on the pause's transaction. */
  recordPaused(tx: Transaction, enrollmentId: string, occurredAt: Date): Promise<void>;
}

export const programmeMonthStore: ProgrammeMonthStore = {
  programmeMonthOf,
  keyShareTeacher: (tx, teacherUserId) => keyShareRows(tx, 'users', [teacherUserId]),
  lockProgramme: (tx, enrollmentId) => lockRows(tx, 'programmes', [enrollmentId]),
  lockEnrollment: (tx, enrollmentId) => lockRows(tx, 'enrollments', [enrollmentId]),
  openCaseOf,
  sessionsOf: async (tx, enrollmentId) =>
    (await sessionsOfEnrollments(tx, [enrollmentId])).get(enrollmentId) ?? [],
  readSlot,
  openItemExists: (tx, enrollmentId) => openRequestExists(tx, enrollmentId, 'charge_unknown'),
  lastItemAt: (tx, enrollmentId) => lastRequestAt(tx, enrollmentId, 'charge_unknown'),
  insertItem: (tx, { enrollmentId, teacherUserId }) =>
    insertRequest(tx, { enrollmentId, teacherUserId, kind: 'charge_unknown' }),
  withdrawItem: (tx, enrollmentId) => withdrawOpenItem(tx, enrollmentId, 'charge_unknown'),
  writeNextDue,
  writeFirstFailure,
  writeAttempt,
  writePaused,
  recordPaused: (tx, enrollmentId, occurredAt) =>
    recordEnrollmentEvents(tx, [{ kind: 'programme_paused', enrollmentId, occurredAt }]),
};

/** What the month steps are built over (`advance-programmes` in the worker). */
export interface ProgrammeMonthDependencies {
  readonly transactions: Transactions;
  readonly settings: SettingsReader;
  /** Payments' answer of the month's orders (handed in). */
  readonly orders: MonthOrdersOf;
  /** Payments' automatic charge's `record` (handed in). */
  readonly charges: ProgrammeCharges;
  readonly log: ProgrammeLog;
  /** The database's clock on the transaction (`clock_timestamp()`). */
  readonly clock?: (tx: Transaction) => Promise<Date>;
  readonly store?: ProgrammeMonthStore;
}

/** The survey's answer (this section's head, THE SURVEY). */
export interface MonthSurvey {
  /** The month's automatic order the gateway is asked about on this minute; null for none. */
  readonly ask: string | null;
  /** The steps that may act now, in order. */
  readonly steps: readonly MonthStepKind[];
}

/** What a step did: its action, and the gateway's call to run after its commit, once. */
export interface MonthStepDone {
  readonly action: MonthAction['kind'] | 'none';
  readonly charge?: () => Promise<unknown>;
}

/** The month steps (this section's head). */
export interface ProgrammeMonths {
  survey(enrollmentId: string): Promise<MonthSurvey | null>;
  step(
    step: MonthStepKind,
    enrollmentId: string,
    context: { readonly askedNoAnswer: boolean },
  ): Promise<MonthStepDone>;
}

const MONTH_STEPS: readonly MonthStepKind[] = ['item', 'retry', 'due', 'pause'];

/** The settings the month steps read, once per step. */
interface MonthTerms {
  readonly retryDays: readonly number[];
  readonly ttlMinutes: number;
  readonly tries: number;
}

/** A programme the month steps act on: its enrollment `confirmed`, the programme paid. */
type SweptMonthRow = ProgrammeMonthRow & { readonly state: 'active' | 'paused' };

function swept(row: ProgrammeMonthRow): row is SweptMonthRow {
  return row.status === 'confirmed' && (row.state === 'active' || row.state === 'paused');
}

function sameInstant(one: Date | null, other: Date | null): boolean {
  return (one?.getTime() ?? null) === (other?.getTime() ?? null);
}

/** The month steps over `dependencies` (this section's head). */
export function createProgrammeMonths(dependencies: ProgrammeMonthDependencies): ProgrammeMonths {
  const store = dependencies.store ?? programmeMonthStore;
  const clock = dependencies.clock ?? clockTimestamp;
  const { settings, log } = dependencies;

  const termsOf = async (): Promise<MonthTerms> => {
    const [retryDays, ttlMinutes, tries] = await Promise.all([
      settings.read(PROGRAMME_CHARGE_RETRY_DAYS_SETTING, programmeChargeRetryDays),
      settings.read(SLOT_HOLD_TTL_SETTING, positiveWhole),
      settings.read(PROGRAMME_CHARGE_INQUIRY_TRIES_SETTING, positiveWhole),
    ]);
    return { retryDays, ttlMinutes, tries };
  };

  /** The month's facts on `tx`, with or without the step's locks; one query at a time. */
  const factsOf = async (
    tx: Transaction,
    row: SweptMonthRow,
    terms: MonthTerms,
    askedNoAnswer: boolean,
  ): Promise<MonthFacts> => {
    const now = await clock(tx);
    const sessions = await store.sessionsOf(tx, row.enrollmentId);
    const nextDueAt = nextDueOf({ ...row, sessions });
    let nextOccurrence: Date | null = null;
    if (nextDueAt !== null) {
      const slot = await store.readSlot(tx, row.slotId);
      // `enrollments.slot_id` is a foreign key to the slot (ERD `enrollments`).
      if (slot === null) throw new Error('advance-programmes: an enrollment without its slot');
      nextOccurrence = nextOccurrenceAt(slot, row.timezone, nextDueAt);
    }
    const orders = await dependencies.orders(tx, row.enrollmentId, row.monthsPaid + 1, now);
    const open = await store.openItemExists(tx, row.enrollmentId);
    const lastAt = await store.lastItemAt(tx, row.enrollmentId);
    return {
      now,
      state: row.state,
      nextDueAt,
      nextOccurrenceAt: nextOccurrence,
      firstFailureAt: row.firstFailureAt,
      retriesDone: row.retriesDone,
      retryDays: terms.retryDays,
      orders,
      item: { open, lastAt },
      inquiry: { ttlMinutes: terms.ttlMinutes, tries: terms.tries },
      askedNoAnswer,
    };
  };

  /** The month's automatic charge recorded by payments, and its attempt on the programme. */
  const recordCharge = async (
    tx: Transaction,
    row: SweptMonthRow,
    attempt: number,
  ): Promise<MonthStepDone['charge']> => {
    const recorded = await dependencies.charges.record(tx, {
      enrollmentId: row.enrollmentId,
      teacherUserId: row.teacherUserId,
      instalmentMonth: row.monthsPaid + 1,
      attempt,
      offerTotal_piasters: row.offerTotal_piasters,
      offerSessionCount: row.offerSessionCount,
    });
    if (recorded.outcome === 'no_card') return undefined;
    await store.writeAttempt(tx, row.enrollmentId, attempt);
    return recorded.outcome === 'recorded' ? recorded.charge : undefined;
  };

  const apply = async (
    tx: Transaction,
    row: SweptMonthRow,
    action: MonthAction,
    now: Date,
  ): Promise<MonthStepDone> => {
    const { enrollmentId } = row;
    switch (action.kind) {
      case 'withdraw_item':
        await store.withdrawItem(tx, enrollmentId);
        return { action: action.kind };
      case 'raise_item':
        await store.insertItem(tx, row);
        return { action: action.kind };
      case 'failed':
        await store.writeFirstFailure(tx, enrollmentId, now);
        return { action: action.kind };
      case 'due':
      case 'retry': {
        const call = await recordCharge(tx, row, action.kind === 'due' ? 0 : action.attempt);
        return call === undefined ? { action: action.kind } : { action: action.kind, charge: call };
      }
      case 'pause':
        if (await store.writePaused(tx, enrollmentId, action.pausedAt)) {
          await store.recordPaused(tx, enrollmentId, action.pausedAt);
          publisherOn(tx)?.afterCommit([row.studentUserId, row.teacherUserId], {
            type: 'enrollment',
            enrollmentId,
          });
        }
        return { action: action.kind };
    }
  };

  return {
    survey: async (enrollmentId) => {
      const terms = await termsOf();
      return dependencies.transactions.run(async (tx): Promise<MonthSurvey | null> => {
        const row = await store.programmeMonthOf(tx, enrollmentId);
        if (row === null || !swept(row)) return null;
        const facts = await factsOf(tx, row, terms, true);
        const steps = MONTH_STEPS.filter(
          (step) =>
            monthStepOf(step, facts) !== null ||
            (step === 'due' && !sameInstant(facts.nextDueAt, row.nextDueAt)),
        );
        const automatic = facts.orders.automatic;
        const ask =
          automatic !== null && inquiryDue(facts.now, automatic, terms.ttlMinutes, terms.tries)
            ? automatic.paymentId
            : null;
        return { ask, steps };
      });
    },

    step: async (step, enrollmentId, { askedNoAnswer }) => {
      const terms = await termsOf();
      return dependencies.transactions.run(async (tx): Promise<MonthStepDone> => {
        const seen = await store.programmeMonthOf(tx, enrollmentId);
        if (seen === null) return { action: 'none' };
        await store.keyShareTeacher(tx, seen.teacherUserId);
        await store.lockProgramme(tx, enrollmentId);
        await store.lockEnrollment(tx, enrollmentId);
        const row = await store.programmeMonthOf(tx, enrollmentId);
        if (row === null || !swept(row)) return { action: 'none' };
        if (await suspensionOpen(tx, enrollmentId, store.openCaseOf)) return { action: 'none' };
        const facts = await factsOf(tx, row, terms, askedNoAnswer);
        if (!sameInstant(facts.nextDueAt, row.nextDueAt)) {
          await store.writeNextDue(tx, enrollmentId, facts.nextDueAt);
        }
        const action = monthStepOf(step, facts);
        if (action === null) return { action: 'none' };
        const done = await apply(tx, row, action, facts.now);
        log.info(
          {
            enrollmentId,
            instalmentMonth: row.monthsPaid + 1,
            reason: action.kind,
            ...(action.kind === 'retry' ? { attempt: action.attempt } : {}),
          },
          'A programme month step acted',
        );
        return done;
      });
    },
  };
}

// ---------------------------------------------------------------------------------------------
// 006:T016 (FR-713a, FR-715, FR-716, FR-722, FR-724; R-508, R-509, R-510; SRS DEC-95, DEC-110,
// DEC-113; B-P3's conflict check, the owner's «موافق على الكل (أ)»): the automatic renewal off.
//
// THE AUTOMATIC RENEWAL OFF (`programme.autoRenewOff`, the student, at any time; DEC-95). Keyed
// (`programme.autoRenewOff`). The programme read once with no lock for its student, anyone else
// NOT_FOUND as an unknown id; then the programme's row and the enrollment's (kernel.md's order, the
// locks the sweep's due step reads the card under, 006:T015's row), read again under them; then
// payments' `deleteProgrammeCard` deletes the saved card, if any, on this transaction. An «off» that
// has answered is never followed by a new automatic order: a due step that took the programme first
// has committed its order (a charge already `created` stays, the review session's reading of
// DEC-95), and one that waits reads no card. Later months by hand (`programme.renew`). Refused
// `CONFLICT` with the cause, nothing deleted, one line of ids and a reason: `closed` (the programme
// closed or its enrollment no longer `confirmed`), `party_suspended` (an open `teacher_suspended` or
// `student_suspended` case; PR #153 r1 Minor 2). One info line of ids and the reason; `enrollment`
// to both parties after the commit.

/** What the «off» reads and locks, over booking's rows and moderation's entry. */
export interface AutoRenewOffStore {
  programmeFactsOf(tx: Transaction, enrollmentId: string): Promise<ProgrammeFacts | null>;
  lockProgramme(tx: Transaction, enrollmentId: string): Promise<void>;
  lockEnrollment(tx: Transaction, enrollmentId: string): Promise<void>;
  openCaseOf(tx: Transaction, enrollmentId: string, reason: string): Promise<string | null>;
}

export const autoRenewOffStore: AutoRenewOffStore = {
  programmeFactsOf,
  lockProgramme: (tx, enrollmentId) => lockRows(tx, 'programmes', [enrollmentId]),
  lockEnrollment: (tx, enrollmentId) => lockRows(tx, 'enrollments', [enrollmentId]),
  openCaseOf,
};

/** `programme.autoRenewOff` (this section's head, THE AUTOMATIC RENEWAL OFF). */
export function turnAutoRenewOff(
  studentUserId: string,
  { idempotencyKey, ...input }: ProgrammeActionInput,
  live: Pick<LivePublisher, 'afterCommit'>,
  dependencies: ProgrammeServiceDependencies & { readonly offStore?: AutoRenewOffStore },
): Promise<ProgrammeActionOutput> {
  const store = dependencies.offStore ?? autoRenewOffStore;
  const ids = { studentUserId, enrollmentId: input.enrollmentId };
  const refused = (cause: ProgrammeAutoRenewOffRefusal): DomainError => {
    dependencies.log.info({ ...ids, reason: cause }, 'The automatic renewal off was refused');
    return markRefusalLogged(
      new DomainError('CONFLICT', undefined, { details: [{ path: 'cause', code: cause }] }),
    );
  };
  return dependencies.idempotency.run(
    { scope: 'programme.autoRenewOff', key: idempotencyKey, actorId: studentUserId, input },
    async (tx) => {
      const seen = await store.programmeFactsOf(tx, input.enrollmentId);
      if (seen === null || seen.studentUserId !== studentUserId) throw new DomainError('NOT_FOUND');
      await store.lockProgramme(tx, seen.enrollmentId);
      await store.lockEnrollment(tx, seen.enrollmentId);
      const facts = await store.programmeFactsOf(tx, seen.enrollmentId);
      if (facts === null) throw new DomainError('NOT_FOUND');
      if (facts.status !== 'confirmed' || facts.state === 'closed') throw refused('closed');
      if (await suspensionOpen(tx, facts.enrollmentId, store.openCaseOf)) {
        throw refused('party_suspended');
      }
      await (dependencies.deleteProgrammeCard ?? noProgrammeCardYet)(tx, facts.enrollmentId);
      dependencies.log.info(
        { ...ids, reason: 'auto_renew_off' },
        'The automatic renewal was turned off',
      );
      live.afterCommit([facts.studentUserId, facts.teacherUserId], {
        type: 'enrollment',
        enrollmentId: facts.enrollmentId,
      });
      return { ok: true as const };
    },
  );
}

// THE RENEWAL'S CHECK (`programme.renew`, FR-715, FR-716, FR-720; R-509; FR-BOOK-12), run by
// payments' checkout before the gateway and again on the record's transaction, as `programme.pay`'s
// (006:T009). The programme read with no lock for its student (anyone else NOT_FOUND); then both
// accounts, the student's unexpired own hold, the programme, the enrollments (the programme's and
// the hold's), the instant the database's clock; then, under them, the month's orders (payments'
// `monthOrders`, no lock: every order's move takes the enrollment first, held here) and FR-BOOK-12's
// orders (payments' `orders`, their rows locked after the enrollments'). The month by hand is the
// next one, `months_paid` + 1. Refused, with one line of ids and a reason: `closed` (closed, or the
// enrollment no longer `confirmed`); `nothing_due` (not `active` or `paused`, in full, or every month
// paid); `party_suspended` (a suspension case open); `charge_pending` (the month's automatic order
// `created`, answered or not: the gateway may still take it, DEC-113 (1)); `not_due_yet` with no
// failure of the month's automatic charge (failed, of either kind, or expired: «pay now» and «change
// card», FR-716) while a card is saved (the month is charged by itself), or, with none, before the
// due point (`lastToEnd`, derived from the sessions as the sweep derives it) less
// `programme_renew_early_days` whole days on the instant (FR-715); and FR-BOOK-12's
// `PREVIOUS_CHECKOUT` as `programme.pay`'s. A `no_payee` refusal is a hard failure, so once the
// payout account is verified the month is taken by hand (PR #153 r4 Minor 1); `payee_unverified` is
// the checkout's, before the gateway.

/** §3.14: the days before the due point a student without a saved card may renew by hand (3). */
export const PROGRAMME_RENEW_EARLY_DAYS_SETTING = 'programme_renew_early_days';

/** What `programme.renew` creates its order from, read and checked under the locks (R-509). */
export interface ProgrammeRenewTarget {
  readonly enrollmentId: string;
  readonly studentUserId: string;
  readonly teacherUserId: string;
  /** A programme is an `ijazah_track` enrollment (R-501). */
  readonly track: 'ijazah_track';
  /** The month by hand, `months_paid` + 1. */
  readonly instalmentMonth: number;
  /** The offer's count N, the assessment left out (R-501). */
  readonly offerSessionCount: number;
  /** The offer's frozen total (R-506). */
  readonly total_piasters: Piasters;
}

/** What the renewal's check reads and locks, over booking's rows and the owners' entries. */
export interface ProgrammeRenewStore extends Pick<
  ProgrammePayStore,
  'lockRows' | 'ownActiveHold' | 'activeHoldsByIds' | 'openCaseOf' | 'clock'
> {
  programmeMonthOf(tx: Transaction, enrollmentId: string): Promise<ProgrammeMonthRow | null>;
  /** Sessions' entry: the enrollment's sessions with their months. */
  sessionsOf(tx: Transaction, enrollmentId: string): Promise<readonly MonthSession[]>;
}

export const programmeRenewStore: ProgrammeRenewStore = {
  programmeMonthOf,
  lockRows,
  ownActiveHold,
  activeHoldsByIds,
  openCaseOf,
  clock: clockTimestamp,
  sessionsOf: async (tx, enrollmentId) =>
    (await sessionsOfEnrollments(tx, [enrollmentId])).get(enrollmentId) ?? [],
};

/** `programme.renew`'s own refusals (contracts' `programmeRenewRefusal`), the check's part. */
type RenewRefusal = Exclude<ProgrammeRenewRefusal, 'payee_unverified'>;

/** What a month by hand is decided on, each read only when the decision reaches it. */
export interface RenewalReads {
  /** A `teacher_suspended` or `student_suspended` case open. */
  suspended(): Promise<boolean>;
  /** The month's orders, `months_paid` + 1. */
  month(): Promise<MonthOrders>;
  /** The due point (`lastToEnd` over the paid month's sessions). */
  due(): Promise<Date | null>;
  readonly at: Date;
  /** `programme_renew_early_days`. */
  readonly earlyDays: number;
}

/**
 * 006:T018 (Q-f3 (a), the owner, 2026-11-24): whether `programme.renew` takes the month now, and
 * its refusal otherwise (this section's head): the renewal's check holds it under its locks, and
 * `programme.get`'s `renewOpen` reads it with none, so the two never disagree.
 */
export async function renewalRefusalOf(
  row: Pick<ProgrammeMonthRow, 'status' | 'state' | 'plan' | 'monthsPaid' | 'monthCount'>,
  reads: RenewalReads,
): Promise<RenewRefusal | null> {
  if (row.status !== 'confirmed' || row.state === 'closed') return 'closed';
  if (
    (row.state !== 'active' && row.state !== 'paused') ||
    row.plan !== 'monthly' ||
    row.monthCount === null ||
    row.monthsPaid >= row.monthCount
  ) {
    return 'nothing_due';
  }
  if (await reads.suspended()) return 'party_suspended';
  const month = await reads.month();
  const charge = month.automatic?.status;
  if (charge === 'created') return 'charge_pending';
  // «pay now» and «change card» after a failure of the month's charge (FR-716); otherwise «renew
  // now» only without a card, from the early days before the due point (FR-715).
  if (charge === 'failed' || charge === 'expired') return null;
  if (month.cardSaved) return 'not_due_yet';
  const due = await reads.due();
  return due === null || reads.at < new Date(addDays(due, -reads.earlyDays)) ? 'not_due_yet' : null;
}

/** `programme.renew`'s check (this section's head, THE RENEWAL'S CHECK). */
export async function checkedProgrammeRenew(
  tx: Transaction,
  {
    studentUserId,
    enrollmentId,
  }: { readonly studentUserId: string; readonly enrollmentId: string },
  dependencies: {
    readonly orders: CheckoutOrdersAmong;
    readonly monthOrders: MonthOrdersOf;
    /** `programme_renew_early_days`, read before the transaction. */
    readonly earlyDays: number;
    readonly log: ProgrammeLog;
    readonly store?: ProgrammeRenewStore;
  },
): Promise<ProgrammeRenewTarget> {
  const store = dependencies.store ?? programmeRenewStore;
  const refused = (reason: RenewRefusal | 'previous_checkout', error: DomainError): DomainError => {
    dependencies.log.info(
      { studentUserId, enrollmentId, reason },
      'A programme renewal was refused',
    );
    return markRefusalLogged(error);
  };
  const cause = (reason: RenewRefusal) =>
    refused(
      reason,
      new DomainError('CONFLICT', undefined, { details: [{ path: 'cause', code: reason }] }),
    );
  const seen = await store.programmeMonthOf(tx, enrollmentId);
  if (seen === null || seen.studentUserId !== studentUserId) throw new DomainError('NOT_FOUND');
  await store.lockRows(tx, 'users', [...new Set([studentUserId, seen.teacherUserId])].sort());
  const at = await store.clock(tx);
  const heldEnrollment = await ownHeldEnrollment(tx, store, studentUserId, at);
  const enrollmentIds = [...new Set([enrollmentId, ...heldEnrollment])].sort();
  await store.lockRows(tx, 'programmes', [enrollmentId]);
  await store.lockRows(tx, 'enrollments', enrollmentIds);
  const row = await store.programmeMonthOf(tx, enrollmentId);
  if (row === null || row.studentUserId !== studentUserId) throw new DomainError('NOT_FOUND');
  const refusal = await renewalRefusalOf(row, {
    suspended: () => suspensionOpen(tx, enrollmentId, store.openCaseOf),
    month: () => dependencies.monthOrders(tx, enrollmentId, row.monthsPaid + 1, at),
    due: async () => nextDueOf({ ...row, sessions: await store.sessionsOf(tx, enrollmentId) }),
    at,
    earlyDays: dependencies.earlyDays,
  });
  if (refusal !== null) throw cause(refusal);
  const orders = await dependencies.orders(tx, enrollmentIds, at);
  for (const held of heldEnrollment) {
    const standing = orders.get(held);
    if (standing?.paid === true) {
      throw refused('previous_checkout', previousCheckout(held, 'processing'));
    }
    if (standing?.payable) {
      const { expiresAt } = standing.payable;
      throw refused('previous_checkout', previousCheckout(held, 'payable', expiresAt));
    }
  }
  const own = orders.get(enrollmentId);
  if (own?.payable) {
    const { expiresAt } = own.payable;
    throw refused('previous_checkout', previousCheckout(enrollmentId, 'payable', expiresAt));
  }
  if (own?.programmeProcessing === true) {
    throw refused('previous_checkout', previousCheckout(enrollmentId, 'processing'));
  }
  return {
    enrollmentId,
    studentUserId,
    teacherUserId: row.teacherUserId,
    track: 'ijazah_track',
    instalmentMonth: row.monthsPaid + 1,
    offerSessionCount: row.offerSessionCount,
    total_piasters: row.offerTotal_piasters,
  };
}

// ---------------------------------------------------------------------------------------------
// 006:T018 (FR-726, FR-727; app-surface.md `programme.get`, admin-surface.md `programmes.queue`
// and `programmes.get`; B-P3's conflict check, the owner's «موافق على الكل (أ) مع تحسين س٢»): the
// reads. Each on one transaction with no lock: a read decides nothing.
//
// THE PROGRAMME (`programme.get`, either party). The programme read for its two parties only, anyone
// else NOT_FOUND as an unknown id (R-GENDER-2's shape; the parties are of one gender, R-GENDER-4).
// `card` (`last4`, brand) to the student alone, never its token (SC-707). `nextDueAt` derived from
// the paid month's sessions (`nextDueOf`, as the sweep and the renewal derive it, Q-3 (a)).
// `chargePending`: the month's automatic order `created`, until the gateway answers it, expired or
// not (Q-f2 (a), the owner, 2026-11-24).
// `payeePending`: payments' «unverified in live mode» (T008's entry), false in test mode.
// `payBlocked`: a `pay_blocked` item open (FR-706b). `teacherUnavailable`: the teacher's account
// gone, suspended or banned (FR-BOOK-19). `renewOpen` (Q-f3 (a), the owner, 2026-11-24): `programme.renew`
// would take the month now, its check's own rule (`renewalRefusalOf`): with a card saved only after
// the month's charge failed or expired («pay now», «change card»), with none «renew now» from
// `programme_renew_early_days` before the due point; false while `payeePending` (the checkout's
// `payee_unverified`), `chargePending` or a suspension holds.
//
// THE QUEUE (`programmes.queue`, an administrator). Oldest first in pages of `admin_list_page_size`
// (one row more read, a cursor only while more follow): `paused`, the longest paused first; every
// other filter, the open items of its kind by their time-ordered id (`refusal` has none since SRS
// DEC-112). Each row names the two parties, the programme's state and pause, and its item: a
// `no_offer` one with whether the assessment was held (PR #158 r1 Q-R1 (b)), a `pay_blocked` one
// with whether the payout account is verified now (FR-706b).
//
// THE PROGRAMME'S PAGE (`programmes.get`, an administrator). The programme, its orders by kind
// (payments', oldest first), its items with their reasons, `cardSaved` (a boolean, never a card
// detail; Q-9 (a)), and, on a closed programme with no `assessment` release, whether the assessment
// was held (PR #158 r2 Follow-up 2). An unknown or soft-deleted enrollment NOT_FOUND.

/** The student's saved card as `programme.get` shows it: never its token (SC-707). */
export interface ProgrammeCardView {
  readonly last4: string;
  readonly brand: string;
}

/** Payments' reads for `programme.get`, handed in by the composition root (R-208). */
export interface ProgrammeReadPayments {
  /** «Unverified in live mode» (T008's entry). */
  readonly payee: {
    unverifiedInLiveMode(tx: Transaction, teacherUserId: string): Promise<boolean>;
  };
  /** The month's orders and whether a card is saved, with no lock. */
  readonly monthOrders: MonthOrdersOf;
  /** The student's saved card, or null. */
  readonly cardOf: (tx: Transaction, enrollmentId: string) => Promise<ProgrammeCardView | null>;
}

/** What `programme.get` reads of booking's rows and the owners' entries; stood in by a spec. */
export interface ProgrammeReadStore {
  viewOf(tx: Transaction, enrollmentId: string): Promise<ProgrammeView | null>;
  sessionsOf(tx: Transaction, enrollmentId: string): Promise<readonly MonthSession[]>;
  payBlockedOpen(tx: Transaction, enrollmentId: string): Promise<boolean>;
  standingOf(tx: Transaction, userId: string): ReturnType<typeof readStanding>;
  clock(tx: Transaction): Promise<Date>;
  /** Moderation's entry: the enrollment's open case of `reason`. */
  openCaseOf(tx: Transaction, enrollmentId: string, reason: string): Promise<string | null>;
}

export const programmeReadStore: ProgrammeReadStore = {
  viewOf: programmeViewOf,
  sessionsOf: async (tx, enrollmentId) =>
    (await sessionsOfEnrollments(tx, [enrollmentId])).get(enrollmentId) ?? [],
  payBlockedOpen: (tx, enrollmentId) => openRequestExists(tx, enrollmentId, 'pay_blocked'),
  standingOf: readStanding,
  clock: clockTimestamp,
  openCaseOf,
};

/** The account states in which the teacher is unavailable to the student (FR-BOOK-19). */
const UNAVAILABLE_ACCOUNTS: ReadonlySet<string> = new Set(['suspended', 'banned']);

/** The offer as both reads show it, the session's price `packages/money`'s (R-MONEY-5). */
function offerOf(view: ProgrammeView): ProgrammeGetOutput['offer'] {
  const { offer } = view;
  if (offer === null) return null;
  return {
    level: offer.level,
    readiness: offer.readiness,
    expectedLength: offer.expectedLength,
    durationMinutes: sessionLengthMinutes.parse(offer.durationMinutes),
    sessionCount: offer.sessionCount,
    total_piasters: offer.total_piasters,
    sessionPrice_piasters: perSession(offer.total_piasters, offer.sessionCount),
    offeredAt: offer.offeredAt.toISOString(),
  };
}

/** No order read: a programme with no month to pay (`renewalRefusalOf` answers before it). */
const NO_MONTH_ORDERS: MonthOrders = {
  cardSaved: false,
  payable: false,
  processing: false,
  automatic: null,
};

/** A month is still to pay on a monthly programme that runs (R-507). */
function monthDue(view: ProgrammeView): boolean {
  return (
    view.status === 'confirmed' &&
    (view.state === 'active' || view.state === 'paused') &&
    view.plan === 'monthly' &&
    view.monthCount !== null &&
    view.monthsPaid < view.monthCount
  );
}

const isoOrNull = (at: Date | null): string | null => (at === null ? null : at.toISOString());

/** §3.14 (SRS DEC-114): the hours before `payBy` the student's reminder line shows from (12). */
export const PROGRAMME_PAY_REMINDER_HOURS_SETTING = 'programme_pay_reminder_hours';

/**
 * 006:T019 (B-P4's conflict check, Q-5 (b), the owner, 2026-11-25; SRS DEC-114, FR-708): the instant
 * the «pay before» line shows from, `payBy` − `hours` whole hours on the instant (`packages/time`),
 * while the programme is `offered`; null otherwise. One rule for `programme.get` and the enrollment
 * reads' `programme` marker. Example: `payBy` Wed 18:00, 12 hours → Wed 06:00.
 */
export function payReminderFromOf(
  programme: { readonly state: ProgrammeState; readonly payByAt: Date | null },
  hours: number,
): Date | null {
  if (programme.state !== 'offered' || programme.payByAt === null) return null;
  return new Date(addHours(programme.payByAt, -hours));
}

/** `programme.get` on `tx` for `userId` (this section's head, THE PROGRAMME). */
export async function readProgramme(
  tx: Transaction,
  userId: string,
  enrollmentId: string,
  dependencies: {
    readonly payments: ProgrammeReadPayments;
    /** `programme_renew_early_days`, read before the transaction. */
    readonly earlyDays: number;
    /** 006:T020: `programme_stop_request_days` (7), read before the transaction. */
    readonly stopDays: number;
    /** 006:T019: `programme_pay_reminder_hours` (12, DEC-114), read before the transaction. */
    readonly reminderHours: number;
    readonly store?: ProgrammeReadStore;
  },
): Promise<ProgrammeGetOutput> {
  const store = dependencies.store ?? programmeReadStore;
  const { payments } = dependencies;
  const view = await store.viewOf(tx, enrollmentId);
  if (view === null || (userId !== view.studentUserId && userId !== view.teacherUserId)) {
    throw new DomainError('NOT_FOUND');
  }
  const at = await store.clock(tx);
  const due = monthDue(view)
    ? nextDueOf({ ...view, sessions: await store.sessionsOf(tx, enrollmentId) })
    : null;
  const month = monthDue(view)
    ? await payments.monthOrders(tx, enrollmentId, view.monthsPaid + 1, at)
    : null;
  // Q-f2 (a): pending until the gateway answers, expired or not.
  const chargePending = month?.automatic?.status === 'created';
  const payeePending = await payments.payee.unverifiedInLiveMode(tx, view.teacherUserId);
  // Q-f3 (a): `programme.renew` would take the month now; the checkout refuses it while
  // `payeePending` (`payee_unverified`).
  const renewOpen =
    !payeePending &&
    (await renewalRefusalOf(view, {
      suspended: () => suspensionOpen(tx, enrollmentId, store.openCaseOf),
      month: async () => month ?? NO_MONTH_ORDERS,
      due: async () => due,
      at,
      earlyDays: dependencies.earlyDays,
    })) === null;
  const payBlocked = await store.payBlockedOpen(tx, enrollmentId);
  const teacher = await store.standingOf(tx, view.teacherUserId);
  const card = userId === view.studentUserId ? await payments.cardOf(tx, enrollmentId) : null;
  const pausedAt = view.state === 'paused' ? view.pausedAt : null;
  return {
    state: view.state,
    offerDueAt: isoOrNull(view.offerDueAt),
    payBy: isoOrNull(view.payByAt),
    offer: offerOf(view),
    plan: view.plan,
    monthsPaid: view.monthsPaid,
    monthCount: view.monthCount,
    nextDueAt: isoOrNull(due),
    paused: pausedAt === null ? null : { since: pausedAt.toISOString() },
    renewOpen,
    chargePending,
    payeePending,
    payBlocked,
    teacherUnavailable: teacher === null || UNAVAILABLE_ACCOUNTS.has(teacher.accountStatus),
    // The last four digits and the brand alone, to the student alone (SC-707).
    card: card === null ? null : { last4: card.last4, brand: card.brand },
    // 006:T020 (Q-2 (a)): `too_early`'s instant, the teacher's alone.
    stopRequestFrom:
      pausedAt === null || userId !== view.teacherUserId
        ? null
        : stopRequestFromOf(pausedAt, dependencies.stopDays).toISOString(),
    // 006:T019 (Q-5 (b), DEC-114): both parties'.
    payReminderFrom: isoOrNull(payReminderFromOf(view, dependencies.reminderHours)),
  };
}

/** An order of the programme as payments answers it for the administrator's page. */
export interface ProgrammeOrderRow {
  readonly id: string;
  readonly kind: 'package' | 'assessment' | 'rest_in_full' | 'instalment';
  readonly instalmentMonth: number | null;
  readonly status: 'created' | 'paid' | 'failed' | 'expired' | 'refunded';
  readonly automatic: boolean;
  readonly declineKind: 'soft' | 'hard' | null;
  readonly createdAt: Date;
}

/** Payments' reads for the administrator's two reads, handed in by the composition root. */
export interface ProgrammeAdminReadPayments extends Pick<
  ProgrammeReadPayments,
  'payee' | 'monthOrders'
> {
  /** Every order of the enrollment, oldest first. */
  readonly ordersOf: (
    tx: Transaction,
    enrollmentId: string,
  ) => Promise<readonly ProgrammeOrderRow[]>;
  /** Whether an `assessment` release is written for the enrollment. */
  readonly assessmentReleased: (tx: Transaction, enrollmentId: string) => Promise<boolean>;
}

/** What the administrator's reads read of booking's rows and the owners' entries. */
export interface ProgrammeAdminReadStore {
  viewOf(tx: Transaction, enrollmentId: string): Promise<ProgrammeView | null>;
  sessionsOf(tx: Transaction, enrollmentId: string): Promise<readonly MonthSession[]>;
  requestsOf(tx: Transaction, enrollmentId: string): Promise<readonly ProgrammeRequestView[]>;
  openItemsPage(
    tx: Transaction,
    kind: ProgrammeRequestView['kind'],
    after: string | undefined,
    take: number,
  ): Promise<readonly ProgrammeRequestView[]>;
  pausedPage(
    tx: Transaction,
    after: string | undefined,
    take: number,
  ): Promise<readonly PausedProgramme[]>;
  programmesAmong(
    tx: Transaction,
    enrollmentIds: readonly string[],
  ): Promise<ReadonlyMap<string, QueuedProgramme>>;
  /** Sessions' entry: where session 1's outcome chain stands. */
  assessmentOutcome(tx: Transaction, enrollmentId: string): Promise<AssessmentOutcome>;
  /** Identity's: display names by account. */
  namesOf(tx: Transaction, userIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
  clock(tx: Transaction): Promise<Date>;
}

export const programmeAdminReadStore: ProgrammeAdminReadStore = {
  viewOf: programmeViewOf,
  sessionsOf: programmeReadStore.sessionsOf,
  requestsOf: programmeRequestsOf,
  openItemsPage,
  pausedPage,
  programmesAmong: queuedProgrammesAmong,
  assessmentOutcome,
  namesOf: displayNamesOf,
  clock: clockTimestamp,
};

/** The administrator's two reads on the call's transaction. */
export interface ProgrammeAdminReads {
  queue(tx: Transaction, input: ProgrammesQueueInput): Promise<ProgrammesQueueOutput>;
  get(tx: Transaction, enrollmentId: string): Promise<ProgrammesGetOutput>;
}

/** The page size of every admin list (SRS §3.14, FR-412). */
const LIST_PAGE_SIZE_SETTING = 'admin_list_page_size';

/** An item as the administrator's reads show it; `assessmentHeld` on a `no_offer` one only. */
function requestItemOf(
  item: ProgrammeRequestView,
  assessmentHeld: boolean | undefined,
): ProgrammeRequestItem {
  return {
    requestId: item.id,
    kind: item.kind,
    ...(item.reason === null ? {} : { reason: item.reason }),
    status: item.status,
    createdAt: item.createdAt.toISOString(),
    ...(item.decidedAt === null ? {} : { decidedAt: item.decidedAt.toISOString() }),
    ...(item.kind === 'no_offer' && assessmentHeld !== undefined ? { assessmentHeld } : {}),
  };
}

/** An order of the programme as its page shows it: a month and a decline only where set. */
function orderItemOf(order: ProgrammeOrderRow): ProgrammeOrderItem {
  return {
    paymentId: order.id,
    kind: order.kind,
    ...(order.instalmentMonth === null ? {} : { instalmentMonth: order.instalmentMonth }),
    status: order.status,
    automatic: order.automatic,
    ...(order.declineKind === null ? {} : { declineKind: order.declineKind }),
    createdAt: order.createdAt.toISOString(),
  };
}

/** The administrator's reads over `dependencies` (this section's head). */
export function createProgrammeAdminReads(dependencies: {
  readonly settings: SettingsReader;
  readonly payments: ProgrammeAdminReadPayments;
  readonly store?: ProgrammeAdminReadStore;
}): ProgrammeAdminReads {
  const store = dependencies.store ?? programmeAdminReadStore;
  const { payments } = dependencies;
  const held = async (tx: Transaction, enrollmentId: string): Promise<boolean> =>
    (await store.assessmentOutcome(tx, enrollmentId)).kind === 'delivered';
  const nameIn = (names: ReadonlyMap<string, string>, userId: string) => ({
    displayName: names.get(userId) ?? '',
  });

  /** The queue's rows of a page: one per paused programme, or one per open item. */
  const rowsOf = async (
    tx: Transaction,
    filter: ProgrammesQueueInput['filter'],
    after: string | undefined,
    take: number,
  ): Promise<
    readonly {
      readonly cursor: string;
      readonly enrollmentId: string;
      readonly item?: ProgrammeRequestView;
    }[]
  > => {
    if (filter === 'paused') {
      return (await store.pausedPage(tx, after, take)).map(({ enrollmentId }) => ({
        cursor: enrollmentId,
        enrollmentId,
      }));
    }
    return (await store.openItemsPage(tx, filter, after, take)).map((item) => ({
      cursor: item.id,
      enrollmentId: item.enrollmentId,
      item,
    }));
  };

  return {
    queue: async (tx, { filter, cursor }) => {
      const pageSize = await dependencies.settings.read(LIST_PAGE_SIZE_SETTING, positiveWhole);
      const rows = await rowsOf(tx, filter, cursor, pageSize + 1);
      const page = rows.slice(0, pageSize);
      const programmes = await store.programmesAmong(tx, [
        ...new Set(page.map(({ enrollmentId }) => enrollmentId)),
      ]);
      const shown = page.flatMap((row) => {
        const programme = programmes.get(row.enrollmentId);
        return programme === undefined ? [] : [{ ...row, programme }];
      });
      const names = await store.namesOf(tx, [
        ...new Set(
          shown.flatMap(({ programme }) => [programme.studentUserId, programme.teacherUserId]),
        ),
      ]);
      // Bounded by the page: one read each where the item's kind needs it.
      const items: ProgrammesQueueOutput['items'] = [];
      for (const { programme, item } of shown) {
        const assessmentHeld =
          item?.kind === 'no_offer' ? await held(tx, programme.enrollmentId) : undefined;
        const payeeVerifiedNow =
          item?.kind === 'pay_blocked'
            ? !(await payments.payee.unverifiedInLiveMode(tx, programme.teacherUserId))
            : null;
        items.push({
          enrollmentId: programme.enrollmentId,
          teacher: nameIn(names, programme.teacherUserId),
          student: nameIn(names, programme.studentUserId),
          state: programme.state,
          pausedSince: isoOrNull(programme.pausedAt),
          request: item === undefined ? null : requestItemOf(item, assessmentHeld),
          payeeVerifiedNow,
        });
      }
      const last = page.at(-1);
      return rows.length > pageSize && last !== undefined
        ? { items, nextCursor: last.cursor }
        : { items };
    },

    get: async (tx, enrollmentId) => {
      const view = await store.viewOf(tx, enrollmentId);
      if (view === null) throw new DomainError('NOT_FOUND');
      const at = await store.clock(tx);
      const sessions = monthDue(view) ? await store.sessionsOf(tx, enrollmentId) : [];
      const requests = await store.requestsOf(tx, enrollmentId);
      const orders = await payments.ordersOf(tx, enrollmentId);
      const month = await payments.monthOrders(tx, enrollmentId, view.monthsPaid + 1, at);
      const assessmentHeld =
        requests.some(({ kind }) => kind === 'no_offer') || view.state === 'closed'
          ? await held(tx, enrollmentId)
          : undefined;
      const unreleased =
        view.state === 'closed' && !(await payments.assessmentReleased(tx, enrollmentId));
      const names = await store.namesOf(tx, [view.studentUserId, view.teacherUserId]);
      return {
        enrollmentId,
        teacher: nameIn(names, view.teacherUserId),
        student: nameIn(names, view.studentUserId),
        state: view.state,
        offerDueAt: isoOrNull(view.offerDueAt),
        payBy: isoOrNull(view.payByAt),
        offer: offerOf(view),
        plan: view.plan,
        monthsPaid: view.monthsPaid,
        monthCount: view.monthCount,
        nextDueAt: isoOrNull(monthDue(view) ? nextDueOf({ ...view, sessions }) : null),
        pausedAt: isoOrNull(view.pausedAt),
        closedAt: isoOrNull(view.closedAt),
        orders: orders.map(orderItemOf),
        requests: requests.map((item) => requestItemOf(item, assessmentHeld)),
        // Whether a card is saved, never a card detail (Q-9 (a), SC-707).
        cardSaved: month.cardSaved === true,
        ...(unreleased && assessmentHeld !== undefined ? { assessmentHeld } : {}),
      };
    },
  };
}
