// T033 — holds over the real tables (FR-351 to FR-353, FR-363, FR-PAYG-19, R-208, R-216), with the
// stores `main.ts` binds: booking's `holdsStore` over catalog's, identity's and sessions' entries,
// and payments' `orderStandingsOf` for the orders.
//
//   - a placement writes one active hold, for the checkout time plus the grace, with no enrollment;
//   - FR-353's refusals answer their code and write nothing, the predicate in both directions;
//   - the slot's and the student's expired holds are released first, each enrollment awaiting
//     payment cancelled with FR-363's reason and one `enrollment_events` row; an enrollment with a
//     paid order is left awaiting payment, with no row (the owner's decision of 2026-11-03);
//   - the one overlap check: a slot whose third session overlaps the student's own session, or whose
//     fourth overlaps the teacher's, is left out of the sheet and refused by the hold;
//   - a release with a named reason, FR-362's `slot_unavailable` on a paid one, and FR-PAYG-19's
//     re-hold, whose refusal by the database is thrown for the confirm job to name.
//
// Every probe writes its parents on its own transaction and rolls back (as booking-slots.spec.ts).
// What a refused hold keeps once its transaction ends, and the races, are
// `hold-concurrency.spec.ts`.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  bookingSlotsOf,
  bookingSlotsStore,
  type HoldTerms,
  placeHold,
  reholdEnrollment,
  releaseHolds,
} from '../../apps/api/src/modules/booking/index.js';
import { orderStandingsOf } from '../../apps/api/src/modules/payments/index.js';
import { isUniqueViolation } from '../../apps/api/src/platform/db/db-errors.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import { DomainError } from '../../apps/api/src/platform/errors/domain-error.js';
import type { RequesterGender } from '../../apps/api/src/platform/guards/requester-gender.js';

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

const CAIRO = 'Africa/Cairo';
/** Tuesday 2026-11-03 10:00 in Cairo (+02:00 since the October change). */
const NOW = new Date('2026-11-03T08:00:00Z');
/** Before NOW: a hold that expired then is past its time at NOW. */
const EARLIER = new Date('2026-11-03T07:00:00Z');
/** After NOW: a hold expiring then is still running at NOW. */
const LATER = new Date('2026-11-03T08:10:00Z');

const terms: HoldTerms = {
  now: NOW,
  ttlMinutes: 10,
  graceMinutes: 5,
  leadHours: 24,
  bufferWeeks: async () => 0,
};
const orders = orderStandingsOf;

type Gender = 'male' | 'female';
type Standing = 'active' | 'verification_required';

function person(
  tx: Transaction,
  gender: Gender = 'female',
  accountStatus: Standing = 'active',
): Promise<{ id: string }> {
  return tx.user.create({
    data: {
      email: `probe-${randomUUID()}@example.invalid`,
      gender,
      dateOfBirth: new Date('1990-01-01T00:00:00Z'),
      displayName: 'Probe person',
      preferredLanguage: 'ar',
      timezone: CAIRO,
      accountStatus,
    },
    select: { id: true },
  });
}

interface Offer {
  readonly teacherId: string;
  readonly packageId: string;
  readonly subjectId: string;
  /** Thursday 09:00 for 60 minutes. */
  readonly thursday: string;
  /** Saturday 10:00 for 60 minutes. */
  readonly saturday: string;
}

/** The probe's `time` columns, written whole: only packages/time computes (R-TIME-1). */
const TIME_COLUMN = {
  '09:00:00': new Date('1970-01-01T09:00:00Z'),
  '09:30:00': new Date('1970-01-01T09:30:00Z'),
  '10:00:00': new Date('1970-01-01T10:00:00Z'),
} as const;

