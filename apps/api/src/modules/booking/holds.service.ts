// T033 (FR-351 to FR-353, FR-363, FR-PAYG-19, R-208, R-216, ADR 0010 D1–D7): holds, as functions of
// booking's entry taking the caller's transaction. The caller is `payments`' checkout (T036), the
// confirm job (T039) and the sweeps (T040); booking owns `slot_holds` and `enrollments` and is the
// only writer of both (R-208).
//
// PLACING A HOLD (FR-351, FR-353). The package is read for its teacher alone, then both accounts are
// locked in one `lockRows(tx, 'users', [student, teacher])` call (the note under T033: a hold
// references the student, and the enrollment later written beside it both accounts), and only then
// is anything decided: the predicate with the session's gender (`NOT_FOUND` for a teacher it hides,
// `NOT_BOOKABLE` for a visible teacher whose account is not active, T143), the student's account
// (`ACCOUNT_NOT_ACTIVE`, FR-VERIFY-10), the package again under its teacher's lock (a package edit
// locks that account first, T018), then the slot locked and read through catalog's entry: one of
// the teacher's active slots of exactly the package's length, or `NOT_FOUND` with nothing written
// (round 2 N2). The buyer who is the teacher is refused before any lock (FR-BOOK-11). Then, in
// FR-351's order: the slot's and the student's expired holds are released with FR-363's
// cancellations; a hold still active on the slot answers `SLOT_TAKEN`, the student's own unexpired
// hold `PREVIOUS_CHECKOUT` (FR-BOOK-12's release of it is the caller's, before this is called); the
// slot's occupancy (R-205) on its first session's date; the insert, for `slot_hold_ttl_minutes` plus
// `slot_hold_grace_minutes` from now (FR-BOOK-9); then every one of the package's sessions against
// the student's and the teacher's own and the times their open remedies reserve (T027 of
// specs/004-sessions, H3; the check `booking.slots` shares, FR-BOOK-5). A refusal is
// thrown, so the caller's transaction keeps nothing, the releases included (FR-351).
//
// RELEASING (FR-363, the owner's decision of 2026-11-03). One function serves the placement here,
// T040's sweep, FR-BOOK-12's new checkout and R-219's terminations. It locks the holds, reads them
// again, locks their enrollments, then asks payments for their orders (which locks the orders' rows,
// T005's order: hold, enrollment, payment). Each still-active hold is released; its enrollment, if
// it is still awaiting payment, is cancelled with the reason (an expiry's: `payment_failed` when its
// last order failed, `payment_expired` otherwise) and one `enrollment_events` row, in the same
// transaction. An enrollment with a `paid` order is left awaiting payment, with no row, for the
// confirm job, except under `slot_unavailable`, which is that job's own refusal of the paid order
// (FR-362).
//
// THE LOCKS (T005's rules, `platform/db/row-lock.ts`). Placement: users, the slot, the holds, the
// enrollments, the payments, each table's rows in id order in one call. A release locks from the
// holds on; its caller holds nothing after the slot. The re-hold expects its caller to hold both
// accounts and the slot, and takes the holds and then the enrollments, its own among them, in one
// call. Booking never reads a `payments` row (R-API-6) and never imports `payments` (which imports
// booking, R-208): the orders' standing is payments' answer, handed in by the caller.
import { addMinutes, type Occurrence } from '@ijazah/time';
import { z } from 'zod';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { LockedTable } from '../../platform/db/row-lock.js';
import { isUniqueViolation } from '../../platform/db/db-errors.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import type { RequesterGender } from '../../platform/guards/requester-gender.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import {
  type BookablePackage,
  bookablePackageOf,
  type OfferedSlot,
  offeredSlotsOf,
} from '../catalog/index.js';
import { readStanding, type VisibilityPurpose, visibleTeachers } from '../identity/index.js';
import type { SessionTime } from '../sessions/index.js';
import {
  type EnrollmentCancellationReason,
  type EnrollmentOutcome,
  recordEnrollmentEvents,
} from './enrollment-events.repository.js';
import {
  activeHoldsByIds,
  activeHoldsOf,
  cancelPending,
  expiredHoldIds,
  type HeldRow,
  type HoldReleaseReason,
  type HoldScope,
  enrollmentTermsOf,
  insertHold,
  lockRows,
  markReleased,
  type NewHold,
  pendingAmong,
} from './holds.repository.js';
import {
  FIRST_SESSION_LEAD_SETTING,
  firstSessionLeadHours,
  offerableOccurrences,
} from './nearest-slot.service.js';
import {
  freeOfPartiesSessions,
  packageSessionsOn,
  partiesBusyBetween,
  type SessionParties,
} from './session-overlap.service.js';
import {
  occupancyOf,
  SLOT_RELEASE_BUFFER_SETTING,
  type SlotOccupancy,
  slotReleaseBufferWeeks,
} from './slot-occupancy.service.js';

