// T036 (ARCHITECTURE §8.1 step for step; FR-BOOK-12, FR-351 to FR-357, R-208, M3) and T037 (FR-380 to
// FR-386, FR-BOOK-12 (c), data-model §2.4.1): the student's checkout, orchestrated by `payments`,
// which owns the orders and calls the gateway; every write to `slot_holds` and `enrollments` is a
// function of booking's entry on this module's transaction (R-208).
//
// KEYED IN TWO STEPS (the owner's decision of 2026-11-03). `IdempotencyService.run` claims the key,
// runs the effect and stores the outcome in one transaction, while the gateway is called outside any
// transaction. So `hold`, `pay` and `retry` first read the key (`completed`): a completed key answers
// its stored outcome and calls no gateway. Otherwise the gateway is called, then `run` records the
// order; when a duplicate with the same key committed first, `run` answers its outcome without
// running the effect here, and the order this call created is cancelled at the gateway. The stored
// outcome holds no address: a repeat reads it again from `payments.checkout_url_encrypted`, under
// `checkout.continue`'s conditions (the order `created` and before its `expires_at`), which settles
// R-DB-8 for the stored answer (the note under T036 of B28's T031). T175 (R1a): `hold`'s stored
// outcome holds no teacher's name either; either replay (the key read first, or `run`'s duplicate)
// reads it again through booking's `checkoutTeacherName`, the visibility predicate, and a teacher the
// student may no longer see answers `NOT_FOUND`.
//
// A NEW CHECKOUT (`hold`, FR-BOOK-12). Booking's `placeCheckoutHold` releases the student's own
// unexpired hold and places the new one in one transaction, or throws `PayableCheckout` when an
// order on the own hold is still payable: the transaction kept nothing, and the gateway is asked
// here, outside any transaction, to cancel that order. `cancelled` (also an order the gateway
// already ended) records the order failed, with its `order_failed` outcome, and the checkout starts
// again; `paid` and `in_progress` write nothing and refuse `PREVIOUS_CHECKOUT` as processing;
// `unsupported` refuses it as payable with the order's expiry (FR-BOOK-12 (b), (c)).
//
// A NEW ORDER (`retry`, FR-356). The enrollment and its hold are read before the gateway: another
// student's enrollment answers `NOT_FOUND` and an order that can no longer be created
// `ORDER_NOT_PAYABLE`, neither calling the gateway. The order is created no later than the hold's
// expiry minus the grace (FR-355), then recorded only in a transaction that locks the hold and the
// enrollment and finds them still as they were (booking's `lockOrderTarget`); otherwise the order is
// cancelled at the gateway where it allows, and the refusal answered. The address is encrypted to
// the order's row (R-DB-8), so the order's id is drawn before the row is written, and handed to the
// student only after the commit.
//
// WHAT THE STUDENT READS (T037; FR-BOOK-12 (c), FR-380 to FR-386, data-model §2.4.1). `current` is
// the student's own unexpired hold with its package's summary now, the first and last session it
// would get if confirmed now (booking's previews with `first_session_lead_hours`, FR-386, T085) and,
// after Pay, its last order and whether it can still be continued (`created`, before its
// `expires_at`); it decrypts nothing.
// `continue` answers `NOT_FOUND` unless the enrollment is the student's, and decrypts the last
// order's address only while that order is `created` and before its `expires_at`
// (`ORDER_NOT_PAYABLE` otherwise, nothing decrypted). `status` answers `NOT_FOUND` unless the
// enrollment is the student's, and its last order with the gateway's reference; `confirmed` comes
// only from the row (R-HONEST-1). The address is never logged: the logger's list redacts
// `checkoutUrl` (T037). 006:T009 (the owner's Q-C2 (a), R-509): `current` also answers the
// student's programme order still payable (`programmeOrder`), which has no hold; `continue` with its
// enrollment hands its page back as for any order.
//
// THE FIRST PAYMENT (`programme.pay`, 006:T009; FR-710 to FR-713, R-507, R-509, R-511). Keyed as Pay
// is, with no hold. Booking's `checkedProgrammePay` runs before the gateway and again in the
// recording transaction (the student's account, the own hold, the programme, the enrollments, then
// their orders): NOT_FOUND for another student, `not_offered`, `pay_by_passed`, `party_suspended`,
// and FR-BOOK-12's `PREVIOUS_CHECKOUT` while another checkout of the student, or an order of the
// programme itself, is still payable. The amount is `packages/money`'s (`firstPaymentOf`): in full
// the offer's total less the assessment's fee as paid (`rest_not_positive` when nothing is left),
// by months month 1 (4 × the session price, the whole offer below 4 sessions). The rate and the 25 %
// are copied from the assessment order (R-511); the order expires at the checkout's TTL or at
// `pay_by_at`, whichever is first; a ticked «save my card» is kept as `card_consent_at` (Q-4 (a)).
//
// A CANCELLATION THE GATEWAY FAILS is reported (T111) and never hides the answer it followed: the
// order it left is the one FR-375's `duplicate_payment` case covers if it is ever paid.
//
// THE PUSHES (005:T016 of specs/005-certification; the note under T016, Q-N1 (a), Q-N3 (a)). One
// transaction here records a payment outcome that is pushed: `hold`'s, whose placement releases the
// expired holds on the slot and of the student (FR-351) and so can cancel an enrollment for an
// expired payment. It runs with an after-commit list of its own (booking's `withOutcomeNotices`),
// and booking's writer records the push with the outcome through the notice port `main.ts` binds
// (`notices`). The gateway's cancellation of an earlier order, recorded as a failed order
// (`recordCancelled`), pushes nothing (#148 Saif r1, Major 2): the platform cancelled it, and the
// placement then releases its hold as `checkout_abandoned`, so nothing is left to Retry. It records
// `order_failed` with `'without_push'`, so it binds no list and takes no lock on the student: no
// write of its transaction references the account.
import type {
  CheckoutHandover,
  CheckoutHoldInput,
  CheckoutHoldOutput,
  CheckoutContinueInput,
  CheckoutCurrentOutput,
  CheckoutPayInput,
  CheckoutPayOutput,
  CheckoutRetryInput,
  CheckoutStatusInput,
  CheckoutStatusOutput,
  ProgrammeCheckoutOutput,
  ProgrammePayInput,
} from '@ijazah/contracts';
import { teacherSharePercent } from '@ijazah/contracts';
import {
  type Piasters,
  perSession,
  piasters,
  programmeOfferAmounts,
  SESSIONS_PER_PROGRAMME_MONTH,
  shareLeft,
  teacherShare,
  toPlainNumber,
} from '@ijazah/money';
import { addMinutes } from '@ijazah/time';

