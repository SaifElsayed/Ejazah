// T036 (FR-BOOK-12, FR-351 to FR-358, FR-356; R-208; ARCHITECTURE §8.1): what `payments`' checkout asks
// of booking, each on the caller's transaction. Booking owns `slot_holds` and `enrollments` and is
// the only module that writes or reads them (R-API-6); payments owns the orders and the gateway
// calls, and hands in what booking needs of its orders as functions (booking never imports
// payments, R-208).
//
// A NEW CHECKOUT (`checkout.hold`, FR-BOOK-12). The package is read for its teacher alone, then both
// accounts are locked in one call and the slot after them (T005's order, the note under T033), and
// only then the student's own hold is looked at: while it has not expired it is locked and read
// again, its enrollment locked, and payments asked for that enrollment's orders (which locks them
// after the enrollment). An order still payable (`created`, before its `expires_at`) throws
// `PayableCheckout`, so the caller's transaction keeps nothing and the caller asks the gateway to
// cancel it outside any transaction, then starts again (FR-BOOK-12 (b)). A `paid` order refuses the
// new checkout as being processed: that payment is confirmed on its own hold by the confirm job,
// and releasing that hold would turn the student's payment into a refused confirmation (FR-362).
// Otherwise the hold is released with `checkout_abandoned` (FR-BOOK-12 (a), FR-363) and T033's
// placement runs in the same transaction: a refusal of the new hold throws and the release goes
// with it (FR-351). An expired own hold is the placement's to release with its expiry's reason.
//
// A NEW ORDER ON A HOLD (`checkout.retry`, FR-356). The enrollment and its hold are read without a
// lock before the gateway is called; inside the caller's transaction the hold is locked and read
// again, then the enrollment, in T005's order (the hold, then the enrollment, then the payment), and
// the order is refused unless the hold is still active, still the enrollment's and the student's,
// and an order can still be created on it, and the enrollment is still awaiting payment.
import type { CheckoutSummary } from '@ijazah/contracts';
import { toPlainNumber } from '@ijazah/money';
import type { Occurrence } from '@ijazah/time';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { LockedTable } from '../../platform/db/row-lock.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import type { RequesterGender } from '../../platform/guards/requester-gender.js';
import {
  type BookablePackage,
  bookablePackageOf,
  type PackageRow,
  teacherPackageOf,
} from '../catalog/index.js';
import { visibleTeachers } from '../identity/index.js';
import {
  activeHoldOfEnrollment,
  type CheckoutEnrollmentRow,
  enrollmentStatus,
  ownActiveHold,
  studentEnrollment,
} from './checkout-holds.repository.js';
import { activeHoldsByIds, type HeldRow, lockRows } from './holds.repository.js';
import {
  type HoldRequest,
  type HoldStudent,
  type HoldTerms,
  type OrderStandings,
  type PlacedHold,
  placeHold,
  type ReleasedHolds,
  releaseHolds,
} from './holds.service.js';

export type { CheckoutEnrollmentRow };

/** An order still payable at the gateway: `created`, before its `expires_at` (FR-BOOK-12). */
export interface PayableOrder {
  readonly paymentId: string;
  readonly gatewayOrderId: string;
  readonly expiresAt: Date;
}

/** What a new checkout needs of the own hold's enrollment's orders. */
export interface HeldOrders {
  readonly payable: PayableOrder | null;
  readonly paid: boolean;
}

/**
 * Payments' answer for one enrollment, on the caller's transaction holding the enrollment's lock;
 * it locks the orders after it (T005).
 */
export type HeldOrdersOf = (tx: Transaction, enrollmentId: string, at: Date) => Promise<HeldOrders>;

/**
 * The student's own unexpired hold has an order the gateway must cancel first (FR-BOOK-12 (b)):
 * thrown so the caller's transaction keeps nothing; the caller cancels outside any transaction.
 */
export class PayableCheckout extends Error {
  readonly enrollmentId: string;
  readonly order: PayableOrder;

  constructor(enrollmentId: string, order: PayableOrder) {
    super('The previous checkout has an order still payable at the gateway (FR-BOOK-12)');
    this.name = 'PayableCheckout';
    this.enrollmentId = enrollmentId;
    this.order = order;
  }
}

/** FR-BOOK-12's refusal: `enrollmentId` and `state` in details, `expiresAt` when it is payable. */
export function previousCheckout(
  enrollmentId: string,
  state: 'processing' | 'payable',
  expiresAt?: Date,
): DomainError {
  return new DomainError('PREVIOUS_CHECKOUT', undefined, {
    details: [
      { path: 'enrollmentId', code: enrollmentId },
      { path: 'state', code: state },
      ...(expiresAt === undefined ? [] : [{ path: 'expiresAt', code: expiresAt.toISOString() }]),
    ],
  });
}

