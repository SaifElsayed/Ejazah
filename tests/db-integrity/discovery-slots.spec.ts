// T026 — booking's reads for discovery over the real tables (R-205, FR-335, FR-394, FR-BOOK-10):
//
//   - `lastSessionDateOf` (sessions' entry): each enrollment's latest `scheduled_date_local`, a
//     soft-deleted session left out, an enrollment with none absent;
//   - `offeredSlotsOf` (catalog's entry): a teacher's active slots of the lengths of their active
//     packages;
//   - `slotInUse` with R-205's release (the note under T026): a confirmed enrollment uses its slot on
//     every local date before the week after its final session plus `slot_release_buffer_weeks`, and
//     one whose last session cannot be read keeps it; the buffer is read only when a confirmed
//     enrollment asks for it;
//   - `nearestFreeSlots`: the first free session per teacher of a page, under the predicate with
//     `purpose: 'book'` and the requester's gender, both directions.
//
// Every probe writes its parents on its own transaction and rolls back (as catalog-use.spec.ts).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { nearestFreeSlots, slotInUse } from '../../apps/api/src/modules/booking/index.js';
import { offeredSlotsOf } from '../../apps/api/src/modules/catalog/index.js';
import { lastSessionDateOf } from '../../apps/api/src/modules/sessions/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
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

/**
 * The probe's `time` columns and its Thursday 09:00 sessions in Cairo, each written whole as text:
 * only packages/time computes a session's datetime (R-TIME-1). +03:00 until Cairo's change at the
 * end of Thursday 2026-10-29, +02:00 after it.
 */
const TIME_COLUMN = {
  '09:00:00': new Date('1970-01-01T09:00:00Z'),
  '10:00:00': new Date('1970-01-01T10:00:00Z'),
} as const;
const THURSDAY_SESSION = {
  '2026-10-15': ['2026-10-15T00:00:00Z', '2026-10-15T06:00:00Z', '2026-10-15T07:00:00Z'],
  '2026-10-22': ['2026-10-22T00:00:00Z', '2026-10-22T06:00:00Z', '2026-10-22T07:00:00Z'],
  '2026-10-29': ['2026-10-29T00:00:00Z', '2026-10-29T06:00:00Z', '2026-10-29T07:00:00Z'],
  '2026-11-05': ['2026-11-05T00:00:00Z', '2026-11-05T07:00:00Z', '2026-11-05T08:00:00Z'],
  '2026-11-12': ['2026-11-12T00:00:00Z', '2026-11-12T07:00:00Z', '2026-11-12T08:00:00Z'],
  '2026-11-19': ['2026-11-19T00:00:00Z', '2026-11-19T07:00:00Z', '2026-11-19T08:00:00Z'],
} as const;
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
      displayName: 'Probe teacher',
      preferredLanguage: 'ar',
      timezone: CAIRO,
      accountStatus,
    },
    select: { id: true },
  });
}

/** An approved teacher, payout verified unless said otherwise. */
async function teacher(
  tx: Transaction,
  options: { gender?: Gender; standing?: Standing; payoutVerified?: boolean } = {},
): Promise<string> {
  const { id } = await person(tx, options.gender ?? 'female', options.standing ?? 'active');
  await tx.teacherProfile.create({
    data: {
      userId: id,
      bio: 'Probe',
      qualificationSummary: 'Probe',
      verificationStatus: 'approved',
      ...(options.payoutVerified === false
        ? {}
        : { payoutVerifiedAt: new Date('2026-10-01T00:00:00Z') }),
    },
  });
  return id;
}

async function subject(tx: Transaction): Promise<string> {
  const { id } = await tx.subject.create({
    data: { nameAr: 'مادة', nameEn: 'Subject', isActive: true },
    select: { id: true },
  });
  return id;
}

async function pack(
  tx: Transaction,
  teacherUserId: string,
  subjectId: string,
  minutes: number,
  isActive = true,
): Promise<string> {
  const { id } = await tx.package.create({
    data: {
      teacherUserId,
      subjectId,
      sessionCount: 4,
      sessionDurationMinutes: minutes,
      pricePiasters: 100_000n,
      isActive,
    },
    select: { id: true },
  });
  return id;
}

async function slot(
  tx: Transaction,
  teacherUserId: string,
  values: { day: number; time: keyof typeof TIME_COLUMN; minutes?: number; isActive?: boolean },
): Promise<string> {
  const { id } = await tx.availabilitySlot.create({
    data: {
      teacherUserId,
      dayOfWeek: values.day,
      startTimeLocal: TIME_COLUMN[values.time],
      durationMinutes: values.minutes ?? 60,
      timezone: CAIRO,
      isActive: values.isActive ?? true,
    },
    select: { id: true },
  });
  return id;
}

