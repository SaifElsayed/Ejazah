// T039 (R-215, FR-361, FR-362, FR-375, FR-PAYG-19, SC-305; ARCHITECTURE §8.1, ADR 0010 D5):
// `confirm-enrollment({ paymentId })`, enqueued by the webhook on a persisted, signature-verified
// paid event under the job id `paymentId` (T038), and by T040's sweep. The only path to a confirmed
// enrollment (R-HONEST-1): booking's `confirmEnrollment`, the only writer of `confirmed_at`, is
// called from here and nowhere else.
//
// THE LOCKS FIRST (T005's rules; the notes under T039). The order's enrollment, and that
// enrollment's parties and slot, are read with no lock (none of them ever changes); then booking's
// `lockForConfirmation` takes, in the one order, both accounts, the slot, the holds, the
// enrollments and (through payments' `orderStandingsOf`) the orders, and reads the enrollment again
// under them. What is decided on below is read under those locks. R-215's "it locks the enrollment
// row" is kept as the enrollment's place in that order: locking it before the slot and the holds
// would break the order FR-PAYG-19's re-hold needs.
//
// THE DECISION, in R-215's order, in one transaction:
//   1. an order that is not `paid` (a `refunded` one), or that a compensation case covers, is
//      ignored: a case covers every order of its enrollment whose paid event was recorded before the
//      case was opened, while it is open, or before it was closed (`resolved_at`), all three the
//      database's instants, over every case of the enrollment (`case-cover.ts`, T082; the note under
//      T035: `disputes` has no payment column, so the covered order is read from the instants and
//      recorded nowhere new). An order paid while a case is open joins that case: no new one;
//   2. an enrollment confirmed by another order (its `confirmed` event names another, or it is
//      confirmed with none) gets one `duplicate_payment` case, joined while open, and nothing else
//      (FR-375); a replay of the confirming order does nothing;
//   3. an enrollment with compensation cases, all closed before this order was paid (1 found none
//      covering it), gets one new `duplicate_payment` case, as 2, and nothing else (FR-PAYG-19 as
//      amended 2026-11-04, the owner's decision); the case, open, covers the order from then on;
//   4. an enrollment R-219 cancelled takes the refusal at once, its reason kept, `party_restricted`;
//   5. its hold active: converted, confirmed, its sessions generated (FR-361), no party checked;
//   6. its hold released (a late payment): the parties checked with no new rule, through identity's
//      `isBookablePair` (`party_restricted` when false); then the times open remedies reserve for
//      either party read, under the accounts' locks already held, over the sessions generation would
//      write (T027 of specs/004-sessions, FR-466, H3; the note under T027, Q2 (a)): the database's
//      exclusions see no reservation, so a session over one takes the refusal (`slot_unavailable`),
//      with one info line of ids and a reason; then FR-PAYG-19's re-hold, confirmed and generated.
//      Branch 5 reads none: no reservation is made over an open hold (F5, H2).
// A refusal (4, 6) releases what the enrollment holds, cancels it with one `cancelled` row, and
// opens one case through moderation's entry (FR-362).
//
// THE DATABASE'S REFUSAL. In 5 and 6, a second active hold (another student's on the slot, the
// student's own on another) or a session overlapping the teacher's or the student's (exactly T006's
// four names) fails the transaction, which keeps nothing; Prisma gives no savepoint, so a new
// transaction takes the same locks again, decides again from 1, and refuses with `slot_unavailable`
// where 5 or 6 would have confirmed (the note under T039, PR #118's review). Any other error is
// rethrown, and the queue's retries try again.
//
// IDEMPOTENT (R-API-14). A second run meets the first's outcome under the same locks: a confirmed
// enrollment naming this order (2), or the case the refusal, 2 or 3 opened, which covers it (1).
//
// THE PUSHES (005:T016 of specs/005-certification; the note under T016, Q-N1 (a), Q-N3 (a)).
// Booking records each outcome's push through the notice port `worker.ts` binds (`notices`), with
// the outcome, on the attempt's transaction: `payment_confirmed` with the confirmation, and
// `payment_expired` for another student's enrollment the re-hold's release cancels for an expired
// payment; a refusal's own record pushes nothing (Q-A1 (b), the owner's answer of 2026-11-18). Each
// attempt runs with an after-commit list of its own (`withOutcomeNotices`), so a `'confirm'` attempt
// the database refuses drops its push with everything else it wrote. A second run records no second
// outcome, so no second push.
//
// THE ASSESSMENT (006:T005 of specs/006-programme; FR-701, R-504). The order's kind is read with
// its status, under the same locks (payments' `orderTermsOf`). An `assessment` is confirmed as a
// package is, branch 5 or 6 alike, and then generates session 1 only, at the assessment's length
// (the snapshot holds count 1 and that length; the plan is named, since the snapshot grows at the
// offer), and writes its programme `awaiting_offer` through booking's entry, on the same transaction;
// a second run meets the confirmed enrollment (2) and writes no second row. A refused assessment
// writes no programme.
//
// BY KIND (006:T006 of specs/006-programme; FR-718, R-502, V-3; kernel.md, the confirm step's row).
// Every order of a programme's kind (`assessment`, `rest_in_full`, `instalment`) carries its own marker,
// `payments.confirmed_at`, written through payments' entry on the transaction that settles it, whatever
// the outcome: a replay finds it and does nothing. A `package` order is unchanged and writes none (the
// enrollment's `confirmed` event names it). An expected order skips 1 and 3's cover and case gates:
// an `assessment` on an enrollment awaiting payment; a `rest_in_full`, or the next `instalment` (the
// month after the highest processed one), on a confirmed programme `offered`, `active` or `paused`.
// Those two take the path with NO HOLD, under the locks above (the programme's among them):
//   - an order for a month already paid (or a month or the rest after the rest), or one on a
//     programme not awaiting it, is FR-PAYG-19's unexpected payment: one `duplicate_payment` case
//     (FR-718), the enrollment unchanged;
//   - while a `teacher_suspended` or `student_suspended` case is open (a suspension pauses), one
//     `party_restricted` case instead of the sessions, and one log line of ids and a reason;
//   - otherwise generation only: the month's sessions (4, the last month the remainder; the rest in
//     full all N), numbered from the highest + 1, each with its `programme_month`, from the first weekly
//     occurrence at least the lead after the payment and after the last session (R-507);
//   - a generation the database refuses never cancels the programme: the order stays paid, one
//     `slot_unavailable` case, one log line `{ enrollmentId, paymentId, reason }`.
// A month's case and its marker are written in the same transaction, so a replay opens no second.
import { z } from 'zod';

