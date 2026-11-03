// T036 — booking's part of the checkout (FR-BOOK-12, FR-356; T005's lock rules), over fakes standing
// for booking's rows, catalog's and identity's entries, payments' orders and T033's placement and
// release. What the fakes show plainly: the order the locks are taken in, that the own hold is
// released before the placement and only when no order on it is payable, and what each branch
// throws. Over the real tables: `tests/db-integrity/checkout.spec.ts`.
import { piasters } from '@ijazah/money';
import type { Occurrence } from '@ijazah/time';
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import type { RequesterGender } from '../../platform/guards/requester-gender.js';
import type { BookablePackage, PackageRow } from '../catalog/index.js';
import type { CheckoutEnrollmentRow } from './checkout-holds.repository.js';
import {
  type CheckoutHoldStore,
  type HeldOrders,
  lockOrderTarget,
  type OrderTargetStore,
  PayableCheckout,
  placeCheckoutHold,
  retryTargetOf,
} from './checkout-holds.service.js';
import type { HeldRow } from './holds.repository.js';
import type { HoldTerms, PlacedHold } from './holds.service.js';

const tx = {} as Transaction;
const female = 'female' as RequesterGender;
const id = (n: number) => `0199d0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const STUDENT = id(10);
const TEACHER = id(90);
const PACKAGE = id(30);
const SLOT = id(40);
const OLD_SLOT = id(41);
const OWN_HOLD = id(50);
const NEW_HOLD = id(51);
const ENROLLMENT = id(60);
const PAYMENT = id(70);

/** Tuesday 2026-11-03, 10:00 in Cairo. */
const NOW = new Date('2026-11-03T08:00:00Z');
const PAST = new Date('2026-11-03T07:59:00Z');
const LATER = new Date('2026-11-03T08:10:00Z');

const terms: HoldTerms = {
  now: NOW,
  ttlMinutes: 10,
  graceMinutes: 5,
  leadHours: 24,
  bufferWeeks: async () => 0,
};

const bookable: BookablePackage = {
  id: PACKAGE,
  teacherUserId: TEACHER,
  sessionCount: 4,
  sessionDurationMinutes: 60,
};
const row: PackageRow = {
  id: PACKAGE,
  subject: { id: id(5), nameAr: 'تجويد', nameEn: 'Tajweed' },
  track: 'recitation',
  sessionCount: 4,
  sessionDurationMinutes: 60,
  price_piasters: piasters(100_000),
  isActive: true,
};
const occurrence = (date: string): Occurrence =>
  ({
    requestedLocalDate: date,
    requestedStartTimeLocal: '09:00',
    startsAt: `${date}T07:00:00.000Z`,
    endsAt: `${date}T08:00:00.000Z`,
  }) as unknown as Occurrence;

interface World {
  readonly pkg?: BookablePackage | null;
  readonly own?: HeldRow | null;
  readonly ownStillActive?: boolean;
  readonly orders?: HeldOrders;
  readonly name?: string | null;
}

function setUp(world: World = {}) {
  const log: unknown[][] = [];
  const store: CheckoutHoldStore = {
    lockRows: async (_tx, table, ids) => void log.push(['lock', table, [...ids]]),
    packageOf: async () => (world.pkg === undefined ? bookable : world.pkg),
    ownActiveHold: async () => world.own ?? null,
    activeHoldsByIds: async () =>
      world.own === undefined || world.own === null || world.ownStillActive === false
        ? []
        : [world.own],
    teacherPackageOf: async () => row,
    teacherName: async () => (world.name === undefined ? 'الشيخ' : world.name),
  };
  const placed: PlacedHold = {
    holdId: NEW_HOLD,
    expiresAt: new Date('2026-11-03T08:15:00Z'),
    package: bookable,
    slot: {
      id: SLOT,
      teacherUserId: TEACHER,
      dayOfWeek: 4,
      startTimeLocal: '09:00:00',
      durationMinutes: 60,
      timezone: 'Africa/Cairo',
    },
    firstSession: occurrence('2026-11-05'),
    lastSession: occurrence('2026-11-26'),
  };
  const run = () =>
    placeCheckoutHold(
      tx,
      { userId: STUDENT, gender: female },
      { packageId: PACKAGE, slotId: SLOT },
      {
        terms,
        orders: async () => new Map(),
        heldOrders: async (_tx, enrollmentId) => {
          log.push(['orders', enrollmentId]);
          return world.orders ?? { payable: null, paid: false };
        },
        store,
        place: async () => {
          log.push(['place']);
          return placed;
        },
        release: async (_tx, ids, reason) => {
          log.push(['release', [...ids], reason]);
          return { released: [...ids], cancelled: [], keptPending: [] };
        },
      },
    );
  return { log, run };
}

const ownHold = (values: Partial<HeldRow> = {}): HeldRow => ({
  id: OWN_HOLD,
  slotId: OLD_SLOT,
  studentUserId: STUDENT,
  enrollmentId: ENROLLMENT,
  expiresAt: LATER,
  ...values,
});

async function thrown(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected a refusal');
    },
    (error: unknown) => error,
  );
}

describe('placeCheckoutHold: FR-BOOK-12 (a), the own hold with no payable order', () => {
  it('locks both accounts in one call, the slot, the own hold, its enrollment, asks its orders, releases it checkout_abandoned, then places', async () => {
    const { log, run } = setUp({ own: ownHold() });
    await run();
    expect(log).toEqual([
      ['lock', 'users', [STUDENT, TEACHER]],
      ['lock', 'availability_slots', [SLOT]],
      ['lock', 'slot_holds', [OWN_HOLD]],
      ['lock', 'enrollments', [ENROLLMENT]],
      ['orders', ENROLLMENT],
      ['release', [OWN_HOLD], 'checkout_abandoned'],
      ['place'],
    ]);
  });

  it('releases an own hold with no enrollment without asking for orders', async () => {
    const { log, run } = setUp({ own: ownHold({ enrollmentId: null }) });
    await run();
    expect(log.filter(([kind]) => kind !== 'lock')).toEqual([
      ['release', [OWN_HOLD], 'checkout_abandoned'],
      ['place'],
    ]);
  });

  it('leaves an expired own hold, and one released meanwhile, to the placement', async () => {
    for (const world of [{ own: ownHold({ expiresAt: PAST }) }, { own: ownHold(), ownStillActive: false }]) {
      const { log, run } = setUp(world);
      await run();
      expect(log.some(([kind]) => kind === 'release')).toBe(false);
      expect(log.at(-1)).toEqual(['place']);
    }
  });

  it('answers the hold with the summary in FR-358’s order and the previews', async () => {
    const { run } = setUp();
    const answer = await run();
    expect(answer).toMatchObject({
      holdId: NEW_HOLD,
      summary: {
        teacher: { teacherId: TEACHER, displayName: 'الشيخ' },
        subject: row.subject,
        track: 'recitation',
        sessionCount: 4,
        sessionDurationMinutes: 60,
        price_piasters: 100_000,
      },
    });
    expect(answer.firstSession.requestedLocalDate).toBe('2026-11-05');
  });

  it('locks nothing before the placement for an unknown package and for the buyer who is the teacher', async () => {
    for (const pkg of [null, { ...bookable, teacherUserId: STUDENT }]) {
      const { log, run } = setUp({ pkg, own: ownHold() });
      await run();
      expect(log).toEqual([['place']]);
    }
  });
});

describe('placeCheckoutHold: FR-BOOK-12 (b), the own hold with a payable or paid order', () => {
  it('throws PayableCheckout with the order, releasing nothing and placing nothing', async () => {
    const order = { paymentId: PAYMENT, gatewayOrderId: 'fake_ord_1', expiresAt: LATER };
    const { log, run } = setUp({ own: ownHold(), orders: { payable: order, paid: false } });
    const error = await thrown(run());
    expect(error).toBeInstanceOf(PayableCheckout);
    expect((error as PayableCheckout).order).toEqual(order);
    expect((error as PayableCheckout).enrollmentId).toBe(ENROLLMENT);
    expect(log.some(([kind]) => kind === 'release' || kind === 'place')).toBe(false);
  });

  it('refuses PREVIOUS_CHECKOUT as processing when an order on it is paid', async () => {
    const { log, run } = setUp({ own: ownHold(), orders: { payable: null, paid: true } });
    const error = await thrown(run());
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe('PREVIOUS_CHECKOUT');
    expect((error as DomainError).details).toEqual([
      { path: 'enrollmentId', code: ENROLLMENT },
      { path: 'state', code: 'processing' },
    ]);
    expect(log.some(([kind]) => kind === 'release' || kind === 'place')).toBe(false);
  });
});

const enrollment = (values: Partial<CheckoutEnrollmentRow> = {}): CheckoutEnrollmentRow => ({
  id: ENROLLMENT,
  studentUserId: STUDENT,
  teacherUserId: TEACHER,
  packageId: PACKAGE,
  slotId: SLOT,
  status: 'pending_payment',
  cancellationReason: null,
  snapshotPricePiasters: 100_000n,
  snapshotSessionCount: 4,
  snapshotDurationMinutes: 60,
  snapshotSubjectId: id(5),
  snapshotSlotTimezone: 'Africa/Cairo',
  snapshotTrack: 'recitation',
  quotedFirstSessionLocalDate: new Date('2026-11-05T00:00:00Z'),
  ...values,
});

function targetStore(world: {
  enrollment?: CheckoutEnrollmentRow | null;
  hold?: HeldRow | null;
  status?: CheckoutEnrollmentRow['status'] | null;
}) {
  const log: unknown[][] = [];
  const store: OrderTargetStore = {
    lockRows: async (_tx, table, ids) => void log.push(['lock', table, [...ids]]),
    studentEnrollment: async () =>
      world.enrollment === undefined ? enrollment() : world.enrollment,
    activeHoldOfEnrollment: async () => world.hold ?? null,
    activeHoldsByIds: async () => (world.hold === undefined || world.hold === null ? [] : [world.hold]),
    enrollmentStatus: async () => (world.status === undefined ? 'pending_payment' : world.status),
  };
  return { log, store };
}

describe('retryTargetOf: only the student’s own enrollment (M3)', () => {
  it('answers NOT_FOUND for another student’s enrollment and an unknown one', async () => {
    const { store } = targetStore({ enrollment: null });
    const error = await thrown(retryTargetOf(tx, STUDENT, ENROLLMENT, store));
    expect((error as DomainError).code).toBe('NOT_FOUND');
  });

  it('answers the enrollment and its active hold', async () => {
    const hold = ownHold();
    const { store } = targetStore({ hold });
    await expect(retryTargetOf(tx, STUDENT, ENROLLMENT, store)).resolves.toEqual({
      enrollment: enrollment(),
      hold,
    });
  });
});

describe('lockOrderTarget: the hold, then the enrollment, read again under the locks (FR-356, T005)', () => {
  const target = { holdId: OWN_HOLD, enrollmentId: ENROLLMENT, studentUserId: STUDENT };
  const payable = () => true;

  it('locks the hold, then the enrollment, and passes while all holds', async () => {
    const { log, store } = targetStore({ hold: ownHold() });
    await lockOrderTarget(tx, target, payable, store);
    expect(log).toEqual([
      ['lock', 'slot_holds', [OWN_HOLD]],
      ['lock', 'enrollments', [ENROLLMENT]],
    ]);
  });

  it.each([
    ['the hold released meanwhile', { hold: null }],
    ['the hold linked to another enrollment', { hold: ownHold({ enrollmentId: id(61) }) }],
    ['the enrollment cancelled meanwhile', { hold: ownHold(), status: 'cancelled' as const }],
  ])('refuses ORDER_NOT_PAYABLE for %s', async (_name, world) => {
    const { store } = targetStore(world);
    const error = await thrown(lockOrderTarget(tx, target, payable, store));
    expect((error as DomainError).code).toBe('ORDER_NOT_PAYABLE');
  });

  it('refuses ORDER_NOT_PAYABLE past the last moment an order may be created on the hold', async () => {
    const { store } = targetStore({ hold: ownHold() });
    const error = await thrown(lockOrderTarget(tx, target, () => false, store));
    expect((error as DomainError).code).toBe('ORDER_NOT_PAYABLE');
  });
});