async function slot(
  tx: Transaction,
  teacherUserId: string,
  values: { day: number; time: keyof typeof TIME_COLUMN; minutes?: number },
): Promise<string> {
  const { id } = await tx.availabilitySlot.create({
    data: {
      teacherUserId,
      dayOfWeek: values.day,
      startTimeLocal: TIME_COLUMN[values.time],
      durationMinutes: values.minutes ?? 60,
      timezone: CAIRO,
      isActive: true,
    },
    select: { id: true },
  });
  return id;
}

/** A Cairo teacher, approved and payable, with a four-session 60-minute package and two slots. */
async function offer(
  tx: Transaction,
  options: { gender?: Gender; standing?: Standing } = {},
): Promise<Offer> {
  const { id: teacherId } = await person(tx, options.gender, options.standing);
  await tx.teacherProfile.create({
    data: {
      userId: teacherId,
      bio: 'Probe',
      qualificationSummary: 'Probe',
      verificationStatus: 'approved',
      payoutVerifiedAt: new Date('2026-10-01T00:00:00Z'),
    },
  });
  const { id: subjectId } = await tx.subject.create({
    data: { nameAr: 'مادة', nameEn: 'Subject', isActive: true },
    select: { id: true },
  });
  const { id: packageId } = await tx.package.create({
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
  const thursday = await slot(tx, teacherId, { day: 4, time: '09:00:00' });
  const saturday = await slot(tx, teacherId, { day: 6, time: '10:00:00' });
  return { teacherId, packageId, subjectId, thursday, saturday };
}

/** An enrollment of `studentId` on `on`'s package and `slotId`. */
async function enrollment(
  tx: Transaction,
  on: Offer,
  slotId: string,
  studentId: string,
  status: 'pending_payment' | 'confirmed' = 'pending_payment',
): Promise<string> {
  const { id } = await tx.enrollment.create({
    data: {
      studentUserId: studentId,
      teacherUserId: on.teacherId,
      packageId: on.packageId,
      slotId,
      snapshotPricePiasters: 100_000n,
      snapshotSessionCount: 4,
      snapshotDurationMinutes: 60,
      snapshotSubjectId: on.subjectId,
      snapshotSlotTimezone: CAIRO,
      status,
      ...(status === 'confirmed' ? { confirmedAt: new Date('2026-10-04T07:01:00Z') } : {}),
      purchasedAt: new Date('2026-10-04T07:00:00Z'),
      quotedFirstSessionLocalDate: new Date('2026-11-05T00:00:00Z'),
    },
    select: { id: true },
  });
  return id;
}

/**
 * A gateway order of the enrollment in `status`, written as the payments module's row by SQL (its
 * amount column is named only there, R-MONEY-6, as `encrypted-columns.spec.ts` writes one). Each
 * order is a fresh UUIDv7 of the database's, so a later one sorts after an earlier one.
 */
async function order(
  tx: Transaction,
  enrollmentId: string,
  status: 'created' | 'paid' | 'failed',
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO payments (enrollment_id, gateway, gateway_order_id, gross_piasters, currency,
                          status, expires_at, updated_at)
    VALUES (${enrollmentId}::uuid, 'fake', ${`probe-order-${randomUUID()}`}, 100000, 'EGP',
            ${status}::payment_status, '2026-11-03T07:10:00Z', now())`;
}

/**
 * A hold of `studentId` on `slotId`, expiring at `expiresAt`, linked to `enrollmentId` if given; its
 * package is the slot's teacher's first, as a placement records it (B29).
 */
async function hold(
  tx: Transaction,
  slotId: string,
  studentId: string,
  expiresAt: Date,
  enrollmentId: string | null = null,
): Promise<string> {
  const { teacherUserId } = await tx.availabilitySlot.findUniqueOrThrow({
    where: { id: slotId },
    select: { teacherUserId: true },
  });
  const pkg = await tx.package.findFirstOrThrow({
    where: { teacherUserId },
    orderBy: { id: 'asc' },
    select: { id: true, sessionCount: true },
  });
  const { id } = await tx.slotHold.create({
    data: {
      slotId,
      studentUserId: studentId,
      packageId: pkg.id,
      sessionCount: pkg.sessionCount,
      expiresAt,
      enrollmentId,
    },
    select: { id: true },
  });
  return id;
}

/** The probe's `date` columns, written whole as text as well. */
const DATE_COLUMN = {
  '2026-11-19': new Date('2026-11-19T00:00:00Z'),
  '2026-11-26': new Date('2026-11-26T00:00:00Z'),
} as const;

/** One session, its local fields and instants written whole as text. */
async function session(
  tx: Transaction,
  values: {
    enrollmentId: string;
    teacherId: string;
    studentId: string;
    localDate: keyof typeof DATE_COLUMN;
    startsAt: string;
    endsAt: string;
  },
): Promise<void> {
  await tx.session.create({
    data: {
      enrollmentId: values.enrollmentId,
      teacherUserId: values.teacherId,
      studentUserId: values.studentId,
      sequenceNumber: 1,
      scheduledDateLocal: DATE_COLUMN[values.localDate],
      scheduledStartTimeLocal: TIME_COLUMN['09:30:00'],
      timezone: CAIRO,
      scheduledStartAt: new Date(values.startsAt),
      scheduledEndAt: new Date(values.endsAt),
      status: 'scheduled',
    },
  });
}

const studentOf = (id: string, gender: Gender = 'female') => ({
  userId: id,
  gender: gender as RequesterGender,
});

const place = (
  tx: Transaction,
  student: { userId: string; gender: RequesterGender },
  packageId: string,
  slotId: string,
) => placeHold(tx, student, { packageId, slotId }, { terms, orders });

async function activeHolds(tx: Transaction, where: { slotId?: string; studentUserId?: string }) {
  return tx.slotHold.findMany({ where: { ...where, releasedAt: null } });
}

async function eventsOf(tx: Transaction, enrollmentId: string) {
  return tx.enrollmentEvent.findMany({
    where: { enrollmentId },
    select: { kind: true, cancellationReason: true, paymentId: true, occurredAt: true },
  });
}

async function enrollmentState(tx: Transaction, id: string) {
  return tx.enrollment.findUniqueOrThrow({
    where: { id },
    select: { status: true, cancellationReason: true },
  });
}

describe('placeHold: one active hold (FR-351, FR-BOOK-9)', () => {
  it('writes one active hold for the checkout time plus the grace, with no enrollment, and previews the sessions', async () => {
    await rolledBack(async (tx) => {
      const on = await offer(tx);
      const student = (await person(tx)).id;
      const placed = await place(tx, studentOf(student), on.packageId, on.thursday);
      expect(await activeHolds(tx, { studentUserId: student })).toEqual([
        expect.objectContaining({
          id: placed.holdId,
          slotId: on.thursday,
          enrollmentId: null,
          expiresAt: new Date('2026-11-03T08:15:00Z'),
        }),
      ]);
      expect([
        placed.firstSession.requestedLocalDate,
        placed.lastSession.requestedLocalDate,
      ]).toEqual(['2026-11-05', '2026-11-26']);
    });
  });
});

describe("placeHold: FR-353's refusals write nothing", () => {
  it('answers NOT_FOUND for the other gender’s teacher, in both directions', async () => {
    await rolledBack(async (tx) => {
      for (const gender of ['female', 'male'] as const) {
        const other = await offer(tx, { gender: gender === 'female' ? 'male' : 'female' });
        const student = (await person(tx, gender)).id;
        await expect(
          place(tx, studentOf(student, gender), other.packageId, other.thursday),
        ).rejects.toEqual(new DomainError('NOT_FOUND'));
        expect(await activeHolds(tx, { studentUserId: student })).toEqual([]);
      }
    });
  });

  it('answers NOT_BOOKABLE, ACCOUNT_NOT_ACTIVE and NOT_FOUND for another teacher’s slot or another length', async () => {
    await rolledBack(async (tx) => {
      const on = await offer(tx);
      const mustVerify = await offer(tx, { standing: 'verification_required' });
      const other = await offer(tx);
      const fortyFive = await slot(tx, on.teacherId, { day: 5, time: '09:00:00', minutes: 45 });
      const student = (await person(tx)).id;
      const waiting = (await person(tx, 'female', 'verification_required')).id;
      const cases: [string, string, string, string][] = [
        [student, mustVerify.packageId, mustVerify.thursday, 'NOT_BOOKABLE'],
        [waiting, on.packageId, on.thursday, 'ACCOUNT_NOT_ACTIVE'],
        [student, on.packageId, other.thursday, 'NOT_FOUND'],
        [student, on.packageId, fortyFive, 'NOT_FOUND'],
        [student, randomUUID(), on.thursday, 'NOT_FOUND'],
      ];
      for (const [who, packageId, slotId, code] of cases) {
        await expect(place(tx, studentOf(who), packageId, slotId), code).rejects.toEqual(
          new DomainError(code as 'NOT_FOUND'),
        );
      }
      expect(
        await tx.slotHold.count({ where: { studentUserId: { in: [student, waiting] } } }),
      ).toBe(0);
    });
  });
});

describe('placeHold: the expired holds first (FR-351, FR-363, the owner’s decision of 2026-11-03)', () => {
  it('releases the slot’s and the student’s expired holds, cancelling payment_failed and payment_expired with one event each', async () => {
    await rolledBack(async (tx) => {
      const on = await offer(tx);
      const student = (await person(tx)).id;
      const other = (await person(tx)).id;
      const failed = await enrollment(tx, on, on.thursday, other);
      await order(tx, failed, 'failed');
      const onSlot = await hold(tx, on.thursday, other, EARLIER, failed);
      const lapsed = await enrollment(tx, on, on.saturday, student);
      await order(tx, lapsed, 'created');
      const own = await hold(tx, on.saturday, student, EARLIER, lapsed);
      await place(tx, studentOf(student), on.packageId, on.thursday);
      const released = await tx.slotHold.findMany({
        where: { id: { in: [onSlot, own] } },
        select: { releasedAt: true },
      });
      expect(released).toEqual([{ releasedAt: NOW }, { releasedAt: NOW }]);
      expect(await enrollmentState(tx, failed)).toEqual({
        status: 'cancelled',
        cancellationReason: 'payment_failed',
      });
      expect(await enrollmentState(tx, lapsed)).toEqual({
        status: 'cancelled',
        cancellationReason: 'payment_expired',
      });
      expect(await eventsOf(tx, failed)).toEqual([
        {
          kind: 'cancelled',
          cancellationReason: 'payment_failed',
          paymentId: null,
          occurredAt: NOW,
        },
      ]);
      expect(await eventsOf(tx, lapsed)).toEqual([
        {
          kind: 'cancelled',
          cancellationReason: 'payment_expired',
          paymentId: null,
          occurredAt: NOW,
        },
      ]);
    });
  });

  it('releases the student’s expired hold whose enrollment has a paid order and leaves that enrollment awaiting payment, with no event', async () => {
    await rolledBack(async (tx) => {
      const on = await offer(tx);
      const student = (await person(tx)).id;
      const paid = await enrollment(tx, on, on.saturday, student);
      await order(tx, paid, 'failed');
      await order(tx, paid, 'paid');
      const own = await hold(tx, on.saturday, student, EARLIER, paid);
      const placed = await place(tx, studentOf(student), on.packageId, on.thursday);
      expect((await tx.slotHold.findUniqueOrThrow({ where: { id: own } })).releasedAt).toEqual(NOW);
      expect(await enrollmentState(tx, paid)).toEqual({
        status: 'pending_payment',
        cancellationReason: null,
      });
      expect(await eventsOf(tx, paid)).toEqual([]);
      expect((await activeHolds(tx, { studentUserId: student })).map(({ id }) => id)).toEqual([
        placed.holdId,
      ]);
    });
  });

  it('answers SLOT_TAKEN when the slot’s expired hold has a paid enrollment, which still occupies it', async () => {
    await rolledBack(async (tx) => {
      const on = await offer(tx);
      const other = (await person(tx)).id;
      const paid = await enrollment(tx, on, on.thursday, other);
      await order(tx, paid, 'paid');
      await hold(tx, on.thursday, other, EARLIER, paid);
      const student = (await person(tx)).id;
      await expect(place(tx, studentOf(student), on.packageId, on.thursday)).rejects.toEqual(
        new DomainError('SLOT_TAKEN'),
      );
      expect(await enrollmentState(tx, paid)).toEqual({
        status: 'pending_payment',
        cancellationReason: null,
      });
    });
  });

  it('answers SLOT_TAKEN for a slot another student holds unexpired, and PREVIOUS_CHECKOUT for the student’s own', async () => {
    await rolledBack(async (tx) => {
      const on = await offer(tx);
      const other = (await person(tx)).id;
      await hold(tx, on.thursday, other, LATER);
      const student = (await person(tx)).id;
      await expect(place(tx, studentOf(student), on.packageId, on.thursday)).rejects.toEqual(
        new DomainError('SLOT_TAKEN'),
      );
      await hold(tx, on.saturday, student, LATER);
      const elsewhere = await offer(tx);
      await expect(
        place(tx, studentOf(student), elsewhere.packageId, elsewhere.thursday),
      ).rejects.toEqual(new DomainError('PREVIOUS_CHECKOUT'));
    });
  });
});

describe('the one overlap check, every session and both axes (FR-351, FR-BOOK-5, T033)', () => {
  it("leaves out of the sheet, and refuses, a slot whose third session overlaps the student's own session", async () => {
    await rolledBack(async (tx) => {
      const on = await offer(tx);
      const student = (await person(tx)).id;
      const elsewhere = await offer(tx);
      const own = await enrollment(tx, elsewhere, elsewhere.thursday, student, 'confirmed');
      // Thursday 2026-11-19 09:30 in Cairo, against the third Thursday 09:00 from 11-05.
      await session(tx, {
        enrollmentId: own,
        teacherId: elsewhere.teacherId,
        studentId: student,
        localDate: '2026-11-19',
        startsAt: '2026-11-19T07:30:00Z',
        endsAt: '2026-11-19T08:30:00Z',
      });
      const sheet = await bookingSlotsOf(
        tx,
        bookingSlotsStore,
        studentOf(student),
        { packageId: on.packageId },
        { now: NOW, leadHours: terms.leadHours, bufferWeeks: terms.bufferWeeks },
      );
      expect(sheet.slots.map(({ slotId }) => slotId)).toEqual([on.saturday]);
      await expect(place(tx, studentOf(student), on.packageId, on.thursday)).rejects.toEqual(
        new DomainError('SLOT_TAKEN'),
      );
    });
  });

  it("leaves out of the sheet, and refuses, a slot whose fourth session overlaps the teacher's own session", async () => {
    await rolledBack(async (tx) => {
      const on = await offer(tx);
      const busy = await slot(tx, on.teacherId, { day: 2, time: '09:00:00' });
      const another = (await person(tx)).id;
      const theirs = await enrollment(tx, on, busy, another, 'confirmed');
      // Thursday 2026-11-26 09:30 in Cairo, against the fourth Thursday 09:00.
      await session(tx, {
        enrollmentId: theirs,
        teacherId: on.teacherId,
        studentId: another,
        localDate: '2026-11-26',
        startsAt: '2026-11-26T07:30:00Z',
        endsAt: '2026-11-26T08:30:00Z',
      });
      const student = (await person(tx)).id;
      const sheet = await bookingSlotsOf(
        tx,
        bookingSlotsStore,
        studentOf(student),
        { packageId: on.packageId },
        { now: NOW, leadHours: terms.leadHours, bufferWeeks: terms.bufferWeeks },
      );
      expect(sheet.slots.map(({ slotId }) => slotId)).not.toContain(on.thursday);
      await expect(place(tx, studentOf(student), on.packageId, on.thursday)).rejects.toEqual(
        new DomainError('SLOT_TAKEN'),
      );
    });
  });
});

describe('releaseHolds with a named reason, and the re-hold (FR-363, FR-362, FR-PAYG-19)', () => {
  it('cancels checkout_abandoned with one event; slot_unavailable cancels even a paid one', async () => {
    await rolledBack(async (tx) => {
      const on = await offer(tx);
      const student = (await person(tx)).id;
      const abandoned = await enrollment(tx, on, on.thursday, student);
      await order(tx, abandoned, 'created');
      const first = await hold(tx, on.thursday, student, LATER, abandoned);
      const released = await releaseHolds(tx, [first], 'checkout_abandoned', { at: NOW, orders });
      expect(released).toEqual({
        released: [first],
        cancelled: [{ enrollmentId: abandoned, reason: 'checkout_abandoned' }],
        keptPending: [],
      });
      expect(await eventsOf(tx, abandoned)).toEqual([
        {
          kind: 'cancelled',
          cancellationReason: 'checkout_abandoned',
          paymentId: null,
          occurredAt: NOW,
        },
      ]);
      const paid = await enrollment(tx, on, on.saturday, student);
      await order(tx, paid, 'paid');
      const second = await hold(tx, on.saturday, student, LATER, paid);
      await releaseHolds(tx, [second], 'slot_unavailable', { at: NOW, orders });
      expect(await enrollmentState(tx, paid)).toEqual({
        status: 'cancelled',
        cancellationReason: 'slot_unavailable',
      });
      // Released once: a second call finds no active hold and writes nothing.
      expect(
        await releaseHolds(tx, [first, second], 'checkout_abandoned', { at: NOW, orders }),
      ).toEqual({ released: [], cancelled: [], keptPending: [] });
    });
  });

  it('re-holds a paid enrollment on its slot, linked to it, after releasing the slot’s expired hold', async () => {
    await rolledBack(async (tx) => {
      const on = await offer(tx);
      const student = (await person(tx)).id;
      const late = await enrollment(tx, on, on.thursday, student);
      await order(tx, late, 'paid');
      await hold(tx, on.thursday, student, EARLIER, late);
      await tx.slotHold.updateMany({
        where: { enrollmentId: late },
        data: { releasedAt: EARLIER },
      });
      const other = (await person(tx)).id;
      const lapsed = await hold(tx, on.thursday, other, EARLIER);
      const holdId = await reholdEnrollment(
        tx,
        { id: late, slotId: on.thursday, studentUserId: student },
        { terms, orders },
      );
      expect((await tx.slotHold.findUniqueOrThrow({ where: { id: lapsed } })).releasedAt).toEqual(
        NOW,
      );
      expect(await activeHolds(tx, { slotId: on.thursday })).toEqual([
        expect.objectContaining({ id: holdId, enrollmentId: late, studentUserId: student }),
      ]);
    });
  });

  it("throws the database's refusal as it is when another student holds the slot unexpired", async () => {
    await rolledBack(async (tx) => {
      const on = await offer(tx);
      const student = (await person(tx)).id;
      const late = await enrollment(tx, on, on.thursday, student);
      const other = (await person(tx)).id;
      await hold(tx, on.thursday, other, LATER);
      const refused = await reholdEnrollment(
        tx,
        { id: late, slotId: on.thursday, studentUserId: student },
        { terms, orders },
      ).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(isUniqueViolation(refused, 'slot_holds_slot_id_active_key')).toBe(true);
    });
  });
});
