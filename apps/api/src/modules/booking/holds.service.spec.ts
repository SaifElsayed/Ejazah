// T033 — holds (FR-351 to FR-353, FR-363, R-208, R-216; T005's lock rules), over a store of fakes
// standing for booking's rows, catalog's, identity's and sessions' entries and payments' order
// standing. What the fakes let a spec see that the database cannot show as plainly: the order the
// locks are taken in, that a refusal before the insert writes nothing, the reason each release
// cancels with, and that an enrollment with a paid order is left awaiting payment. Over the real
// tables, with the concurrency probes, `tests/db-integrity/holds.spec.ts` and
// `tests/db-integrity/hold-concurrency.spec.ts`.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import type { RequesterGender } from '../../platform/guards/requester-gender.js';
import type { BookablePackage, OfferedSlot } from '../catalog/index.js';
import type { SessionTime } from '../sessions/index.js';
import type { EnrollmentOutcome } from './enrollment-events.repository.js';
import {
  type HeldRow,
  type HoldsStore,
  type HoldTerms,
  type OrderStanding,
  placeHold,
  releaseExpiredHolds,
  releaseHolds,
  reholdEnrollment,
} from './holds.service.js';
import type { SlotOccupancy } from './slot-occupancy.service.js';

const tx = {} as Transaction;
const female = 'female' as RequesterGender;
const CAIRO = 'Africa/Cairo';