import { addHours } from '@ijazah/time';

import { isExclusionViolation, isUniqueViolation } from '../platform/db/db-errors.js';
import type { Database, Transaction } from '../platform/db/prisma.repository.js';
import type { Logger } from '../platform/logging/logger.js';
import type { SettingsReader } from '../platform/settings/settings-reader.js';
import * as booking from '../modules/booking/index.js';
import type {
  Confirmation,
  EnrollmentParties,
  EnrollmentToHold,
  HoldTerms,
  LockedEnrollment,
  PaymentOutcomeNotices,
  Refusal,
} from '../modules/booking/index.js';
import { readSlot } from '../modules/catalog/index.js';
import { isBookablePair } from '../modules/identity/index.js';
import {
  type CaseInstants,
  caseInstantsOf,
  type CompensationReason,
  openCaseOf,
  openCompensationCase,
} from '../modules/moderation/index.js';
import {
  markOrderConfirmed,
  orderEnrollmentOf,
  orderStandingsOf,
  type OrderTerms,
  orderTermsOf,
  type PaidOrder,
  paidOrderOf,
  type ProcessedProgrammeOrder,
  processedProgrammeOrdersOf,
} from '../modules/payments/index.js';
import {
  enrollmentSessionsOf,
  type EnrollmentToSchedule,
  generateForEnrollment,
  type ReservationReads,
  type ReservedTime,
  reservedTimesOf,
  sessionsFor,
} from '../modules/sessions/index.js';
import { covers } from './case-cover.js';
import { defineJob, type Job } from './job.js';

