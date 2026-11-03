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
// R-DB-8 for the stored answer (the note under T036 of B28's T031).
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
// the student's own unexpired hold with its package's summary now and, after Pay, its last order and
// whether it can still be continued (`created`, before its `expires_at`); it decrypts nothing.
// `continue` answers `NOT_FOUND` unless the enrollment is the student's, and decrypts the last
// order's address only while that order is `created` and before its `expires_at`
// (`ORDER_NOT_PAYABLE` otherwise, nothing decrypted). `status` answers `NOT_FOUND` unless the
// enrollment is the student's, and its last order with the gateway's reference; `confirmed` comes
// only from the row (R-HONEST-1). The address is never logged: the logger's list redacts
// `checkoutUrl` (T037).
//
// A CANCELLATION THE GATEWAY FAILS is reported (T111) and never hides the answer it followed: the
// order it left is the one FR-375's `duplicate_payment` case covers if it is ever paid.
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
} from '@ijazah/contracts';
import { piasters } from '@ijazah/money';

import type { ColumnCipher } from '../../platform/crypto/encryption.js';
import type { Database, Transaction } from '../../platform/db/prisma.repository.js';
import { drawRowId } from '../../platform/db/row-id.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { reportError } from '../../platform/errors/reporting.js';
import type { RequesterGender } from '../../platform/guards/requester-gender.js';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import type { PaymentPort } from '../../platform/ports/payment/payment.port.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import {
  type CheckoutEnrollmentRow,
  type CheckoutHold,
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
  payByOf,
  placeCheckoutHold,
  previousCheckout,
  readHoldTerms,
  recordOrderFailed,
  type RetryTarget,
  retryTargetOf,
  studentCheckoutEnrollment,
} from '../booking/index.js';
import {
  type AddressedOrder,
  heldOrdersOf,
  insertOrder,
  lastOrderOf,
  type NewOrder,
  orderById,
  type PaymentGateway,
} from './checkout.repository.js';
import { orderStandingsOf } from './order-standing.repository.js';
import { lockOrder, PaymentsRepository } from './payments.repository.js';

/** The column the hosted checkout's address is encrypted under, bound to the order's id (R-DB-8). */
export const CHECKOUT_URL_COLUMN = 'payments.checkout_url_encrypted';

/** The currency of every order: piasters are the Egyptian pound's hundredths (R-MONEY-1). */
export const ORDER_CURRENCY = 'EGP';

/** The student asking, from the session, never from input (R-GENDER-4). */
export interface CheckoutStudent {
  readonly userId: string;
  readonly gender: RequesterGender;
}