interface Offer {
  readonly teacherId: string;
  readonly subjectId: string;
  readonly packageId: string;
  readonly slotId: string;
}

/** A Cairo teacher with a 60-minute package and a Thursday 09:00 slot. */
async function offer(tx: Transaction, options: Parameters<typeof teacher>[1] = {}): Promise<Offer> {
  const teacherId = await teacher(tx, options);
  const subjectId = await subject(tx);
  const packageId = await pack(tx, teacherId, subjectId, 60);
  const slotId = await slot(tx, teacherId, { day: 4, time: '09:00:00' });
  return { teacherId, subjectId, packageId, slotId };
}

/** An enrollment of a fresh student on `on`'s package and slot. */
async function enrollment(
  tx: Transaction,
  on: Offer,
  status: 'pending_payment' | 'confirmed',
): Promise<{ id: string; studentId: string }> {
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
      snapshotSlotTimezone: CAIRO,
      status,
      ...(status === 'confirmed' ? { confirmedAt: new Date('2026-10-04T07:01:00Z') } : {}),
      purchasedAt: new Date('2026-10-04T07:00:00Z'),
      quotedFirstSessionLocalDate: new Date('2026-10-15T00:00:00Z'),
    },
    select: { id: true },
  });
  return { id, studentId };
}

/** One Thursday 09:00 (+02:00) session of the enrollment on `localDate`. */
async function session(
  tx: Transaction,
  on: Offer,
  enrolled: { id: string; studentId: string },
  sequenceNumber: number,
  localDate: keyof typeof THURSDAY_SESSION,
  options: { deleted?: boolean } = {},
): Promise<void> {
  const [day, startsAt, endsAt] = THURSDAY_SESSION[localDate];
  await tx.session.create({
    data: {
      enrollmentId: enrolled.id,
      teacherUserId: on.teacherId,
      studentUserId: enrolled.studentId,
      sequenceNumber,
      scheduledDateLocal: new Date(day),
      scheduledStartTimeLocal: TIME_COLUMN['09:00:00'],
      timezone: CAIRO,
      scheduledStartAt: new Date(startsAt),
      scheduledEndAt: new Date(endsAt),
      status: 'scheduled',
      ...(options.deleted === true ? { deletedAt: new Date('2026-10-05T07:00:00Z') } : {}),
    },
  });
}

/** A confirmed enrollment whose sessions are the Thursdays 10-15 to 11-05, its final one. */
async function confirmedThroughNovember5(tx: Transaction, on: Offer): Promise<string> {
  const enrolled = await enrollment(tx, on, 'confirmed');
  const thursdays = ['2026-10-15', '2026-10-22', '2026-10-29', '2026-11-05'] as const;
  for (const [index, localDate] of thursdays.entries()) {
    await session(tx, on, enrolled, index + 1, localDate);
  }
  return enrolled.id;
}

/** `slotInUse`'s clock and buffer, counting how often the buffer is read. */
function releaseAt(now: string, bufferWeeks = 0) {
  const reads = { count: 0 };
  return {
    reads,
    release: {
      now: () => new Date(now),
      bufferWeeks: async () => {
        reads.count += 1;
        return bufferWeeks;
      },
      windowDays: async () => 14, // T070 (rule d)
    },
  };
}

describe('lastSessionDateOf (T026, the sessions entry)', () => {
  it("answers each enrollment's latest local date, a soft-deleted session left out", async () => {
    await rolledBack(async (tx) => {
      const on = await offer(tx);
      const first = await confirmedThroughNovember5(tx, on);
      const second = await enrollment(tx, on, 'confirmed');
      await session(tx, on, second, 1, '2026-11-12');
      await session(tx, on, second, 2, '2026-11-19', { deleted: true });
      const none = await enrollment(tx, on, 'pending_payment');
      expect(await lastSessionDateOf(tx, [first, second.id, none.id])).toEqual(
        new Map([
          [first, '2026-11-05'],
          [second.id, '2026-11-12'],
        ]),
      );
      expect(await lastSessionDateOf(tx, [])).toEqual(new Map());
    });
  });
});