/** The job's name, the one `main.ts` enqueues it by (T038). */
export const CONFIRM_ENROLLMENT = 'confirm-enrollment';

/** The slot's weekday and local start, as catalog reads it. */
export type SlotTime = EnrollmentToSchedule['slot'];

/**
 * What the job asks of the modules, each through its public entry and on the job's transaction
 * (R-API-6). `confirmationStepsOf` binds them; a spec hands in its own.
 */
export interface ConfirmationSteps {
  orderEnrollmentOf(tx: Transaction, paymentId: string): Promise<string | null>;
  partiesOf(tx: Transaction, enrollmentId: string): Promise<EnrollmentParties | null>;
  lock(tx: Transaction, parties: EnrollmentParties): Promise<LockedEnrollment>;
  paidOrderOf(tx: Transaction, paymentId: string): Promise<PaidOrder>;
  /** 006:T005: the order's kind, month and marker, read under the locks with its status. */
  orderTermsOf(tx: Transaction, paymentId: string): Promise<OrderTerms>;
  /** 006:T005: the confirmed assessment's programme, `awaiting_offer` (booking's entry). */
  startProgramme(tx: Transaction, enrollmentId: string): Promise<void>;
  /** 006:T006: the per-order marker (payments' entry), under the order's lock. */
  markConfirmed(tx: Transaction, paymentId: string, at: Date): Promise<void>;
  /** 006:T006: the months and the rest already processed (payments' entry). */
  programmeOrdersOf(
    tx: Transaction,
    enrollmentId: string,
  ): Promise<readonly ProcessedProgrammeOrder[]>;
  /** 006:T006: the enrollment's open case of a reason, or null (moderation's entry). */
  openCaseOf(tx: Transaction, enrollmentId: string, reason: string): Promise<string | null>;
  /** 006:T006: the enrollment's sessions' numbers and ends (sessions' entry). */
  sessionsOf(
    tx: Transaction,
    enrollmentId: string,
  ): Promise<readonly { readonly sequenceNumber: number; readonly endsAt: Date }[]>;
  casesOf(tx: Transaction, enrollmentId: string): Promise<CaseInstants | null>;
  openCase(tx: Transaction, enrollmentId: string, reason: CompensationReason): Promise<unknown>;
  confirm(tx: Transaction, confirmation: Confirmation): Promise<'confirmed' | 'no_active_hold'>;
  bookablePair(tx: Transaction, studentUserId: string, teacherUserId: string): Promise<boolean>;
  rehold(tx: Transaction, enrollment: EnrollmentToHold, terms: HoldTerms): Promise<unknown>;
  refuse(
    tx: Transaction,
    enrollment: LockedEnrollment,
    refusal: Refusal,
    at: Date,
  ): Promise<unknown>;
  slotOf(tx: Transaction, slotId: string): Promise<SlotTime | null>;
  /** Sessions' reserved times of `userIds` overlapping `window` (T027). */
  reservedTimesOf(
    tx: Transaction,
    userIds: readonly string[],
    window: { readonly from: Date; readonly to: Date },
    reads: ReservationReads,
  ): Promise<readonly ReservedTime[]>;
  generate(
    tx: Transaction,
    enrollment: EnrollmentToSchedule,
    confirmedAt: Date,
    leadHours: number,
    plan?: GenerationPlan,
  ): Promise<unknown>;
}

/** Sessions' generation plan: a count and the first sequence number (T061). */
type GenerationPlan = NonNullable<Parameters<typeof generateForEnrollment>[4]>;

/** 006:T005 (R-504): the assessment's one session, numbered 1. */
const ASSESSMENT_PLAN: GenerationPlan = { count: 1, firstSequenceNumber: 1 };

/**
 * 006:T006 (R-507; DEC-93): a month holds 4 of the offer's sessions, the last month the remainder.
 * A definition of the programme, not an operational number (analyze K-2).
 */
const SESSIONS_PER_MONTH = 4;

/** The programme states a month's or the rest's payment is awaited in (R-502). */
const PAYABLE_STATES: ReadonlySet<LockedEnrollment['programmeState']> = new Set([
  'offered',
  'active',
  'paused',
]);