/** A keyed request of the checkout (`packages/contracts`' `idempotent-procedures.ts`). */
interface KeyedRequest {
  readonly scope: 'checkout.hold' | 'checkout.pay' | 'checkout.retry';
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
  placeHold(
    tx: Transaction,
    student: CheckoutStudent,
    request: { readonly packageId: string; readonly slotId: string },
    dependencies: {
      readonly terms: HoldTerms;
      readonly orders: OrderStandings;
      readonly heldOrders: HeldOrdersOf;
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
  /** The student's current hold (booking's `currentHoldOf`, T037). */
  currentHold(tx: Transaction, student: CheckoutStudent, now: Date): Promise<CurrentHold | null>;
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
}

/** The steps over the process's client and the owners' entries. */
export function checkoutStepsOver(
  database: Database,
  now: () => Date = () => new Date(),
): CheckoutSteps {
  const pay = payStoreOver();
  return {
    currentHold: (tx, student, at) => currentHoldOf(tx, student, at),
    enrollmentStatus: (tx, studentUserId, enrollmentId) =>
      enrollmentStatusOf(tx, studentUserId, enrollmentId),
    payTarget: (tx, request, quoted) => payTargetOf(tx, request, quoted, pay),
    enrollOnHold: (tx, target, enrolment) => enrollOnHold(tx, target, enrolment, pay),
    transaction: (work) => database.$transaction(work),
    placeHold: (tx, student, request, dependencies) =>
      placeCheckoutHold(tx, student, request, dependencies),
    retryTarget: (tx, studentUserId, enrollmentId) =>
      retryTargetOf(tx, studentUserId, enrollmentId),
    lockOrderTarget: (tx, target, stillPayable) => lockOrderTarget(tx, target, stillPayable),
    insertOrder,
    recordCancelled: (enrollmentId, paymentId) =>
      database.$transaction(async (tx) => {
        // The enrollment, then the order (T005), as the order event branch locks them (T038).
        await lockOrder(tx, { paymentId, enrollmentId });
        const orders = new PaymentsRepository(tx);
        if ((await orders.statusOf(paymentId)) !== 'created') return;
        await orders.moveOrder(paymentId, 'failed', undefined);
        await recordOrderFailed(tx, enrollmentId, paymentId, now());
      }),
    studentEnrollment: studentCheckoutEnrollment,
    orderById,
    lastOrderOf,
    drawRowId: () => drawRowId(database),
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

function asHoldOutput(
  held: CheckoutHold,
  terms: Pick<HoldTerms, 'graceMinutes'>,
): CheckoutHoldOutput {
  return {
    holdId: held.holdId,
    expiresAt: held.expiresAt.toISOString(),
    payBy: payByOf(held.expiresAt, terms).toISOString(),
    summary: held.summary,
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
  readonly gross_piasters: ReturnType<typeof piasters>;
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
    const stored = await this.#idempotency.completed<CheckoutHoldOutput>(request);
    if (stored !== undefined) return stored;
    const recordedFailed = new Set<string>();
    for (;;) {
      const terms = await readHoldTerms(this.#settings, this.#now());
      try {
        return await this.#idempotency.run(request, async (tx) =>
          asHoldOutput(
            await this.#steps.placeHold(
              tx,
              student,
              { packageId, slotId },
              { terms, orders: orderStandingsOf, heldOrders: heldOrdersOf },
            ),
            terms,
          ),
        );
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
    const { enrollment, hold } = await this.#steps.transaction((tx) =>
      this.#steps.retryTarget(tx, student.userId, enrollmentId),
    );
    if (hold === null || enrollment.status !== 'pending_payment' || !stillPayable(hold.expiresAt)) {
      throw new DomainError('ORDER_NOT_PAYABLE');
    }
    const { checkoutUrl, orderExpiresAt } = await this.#createAndRecord(request, {
      enrollmentId,
      gross_piasters: piasters(Number(enrollment.snapshotPricePiasters)),
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
    const enrollmentId = await this.#steps.drawRowId();
    const recorded = await this.#createAndRecord(
      request,
      {
        enrollmentId,
        gross_piasters: target.price_piasters,
        latestExpiry,
        lockTarget: (tx) =>
          this.#steps.enrollOnHold(tx, target, {
            student,
            enrollmentId,
            at: now,
            leadHours,
            quoted,
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
    const paymentId = await this.#steps.drawRowId();
    const checkout = await this.#payment.createCheckout(
      order.enrollmentId,
      order.gross_piasters,
      ORDER_CURRENCY,
      order.latestExpiry,
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
      const hold = await this.#steps.currentHold(tx, student, now);
      if (hold === null) return {};
      const order =
        hold.enrollmentId === null ? null : await this.#steps.lastOrderOf(tx, hold.enrollmentId);
      return {
        hold: {
          holdId: hold.holdId,
          expiresAt: hold.expiresAt.toISOString(),
          payBy: payByOf(hold.expiresAt, terms).toISOString(),
          ...(hold.enrollmentId === null ? {} : { enrollmentId: hold.enrollmentId }),
          summary: hold.summary,
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

  async #cancelQuietly(gatewayOrderId: string): Promise<void> {
    try {
      await this.#payment.cancelCheckout(gatewayOrderId);
    } catch (error) {
      this.#report(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