describe('offeredSlotsOf (T026, the catalog entry)', () => {
  it("answers a teacher's active slots of the lengths of their active packages", async () => {
    await rolledBack(async (tx) => {
      const on = await offer(tx);
      await pack(tx, on.teacherId, on.subjectId, 45, false);
      const paused45 = await slot(tx, on.teacherId, { day: 0, time: '09:00:00', minutes: 45 });
      const inactive = await slot(tx, on.teacherId, { day: 1, time: '09:00:00', isActive: false });
      const other = await offer(tx);
      const offered = await offeredSlotsOf(tx, [on.teacherId, other.teacherId]);
      const ids = offered.map(({ id }) => id);
      expect(ids.toSorted()).toEqual([on.slotId, other.slotId].toSorted());
      expect(ids).not.toContain(paused45);
      expect(ids).not.toContain(inactive);
      expect(offered.find(({ id }) => id === on.slotId)).toEqual({
        id: on.slotId,
        teacherUserId: on.teacherId,
        dayOfWeek: 4,
        startTimeLocal: '09:00:00',
        durationMinutes: 60,
        timezone: CAIRO,
      });
      expect(await offeredSlotsOf(tx, [])).toEqual([]);
    });
  });
});

describe('slotInUse with R-205’s release (the note under T026, FR-394)', () => {
  it('keeps a confirmed enrollment’s slot in use whatever the date, and a completed one’s until the week after its final session', async () => {
    await rolledBack(async (tx) => {
      const on = await offer(tx);
      const id = await confirmedThroughNovember5(tx, on);
      // Still confirmed: in use past the week after its final session (the owner's rule of
      // 2026-11-10; FR-394 as amended).
      expect(await slotInUse(tx, on.slotId, releaseAt('2027-06-01T00:00:00Z').release)).toBe(true);
      await tx.enrollment.update({ where: { id }, data: { status: 'completed' } });
      // Thursday 11-05 09:30 and Wednesday 11-11 23:59 in Cairo: still in use.
      expect(await slotInUse(tx, on.slotId, releaseAt('2026-11-05T07:30:00Z').release)).toBe(true);
      expect(await slotInUse(tx, on.slotId, releaseAt('2026-11-11T21:59:00Z').release)).toBe(true);
      // Thursday 11-12 00:00 in Cairo: the release week has begun.
      expect(await slotInUse(tx, on.slotId, releaseAt('2026-11-11T22:00:00Z').release)).toBe(false);
    });
  });

  it('keeps a completed one’s through the buffer weeks', async () => {
    await rolledBack(async (tx) => {
      const on = await offer(tx);
      const id = await confirmedThroughNovember5(tx, on);
      await tx.enrollment.update({ where: { id }, data: { status: 'completed' } });
      expect(await slotInUse(tx, on.slotId, releaseAt('2026-11-12T08:00:00Z', 1).release)).toBe(
        true,
      );
      expect(await slotInUse(tx, on.slotId, releaseAt('2026-11-18T22:00:00Z', 1).release)).toBe(
        false,
      );
    });
  });

  it('keeps the slot of a confirmed enrollment whose sessions cannot be read', async () => {
    await rolledBack(async (tx) => {
      const on = await offer(tx);
      await enrollment(tx, on, 'confirmed');
      expect(await slotInUse(tx, on.slotId, releaseAt('2027-06-01T00:00:00Z').release)).toBe(true);
    });
  });

  it('answers a hold or a pending enrollment without reading the buffer', async () => {
    await rolledBack(async (tx) => {
      const on = await offer(tx);
      const free = releaseAt('2026-11-03T08:00:00Z');
      expect(await slotInUse(tx, on.slotId, free.release)).toBe(false);
      await enrollment(tx, on, 'pending_payment');
      const pending = releaseAt('2026-11-03T08:00:00Z');
      expect(await slotInUse(tx, on.slotId, pending.release)).toBe(true);
      expect(free.reads.count + pending.reads.count).toBe(0);
    });
  });
});