/** The suspensions that pause a programme: a month paid during one opens a case (PR #153 r1 Minor 2). */
const SUSPENSION_REASONS = ['teacher_suspended', 'student_suspended'] as const;

/** Why a paid programme order generated nothing, as its one log line names it. */
type UngeneratedReason = 'party_suspended' | 'generation_refused';

/** Each offer session's month, the k-th (from 1) in month ⌈k ÷ 4⌉ (R-507). */
function monthOfOfferSession(position: number): number {
  return Math.ceil(position / SESSIONS_PER_MONTH);
}

/**
 * Where the processed orders leave the programme, walked in the order they were processed: the
 * next month awaited and whether the rest was paid in full. Only the awaited order moves it (the
 * rest before any month, or the next month); a duplicate already processed never does (PR #156 r1
 * Major 1: month 1 twice, then month 2, generates month 2).
 */
function awaitedAfter(processed: readonly ProcessedProgrammeOrder[]): {
  readonly next: number;
  readonly inFull: boolean;
} {
  let next = 1;
  let inFull = false;
  for (const { kind, instalmentMonth } of processed) {
    if (inFull) break;
    if (kind === 'rest_in_full') inFull = next === 1;
    else if (instalmentMonth === next) next += 1;
  }
  return { next, inFull };
}

/**
 * The sessions an expected month or rest generates, by their months; null when the order is not
 * the one awaited (a paid month, a month after the rest, the rest after any month, a month past the
 * last): FR-718's duplicate.
 */
function monthsToGenerate(
  terms: OrderTerms,
  offerSessions: number,
  processed: readonly ProcessedProgrammeOrder[],
): readonly number[] | null {
  const { next, inFull } = awaitedAfter(processed);
  if (inFull) return null;
  const all = Array.from({ length: offerSessions }, (_, index) => monthOfOfferSession(index + 1));
  if (terms.kind === 'rest_in_full') return next === 1 ? all : null;
  const month = terms.instalmentMonth;
  if (month === null || month !== next) return null;
  const sessions = all.filter((one) => one === month);
  return sessions.length === 0 ? null : sessions;
}

/**
 * The steps over the modules' entries, the orders' locks and standing being payments'; 005:T016:
 * booking's writes hand their pushes to `notices`.
 */
export function confirmationStepsOf(notices: PaymentOutcomeNotices): ConfirmationSteps {
  return {
    orderEnrollmentOf,
    partiesOf: booking.confirmationPartiesOf,
    lock: (tx, parties) => booking.lockForConfirmation(tx, parties, { orders: orderStandingsOf }),
    paidOrderOf,
    orderTermsOf,
    startProgramme: booking.startProgramme,
    markConfirmed: markOrderConfirmed,
    programmeOrdersOf: processedProgrammeOrdersOf,
    openCaseOf,
    sessionsOf: enrollmentSessionsOf,
    casesOf: caseInstantsOf,
    openCase: openCompensationCase,
    confirm: (tx, confirmation) => booking.confirmEnrollment(tx, confirmation, notices),
    bookablePair: isBookablePair,
    rehold: (tx, enrollment, terms) =>
      booking.reholdEnrollment(tx, enrollment, { terms, orders: orderStandingsOf, notices }),
    refuse: (tx, enrollment, refusal, at) =>
      booking.refuseEnrollment(tx, enrollment, refusal, { at, orders: orderStandingsOf, notices }),
    slotOf: readSlot,
    reservedTimesOf,
    generate: generateForEnrollment,
  };
}

export interface ConfirmEnrollmentOptions {
  readonly database: Pick<Database, '$transaction'>;
  /** The hold's terms and `first_session_lead_hours`, read before the transaction (R-MONEY-12). */
  readonly settings: SettingsReader;
  /**
   * 005:T016: the payment pushes' port (`NotificationWriter`, bound by `worker.ts`), through which
   * booking records each outcome's push.
   */
  readonly notices: PaymentOutcomeNotices;
  readonly steps?: ConfirmationSteps;
  /** The clock; the system clock unless a spec sets one. */
  readonly clock?: () => Date;
  /** The enrollments' terms a reservation is resolved with; booking's `EnrollmentSide` by default. */
  readonly enrollments?: ReservationReads;
  /** Where the late branch's refusal over a reservation is logged (ids and a reason only). */
  readonly log?: Pick<Logger, 'info'>;
}