export type { HeldRow, HoldScope, NewHold };

/**
 * Why a hold is released without conversion (FR-363, ADR 0010 D7): its expiry, whose reason its
 * orders decide, or the reason the caller names (FR-BOOK-12's new checkout, FR-362's refusal,
 * R-219's terminations).
 */
export type ReleaseReason = HoldReleaseReason;

/** An enrollment's gateway orders as a release needs them: one is paid; the last one failed. */
export interface OrderStanding {
  readonly paid: boolean;
  readonly lastFailed: boolean;
}

/**
 * Payments' answer for `enrollmentIds`, on the caller's transaction, locking the orders' rows after
 * the enrollments' (T005); an enrollment with no order is absent.
 */
export type OrderStandings = (
  tx: Transaction,
  enrollmentIds: readonly string[],
) => Promise<ReadonlyMap<string, OrderStanding>>;

/** What a release reads and writes: booking's rows and the kernel's lock. */
export interface HoldRows {
  lockRows(tx: Transaction, table: LockedTable, ids: readonly string[]): Promise<void>;
  expiredHoldIds(tx: Transaction, scope: HoldScope, at: Date): Promise<readonly string[]>;
  activeHoldsByIds(tx: Transaction, ids: readonly string[]): Promise<readonly HeldRow[]>;
  activeHoldsOf(tx: Transaction, scope: Required<HoldScope>): Promise<readonly HeldRow[]>;
  markReleased(
    tx: Transaction,
    ids: readonly string[],
    at: Date,
    reason: ReleaseReason,
  ): Promise<void>;
  pendingAmong(tx: Transaction, enrollmentIds: readonly string[]): Promise<readonly string[]>;
  cancelPending(
    tx: Transaction,
    enrollmentIds: readonly string[],
    reason: EnrollmentCancellationReason,
  ): Promise<void>;
  recordEvents(tx: Transaction, outcomes: readonly EnrollmentOutcome[]): Promise<void>;
  insertHold(tx: Transaction, hold: NewHold): Promise<string>;
  /** The enrollment's package and snapshot count, read under its lock (the re-hold's). */
  enrollmentTerms(
    tx: Transaction,
    enrollmentId: string,
  ): Promise<{ readonly packageId: string; readonly sessionCount: number } | null>;
}

/** What a placement reads besides booking's rows, each through its owner's entry (R-API-6). */
export interface PlacementReads {
  packageOf(tx: Transaction, packageId: string): Promise<BookablePackage | null>;
  visible(
    tx: Transaction,
    requester: RequesterGender,
    teacherUserId: string,
    purpose: VisibilityPurpose,
  ): Promise<boolean>;
  studentActive(tx: Transaction, userId: string): Promise<boolean>;
  offeredSlotsOf(tx: Transaction, teacherIds: readonly string[]): Promise<OfferedSlot[]>;
  occupancyOf(
    tx: Transaction,
    slotIds: readonly string[],
    bufferWeeks: () => Promise<number>,
  ): Promise<ReadonlyMap<string, SlotOccupancy>>;
  sessionsBetween(
    tx: Transaction,
    parties: SessionParties,
    window: { readonly from: Date; readonly to: Date },
  ): Promise<readonly SessionTime[]>;
}