describe('nearestFreeSlots (T026, R-205, FR-335)', () => {
  const FEMALE = 'female' as RequesterGender;
  const MALE = 'male' as RequesterGender;
  /** Tuesday 2026-11-03 10:00 in Cairo. */
  const TUESDAY = new Date('2026-11-03T08:00:00Z');
  const clock = (now: Date, bufferWeeks = 0) => ({
    now,
    leadHours: 24,
    bufferWeeks: async () => bufferWeeks,
    windowDays: async () => 14, // T070 (rule d)
  });

  it('answers the first free session of a bookable same-gender teacher, in both directions', async () => {
    await rolledBack(async (tx) => {
      const her = await offer(tx, { gender: 'female' });
      const him = await offer(tx, { gender: 'male' });
      const ids = [her.teacherId, him.teacherId];
      expect(await nearestFreeSlots(tx, FEMALE, ids, clock(TUESDAY))).toEqual(
        new Map([[her.teacherId, { startsAt: '2026-11-05T07:00:00Z', timezone: CAIRO }]]),
      );
      expect(await nearestFreeSlots(tx, MALE, ids, clock(TUESDAY))).toEqual(
        new Map([[him.teacherId, { startsAt: '2026-11-05T07:00:00Z', timezone: CAIRO }]]),
      );
    });
  });

  it('answers nothing for a teacher who cannot be booked: verification required, payout unverified', async () => {
    await rolledBack(async (tx) => {
      const required = await offer(tx, { standing: 'verification_required' });
      const unpaid = await offer(tx, { payoutVerified: false });
      expect(
        await nearestFreeSlots(tx, FEMALE, [required.teacherId, unpaid.teacherId], clock(TUESDAY)),
      ).toEqual(new Map());
    });
  });

  it('skips a slot in use and offers it again from the week after the final session once completed (FR-394)', async () => {
    await rolledBack(async (tx) => {
      const on = await offer(tx);
      const id = await confirmedThroughNovember5(tx, on);
      expect(await nearestFreeSlots(tx, FEMALE, [on.teacherId], clock(TUESDAY))).toEqual(new Map());
      const wednesday = new Date('2026-11-04T10:00:00Z');
      // Still confirmed, the package keeps its slot (the owner's rule of 2026-11-10).
      expect(await nearestFreeSlots(tx, FEMALE, [on.teacherId], clock(wednesday))).toEqual(
        new Map(),
      );
      await tx.enrollment.update({ where: { id }, data: { status: 'completed' } });
      expect(await nearestFreeSlots(tx, FEMALE, [on.teacherId], clock(wednesday))).toEqual(
        new Map([[on.teacherId, { startsAt: '2026-11-12T07:00:00Z', timezone: CAIRO }]]),
      );
      expect(await nearestFreeSlots(tx, FEMALE, [on.teacherId], clock(wednesday, 1))).toEqual(
        new Map(),
      );
    });
  });

  // 006:T004 (FR-701, R-504; Q-5 (a); the owner's approval of 2026-11-22): a teacher whose only
  // active package is a programme one offers each slot at least the assessment's length long, named
  // only while the programme is open; with none named, no nearest slot. Both directions.
  it.each([
    ['female', FEMALE],
    ['male', MALE],
  ] as const)(
    'answers a programme teacher’s nearest slot of at least the assessment’s length, %s, and none with no length named',
    async (gender, requester) => {
      await rolledBack(async (tx) => {
        const teacherId = await teacher(tx, { gender });
        const subjectId = await subject(tx);
        await tx.package.create({
          data: {
            teacherUserId: teacherId,
            subjectId,
            track: 'ijazah_track',
            isProgramme: true,
            price30Piasters: 20_000n,
            price45Piasters: 28_000n,
            price60Piasters: 35_000n,
            isActive: true,
          },
        });
        // Thursday 09:00 for 30 minutes, Saturday 10:00 for 60.
        await slot(tx, teacherId, { day: 4, time: '09:00:00', minutes: 30 });
        await slot(tx, teacherId, { day: 6, time: '10:00:00' });
        expect(await nearestFreeSlots(tx, requester, [teacherId], clock(TUESDAY), 45)).toEqual(
          new Map([[teacherId, { startsAt: '2026-11-07T08:00:00Z', timezone: CAIRO }]]),
        );
        expect(await nearestFreeSlots(tx, requester, [teacherId], clock(TUESDAY), 30)).toEqual(
          new Map([[teacherId, { startsAt: '2026-11-05T07:00:00Z', timezone: CAIRO }]]),
        );
        expect(await nearestFreeSlots(tx, requester, [teacherId], clock(TUESDAY))).toEqual(
          new Map(),
        );
      });
    },
  );

  it('skips a slot an active hold takes and answers the teacher’s next free one', async () => {
    await rolledBack(async (tx) => {
      const on = await offer(tx);
      await slot(tx, on.teacherId, { day: 6, time: '10:00:00' });
      const student = await person(tx);
      await tx.slotHold.create({
        data: {
          slotId: on.slotId,
          studentUserId: student.id,
          packageId: on.packageId,
          sessionCount: 4,
          expiresAt: new Date('2026-11-03T08:20:00Z'),
        },
      });
      expect(await nearestFreeSlots(tx, FEMALE, [on.teacherId], clock(TUESDAY))).toEqual(
        new Map([[on.teacherId, { startsAt: '2026-11-07T08:00:00Z', timezone: CAIRO }]]),
      );
    });
  });
});