/** What one transaction does once the locks are taken: confirm where it can, or only refuse. */
type Attempt = 'confirm' | 'refuse';

/** Whether `error` is one of the database's four refusals T006 names (R-215). */
function refusedByDatabase(error: unknown): boolean {
  return (
    isUniqueViolation(error, 'slot_holds_slot_id_active_key') ||
    isUniqueViolation(error, 'slot_holds_student_user_id_active_key') ||
    isExclusionViolation(error, 'sessions_teacher_no_overlap') ||
    isExclusionViolation(error, 'sessions_student_no_overlap')
  );
}

/** Whether one of `sessions` overlaps one of `reserved`; each range holds its start, not its end. */
function overlapsReserved(
  sessions: readonly { readonly scheduledStartAt: string; readonly scheduledEndAt: string }[],
  reserved: readonly ReservedTime[],
): boolean {
  return sessions.some(({ scheduledStartAt, scheduledEndAt }) => {
    const start = Date.parse(scheduledStartAt);
    const end = Date.parse(scheduledEndAt);
    return reserved.some(
      ({ startsAt, endsAt }) => start < endsAt.getTime() && startsAt.getTime() < end,
    );
  });
}

class Confirmer {
  readonly #steps: ConfirmationSteps;
  readonly #terms: HoldTerms;
  readonly #reads: ReservationReads;
  readonly #log: Pick<Logger, 'info'> | undefined;

  constructor(
    steps: ConfirmationSteps,
    terms: HoldTerms,
    reads: ReservationReads,
    log: Pick<Logger, 'info'> | undefined,
  ) {
    this.#steps = steps;
    this.#terms = terms;
    this.#reads = reads;
    this.#log = log;
  }

  /** One transaction of the job: the locks, then the decision (this file's head). */
  async settle(tx: Transaction, paymentId: string, attempt: Attempt): Promise<void> {
    const steps = this.#steps;
    const enrollmentId = await steps.orderEnrollmentOf(tx, paymentId);
    if (enrollmentId === null) throw new Error(`No order has the id ${paymentId}`);
    const parties = await steps.partiesOf(tx, enrollmentId);
    if (parties === null) throw new Error(`No live enrollment has the id ${enrollmentId}`);
    const enrollment = await steps.lock(tx, parties);
    const [order, cases, terms] = await Promise.all([
      steps.paidOrderOf(tx, paymentId),
      steps.casesOf(tx, enrollmentId),
      steps.orderTermsOf(tx, paymentId),
    ]);
    if (order.status !== 'paid') return;
    // 006:T006: an order of a programme's kind carries its own marker (this file's head).
    if (terms.kind !== 'package' && terms.confirmedAt !== null) return;
    if (terms.kind === 'rest_in_full' || terms.kind === 'instalment') {
      await this.#month(tx, enrollment, paymentId, terms, attempt);
      return;
    }
    await this.#hold(tx, enrollment, paymentId, terms, attempt, { cases, order });
    if (terms.kind === 'assessment') await steps.markConfirmed(tx, paymentId, this.#terms.now);
  }

  /** The hold path (R-215's decision): a `package` order as before, an `assessment` alike. */
  async #hold(
    tx: Transaction,
    enrollment: LockedEnrollment,
    paymentId: string,
    terms: OrderTerms,
    attempt: Attempt,
    { cases, order }: { readonly cases: CaseInstants | null; readonly order: PaidOrder },
  ): Promise<void> {
    const steps = this.#steps;
    const enrollmentId = enrollment.id;
    // 006:T006: an assessment awaited on its enrollment skips the cover and case gates (R-502).
    const expected = terms.kind === 'assessment' && enrollment.status === 'pending_payment';
    if (!expected && covers(cases, order.paidRecordedAt)) return;
    if (enrollment.confirmingPaymentId === paymentId) return;
    const duplicate = enrollment.confirmed || enrollment.confirmingPaymentId !== null;
    if (duplicate || (!expected && cases !== null)) {
      await steps.openCase(tx, enrollmentId, 'duplicate_payment');
      return;
    }
    if (enrollment.cancelledByTermination) {
      await this.#refuse(tx, enrollment, 'party_restricted');
      return;
    }
    if (attempt === 'refuse') {
      await this.#refuse(tx, enrollment, 'slot_unavailable');
      return;
    }
    await this.#confirm(tx, enrollment, paymentId, terms);
  }