/** What a new checkout reads besides the placement's store, each through its owner's entry. */
export interface CheckoutHoldStore {
  lockRows(tx: Transaction, table: LockedTable, ids: readonly string[]): Promise<void>;
  packageOf(tx: Transaction, packageId: string): Promise<BookablePackage | null>;
  ownActiveHold(tx: Transaction, studentUserId: string): Promise<HeldRow | null>;
  activeHoldsByIds(tx: Transaction, ids: readonly string[]): Promise<readonly HeldRow[]>;
  teacherPackageOf(
    tx: Transaction,
    teacherUserId: string,
    packageId: string,
  ): Promise<PackageRow | null>;
  /** The teacher's display name when the requester may see the teacher, else null. */
  teacherName(
    tx: Transaction,
    requester: RequesterGender,
    teacherUserId: string,
  ): Promise<string | null>;
}

export const checkoutHoldStore: CheckoutHoldStore = {
  lockRows,
  packageOf: bookablePackageOf,
  ownActiveHold,
  activeHoldsByIds,
  teacherPackageOf,
  teacherName: async (tx, requester, teacherUserId) => {
    const [teacher] = await visibleTeachers(tx, requester, {
      purpose: 'discover',
      teacherIds: [teacherUserId],
    });
    return teacher?.displayName ?? null;
  },
};

/** The hold and what the checkout screen shows (FR-358, FR-386). */
export interface CheckoutHold {
  readonly holdId: string;
  readonly expiresAt: Date;
  readonly summary: CheckoutSummary;
  readonly firstSession: Occurrence;
  readonly lastSession: Occurrence;
}

export interface CheckoutHoldDependencies {
  readonly terms: HoldTerms;
  readonly orders: OrderStandings;
  readonly heldOrders: HeldOrdersOf;
  readonly store?: CheckoutHoldStore;
  /** T033's placement and release; replaced in a spec. */
  readonly place?: typeof placeHold;
  readonly release?: (
    tx: Transaction,
    holdIds: readonly string[],
    reason: 'checkout_abandoned',
    dependencies: { readonly at: Date; readonly orders: OrderStandings },
  ) => Promise<ReleasedHolds>;
}

