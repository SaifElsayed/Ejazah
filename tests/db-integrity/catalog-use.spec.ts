// T020 — booking's answers to catalog's `CatalogUse` port over the real tables (R-207, FR-312,
// FR-318; specs/003-booking/contracts/kernel.md "The composition root").
//
// A slot is in use while an active hold (`released_at IS NULL`) or an enrollment awaiting payment or
// confirmed uses it; a released hold, a cancelled enrollment and a soft-deleted one do not count,
// and another slot's rows never do. A package has an enrollment once any live enrollment, of any
// status, was made on it. T018 adds each package's count, every live enrollment and the confirmed
// ones, for the teacher's list. The answers are reached through booking's entry, as `main.ts` binds them.
//
// The parents an enrollment needs (two people, a subject, a package, a slot) are written by this
// file on the probe's own transaction: a helper under `tests/` may write any table (R-API-6 binds
// `apps/api`), and every probe rolls back, so nothing is left behind.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  packageEnrollmentCounts,
  packageHasEnrollment,
  slotInUse,
} from '../../apps/api/src/modules/booking/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';

let database: Database;

beforeAll(() => {
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 2,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
});

afterAll(async () => {
  await closeDatabase(database);
});

const ROLLED_BACK = Symbol('rolled back');

/** Runs `probe` on one transaction and rolls back whatever it wrote. */
async function rolledBack(probe: (tx: Transaction) => Promise<void>): Promise<void> {
  try {
    await database.$transaction(
      async (tx) => {
        await probe(tx);
        throw ROLLED_BACK;
      },
      { timeout: 30_000 },
    );
  } catch (thrown) {
    if (thrown !== ROLLED_BACK) throw thrown;
  }
}

function person(tx: Transaction): Promise<{ id: string }> {
  return tx.user.create({
    data: {
      email: `probe-${randomUUID()}@example.invalid`,
      gender: 'male',
      dateOfBirth: new Date('1990-01-01T00:00:00Z'),
      displayName: 'Probe user',
      preferredLanguage: 'ar',
      timezone: 'Africa/Cairo',
      accountStatus: 'active',
    },
    select: { id: true },
  });
}

interface Offer {
  readonly teacherId: string;
  readonly subjectId: string;
  readonly packageId: string;
  readonly slotId: string;
}

/** A teacher's package and weekly slot, with a second package and slot of the same teacher. */
async function offer(
  tx: Transaction,
): Promise<Offer & { otherPackageId: string; otherSlotId: string }> {
  const teacherId = (await person(tx)).id;
  const { id: subjectId } = await tx.subject.create({
    data: { nameAr: 'مادة', nameEn: 'Subject', isActive: true },
    select: { id: true },
  });
  const pack = () =>
    tx.package.create({
      data: {
        teacherUserId: teacherId,
        subjectId,
        sessionCount: 4,
        sessionDurationMinutes: 60,
        pricePiasters: 100_000n,
        isActive: true,
      },
      select: { id: true },
    });
  const slot = (dayOfWeek: number) =>
    tx.availabilitySlot.create({
      data: {
        teacherUserId: teacherId,
        dayOfWeek,
        startTimeLocal: new Date('1970-01-01T09:00:00Z'),
        durationMinutes: 60,
        timezone: 'Africa/Cairo',
        isActive: true,
      },
      select: { id: true },
    });
  const [packageId, otherPackageId, slotId, otherSlotId] = [
    (await pack()).id,
    (await pack()).id,
    (await slot(0)).id,
    (await slot(2)).id,
  ];
  return { teacherId, subjectId, packageId, slotId, otherPackageId, otherSlotId };
}

type EnrollmentState =
  | { readonly status: 'pending_payment' }
  | { readonly status: 'confirmed' }
  | { readonly status: 'cancelled' }
  | { readonly status: 'completed' };

/** One enrollment of a fresh student on `on`'s package and slot, in `state`. */
async function enrollment(
  tx: Transaction,
  on: Offer,
  state: EnrollmentState,
  options: { readonly deleted?: boolean } = {},
): Promise<string> {
  const studentId = (await person(tx)).id;
  const { id } = await tx.enrollment.create({
    data: {
      studentUserId: studentId,
      teacherUserId: on.teacherId,
      packageId: on.packageId,
      slotId: on.slotId,
      snapshotPricePiasters: 100_000n,
      snapshotSessionCount: 4,
      snapshotDurationMinutes: 60,
      snapshotSubjectId: on.subjectId,
      snapshotSlotTimezone: 'Africa/Cairo',
      status: state.status,
      ...(state.status === 'confirmed' || state.status === 'completed'
        ? { confirmedAt: new Date('2026-10-04T07:01:00Z') }
        : {}),
      ...(state.status === 'cancelled' ? { cancellationReason: 'payment_expired' as const } : {}),
      ...(options.deleted === true ? { deletedAt: new Date('2026-10-05T07:00:00Z') } : {}),
      purchasedAt: new Date('2026-10-04T07:00:00Z'),
      quotedFirstSessionLocalDate: new Date('2026-10-11T00:00:00Z'),
    },
    select: { id: true },
  });
  return id;
}

/** One hold of `slotId` by a fresh student, active unless `released`. */
async function hold(tx: Transaction, slotId: string, released: boolean): Promise<void> {
  const studentId = (await person(tx)).id;
  await tx.slotHold.create({
    data: {
      slotId,
      studentUserId: studentId,
      expiresAt: new Date('2026-10-04T07:20:00Z'),
      ...(released ? { releasedAt: new Date('2026-10-04T07:10:00Z') } : {}),
    },
  });
}