  /**
   * 006:T006: a month's or the rest's order, the path with no hold (this file's head); the marker
   * written with whatever it settles.
   */
  async #month(
    tx: Transaction,
    enrollment: LockedEnrollment,
    paymentId: string,
    terms: OrderTerms,
    attempt: Attempt,
  ): Promise<void> {
    const steps = this.#steps;
    const at = this.#terms.now;
    const done = () => steps.markConfirmed(tx, paymentId, at);
    const processed = await steps.programmeOrdersOf(tx, enrollment.id);
    const months = monthsToGenerate(terms, enrollment.snapshotSessionCount - 1, processed);
    const awaited =
      enrollment.status === 'confirmed' && PAYABLE_STATES.has(enrollment.programmeState);
    if (!awaited || months === null) {
      await steps.openCase(tx, enrollment.id, 'duplicate_payment');
      await done();
      return;
    }
    // One query at a time on the one transaction (PR #156 r1 nit: pg's «already executing» warning).
    let suspended = false;
    for (const reason of SUSPENSION_REASONS) {
      suspended = (await steps.openCaseOf(tx, enrollment.id, reason)) !== null;
      if (suspended) break;
    }
    if (suspended) {
      await this.#ungenerated(tx, enrollment.id, paymentId, 'party_restricted', 'party_suspended');
      await done();
      return;
    }
    if (attempt === 'refuse') {
      await this.#ungenerated(
        tx,
        enrollment.id,
        paymentId,
        'slot_unavailable',
        'generation_refused',
      );
      await done();
      return;
    }
    const slot = await steps.slotOf(tx, enrollment.slotId);
    if (slot === null) throw new Error(`No slot has the id ${enrollment.slotId}`);
    const sessions = await steps.sessionsOf(tx, enrollment.id);
    const highest = Math.max(0, ...sessions.map(({ sequenceNumber }) => sequenceNumber));
    const lastEnd = Math.max(0, ...sessions.map(({ endsAt }) => endsAt.getTime()));
    // The first weekly occurrence at least the lead after the payment and after the last session.
    const leadEnd = new Date(addHours(at, this.#terms.leadHours)).getTime();
    const [from, leadHours] =
      lastEnd > leadEnd ? [new Date(lastEnd), 0] : [at, this.#terms.leadHours];
    await steps.generate(tx, scheduleOf(enrollment, slot), from, leadHours, {
      count: months.length,
      firstSequenceNumber: highest + 1,
      months,
    });
    await done();
  }

  /** A paid programme order that generated nothing: its case and one log line (ids and a reason). */
  async #ungenerated(
    tx: Transaction,
    enrollmentId: string,
    paymentId: string,
    caseReason: CompensationReason,
    reason: UngeneratedReason,
  ): Promise<void> {
    await this.#steps.openCase(tx, enrollmentId, caseReason);
    this.#log?.info(
      { enrollmentId, paymentId, reason },
      'A paid programme order was not generated',
    );
  }

  /** FR-361 with the hold active, else FR-PAYG-19's late branch after the parties' check. */
  async #confirm(
    tx: Transaction,
    enrollment: LockedEnrollment,
    paymentId: string,
    terms: OrderTerms,
  ): Promise<void> {
    const steps = this.#steps;
    const at = this.#terms.now;
    const confirmation = { enrollmentId: enrollment.id, paymentId, at };
    const slot = await steps.slotOf(tx, enrollment.slotId);
    if (slot === null) throw new Error(`No slot has the id ${enrollment.slotId}`);
    const schedule = scheduleOf(enrollment, slot);
    if ((await steps.confirm(tx, confirmation)) === 'no_active_hold') {
      const { studentUserId, teacherUserId } = enrollment;
      if (!(await steps.bookablePair(tx, studentUserId, teacherUserId))) {
        await this.#refuse(tx, enrollment, 'party_restricted');
        return;
      }
      if (await this.#overReservation(tx, schedule)) {
        await this.#refuse(tx, enrollment, 'slot_unavailable');
        this.#log?.info(
          { enrollmentId: enrollment.id, paymentId, reason: 'reservation_overlap' },
          'Late payment refused: a session would overlap a reserved time',
        );
        return;
      }
      const { id, slotId } = enrollment;
      await steps.rehold(tx, { id, slotId, studentUserId }, this.#terms);
      if ((await steps.confirm(tx, confirmation)) === 'no_active_hold') {
        throw new Error(`Enrollment ${enrollment.id} has no hold after its re-hold`);
      }
    }
    if (terms.kind === 'assessment') {
      await steps.generate(tx, schedule, at, this.#terms.leadHours, ASSESSMENT_PLAN);
      await steps.startProgramme(tx, enrollment.id);
      return;
    }
    await steps.generate(tx, schedule, at, this.#terms.leadHours);
  }

  /** Whether a session generation would write overlaps a time reserved for either party (T027). */
  async #overReservation(tx: Transaction, schedule: EnrollmentToSchedule): Promise<boolean> {
    const sessions = sessionsFor(schedule, this.#terms.now, this.#terms.leadHours);
    const first = sessions.at(0);
    const last = sessions.at(-1);
    if (first === undefined || last === undefined) return false;
    const reserved = await this.#steps.reservedTimesOf(
      tx,
      [schedule.studentUserId, schedule.teacherUserId],
      { from: new Date(first.scheduledStartAt), to: new Date(last.scheduledEndAt) },
      this.#reads,
    );
    return overlapsReserved(sessions, reserved);
  }

  /** FR-362's refusal: booking's release and cancellation, then one case of `refusal`. */
  async #refuse(tx: Transaction, enrollment: LockedEnrollment, refusal: Refusal): Promise<void> {
    await this.#steps.refuse(tx, enrollment, refusal, this.#terms.now);
    await this.#steps.openCase(tx, enrollment.id, refusal);
  }
}