import type { ColumnCipher } from '../../platform/crypto/encryption.js';
import type { Database, Transaction } from '../../platform/db/prisma.repository.js';
import { drawRowId } from '../../platform/db/row-id.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import { reportError } from '../../platform/errors/reporting.js';
import type { RequesterGender } from '../../platform/guards/requester-gender.js';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import type { PaymentPort } from '../../platform/ports/payment/payment.port.js';
import { ijazahHalfReleasePercent } from '../../platform/settings/registry.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import {
  type CheckoutEnrollmentRow,
  type CheckoutHold,
  type CheckoutOrdersAmong,
  activeProgrammeEnrollmentsOf,
  checkedProgrammePay,
  type ProgrammeLog,
  type ProgrammePayTarget,
  checkoutTeacherName,
  closedProgramme,
  type CurrentHold,
  currentHoldOf,
  type EnrollmentStatusAnswer,
  enrollmentStatusOf,
  type Enrolment,
  enrollOnHold,
  type PayTarget,
  payStoreOver,
  payTargetOf,
  type QuotedSummary,
  type HeldOrdersOf,
  type HoldTerms,
  lockOrderTarget,
  type OrderStandings,
  PayableCheckout,
  type PayableProgrammeOrderOf,
  payByOf,
  placeCheckoutHold,
  previousCheckout,
  type PaymentOutcomeNotices,
  payTermsOf,
  readHoldTerms,
  recordOrderFailed,
  type RetryTarget,
  retryTargetOf,
  studentCheckoutEnrollment,
  withOutcomeNotices,
} from '../booking/index.js';
import { payoutRecipientOf } from '../identity/index.js';
import {
  type AddressedOrder,
  type AssessmentOrder,
  assessmentOrderOf,
  checkoutOrdersAmong,
  heldOrdersOf,
  insertOrder,
  lastOrderOf,
  type NewOrder,
  orderById,
  payableProgrammeOrderAmong,
  type PaymentGateway,
} from './checkout.repository.js';
import { orderStandingsOf } from './order-standing.repository.js';
import { lockOrder, PaymentsRepository } from './payments.repository.js';

/**
 * 006:T009 (FR-711, DEC-93; K-5): the first payment's amount, `packages/money`'s. In full: the
 * offer's total less the assessment's fee as paid, null when nothing is left (`rest_not_positive`,
 * U-6). By months: month 1, 4 × the session price, or the whole offer when it has fewer than 4
 * sessions (the remainder rule). 10,000 EGP over 40 sessions with a 500 fee: 9,500, or 1,000.
 */
function firstPaymentOf(
  plan: ProgrammePayInput['plan'],
  target: Pick<ProgrammePayTarget, 'offerSessionCount' | 'total_piasters'>,
  fee_piasters: Piasters,
): Piasters | null {
  if (plan === 'in_full') {
    const rest_piasters = shareLeft(target.total_piasters, [], fee_piasters);
    return toPlainNumber(rest_piasters) === 0 ? null : rest_piasters;
  }
  const sessionPrice_piasters = perSession(target.total_piasters, target.offerSessionCount);
  const sessions = Math.min(SESSIONS_PER_PROGRAMME_MONTH, target.offerSessionCount);
  return programmeOfferAmounts(sessionPrice_piasters, sessions).total_piasters;
}

/** The column the hosted checkout's address is encrypted under, bound to the order's id (R-DB-8). */
export const CHECKOUT_URL_COLUMN = 'payments.checkout_url_encrypted';

/** The currency of every order: piasters are the Egyptian pound's hundredths (R-MONEY-1). */
export const ORDER_CURRENCY = 'EGP';

/**
 * T104 (ADR 0025 D1, SRS DEC-80, §3.14): the teacher's share of each gateway order, whole percent,
 * an administrator's setting (seed default 70). Read when an order is created and kept on it, so a
 * change reaches new orders only; a value outside 0 to 100 fails closed before the gateway.
 */