// Ids in UUIDv7's shape, ordered as their names say.
const id = (n: number) => `0199d0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const TEACHER = id(90);
const STUDENT = id(10);
const OTHER = id(20);
const PACKAGE = id(30);
const SLOT = id(40);
const ELSEWHERE = id(41);

/** Tuesday 2026-11-03, 10:00 in Cairo. */
const NOW = new Date('2026-11-03T08:00:00Z');
const PAST = new Date('2026-11-03T07:00:00Z');
const LATER = new Date('2026-11-03T08:10:00Z');

const sixtyMinutes: BookablePackage = {
  id: PACKAGE,
  teacherUserId: TEACHER,
  sessionCount: 4,
  sessionDurationMinutes: 60,
};
const thursday: OfferedSlot = {
  id: SLOT,
  teacherUserId: TEACHER,
  dayOfWeek: 4,
  startTimeLocal: '09:00:00',
  durationMinutes: 60,
  timezone: CAIRO,
};

interface Hold extends HeldRow {
  releasedAt: Date | null;
}

interface World {
  pkg?: BookablePackage | null;
  discoverable?: boolean;
  bookable?: boolean;
  studentActive?: boolean;
  slots?: readonly OfferedSlot[];
  occupancy?: ReadonlyMap<string, SlotOccupancy>;
  sessions?: readonly SessionTime[];
  holds?: Hold[];
  pending?: string[];
  standings?: ReadonlyMap<string, OrderStanding>;
}

/** A store over `world`: every lock, read of the order standing and write is logged in order. */
function storeOf(world: World) {
  const log: unknown[][] = [];
  const holds = world.holds ?? [];
  const pending = new Set(world.pending ?? []);
  const cancelled = new Map<string, string>();
  const events: EnrollmentOutcome[] = [];
  const inserted: Hold[] = [];
  const active = (hold: Hold) => hold.releasedAt === null;
  const store: HoldsStore = {
    lockRows: async (_tx, table, ids) => void log.push(['lock', table, [...ids]]),
    packageOf: async () => (world.pkg === undefined ? sixtyMinutes : world.pkg),
    visible: async (_tx, _requester, _teacher, purpose) =>
      purpose === 'discover' ? (world.discoverable ?? true) : (world.bookable ?? true),
    studentActive: async () => world.studentActive ?? true,
    offeredSlotsOf: async () => [...(world.slots ?? [thursday])],
    occupancyOf: async () => world.occupancy ?? new Map(),
    sessionsBetween: async () => world.sessions ?? [],
    expiredHoldIds: async (_tx, scope, at) =>
      holds
        .filter(
          (hold) =>
            active(hold) &&
            hold.expiresAt <= at &&
            (hold.slotId === scope.slotId || hold.studentUserId === scope.studentUserId),
        )
        .map((hold) => hold.id)
        .toSorted(),
    activeHoldsByIds: async (_tx, ids) =>
      holds
        .filter((hold) => active(hold) && ids.includes(hold.id))
        .toSorted((a, b) => (a.id < b.id ? -1 : 1)),
    activeHoldsOf: async (_tx, scope) =>
      holds.filter(
        (hold) =>
          active(hold) &&
          (hold.slotId === scope.slotId || hold.studentUserId === scope.studentUserId),
      ),
    markReleased: async (_tx, ids, at) => {
      log.push(['release', [...ids]]);
      for (const hold of holds) if (ids.includes(hold.id)) hold.releasedAt = at;
    },
    pendingAmong: async (_tx, ids) => ids.filter((one) => pending.has(one)),
    cancelPending: async (_tx, ids, reason) => {
      log.push(['cancel', [...ids], reason]);
      for (const one of ids) {
        pending.delete(one);
        cancelled.set(one, reason);
      }
    },
    recordEvents: async (_tx, outcomes) => {
      log.push(['events', outcomes.length]);
      events.push(...outcomes);
    },
    enrollmentTerms: async () => ({ packageId: PACKAGE, sessionCount: 4 }),
    insertHold: async (_tx, hold) => {
      log.push(['insert', hold]);
      const row = { ...hold, id: id(100 + inserted.length), releasedAt: null };
      inserted.push(row);
      holds.push(row);
      return row.id;
    },
  };
  const orders = async (_tx: Transaction, enrollmentIds: readonly string[]) => {
    log.push(['orders', [...enrollmentIds]]);
    return new Map(
      [...(world.standings ?? new Map<string, OrderStanding>())].filter(([enrollment]) =>
        enrollmentIds.includes(enrollment),
      ),
    );
  };
  return { store, orders, log, holds, pending, cancelled, events, inserted };
}

const terms: HoldTerms = {
  now: NOW,
  ttlMinutes: 10,
  graceMinutes: 5,
  leadHours: 24,
  bufferWeeks: async () => 0,
};

const hold = (
  holdId: string,
  values: Partial<Hold> & Pick<Hold, 'slotId' | 'studentUserId'>,
): Hold => ({ id: holdId, enrollmentId: null, expiresAt: PAST, releasedAt: null, ...values });

function place(world: World, request = { packageId: PACKAGE, slotId: SLOT }) {
  const fake = storeOf(world);
  const answer = placeHold(tx, { userId: STUDENT, gender: female }, request, {
    terms,
    orders: fake.orders,
    store: fake.store,
  });
  return { ...fake, answer };
}

const writes = (log: unknown[][]) =>
  log.filter(([kind]) => ['release', 'cancel', 'events', 'insert'].includes(kind as string));

describe("placeHold: FR-353's refusals write nothing", () => {
  it.each<[string, World, string]>([
    ['an unknown or inactive package', { pkg: null }, 'NOT_FOUND'],
    ['a teacher the predicate hides', { discoverable: false, bookable: false }, 'NOT_FOUND'],
    ['a visible teacher whose account is not active (T143)', { bookable: false }, 'NOT_BOOKABLE'],
    [
      "the student's own account not active (FR-VERIFY-10)",
      { studentActive: false },
      'ACCOUNT_NOT_ACTIVE',
    ],
    ["a slot not among the package's teacher's (round 2 N2)", { slots: [] }, 'NOT_FOUND'],
    ['a slot of another length', { slots: [{ ...thursday, durationMinutes: 45 }] }, 'NOT_FOUND'],
  ])('refuses %s', async (_label, world, code) => {
    const placing = place({
      ...world,
      holds: [hold(id(1), { slotId: SLOT, studentUserId: OTHER, enrollmentId: id(2) })],
      pending: [id(2)],
    });
    await expect(placing.answer).rejects.toEqual(new DomainError(code as 'NOT_FOUND'));
    expect(writes(placing.log)).toEqual([]);
  });

  it('refuses the buyer who is the teacher (FR-BOOK-11) before any lock', async () => {
    const placing = place({ pkg: { ...sixtyMinutes, teacherUserId: STUDENT } });
    await expect(placing.answer).rejects.toEqual(new DomainError('FORBIDDEN'));
    expect(placing.log).toEqual([]);
  });

  it('locks nothing for an unknown package', async () => {
    const placing = place({ pkg: null });
    await expect(placing.answer).rejects.toThrow(DomainError);
    expect(placing.log).toEqual([]);
  });
});

describe('placeHold: the order (FR-351, T005)', () => {
  it('locks both accounts in one call, then the slot, the expired holds, their enrollments, then asks their orders; releases, then inserts', async () => {
    const placing = place({
      holds: [
        hold(id(3), { slotId: ELSEWHERE, studentUserId: STUDENT, enrollmentId: id(6) }),
        hold(id(1), { slotId: SLOT, studentUserId: OTHER, enrollmentId: id(5) }),
      ],
      pending: [id(5), id(6)],
    });
    const placed = await placing.answer;
    expect(
      placing.log.map(([kind, ...rest]) => (kind === 'insert' ? [kind] : [kind, ...rest])),
    ).toEqual([
      ['lock', 'users', [STUDENT, TEACHER]],
      ['lock', 'availability_slots', [SLOT]],
      ['lock', 'slot_holds', [id(1), id(3)]],
      ['lock', 'enrollments', [id(5), id(6)]],
      ['orders', [id(5), id(6)]],
      ['release', [id(1), id(3)]],
      ['cancel', [id(5), id(6)], 'payment_expired'],
      ['events', 2],
      ['insert'],
    ]);
    expect(placed.holdId).toBe(placing.inserted[0]?.id);
  });

  it('inserts the hold for the checkout time plus the grace from now, with no enrollment (FR-BOOK-9)', async () => {
    const placing = place({});
    const placed = await placing.answer;
    expect(placing.inserted).toEqual([
      expect.objectContaining({
        slotId: SLOT,
        studentUserId: STUDENT,
        packageId: PACKAGE,
        sessionCount: 4,
        enrollmentId: null,
        expiresAt: new Date('2026-11-03T08:15:00Z'),
      }),
    ]);
    expect(placed.expiresAt).toEqual(new Date('2026-11-03T08:15:00Z'));
    expect(placed.firstSession.requestedLocalDate).toBe('2026-11-05');
    expect(placed.lastSession.requestedLocalDate).toBe('2026-11-26');
  });
});

describe('placeHold: SLOT_TAKEN and PREVIOUS_CHECKOUT', () => {
  it('answers SLOT_TAKEN for a slot another student holds unexpired, writing nothing', async () => {
    const placing = place({
      holds: [hold(id(1), { slotId: SLOT, studentUserId: OTHER, expiresAt: LATER })],
    });
    await expect(placing.answer).rejects.toEqual(new DomainError('SLOT_TAKEN'));
    expect(writes(placing.log)).toEqual([]);
  });

  it('answers SLOT_TAKEN for a slot an enrollment occupies', async () => {
    const placing = place({ occupancy: new Map([[SLOT, { kind: 'taken' }]]) });
    await expect(placing.answer).rejects.toEqual(new DomainError('SLOT_TAKEN'));
    expect(placing.inserted).toEqual([]);
  });

  it("answers SLOT_TAKEN when the package's third session would overlap one of the parties' sessions, after the insert", async () => {
    const placing = place({
      sessions: [
        { startsAt: new Date('2026-11-19T07:30:00Z'), endsAt: new Date('2026-11-19T08:30:00Z') },
      ],
    });
    await expect(placing.answer).rejects.toEqual(new DomainError('SLOT_TAKEN'));
    expect(placing.inserted).toHaveLength(1);
  });

  it("answers PREVIOUS_CHECKOUT while the student's own hold has not expired (FR-BOOK-12 is the caller's)", async () => {
    const placing = place({
      holds: [hold(id(1), { slotId: ELSEWHERE, studentUserId: STUDENT, expiresAt: LATER })],
    });
    await expect(placing.answer).rejects.toEqual(new DomainError('PREVIOUS_CHECKOUT'));
    expect(writes(placing.log)).toEqual([]);
  });
});

describe('releaseHolds: FR-363 and the paid order (the owner’s decision of 2026-11-03)', () => {
  function release(
    world: World,
    holdIds: readonly string[],
    reason: Parameters<typeof releaseHolds>[2],
  ) {
    const fake = storeOf(world);
    const answer = releaseHolds(tx, holdIds, reason, {
      at: NOW,
      orders: fake.orders,
      store: fake.store,
    });
    return { ...fake, answer };
  }

  it('cancels an expired hold’s enrollment payment_failed when its last order failed, payment_expired otherwise, one event each', async () => {
    const released = release(
      {
        holds: [
          hold(id(1), { slotId: SLOT, studentUserId: STUDENT, enrollmentId: id(5) }),
          hold(id(2), { slotId: ELSEWHERE, studentUserId: OTHER, enrollmentId: id(6) }),
        ],
        pending: [id(5), id(6)],
        standings: new Map([[id(5), { paid: false, lastFailed: true }]]),
      },
      [id(1), id(2)],
      'expired',
    );
    await released.answer;
    expect([...released.cancelled]).toEqual([
      [id(5), 'payment_failed'],
      [id(6), 'payment_expired'],
    ]);
    expect(released.events).toEqual([
      {
        kind: 'cancelled',
        enrollmentId: id(5),
        cancellationReason: 'payment_failed',
        occurredAt: NOW,
      },
      {
        kind: 'cancelled',
        enrollmentId: id(6),
        cancellationReason: 'payment_expired',
        occurredAt: NOW,
      },
    ]);
  });

  it.each(['expired', 'checkout_abandoned', 'teacher_suspended'] as const)(
    'releases a %s hold whose enrollment has a paid order and leaves it awaiting payment, with no event',
    async (reason) => {
      const released = release(
        {
          holds: [hold(id(1), { slotId: SLOT, studentUserId: STUDENT, enrollmentId: id(5) })],
          pending: [id(5)],
          standings: new Map([[id(5), { paid: true, lastFailed: false }]]),
        },
        [id(1)],
        reason,
      );
      expect(await released.answer).toEqual({
        released: [id(1)],
        cancelled: [],
        keptPending: [id(5)],
      });
      expect(released.holds[0]?.releasedAt).toEqual(NOW);
      expect(released.pending.has(id(5))).toBe(true);
      expect(released.events).toEqual([]);
    },
  );

  it("cancels a paid one slot_unavailable: FR-362's refusal of that paid order", async () => {
    const released = release(
      {
        holds: [hold(id(1), { slotId: SLOT, studentUserId: STUDENT, enrollmentId: id(5) })],
        pending: [id(5)],
        standings: new Map([[id(5), { paid: true, lastFailed: false }]]),
      },
      [id(1)],
      'slot_unavailable',
    );
    await released.answer;
    expect([...released.cancelled]).toEqual([[id(5), 'slot_unavailable']]);
  });

  it('leaves a hold already released, and does not release an unexpired one as expired', async () => {
    const released = release(
      {
        holds: [
          hold(id(1), { slotId: SLOT, studentUserId: STUDENT, releasedAt: PAST }),
          hold(id(2), { slotId: ELSEWHERE, studentUserId: OTHER, expiresAt: LATER }),
        ],
      },
      [id(1), id(2)],
      'expired',
    );
    expect(await released.answer).toEqual({ released: [], cancelled: [], keptPending: [] });
    expect(writes(released.log)).toEqual([]);
  });

  it('releases a hold with no enrollment and cancels nothing; an enrollment no longer awaiting payment is not cancelled', async () => {
    const released = release(
      {
        holds: [
          hold(id(1), { slotId: SLOT, studentUserId: STUDENT }),
          hold(id(2), { slotId: ELSEWHERE, studentUserId: OTHER, enrollmentId: id(6) }),
        ],
      },
      [id(1), id(2)],
      'checkout_abandoned',
    );
    expect(await released.answer).toEqual({
      released: [id(1), id(2)],
      cancelled: [],
      keptPending: [],
    });
    expect(released.events).toEqual([]);
  });

  it('takes the holds, then their enrollments, then their orders, each in one call', async () => {
    const released = release(
      {
        holds: [hold(id(2), { slotId: SLOT, studentUserId: STUDENT, enrollmentId: id(6) })],
        pending: [id(6)],
      },
      [id(2)],
      'checkout_abandoned',
    );
    await released.answer;
    expect(released.log.slice(0, 3)).toEqual([
      ['lock', 'slot_holds', [id(2)]],
      ['lock', 'enrollments', [id(6)]],
      ['orders', [id(6)]],
    ]);
  });
});

describe('releaseExpiredHolds: a slot’s and a student’s', () => {
  it('releases the expired holds on the slot and the student’s own, not another slot’s', async () => {
    const fake = storeOf({
      holds: [
        hold(id(1), { slotId: SLOT, studentUserId: OTHER }),
        hold(id(2), { slotId: ELSEWHERE, studentUserId: STUDENT }),
        hold(id(3), { slotId: id(42), studentUserId: id(21) }),
      ],
    });
    const released = await releaseExpiredHolds(
      tx,
      { slotId: SLOT, studentUserId: STUDENT },
      { at: NOW, orders: fake.orders, store: fake.store },
    );
    expect(released.released).toEqual([id(1), id(2)]);
    expect(fake.holds.find((one) => one.id === id(3))?.releasedAt).toBeNull();
  });
});

describe('reholdEnrollment: FR-PAYG-19’s new hold (for T039)', () => {
  it('releases the expired holds, takes the enrollments with the re-held one in one call, and inserts a hold linked to it', async () => {
    const fake = storeOf({
      holds: [hold(id(1), { slotId: SLOT, studentUserId: OTHER, enrollmentId: id(7) })],
      pending: [id(7)],
    });
    const holdId = await reholdEnrollment(
      tx,
      { id: id(5), slotId: SLOT, studentUserId: STUDENT },
      { terms, orders: fake.orders, store: fake.store },
    );
    expect(fake.log.filter(([kind]) => kind === 'lock')).toEqual([
      ['lock', 'slot_holds', [id(1)]],
      ['lock', 'enrollments', [id(5), id(7)]],
    ]);
    expect(fake.inserted).toEqual([
      expect.objectContaining({
        slotId: SLOT,
        studentUserId: STUDENT,
        enrollmentId: id(5),
        // The enrollment's package and snapshot count, read under its lock (B29).
        packageId: PACKAGE,
        sessionCount: 4,
      }),
    ]);
    expect(holdId).toBe(fake.inserted[0]?.id);
  });
});