export type HoldsStore = HoldRows & PlacementReads;

/** Booking's rows over its repositories. */
export const holdRows: HoldRows = {
  lockRows,
  expiredHoldIds,
  activeHoldsByIds,
  activeHoldsOf,
  markReleased,
  pendingAmong,
  cancelPending,
  recordEvents: recordEnrollmentEvents,
  insertHold,
  enrollmentTerms: enrollmentTermsOf,
};

/** The placement's store over booking's rows and catalog's, identity's and sessions' entries. */
export const holdsStore: HoldsStore = {
  ...holdRows,
  packageOf: bookablePackageOf,
  visible: async (tx, requester, teacherUserId, purpose) =>
    (await visibleTeachers(tx, requester, { purpose, teacherIds: [teacherUserId] })).length === 1,
  studentActive: async (tx, userId) => (await readStanding(tx, userId))?.accountStatus === 'active',
  offeredSlotsOf,
  occupancyOf,
  // T027: the parties' sessions and the times their open remedies reserve (H3).
  sessionsBetween: partiesBusyBetween,
};

/** The gateway checkout's minutes, which the hold lasts before its grace (FR-BOOK-9, FR-PAYG-6). */
export const HOLD_TTL_SETTING = 'slot_hold_ttl_minutes';
/** The minutes a hold outlives its order (FR-BOOK-9, ADR 0010 D4). */
export const HOLD_GRACE_SETTING = 'slot_hold_grace_minutes';

const holdTtlMinutes = z.int().positive();
const holdGraceMinutes = z.int().nonnegative();

/** When a hold is placed, how long it lasts, and FR-368's lead and R-205's buffer it previews with. */
export interface HoldTerms {
  readonly now: Date;
  readonly ttlMinutes: number;
  readonly graceMinutes: number;
  readonly leadHours: number;
  /** Read only when a confirmed enrollment's release needs it (R-205). */
  readonly bufferWeeks: () => Promise<number>;
}

/** The hold's terms from settings, read before the caller's transaction (R-MONEY-12). */
export async function readHoldTerms(settings: SettingsReader, now: Date): Promise<HoldTerms> {
  const [ttlMinutes, graceMinutes, leadHours] = await Promise.all([
    settings.read(HOLD_TTL_SETTING, holdTtlMinutes),
    settings.read(HOLD_GRACE_SETTING, holdGraceMinutes),
    settings.read(FIRST_SESSION_LEAD_SETTING, firstSessionLeadHours),
  ]);
  return {
    now,
    ttlMinutes,
    graceMinutes,
    leadHours,
    bufferWeeks: () => settings.read(SLOT_RELEASE_BUFFER_SETTING, slotReleaseBufferWeeks),
  };
}

/**
 * The instant Pay stops being accepted on a hold expiring at `holdExpiresAt`: its expiry minus the
 * grace (FR-355, FR-PAYG-6). It is the latest expiry an order created on the hold may take, Pay and
 * Retry are refused from it on, and `checkout.hold` and `checkout.current` answer it as `payBy`, the
 * instant the phone's countdown runs to (FR-358): one function, so the three never disagree.
 */
export function payByOf(holdExpiresAt: Date, terms: Pick<HoldTerms, 'graceMinutes'>): Date {
  return new Date(addMinutes(holdExpiresAt, -terms.graceMinutes));
}

/** A hold's expiry: the checkout time plus the grace from `now` (FR-BOOK-9). */
function expiryOf(terms: Pick<HoldTerms, 'now' | 'ttlMinutes' | 'graceMinutes'>): Date {
  return new Date(addMinutes(terms.now, terms.ttlMinutes + terms.graceMinutes));
}