export const TEACHER_SHARE_SETTING = 'teacher_share_percent';

/**
 * 003:T105 (ADR 0025 D2, D6, SRS DEC-81, §3.14; Q-4 (a)): the percent of the teacher's share released
 * at half the sessions on the ijazah track (seed default 25). Read when an `ijazah_track` order is
 * created and kept on it; a value outside 0 to 100 fails closed before the gateway.
 */
export const IJAZAH_HALF_RELEASE_SETTING = 'ijazah_half_release_percent';

/** The student asking, from the session, never from input (R-GENDER-4). */
export interface CheckoutStudent {
  readonly userId: string;
  readonly gender: RequesterGender;
}

/** A keyed request of the checkout (`packages/contracts`' `idempotent-procedures.ts`). */
interface KeyedRequest {
  readonly scope: 'checkout.hold' | 'checkout.pay' | 'checkout.retry' | 'programme.pay';
  readonly key: string;
  readonly actorId: string;
  readonly input: { readonly [key: string]: string | number };
}

/** What `run` stores for an order: no address (the owner's decision of 2026-11-03). */
interface StoredOrder {
  readonly paymentId: string;
  readonly orderExpiresAt: string;
  /** Pay's also holds `enrollmentId`, the enrollment it wrote. */
  readonly [key: string]: string;
}

/** The enrollment a stored Pay outcome names. */
function enrollmentOf(stored: StoredOrder): string {
  const enrollmentId = stored['enrollmentId'];
  if (enrollmentId === undefined) {
    throw new Error('checkout: a stored Pay outcome without its enrollment');
  }
  return enrollmentId;
}

/** The steps the service takes on the database, each a function of an owner's entry; faked in a spec. */
export interface CheckoutSteps {
  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
  /** T175: the teacher's name if the student may see the teacher, else null (booking's `checkoutTeacherName`). */
  teacherName(
    tx: Transaction,
    requester: RequesterGender,
    teacherUserId: string,
  ): Promise<string | null>;
  placeHold(
    tx: Transaction,
    student: CheckoutStudent,
    request: { readonly packageId: string; readonly slotId: string },
    dependencies: {
      readonly terms: HoldTerms;
      readonly orders: OrderStandings;
      readonly heldOrders: HeldOrdersOf;
      /** 006:T009: the student's payable programme order, which refuses a new hold (FR-BOOK-12). */
      readonly programmeOrders: PayableProgrammeOrderOf;
    },
  ): Promise<CheckoutHold>;
  retryTarget(tx: Transaction, studentUserId: string, enrollmentId: string): Promise<RetryTarget>;
  lockOrderTarget(
    tx: Transaction,
    target: {
      readonly holdId: string;
      readonly enrollmentId: string;
      readonly studentUserId: string;
    },
    stillPayable: (holdExpiresAt: Date) => boolean,
  ): Promise<void>;
  insertOrder(tx: Transaction, order: NewOrder): Promise<void>;
  /** Records an order the gateway cancelled as failed, in a transaction of its own (FR-BOOK-12 (b)). */
  recordCancelled(enrollmentId: string, paymentId: string): Promise<void>;
  studentEnrollment(
    tx: Transaction,
    enrollmentId: string,
    studentUserId: string,
  ): Promise<CheckoutEnrollmentRow | null>;
  orderById(tx: Transaction, paymentId: string): Promise<AddressedOrder | null>;
  lastOrderOf(tx: Transaction, enrollmentId: string): Promise<AddressedOrder | null>;
  drawRowId(): Promise<string>;
  /** The student's current hold at `rule.now`, previewed with `rule.leadHours` (booking's `currentHoldOf`, T037, T085). */
  currentHold(
    tx: Transaction,
    student: CheckoutStudent,
    rule: Pick<HoldTerms, 'now' | 'leadHours'>,
  ): Promise<CurrentHold | null>;
  /** The student's own enrollment's status (booking's `enrollmentStatusOf`, T037). */
  enrollmentStatus(
    tx: Transaction,
    studentUserId: string,
    enrollmentId: string,
  ): Promise<EnrollmentStatusAnswer>;
  /** Pay's checks before the gateway (booking's `payTargetOf`). */
  payTarget(
    tx: Transaction,
    request: { readonly studentUserId: string; readonly holdId: string; readonly at: Date },
    quoted: QuotedSummary,
  ): Promise<PayTarget>;
  /** Pay's transaction on booking's side (booking's `enrollOnHold`). */
  enrollOnHold(tx: Transaction, target: PayTarget, enrolment: Enrolment): Promise<void>;
  /** 003:T101: the teacher's verified payout recipient; null when none (identity's `payoutRecipientOf`). */
  payoutRecipient(teacherUserId: string): Promise<string | null>;
  /** 006:T009: `programme.pay`'s check, before the gateway and under the record's locks (booking). */
  programmePayTarget(
    tx: Transaction,
    request: { readonly studentUserId: string; readonly enrollmentId: string },
    dependencies: { readonly orders: CheckoutOrdersAmong; readonly log: ProgrammeLog },
  ): Promise<ProgrammePayTarget>;
  /**
   * 006:T009 (Q-C2 (a)): the student's programme order still payable at `at`, or null: booking's
   * active programmes of the student, then payments' read among them; no lock.
   */
  programmeOrderOf(
    tx: Transaction,
    studentUserId: string,
    at: Date,
  ): Promise<{ readonly enrollmentId: string; readonly expiresAt: Date } | null>;
  /** 006:T009 (R-511): the programme's assessment order, its gross and rates (payments' own read). */
  assessmentOrderOf(tx: Transaction, enrollmentId: string): Promise<AssessmentOrder>;
}