/**
 * R-205's release as T026 brings it: these probes write no session, so a confirmed enrollment keeps
 * its slot whatever the clock (`discovery-slots.spec.ts` has the release week).
 */
const RELEASE = { now: () => new Date('2026-10-04T08:00:00Z'), bufferWeeks: async () => 0 };

describe('slotInUse (T020, R-207, FR-318)', () => {
  it('answers false for a slot no hold and no enrollment uses', async () => {
    await rolledBack(async (tx) => {
      const on = await offer(tx);
      expect(await slotInUse(tx, on.slotId, RELEASE)).toBe(false);
    });
  });

  it('answers true while an active hold uses the slot, and false once it is released', async () => {
    await rolledBack(async (tx) => {
      const on = await offer(tx);
      await hold(tx, on.slotId, true);
      expect(await slotInUse(tx, on.slotId, RELEASE)).toBe(false);
      await hold(tx, on.slotId, false);
      expect(await slotInUse(tx, on.slotId, RELEASE)).toBe(true);
    });
  });

  it('answers true while an enrollment awaiting payment uses the slot', async () => {
    await rolledBack(async (tx) => {
      const on = await offer(tx);
      await enrollment(tx, on, { status: 'pending_payment' });
      expect(await slotInUse(tx, on.slotId, RELEASE)).toBe(true);
    });
  });

  it('answers true while a confirmed enrollment uses the slot', async () => {
    await rolledBack(async (tx) => {
      const on = await offer(tx);
      await enrollment(tx, on, { status: 'confirmed' });
      expect(await slotInUse(tx, on.slotId, RELEASE)).toBe(true);
    });
  });

  it('answers false for a slot only a cancelled or a completed enrollment used', async () => {
    await rolledBack(async (tx) => {
      const on = await offer(tx);
      await enrollment(tx, on, { status: 'cancelled' });
      await enrollment(tx, on, { status: 'completed' });
      expect(await slotInUse(tx, on.slotId, RELEASE)).toBe(false);
    });
  });

  it('leaves a soft-deleted enrollment out', async () => {
    await rolledBack(async (tx) => {
      const on = await offer(tx);
      await enrollment(tx, on, { status: 'confirmed' }, { deleted: true });
      expect(await slotInUse(tx, on.slotId, RELEASE)).toBe(false);
    });
  });

  it("never counts another slot's hold or enrollment", async () => {
    await rolledBack(async (tx) => {
      const on = await offer(tx);
      await hold(tx, on.slotId, false);
      await enrollment(tx, on, { status: 'confirmed' });
      expect(await slotInUse(tx, on.otherSlotId, RELEASE)).toBe(false);
    });
  });
});

describe('packageHasEnrollment (T020, R-207, FR-312)', () => {
  it('answers false for a package no enrollment was made on', async () => {
    await rolledBack(async (tx) => {
      const on = await offer(tx);
      expect(await packageHasEnrollment(tx, on.packageId)).toBe(false);
    });
  });

  it('answers true once any enrollment was made on it, a cancelled one included', async () => {
    await rolledBack(async (tx) => {
      const on = await offer(tx);
      await enrollment(tx, on, { status: 'cancelled' });
      expect(await packageHasEnrollment(tx, on.packageId)).toBe(true);
    });
  });

  it("never counts another package's enrollment, nor a soft-deleted one", async () => {
    await rolledBack(async (tx) => {
      const on = await offer(tx);
      await enrollment(tx, on, { status: 'confirmed' });
      const other = { ...on, packageId: on.otherPackageId };
      await enrollment(tx, other, { status: 'confirmed' }, { deleted: true });
      expect(await packageHasEnrollment(tx, on.otherPackageId)).toBe(false);
    });
  });
});

describe('packageEnrollmentCounts (T018, the teacher list’s `frozen` and `activeEnrollmentCount`)', () => {
  it('answers no entry for a package with no enrollment, and an empty map for no package', async () => {
    await rolledBack(async (tx) => {
      const on = await offer(tx);
      expect(await packageEnrollmentCounts(tx, [on.packageId])).toEqual(new Map());
      expect(await packageEnrollmentCounts(tx, [])).toEqual(new Map());
    });
  });

  it('counts every live enrollment of each package, and its confirmed ones, in one answer', async () => {
    await rolledBack(async (tx) => {
      const on = await offer(tx);
      await enrollment(tx, on, { status: 'confirmed' });
      await enrollment(tx, on, { status: 'confirmed' });
      await enrollment(tx, on, { status: 'pending_payment' });
      await enrollment(tx, on, { status: 'cancelled' });
      await enrollment(tx, on, { status: 'completed' });
      await enrollment(tx, on, { status: 'confirmed' }, { deleted: true });
      const other = { ...on, packageId: on.otherPackageId };
      await enrollment(tx, other, { status: 'cancelled' });
      expect(await packageEnrollmentCounts(tx, [on.packageId, on.otherPackageId])).toEqual(
        new Map([
          [on.packageId, { total: 5, active: 2 }],
          [on.otherPackageId, { total: 1, active: 0 }],
        ]),
      );
      expect(await packageEnrollmentCounts(tx, [on.otherPackageId])).toEqual(
        new Map([[on.otherPackageId, { total: 1, active: 0 }]]),
      );
    });
  });
});