function sortedUnique(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

/** FR-358's payment summary of a package, in its order. */
export function summaryOf(
  teacher: { readonly teacherId: string; readonly displayName: string },
  pkg: Pick<
    PackageRow,
    'subject' | 'track' | 'sessionCount' | 'sessionDurationMinutes' | 'price_piasters'
  >,
): CheckoutSummary {
  return {
    teacher,
    subject: pkg.subject,
    track: pkg.track,
    sessionCount: pkg.sessionCount,
    sessionDurationMinutes: pkg.sessionDurationMinutes,
    price_piasters: toPlainNumber(pkg.price_piasters),
  };
}

/**
 * Releases the student's own unexpired hold as FR-BOOK-12 says, or throws: `PayableCheckout` for an
 * order the gateway must cancel first, `PREVIOUS_CHECKOUT` (`processing`) for a paid one. Expects
 * the caller to hold both accounts and the new slot; takes the hold, its enrollment, its orders.
 */
async function releaseOwnHold(
  tx: Transaction,
  store: CheckoutHoldStore,
  studentUserId: string,
  dependencies: CheckoutHoldDependencies,
): Promise<void> {
  const now = dependencies.terms.now;
  const own = await store.ownActiveHold(tx, studentUserId);
  if (own === null || own.expiresAt.getTime() <= now.getTime()) return;
  await store.lockRows(tx, 'slot_holds', [own.id]);
  const [held] = await store.activeHoldsByIds(tx, [own.id]);
  if (held === undefined) return;
  if (held.enrollmentId !== null) {
    await store.lockRows(tx, 'enrollments', [held.enrollmentId]);
    const orders = await dependencies.heldOrders(tx, held.enrollmentId, now);
    if (orders.paid) throw previousCheckout(held.enrollmentId, 'processing');
    if (orders.payable !== null) throw new PayableCheckout(held.enrollmentId, orders.payable);
  }
  await (dependencies.release ?? releaseHolds)(tx, [held.id], 'checkout_abandoned', {
    at: now,
    orders: dependencies.orders,
  });
}

/**
 * `checkout.hold` on the caller's transaction (FR-BOOK-12, FR-351 to FR-353): the student's own
 * unexpired hold ended as FR-BOOK-12 says, then T033's placement, then the summary of the package
 * held. Takes both accounts and the slot before the own hold; the placement takes them again
 * (already held) and goes on in T005's order. Any refusal is thrown and the transaction must keep
 * nothing.
 */
export async function placeCheckoutHold(
  tx: Transaction,
  student: HoldStudent,
  request: HoldRequest,
  dependencies: CheckoutHoldDependencies,
): Promise<CheckoutHold> {
  const store = dependencies.store ?? checkoutHoldStore;
  const named = await store.packageOf(tx, request.packageId);
  if (named !== null && named.teacherUserId !== student.userId) {
    await store.lockRows(tx, 'users', sortedUnique([student.userId, named.teacherUserId]));
    await store.lockRows(tx, 'availability_slots', [request.slotId]);
    await releaseOwnHold(tx, store, student.userId, dependencies);
  }
  const placed: PlacedHold = await (dependencies.place ?? placeHold)(tx, student, request, {
    terms: dependencies.terms,
    orders: dependencies.orders,
  });
  const teacherUserId = placed.package.teacherUserId;
  const [pkg, displayName] = await Promise.all([
    store.teacherPackageOf(tx, teacherUserId, placed.package.id),
    store.teacherName(tx, student.gender, teacherUserId),
  ]);
  if (pkg === null || displayName === null) {
    throw new Error('checkout: the package or the teacher just held is not there to read');
  }
  return {
    holdId: placed.holdId,
    expiresAt: placed.expiresAt,
    summary: summaryOf({ teacherId: teacherUserId, displayName }, pkg),
    firstSession: placed.firstSession,
    lastSession: placed.lastSession,
  };
}

/** The enrollment a Retry creates its order for, and its active hold, read without a lock. */
export interface RetryTarget {
  readonly enrollment: CheckoutEnrollmentRow;
  readonly hold: HeldRow | null;
}

/** What the order reads and locks of booking's rows. */
export interface OrderTargetStore {
  lockRows(tx: Transaction, table: LockedTable, ids: readonly string[]): Promise<void>;
  studentEnrollment(
    tx: Transaction,
    enrollmentId: string,
    studentUserId: string,
  ): Promise<CheckoutEnrollmentRow | null>;
  activeHoldOfEnrollment(tx: Transaction, enrollmentId: string): Promise<HeldRow | null>;
  activeHoldsByIds(tx: Transaction, ids: readonly string[]): Promise<readonly HeldRow[]>;
  enrollmentStatus(
    tx: Transaction,
    enrollmentId: string,
  ): Promise<CheckoutEnrollmentRow['status'] | null>;
}

export const orderTargetStore: OrderTargetStore = {
  lockRows,
  studentEnrollment,
  activeHoldOfEnrollment,
  activeHoldsByIds,
  enrollmentStatus,
};

/**
 * The student's own enrollment and its active hold, without a lock, for the checks made before the
 * gateway is called; `NOT_FOUND` for an unknown enrollment and another student's (M3).
 */
export async function retryTargetOf(
  tx: Transaction,
  studentUserId: string,
  enrollmentId: string,
  store: OrderTargetStore = orderTargetStore,
): Promise<RetryTarget> {
  const enrollment = await store.studentEnrollment(tx, enrollmentId, studentUserId);
  if (enrollment === null) throw new DomainError('NOT_FOUND');
  return { enrollment, hold: await store.activeHoldOfEnrollment(tx, enrollmentId) };
}

/**
 * Locks the hold, then the enrollment (T005), and reads both again: the hold still active, still the
 * enrollment's and the student's, `stillPayable` of its expiry, and the enrollment still awaiting
 * payment; `ORDER_NOT_PAYABLE` otherwise (FR-356). The caller then inserts the order, which
 * references the enrollment it holds.
 */
export async function lockOrderTarget(
  tx: Transaction,
  target: {
    readonly holdId: string;
    readonly enrollmentId: string;
    readonly studentUserId: string;
  },
  stillPayable: (holdExpiresAt: Date) => boolean,
  store: OrderTargetStore = orderTargetStore,
): Promise<void> {
  await store.lockRows(tx, 'slot_holds', [target.holdId]);
  const [hold] = await store.activeHoldsByIds(tx, [target.holdId]);
  await store.lockRows(tx, 'enrollments', [target.enrollmentId]);
  const status = await store.enrollmentStatus(tx, target.enrollmentId);
  if (
    hold === undefined ||
    hold.enrollmentId !== target.enrollmentId ||
    hold.studentUserId !== target.studentUserId ||
    !stillPayable(hold.expiresAt) ||
    status !== 'pending_payment'
  ) {
    throw new DomainError('ORDER_NOT_PAYABLE');
  }
}