/**
 * The steps over the process's client and the owners' entries; 005:T016: `notices`, the payment
 * pushes' port, handed to the placement (the failed order's record pushes nothing, Major 2).
 */
export function checkoutStepsOver(
  database: Database,
  cipher: Pick<ColumnCipher, 'decrypt'>,
  notices: PaymentOutcomeNotices,
  now: () => Date = () => new Date(),
): CheckoutSteps {
  const pay = payStoreOver(payableProgrammeOrderAmong);
  return {
    currentHold: (tx, student, rule) => currentHoldOf(tx, student, rule),
    enrollmentStatus: (tx, studentUserId, enrollmentId) =>
      enrollmentStatusOf(tx, studentUserId, enrollmentId),
    payTarget: (tx, request, quoted) => payTargetOf(tx, request, quoted, pay),
    enrollOnHold: (tx, target, enrolment) => enrollOnHold(tx, target, enrolment, pay),
    transaction: (work) => database.$transaction(work),
    teacherName: checkoutTeacherName,
    placeHold: (tx, student, request, dependencies) =>
      placeCheckoutHold(tx, student, request, { ...dependencies, notices }),
    retryTarget: (tx, studentUserId, enrollmentId) =>
      retryTargetOf(tx, studentUserId, enrollmentId),
    lockOrderTarget: (tx, target, stillPayable) => lockOrderTarget(tx, target, stillPayable),
    insertOrder,
    recordCancelled: (enrollmentId, paymentId) =>
      database.$transaction(async (tx) => {
        // The enrollment and the order (T005), as the order event branch locks them (T038); no
        // push, so nothing references the student (this file's head, #148 Saif r1, Major 2).
        await lockOrder(tx, { paymentId, enrollmentId });
        const orders = new PaymentsRepository(tx);
        if ((await orders.statusOf(paymentId)) !== 'created') return;
        await orders.moveOrder(paymentId, 'failed', undefined);
        await recordOrderFailed(tx, enrollmentId, paymentId, now(), 'without_push');
      }),
    studentEnrollment: studentCheckoutEnrollment,
    orderById,
    lastOrderOf,
    drawRowId: () => drawRowId(database),
    payoutRecipient: (teacherUserId) => payoutRecipientOf(database, cipher, teacherUserId),
    programmePayTarget: checkedProgrammePay,
    programmeOrderOf: async (tx, studentUserId, at) =>
      payableProgrammeOrderAmong(tx, await activeProgrammeEnrollmentsOf(tx, studentUserId), at),
    assessmentOrderOf,
  };
}

export interface CheckoutDependencies {
  readonly settings: SettingsReader;
  readonly idempotency: Pick<IdempotencyService<Transaction>, 'run' | 'completed'>;
  readonly payment: Pick<PaymentPort, 'createCheckout' | 'cancelCheckout'>;
  readonly cipher: Pick<ColumnCipher, 'encrypt' | 'decrypt'>;
  /** The gateway the payment port is: `config.PAYMENT_GATEWAY` (ERD `payments.gateway`). */
  readonly gateway: PaymentGateway;
  readonly steps: CheckoutSteps;
  readonly now?: () => Date;
  /** The process's error reporting (T111); a recorder in the specs. */
  readonly report?: (error: Error) => void;
}

/**
 * T175 (R1a; the note under T175, (1)): what `checkout.hold`'s key stores, its answer without the
 * teacher's name; a replay reads the name again through the visibility predicate.
 */
type StoredHold = Omit<CheckoutHoldOutput, 'summary'> & {
  readonly summary: Omit<CheckoutHoldOutput['summary'], 'teacher'> & {
    readonly teacher: { readonly teacherId: string };
  };
};

/** T175: the stored hold with the teacher's name, as `checkout.hold` answers it. */
function namedHold(stored: StoredHold, displayName: string): CheckoutHoldOutput {
  const { teacherId } = stored.summary.teacher;
  return { ...stored, summary: { ...stored.summary, teacher: { teacherId, displayName } } };
}

function storedHoldOf(held: CheckoutHold, terms: Pick<HoldTerms, 'graceMinutes'>): StoredHold {
  return {
    holdId: held.holdId,
    expiresAt: held.expiresAt.toISOString(),
    payBy: payByOf(held.expiresAt, terms).toISOString(),
    summary: { ...held.summary, teacher: { teacherId: held.summary.teacher.teacherId } },
    firstSession: {
      localDate: held.firstSession.requestedLocalDate,
      startsAt: held.firstSession.startsAt,
    },
    lastSession: {
      localDate: held.lastSession.requestedLocalDate,
      startsAt: held.lastSession.startsAt,
    },
  };
}