/** The enrollment as generation reads it: its accounts, its snapshot and its slot's day and start. */
function scheduleOf(enrollment: LockedEnrollment, slot: SlotTime): EnrollmentToSchedule {
  return {
    id: enrollment.id,
    teacherUserId: enrollment.teacherUserId,
    studentUserId: enrollment.studentUserId,
    snapshotSessionCount: enrollment.snapshotSessionCount,
    snapshotDurationMinutes: enrollment.snapshotDurationMinutes,
    snapshotSlotTimezone: enrollment.snapshotSlotTimezone,
    slot: { dayOfWeek: slot.dayOfWeek, startTimeLocal: slot.startTimeLocal },
  };
}

export function confirmEnrollment({
  database,
  settings,
  notices,
  steps = confirmationStepsOf(notices),
  clock = () => new Date(),
  enrollments = booking.createEnrollmentSide({ settings }),
  log,
}: ConfirmEnrollmentOptions): Job {
  return defineJob({
    name: CONFIRM_ENROLLMENT,
    payload: z.object({ paymentId: z.uuid() }),
    run: async ({ paymentId }) => {
      const terms = await booking.readHoldTerms(settings, clock());
      const confirmer = new Confirmer(steps, terms, enrollments, log);
      // 005:T016: each attempt with an after-commit list of its own (this file's head).
      const settle = (attempt: Attempt) =>
        booking.withOutcomeNotices(
          (work) => database.$transaction(work),
          (tx) => confirmer.settle(tx, paymentId, attempt),
        );
      try {
        await settle('confirm');
      } catch (error) {
        if (!refusedByDatabase(error)) throw error;
        await settle('refuse');
      }
    },
  });
}