/** What a release is given: its instant, payments' answer and, for a spec, the rows. */
export interface ReleaseDependencies {
  readonly at: Date;
  readonly orders: OrderStandings;
  readonly store?: HoldRows;
}

/** What a release did: the holds it released, the enrollments it cancelled and those it kept. */
export interface ReleasedHolds {
  readonly released: readonly string[];
  readonly cancelled: readonly {
    readonly enrollmentId: string;
    readonly reason: EnrollmentCancellationReason;
  }[];
  /** Awaiting payment still, each with a paid order, for the confirm job (FR-363). */
  readonly keptPending: readonly string[];
}

const NOTHING_RELEASED: ReleasedHolds = { released: [], cancelled: [], keptPending: [] };

function sortedUnique(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

async function lockAll(
  store: HoldRows,
  tx: Transaction,
  table: LockedTable,
  ids: readonly string[],
): Promise<void> {
  if (ids.length > 0) await store.lockRows(tx, table, ids);
}

/** The reason an enrollment of a released hold is cancelled with (FR-363, ADR 0010 D7). */
function cancellationOf(
  reason: ReleaseReason,
  standing: OrderStanding | undefined,
): EnrollmentCancellationReason {
  if (reason !== 'expired') return reason;
  return standing?.lastFailed === true ? 'payment_failed' : 'payment_expired';
}

/** The release, its enrollments' lock widened by `alsoLocked` (the re-hold's own enrollment). */
async function release(
  tx: Transaction,
  holdIds: readonly string[],
  reason: ReleaseReason,
  dependencies: ReleaseDependencies,
  alsoLocked: readonly string[],
): Promise<ReleasedHolds> {
  const store = dependencies.store ?? holdRows;
  const { at } = dependencies;
  await lockAll(store, tx, 'slot_holds', sortedUnique(holdIds));
  const held = (await store.activeHoldsByIds(tx, holdIds)).filter(
    (hold) => reason !== 'expired' || hold.expiresAt.getTime() <= at.getTime(),
  );
  const heldEnrollments = held.flatMap(({ enrollmentId }) =>
    enrollmentId === null ? [] : [enrollmentId],
  );
  await lockAll(store, tx, 'enrollments', sortedUnique([...heldEnrollments, ...alsoLocked]));
  if (held.length === 0) return NOTHING_RELEASED;
  const pending = await store.pendingAmong(tx, sortedUnique(heldEnrollments));
  const standings =
    pending.length === 0
      ? new Map<string, OrderStanding>()
      : await dependencies.orders(tx, pending);
  const released = held.map(({ id }) => id);
  await store.markReleased(tx, released, at, reason);
  const keepsPaid = (enrollmentId: string) =>
    reason !== 'slot_unavailable' && standings.get(enrollmentId)?.paid === true;
  const keptPending = pending.filter(keepsPaid);
  const cancelled = pending
    .filter((enrollmentId) => !keepsPaid(enrollmentId))
    .map((enrollmentId) => ({
      enrollmentId,
      reason: cancellationOf(reason, standings.get(enrollmentId)),
    }));
  for (const why of new Set(cancelled.map((one) => one.reason))) {
    const ids = cancelled.filter((one) => one.reason === why).map((one) => one.enrollmentId);
    await store.cancelPending(tx, ids, why);
  }
  await store.recordEvents(
    tx,
    cancelled.map(({ enrollmentId, reason: cancellationReason }) => ({
      kind: 'cancelled' as const,
      enrollmentId,
      cancellationReason,
      occurredAt: at,
    })),
  );
  return { released, cancelled, keptPending };
}

/**
 * Releases the still-active holds of `holdIds` without conversion, cancelling each one's enrollment
 * awaiting payment with `reason` and one `enrollment_events` row, on the caller's transaction (FR-363).
 * Under `'expired'` only a hold expired at `at` is released. An enrollment with a paid order stays
 * awaiting payment, with no row, except under `'slot_unavailable'`. Locks the holds, then their
 * enrollments, then (through `orders`) their orders; the caller holds nothing after the slot.
 */
export function releaseHolds(
  tx: Transaction,
  holdIds: readonly string[],
  reason: ReleaseReason,
  dependencies: ReleaseDependencies,
): Promise<ReleasedHolds> {
  return release(tx, holdIds, reason, dependencies, []);
}

/**
 * Releases the expired holds on `scope.slotId` and of `scope.studentUserId` as `releaseHolds` does
 * under `'expired'` (FR-351, FR-BOOK-9); the locks as `releaseHolds`'.
 */
export async function releaseExpiredHolds(
  tx: Transaction,
  scope: HoldScope,
  dependencies: ReleaseDependencies,
): Promise<ReleasedHolds> {
  const store = dependencies.store ?? holdRows;
  const ids = await store.expiredHoldIds(tx, scope, dependencies.at);
  return release(tx, ids, 'expired', dependencies, []);
}

/** The student placing a hold, from the session: never from input (R-GENDER-4). */
export interface HoldStudent {
  readonly userId: string;
  readonly gender: RequesterGender;
}

export interface HoldRequest {
  readonly packageId: string;
  readonly slotId: string;
}

/** A placed hold, with what the checkout shows: the package, the slot and its first and last sessions. */
export interface PlacedHold {
  readonly holdId: string;
  readonly expiresAt: Date;
  readonly package: BookablePackage;
  readonly slot: OfferedSlot;
  readonly firstSession: Occurrence;
  readonly lastSession: Occurrence;
}

export interface PlacementDependencies {
  readonly terms: HoldTerms;
  readonly orders: OrderStandings;
  readonly store?: HoldsStore;
}

/** Writes the hold, naming the database's refusal of a second active one (ERD §15 rules 17–18). */
async function insertNamed(store: HoldRows, tx: Transaction, hold: NewHold): Promise<string> {
  try {
    return await store.insertHold(tx, hold);
  } catch (error) {
    if (isUniqueViolation(error, 'slot_holds_slot_id_active_key')) {
      throw new DomainError('SLOT_TAKEN', undefined, { cause: error });
    }
    if (isUniqueViolation(error, 'slot_holds_student_user_id_active_key')) {
      throw new DomainError('PREVIOUS_CHECKOUT', undefined, { cause: error });
    }
    throw error;
  }
}

/**
 * Places the student's hold on the package's slot, on the caller's transaction (FR-351 to FR-353):
 * the order and the refusals as this file's head says. Takes every lock it needs; the caller holds
 * none. A refusal is thrown, and the caller's transaction must then keep nothing.
 */
export async function placeHold(
  tx: Transaction,
  student: HoldStudent,
  request: HoldRequest,
  dependencies: PlacementDependencies,
): Promise<PlacedHold> {
  const store = dependencies.store ?? holdsStore;
  const { terms } = dependencies;
  const named = await store.packageOf(tx, request.packageId);
  if (named === null) throw new DomainError('NOT_FOUND');
  const teacherUserId = named.teacherUserId;
  if (teacherUserId === student.userId) throw new DomainError('FORBIDDEN');
  await store.lockRows(tx, 'users', sortedUnique([student.userId, teacherUserId]));
  if (!(await store.visible(tx, student.gender, teacherUserId, 'discover'))) {
    throw new DomainError('NOT_FOUND');
  }
  if (!(await store.visible(tx, student.gender, teacherUserId, 'book'))) {
    throw new DomainError('NOT_BOOKABLE');
  }
  if (!(await store.studentActive(tx, student.userId))) {
    throw new DomainError('ACCOUNT_NOT_ACTIVE');
  }
  const pkg = await store.packageOf(tx, request.packageId);
  if (pkg === null) throw new DomainError('NOT_FOUND');
  await store.lockRows(tx, 'availability_slots', [request.slotId]);
  const slot = (await store.offeredSlotsOf(tx, [teacherUserId])).find(
    ({ id, durationMinutes }) =>
      id === request.slotId && durationMinutes === pkg.sessionDurationMinutes,
  );
  if (slot === undefined) throw new DomainError('NOT_FOUND');
  await releaseExpiredHolds(
    tx,
    { slotId: slot.id, studentUserId: student.userId },
    { at: terms.now, orders: dependencies.orders, store },
  );
  const active = await store.activeHoldsOf(tx, {
    slotId: slot.id,
    studentUserId: student.userId,
  });
  if (active.some(({ studentUserId }) => studentUserId === student.userId)) {
    throw new DomainError('PREVIOUS_CHECKOUT');
  }
  if (active.length > 0) throw new DomainError('SLOT_TAKEN');
  const occupancy = await store.occupancyOf(tx, [slot.id], terms.bufferWeeks);
  const [free] = offerableOccurrences([slot], occupancy, terms);
  if (free === undefined) throw new DomainError('SLOT_TAKEN');
  const expiresAt = expiryOf(terms);
  const holdId = await insertNamed(store, tx, {
    slotId: slot.id,
    studentUserId: student.userId,
    packageId: pkg.id,
    sessionCount: pkg.sessionCount,
    enrollmentId: null,
    expiresAt,
  });
  const sessions = packageSessionsOn(slot, free.first, pkg.sessionCount);
  const parties = { studentUserId: student.userId, teacherUserId };
  if (
    (await freeOfPartiesSessions(tx, store.sessionsBetween, parties, [{ sessions }])).length === 0
  ) {
    throw new DomainError('SLOT_TAKEN');
  }
  return {
    holdId,
    expiresAt,
    package: pkg,
    slot,
    firstSession: free.first,
    lastSession: sessions.at(-1) ?? free.first,
  };
}

/** The enrollment FR-PAYG-19 holds again: its id, its slot and its student. */
export interface EnrollmentToHold {
  readonly id: string;
  readonly slotId: string;
  readonly studentUserId: string;
}

export interface Rehold {
  readonly terms: Pick<HoldTerms, 'now' | 'ttlMinutes' | 'graceMinutes'>;
  readonly orders: OrderStandings;
  readonly store?: HoldRows;
}

/**
 * FR-PAYG-19's new hold for a paid enrollment whose hold was released (for T039): the expired holds
 * on its slot and its student's own released with FR-363's cancellations, then an active hold for
 * the enrollment on its slot, its expiry as a placement's. Expects the caller to hold both accounts
 * (one `lockRows(tx, 'users', …)` call) and the slot; takes the holds, then the enrollments, this
 * one among them, in one call (T005). The database's refusal of a second active hold on the slot or
 * for the student is thrown as it is, for the caller to name (`isUniqueViolation`, R-215).
 */
export async function reholdEnrollment(
  tx: Transaction,
  enrollment: EnrollmentToHold,
  dependencies: Rehold,
): Promise<string> {
  const store = dependencies.store ?? holdRows;
  const at = dependencies.terms.now;
  const ids = await store.expiredHoldIds(
    tx,
    { slotId: enrollment.slotId, studentUserId: enrollment.studentUserId },
    at,
  );
  await release(tx, ids, 'expired', { at, orders: dependencies.orders, store }, [enrollment.id]);
  const terms = await store.enrollmentTerms(tx, enrollment.id);
  if (terms === null) throw new Error('rehold: the enrollment is not there to read');
  return store.insertHold(tx, {
    slotId: enrollment.slotId,
    studentUserId: enrollment.studentUserId,
    packageId: terms.packageId,
    sessionCount: terms.sessionCount,
    enrollmentId: enrollment.id,
    expiresAt: expiryOf(dependencies.terms),
  });
}