/** What an order's creation and record need. */
interface OrderToCreate {
  readonly enrollmentId: string;
  /** 003:T101: whose payout recipient the share is split to. */
  readonly teacherUserId: string;
  readonly gross_piasters: ReturnType<typeof piasters>;
  /** 003:T105: the package's track, which decides whether the ijazah half's percent is kept. */
  readonly track: 'recitation' | 'ijazah_track';
  /**
   * 006:T005 (R-502, R-511, FR-701): `assessment` for a programme package's assessment, its gross
   * the fee and its rate and 25 % read as a package's; `package` otherwise. 006:T009:
   * `rest_in_full` or `instalment` for `programme.pay`.
   */
  readonly kind: 'package' | 'assessment' | 'rest_in_full' | 'instalment';
  /** 006:T009: the instalment's month (month 1 for `programme.pay`). */
  readonly instalmentMonth?: number;
  /** 006:T009 (Q-4 (a)): the instant the student ticked to save the card, when ticked. */
  readonly cardConsentAt?: Date;
  /**
   * 006:T009 (R-511, ADR 0025 D6): the rate and the 25 % copied from the programme's assessment
   * order, in place of the settings' values read now.
   */
  readonly rates?: Pick<AssessmentOrder, 'teacherShareRatePercent' | 'halfReleaseRatePercent'>;
  readonly latestExpiry: Date;
  /** Locks and checks what the order is recorded on, in the recording transaction. */
  readonly lockTarget: (tx: Transaction) => Promise<void>;
}

export class CheckoutService {
  readonly #settings: SettingsReader;
  readonly #idempotency: CheckoutDependencies['idempotency'];
  readonly #payment: CheckoutDependencies['payment'];
  readonly #cipher: CheckoutDependencies['cipher'];
  readonly #gateway: PaymentGateway;
  readonly #steps: CheckoutSteps;
  readonly #now: () => Date;
  readonly #report: (error: Error) => void;

  constructor(dependencies: CheckoutDependencies) {
    this.#settings = dependencies.settings;
    this.#idempotency = dependencies.idempotency;
    this.#payment = dependencies.payment;
    this.#cipher = dependencies.cipher;
    this.#gateway = dependencies.gateway;
    this.#steps = dependencies.steps;
    this.#now = dependencies.now ?? (() => new Date());
    this.#report = dependencies.report ?? reportError;
  }

  /** `checkout.hold` (FR-351 to FR-353, FR-BOOK-12, FR-357). */
  async hold(student: CheckoutStudent, input: CheckoutHoldInput): Promise<CheckoutHoldOutput> {
    const { packageId, slotId } = input;
    const request = {
      scope: 'checkout.hold' as const,
      key: input.idempotencyKey,
      actorId: student.userId,
      input: { packageId, slotId },
    };
    const stored = await this.#idempotency.completed<StoredHold>(request);
    if (stored !== undefined) return this.#namedAgain(student, stored);
    const recordedFailed = new Set<string>();
    for (;;) {
      const terms = await readHoldTerms(this.#settings, this.#now());
      // T175: the name the placement read, kept in this call only; unset when `run` replayed a key.
      const placed: { name?: string } = {};
      try {
        // 005:T016: the placement's releases can push `payment_expired` (this file's head).
        const outcome = await withOutcomeNotices<StoredHold>(
          (work) => this.#idempotency.run(request, work),
          async (tx) => {
            const held = await this.#steps.placeHold(
              tx,
              student,
              { packageId, slotId },
              {
                terms,
                orders: orderStandingsOf,
                heldOrders: heldOrdersOf,
                programmeOrders: payableProgrammeOrderAmong,
              },
            );
            placed.name = held.summary.teacher.displayName;
            return storedHoldOf(held, terms);
          },
        );
        return placed.name === undefined
          ? await this.#namedAgain(student, outcome)
          : namedHold(outcome, placed.name);
      } catch (error) {
        if (!(error instanceof PayableCheckout)) throw error;
        if (recordedFailed.has(error.order.paymentId)) {
          throw new Error('checkout: an order recorded failed came back payable', { cause: error });
        }
        await this.#cancelPrevious(error);
        recordedFailed.add(error.order.paymentId);
      }
    }
  }

