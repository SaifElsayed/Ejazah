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
// `payment_expired` for an enrollment a release cancels for an expired payment (the re-hold's, or
// the refusal's). Each attempt runs with an after-commit list of its own (`withOutcomeNotices`), so a
// `'confirm'` attempt the database refuses drops its push with everything else it wrote, and the
// `'refuse'` attempt that follows sends only its own. A second run records no second outcome, so
// no second push.
import { z } from 'zod';

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
  openCompensationCase,
} from '../modules/moderation/index.js';
import {
  orderEnrollmentOf,
  orderStandingsOf,
  type PaidOrder,
  paidOrderOf,
} from '../modules/payments/index.js';
import {
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
  ): Promise<unknown>;
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
    const [order, cases] = await Promise.all([
      steps.paidOrderOf(tx, paymentId),
      steps.casesOf(tx, enrollmentId),
    ]);
    if (order.status !== 'paid' || covers(cases, order.paidRecordedAt)) return;
    if (enrollment.confirmingPaymentId === paymentId) return;
    const duplicate = enrollment.confirmed || enrollment.confirmingPaymentId !== null;
    if (duplicate || cases !== null) {
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
    await this.#confirm(tx, enrollment, paymentId);
  }

  /** FR-361 with the hold active, else FR-PAYG-19's late branch after the parties' check. */
  async #confirm(tx: Transaction, enrollment: LockedEnrollment, paymentId: string): Promise<void> {
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