  /**
   * T175: a replayed hold with the teacher's name read again through the visibility predicate,
   * `NOT_FOUND` once the student may no longer see the teacher (R-GENDER-2).
   */
  async #namedAgain(student: CheckoutStudent, stored: StoredHold): Promise<CheckoutHoldOutput> {
    const name = await this.#steps.transaction((tx) =>
      this.#steps.teacherName(tx, student.gender, stored.summary.teacher.teacherId),
    );
    if (name === null) throw new DomainError('NOT_FOUND');
    return namedHold(stored, name);
  }

  /** `checkout.retry` (FR-356, FR-357): a new order on the same hold. */
  async retry(student: CheckoutStudent, input: CheckoutRetryInput): Promise<CheckoutHandover> {
    const { enrollmentId } = input;
    const request = {
      scope: 'checkout.retry' as const,
      key: input.idempotencyKey,
      actorId: student.userId,
      input: { enrollmentId },
    };
    const stored = await this.#idempotency.completed<StoredOrder>(request);
    if (stored !== undefined) return this.#handoverAgain(stored.paymentId);
    const now = this.#now();
    const terms = await readHoldTerms(this.#settings, now);
    const lastMoment = (holdExpiresAt: Date) => payByOf(holdExpiresAt, terms);
    const stillPayable = (holdExpiresAt: Date) =>
      lastMoment(holdExpiresAt).getTime() > now.getTime();
    const { enrollment, hold, kind } = await this.#steps.transaction((tx) =>
      this.#steps.retryTarget(tx, student.userId, enrollmentId),
    );
    if (hold === null || enrollment.status !== 'pending_payment' || !stillPayable(hold.expiresAt)) {
      throw new DomainError('ORDER_NOT_PAYABLE');
    }
    const { checkoutUrl, orderExpiresAt } = await this.#createAndRecord(request, {
      enrollmentId,
      teacherUserId: enrollment.teacherUserId,
      gross_piasters: piasters(Number(enrollment.snapshotPricePiasters)),
      track: enrollment.snapshotTrack,
      kind,
      latestExpiry: lastMoment(hold.expiresAt),
      lockTarget: (tx) =>
        this.#steps.lockOrderTarget(
          tx,
          { holdId: hold.id, enrollmentId, studentUserId: student.userId },
          stillPayable,
        ),
    });
    return { checkoutUrl, orderExpiresAt };
  }

  /**
   * `checkout.pay` (FR-354, FR-355, FR-357, FR-358; the owner's decisions of 2026-11-03): the
   * enrollment's id drawn first and handed to the gateway, the order created outside any
   * transaction, then the enrollment written, the hold linked and the order recorded in one
   * transaction under booking's locks; the address handed over only after its commit. A package no
   * longer as the student saw it refuses `SUMMARY_CHANGED` before the gateway, and again under the
   * locks, where the order just created is then cancelled.
   */
  async pay(student: CheckoutStudent, input: CheckoutPayInput): Promise<CheckoutPayOutput> {
    const { holdId } = input;
    const quoted: QuotedSummary = {
      ...input.quoted,
      price_piasters: piasters(input.quoted.price_piasters),
    };
    const request = {
      scope: 'checkout.pay' as const,
      key: input.idempotencyKey,
      actorId: student.userId,
      input: { holdId, ...input.quoted },
    };
    const stored = await this.#idempotency.completed<StoredOrder>(request);
    if (stored !== undefined) {
      return {
        enrollmentId: enrollmentOf(stored),
        ...(await this.#handoverAgain(stored.paymentId)),
      };
    }
    const now = this.#now();
    const terms = await readHoldTerms(this.#settings, now);
    const { leadHours } = terms;
    const target = await this.#steps.transaction((tx) =>
      this.#steps.payTarget(tx, { studentUserId: student.userId, holdId, at: now }, quoted),
    );
    const latestExpiry = payByOf(target.hold.expiresAt, terms);
    if (latestExpiry.getTime() <= now.getTime()) throw new DomainError('HOLD_EXPIRED');
    // 006:T005: the order's kind and gross, an assessment's fee checked before the gateway.
    const payOrder = await payTermsOf(target, quoted, terms.programme ?? closedProgramme);
    const enrollmentId = await this.#steps.drawRowId();
    const recorded = await this.#createAndRecord(
      request,
      {
        enrollmentId,
        teacherUserId: target.teacherUserId,
        gross_piasters: payOrder.price_piasters,
        // The quoted track: booking checks it against the package under the locks (SUMMARY_CHANGED).
        track: quoted.track,
        kind: payOrder.kind,
        latestExpiry,
        lockTarget: (tx) =>
          this.#steps.enrollOnHold(tx, target, {
            student,
            enrollmentId,
            at: now,
            leadHours,
            quoted,
            ...(terms.programme === undefined ? {} : { programme: terms.programme }),
          }),
      },
      { enrollmentId },
    );
    return {
      enrollmentId: enrollmentOf(recorded.stored),
      checkoutUrl: recorded.checkoutUrl,
      orderExpiresAt: recorded.orderExpiresAt,
    };
  }

  /**
   * The gateway's order created outside any transaction, then recorded by `run` under the key; a
   * refusal or a duplicate that committed first cancels this order at the gateway.
   */
  async #createAndRecord(
    request: KeyedRequest,
    order: OrderToCreate,
    alsoStored: Readonly<Record<string, string>> = {},
  ): Promise<CheckoutHandover & { readonly stored: StoredOrder }> {
    // T104: the rate read now, before the gateway, so a setting outside 0 to 100 creates no order;
    // the share is the gross at that rate, rounded up (`packages/money`), and both stay on the order.
    // 006:T009 (R-511): a programme's later order copies both from its assessment order instead.
    const { teacherShareRatePercent, halfReleaseRatePercent } =
      order.rates ?? (await this.#ratesNow(order.track));
    const teacherShare_piasters = teacherShare(order.gross_piasters, teacherShareRatePercent);
    // T101 (Q-B2 (a)): the share split to the teacher's verified recipient, read before the gateway.
    // With none, no split is asked for: test mode creates the order, live mode's gateway refuses it.
    const recipientRef = await this.#steps.payoutRecipient(order.teacherUserId);
    const payee =
      recipientRef === null ? undefined : { recipientRef, share_piasters: teacherShare_piasters };
    const paymentId = await this.#steps.drawRowId();
    const checkout = await this.#payment.createCheckout(
      order.enrollmentId,
      order.gross_piasters,
      ORDER_CURRENCY,
      order.latestExpiry,
      payee,
      // 006:T013 (R-510, FR-713): the card is asked to be saved only with the student's consent.
      order.cardConsentAt === undefined ? undefined : true,
    );
    let recordedHere = false;
    let stored: StoredOrder;
    try {
      stored = await this.#idempotency.run(request, async (tx) => {
        recordedHere = true;
        await order.lockTarget(tx);
        await this.#steps.insertOrder(tx, {
          id: paymentId,
          enrollmentId: order.enrollmentId,
          gateway: this.#gateway,
          gatewayOrderId: checkout.gatewayOrderId,
          gross_piasters: order.gross_piasters,
          currency: ORDER_CURRENCY,
          expiresAt: checkout.expiresAt,
          checkoutUrlEncrypted: this.#cipher.encrypt(
            checkout.checkoutUrl,
            CHECKOUT_URL_COLUMN,
            paymentId,
          ),
          teacherShareRatePercent,
          teacherShare_piasters,
          halfReleaseRatePercent,
          kind: order.kind,
          ...(order.instalmentMonth === undefined
            ? {}
            : { instalmentMonth: order.instalmentMonth }),
          ...(order.cardConsentAt === undefined ? {} : { cardConsentAt: order.cardConsentAt }),
        });
        const outcome: StoredOrder = {
          ...alsoStored,
          paymentId,
          orderExpiresAt: checkout.expiresAt.toISOString(),
        };
        return outcome;
      });
    } catch (error) {
      await this.#cancelQuietly(checkout.gatewayOrderId);
      throw error;
    }
    if (!recordedHere) {
      await this.#cancelQuietly(checkout.gatewayOrderId);
      return { ...(await this.#handoverAgain(stored.paymentId)), stored };
    }
    return { checkoutUrl: checkout.checkoutUrl, orderExpiresAt: stored.orderExpiresAt, stored };
  }

  /** `checkout.current` (FR-BOOK-12 (c), T037): what `CheckoutPrevious` shows. */
  async current(student: CheckoutStudent): Promise<CheckoutCurrentOutput> {
    const now = this.#now();
    const terms = await readHoldTerms(this.#settings, now);
    return this.#steps.transaction(async (tx) => {
      // 006:T009 (Q-C2 (a), R-509): the student's payable programme order, which has no hold.
      const programme = await this.#steps.programmeOrderOf(tx, student.userId, now);
      const programmeOrder =
        programme === null
          ? {}
          : {
              programmeOrder: {
                enrollmentId: programme.enrollmentId,
                expiresAt: programme.expiresAt.toISOString(),
                canContinue: programme.expiresAt.getTime() > now.getTime(),
              },
            };
      const hold = await this.#steps.currentHold(tx, student, terms);
      if (hold === null) return programmeOrder;
      const order =
        hold.enrollmentId === null ? null : await this.#steps.lastOrderOf(tx, hold.enrollmentId);
      return {
        ...programmeOrder,
        hold: {
          holdId: hold.holdId,
          expiresAt: hold.expiresAt.toISOString(),
          payBy: payByOf(hold.expiresAt, terms).toISOString(),
          ...(hold.enrollmentId === null ? {} : { enrollmentId: hold.enrollmentId }),
          summary: hold.summary,
          firstSession: hold.firstSession,
          lastSession: hold.lastSession,
          ...(order === null
            ? {}
            : {
                lastOrder: {
                  status: order.status,
                  expiresAt: order.expiresAt.toISOString(),
                  canContinue: this.#payable(order, now),
                },
              }),
        },
      };
    });
  }

  /** `checkout.continue` (FR-BOOK-12 (c), data-model §2.4.1, T037): the payable order's page again. */
  async continue(
    student: CheckoutStudent,
    { enrollmentId }: CheckoutContinueInput,
  ): Promise<CheckoutHandover> {
    const order = await this.#steps.transaction(async (tx) => {
      const enrollment = await this.#steps.studentEnrollment(tx, enrollmentId, student.userId);
      if (enrollment === null) throw new DomainError('NOT_FOUND');
      return this.#steps.lastOrderOf(tx, enrollmentId);
    });
    return this.#handoverOf(order);
  }

  /** `checkout.status` (FR-380 to FR-386, T037): the enrollment as the server holds it. */
  async status(
    student: CheckoutStudent,
    { enrollmentId }: CheckoutStatusInput,
  ): Promise<CheckoutStatusOutput> {
    return this.#steps.transaction(async (tx) => {
      const { enrollmentId: _id, ...answer } = await this.#steps.enrollmentStatus(
        tx,
        student.userId,
        enrollmentId,
      );
      const order = await this.#steps.lastOrderOf(tx, enrollmentId);
      // Pay writes the enrollment and its first order in one transaction (FR-354).
      if (order === null) throw new Error('checkout: an enrollment without an order');
      return { ...answer, lastOrder: { status: order.status, reference: order.gatewayOrderId } };
    });
  }

  /** Whether an order can still be paid: `created` and before its `expires_at`. */
  #payable(order: AddressedOrder, at: Date): boolean {
    return order.status === 'created' && order.expiresAt.getTime() > at.getTime();
  }

  /**
   * The address of an order this student's key recorded, decrypted only while the order is
   * `created` and before its `expires_at`; `ORDER_NOT_PAYABLE` otherwise, nothing decrypted.
   */
  async #handoverAgain(paymentId: string): Promise<CheckoutHandover> {
    const order = await this.#steps.transaction((tx) => this.#steps.orderById(tx, paymentId));
    return this.#handoverOf(order);
  }

  #handoverOf(order: AddressedOrder | null): CheckoutHandover {
    if (
      order === null ||
      !this.#payable(order, this.#now()) ||
      order.checkoutUrlEncrypted === null
    ) {
      throw new DomainError('ORDER_NOT_PAYABLE');
    }
    return {
      checkoutUrl: this.#cipher.decrypt(order.checkoutUrlEncrypted, CHECKOUT_URL_COLUMN, order.id),
      orderExpiresAt: order.expiresAt.toISOString(),
    };
  }

  /** FR-BOOK-12 (b) and (c): the previous payable order cancelled at the gateway, or the refusal. */
  async #cancelPrevious(payable: PayableCheckout): Promise<void> {
    const outcome = await this.#payment.cancelCheckout(payable.order.gatewayOrderId);
    if (outcome === 'paid' || outcome === 'in_progress') {
      throw previousCheckout(payable.enrollmentId, 'processing');
    }
    if (outcome === 'unsupported') {
      throw previousCheckout(payable.enrollmentId, 'payable', payable.order.expiresAt);
    }
    await this.#steps.recordCancelled(payable.enrollmentId, payable.order.paymentId);
  }

  /** The rate and the ijazah half's percent the settings hold now (T104, 003:T105). */
  async #ratesNow(
    track: OrderToCreate['track'],
  ): Promise<Pick<AssessmentOrder, 'teacherShareRatePercent' | 'halfReleaseRatePercent'>> {
    const teacherShareRatePercent = await this.#settings.read(
      TEACHER_SHARE_SETTING,
      teacherSharePercent,
    );
    // 003:T105 (Q-4 (a)): the ijazah half's percent, read now on an `ijazah_track` order only and
    // kept on it, so a running package keeps the percent it started with (ADR 0025 D6).
    const halfReleaseRatePercent =
      track === 'ijazah_track'
        ? await this.#settings.read(IJAZAH_HALF_RELEASE_SETTING, ijazahHalfReleasePercent)
        : null;
    return { teacherShareRatePercent, halfReleaseRatePercent };
  }

  /**
   * `programme.pay` (006:T009; FR-710 to FR-713, R-509, R-511; this file's head, THE FIRST
   * PAYMENT): the rest in full or month 1, keyed as `checkout.pay` is, with no hold.
   */
  async programmePay(
    student: CheckoutStudent,
    input: ProgrammePayInput,
    log: ProgrammeLog,
  ): Promise<ProgrammeCheckoutOutput> {
    const { enrollmentId, plan, saveCard } = input;
    const request = {
      scope: 'programme.pay' as const,
      key: input.idempotencyKey,
      actorId: student.userId,
      input: { enrollmentId, plan, saveCard: saveCard ? 1 : 0 },
    };
    const stored = await this.#idempotency.completed<StoredOrder>(request);
    if (stored !== undefined) {
      return { checkoutUrl: (await this.#handoverAgain(stored.paymentId)).checkoutUrl };
    }
    const now = this.#now();
    const { ttlMinutes } = await readHoldTerms(this.#settings, now);
    const check = (tx: Transaction) =>
      this.#steps.programmePayTarget(
        tx,
        { studentUserId: student.userId, enrollmentId },
        { orders: checkoutOrdersAmong, log },
      );
    const { target, assessment } = await this.#steps.transaction(async (tx) => {
      const checked = await check(tx);
      return { target: checked, assessment: await this.#steps.assessmentOrderOf(tx, enrollmentId) };
    });
    const gross_piasters = firstPaymentOf(plan, target, assessment.gross_piasters);
    if (gross_piasters === null) {
      log.info(
        { studentUserId: student.userId, enrollmentId, reason: 'rest_not_positive' },
        'A programme payment was refused',
      );
      throw markRefusalLogged(
        new DomainError('CONFLICT', undefined, {
          details: [{ path: 'cause', code: 'rest_not_positive' }],
        }),
      );
    }
    // No hold (R-509): the checkout's TTL, cut at the 48 hours' end.
    const ttlEnd = new Date(addMinutes(now, ttlMinutes));
    const { checkoutUrl } = await this.#createAndRecord(request, {
      enrollmentId,
      teacherUserId: target.teacherUserId,
      gross_piasters,
      track: target.track,
      kind: plan === 'in_full' ? 'rest_in_full' : 'instalment',
      ...(plan === 'in_full' ? {} : { instalmentMonth: 1 }),
      ...(saveCard ? { cardConsentAt: now } : {}),
      rates: {
        teacherShareRatePercent: assessment.teacherShareRatePercent,
        halfReleaseRatePercent: assessment.halfReleaseRatePercent,
      },
      latestExpiry: ttlEnd.getTime() < target.payByAt.getTime() ? ttlEnd : target.payByAt,
      lockTarget: async (tx) => {
        await check(tx);
      },
    });
    return { checkoutUrl };
  }

  async #cancelQuietly(gatewayOrderId: string): Promise<void> {
    try {
      await this.#payment.cancelCheckout(gatewayOrderId);
    } catch (error) {
      this.#report(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
