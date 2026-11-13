// T032 — `booking.slots` over the real tables (R-205, R-209, FR-350, FR-386): `bookingSlotsOf` with
// the store over catalog's, identity's and sessions' entries (`bookingSlotsStore`), as `main.ts`
// binds it.
//
//   - the package's teacher passes the predicate with `purpose: 'book'` and the requester's gender,
//     in both directions, or the package answers NOT_FOUND, as an inactive or unknown one does;
//   - only slots of exactly the package's length, free by T026's occupancy (an active hold, an
//     enrollment awaiting payment, a confirmed one until the week after its final session);
//   - a slot whose first session overlaps one of the student's own sessions is left out, a
//     cancelled or soft-deleted session freeing its time as the overlap constraint reads it;
//   - the previews are the first and last sessions T034's `generateForEnrollment` writes when the
//     enrollment is confirmed at the same instant.
//
// Every probe writes its parents on its own transaction and rolls back (as discovery-slots.spec.ts).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type BookingStudent,
  bookingSlotsOf,
  bookingSlotsStore,
} from '../../apps/api/src/modules/booking/index.js';
import { generateForEnrollment } from '../../apps/api/src/modules/sessions/index.js';
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
const LEAD = 24;
/** Tuesday 2026-11-03 10:00 in Cairo (+02:00 since the October change). */
const TUESDAY = new Date('2026-11-03T08:00:00Z');

/** The probe's `time` columns, each written whole as text: only packages/time computes (R-TIME-1). */
const TIME_COLUMN = {
  '09:00:00': new Date('1970-01-01T09:00:00Z'),
  '09:30:00': new Date('1970-01-01T09:30:00Z'),
  '10:00:00': new Date('1970-01-01T10:00:00Z'),
} as const;
/** The probe's `date` columns, written whole as text as well. */
const DATE_COLUMN = {
  '2026-10-15': new Date('2026-10-15T00:00:00Z'),
  '2026-10-22': new Date('2026-10-22T00:00:00Z'),
  '2026-10-29': new Date('2026-10-29T00:00:00Z'),
  '2026-11-05': new Date('2026-11-05T00:00:00Z'),
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
      displayName: 'Probe person',
      preferredLanguage: 'ar',
      timezone: CAIRO,
      accountStatus,
    },
    select: { id: true },
  });
}

async function teacher(
  tx: Transaction,
  options: { gender?: Gender; standing?: Standing } = {},
): Promise<string> {
  const { id } = await person(tx, options.gender ?? 'female', options.standing ?? 'active');
  await tx.teacherProfile.create({
    data: {
      userId: id,
      bio: 'Probe',
      qualificationSummary: 'Probe',
      verificationStatus: 'approved',
      payoutVerifiedAt: new Date('2026-10-01T00:00:00Z'),
    },
  });
  return id;
}

async function pack(
  tx: Transaction,
  teacherUserId: string,
  options: { minutes?: number; isActive?: boolean } = {},
): Promise<{ id: string; subjectId: string }> {
  const { id: subjectId } = await tx.subject.create({
    data: { nameAr: 'مادة', nameEn: 'Subject', isActive: true },
    select: { id: true },
  });
  const { id } = await tx.package.create({
    data: {
      teacherUserId,
      subjectId,
      sessionCount: 4,
      sessionDurationMinutes: options.minutes ?? 60,
      pricePiasters: 100_000n,
      isActive: options.isActive ?? true,
    },
    select: { id: true },
  });
  return { id, subjectId };
}

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

interface Offer {
  readonly teacherId: string;
  readonly packageId: string;
  readonly subjectId: string;
  /** Thursday 09:00 for 60 minutes. */
  readonly thursday: string;
  /** Saturday 10:00 for 60 minutes. */
  readonly saturday: string;
}

/** A Cairo teacher with a 60-minute package and two slots of its length. */
async function offer(tx: Transaction, options: Parameters<typeof teacher>[1] = {}): Promise<Offer> {
  const teacherId = await teacher(tx, options);
  const { id: packageId, subjectId } = await pack(tx, teacherId);
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
  status: 'pending_payment' | 'confirmed',
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
      quotedFirstSessionLocalDate: new Date('2026-10-15T00:00:00Z'),
    },
    select: { id: true },
  });
  return id;
}

/** One session of the enrollment, its local fields and instants written whole as text. */
async function session(
  tx: Transaction,
  values: {
    enrollmentId: string;
    teacherId: string;
    studentId: string;
    sequenceNumber: number;
    localDate: keyof typeof DATE_COLUMN;
    time: keyof typeof TIME_COLUMN;
    startsAt: string;
    endsAt: string;
    status?: 'scheduled' | 'cancelled_by_admin';
    deleted?: boolean;
  },
): Promise<void> {
  await tx.session.create({
    data: {
      enrollmentId: values.enrollmentId,
      teacherUserId: values.teacherId,
      studentUserId: values.studentId,
      sequenceNumber: values.sequenceNumber,
      scheduledDateLocal: DATE_COLUMN[values.localDate],
      scheduledStartTimeLocal: TIME_COLUMN[values.time],
      timezone: CAIRO,
      scheduledStartAt: new Date(values.startsAt),
      scheduledEndAt: new Date(values.endsAt),
      status: values.status ?? 'scheduled',
      ...(values.deleted === true ? { deletedAt: new Date('2026-10-05T07:00:00Z') } : {}),
    },
  });
}

const clock = (now: Date, bufferWeeks = 0) => ({
  now,
  leadHours: LEAD,
  bufferWeeks: async () => bufferWeeks,
  windowDays: async () => 14, // T070 (rule d)
});

const studentOf = (id: string, gender: Gender = 'female'): BookingStudent => ({
  userId: id,
  gender: gender as RequesterGender,
});

const slotIdsOf = async (tx: Transaction, who: BookingStudent, packageId: string, now = TUESDAY) =>
  (await bookingSlotsOf(tx, bookingSlotsStore, who, { packageId }, clock(now))).slots.map(
    ({ slotId }) => slotId,
  );

describe('booking.slots: the predicate first (R-GENDER-2, R-201)', () => {
  it('answers a same-gender bookable teacher’s package, in both directions', async () => {
    await rolledBack(async (tx) => {
      for (const gender of ['female', 'male'] as const) {
        const on = await offer(tx, { gender });
        const other = await offer(tx, { gender: gender === 'female' ? 'male' : 'female' });
        const who = studentOf((await person(tx, gender)).id, gender);
        expect(await slotIdsOf(tx, who, on.packageId)).toEqual([on.thursday, on.saturday]);
        await expect(slotIdsOf(tx, who, other.packageId)).rejects.toEqual(
          new DomainError('NOT_FOUND'),
        );
      }
    });
  });

  it('answers NOT_FOUND for a teacher who must verify, an inactive package and an unknown one', async () => {
    await rolledBack(async (tx) => {
      const required = await offer(tx, { standing: 'verification_required' });
      const on = await offer(tx);
      const inactive = await pack(tx, on.teacherId, { isActive: false });
      const who = studentOf((await person(tx)).id);
      for (const packageId of [required.packageId, inactive.id, randomUUID()]) {
        await expect(slotIdsOf(tx, who, packageId), packageId).rejects.toEqual(
          new DomainError('NOT_FOUND'),
        );
      }
    });
  });
});

describe('booking.slots: the offerable slots (FR-350, R-205, FR-394)', () => {
  it("offers only the slots of exactly the package's length", async () => {
    await rolledBack(async (tx) => {
      const on = await offer(tx);
      await pack(tx, on.teacherId, { minutes: 45 });
      await slot(tx, on.teacherId, { day: 5, time: '09:00:00', minutes: 45 });
      const who = studentOf((await person(tx)).id);
      expect(await slotIdsOf(tx, who, on.packageId)).toEqual([on.thursday, on.saturday]);
    });
  });

  it('leaves out a slot an active hold or an enrollment awaiting payment takes', async () => {
    await rolledBack(async (tx) => {
      const on = await offer(tx);
      const holder = await person(tx);
      await tx.slotHold.create({
        data: {
          slotId: on.thursday,
          studentUserId: holder.id,
          packageId: on.packageId,
          sessionCount: 4,
          expiresAt: new Date('2026-11-03T08:20:00Z'),
        },
      });
      const who = studentOf((await person(tx)).id);
      expect(await slotIdsOf(tx, who, on.packageId)).toEqual([on.saturday]);
      await enrollment(tx, on, on.saturday, (await person(tx)).id, 'pending_payment');
      expect(await slotIdsOf(tx, who, on.packageId)).toEqual([]);
    });
  });

  it('offers a confirmed enrollment’s slot again from the week after its final session', async () => {
    await rolledBack(async (tx) => {
      const on = await offer(tx);
      const enrolled = (await person(tx)).id;
      const id = await enrollment(tx, on, on.thursday, enrolled, 'confirmed');
      const thursdays = [
        ['2026-10-15', '2026-10-15T06:00:00Z', '2026-10-15T07:00:00Z'],
        ['2026-10-22', '2026-10-22T06:00:00Z', '2026-10-22T07:00:00Z'],
        ['2026-10-29', '2026-10-29T06:00:00Z', '2026-10-29T07:00:00Z'],
        ['2026-11-05', '2026-11-05T07:00:00Z', '2026-11-05T08:00:00Z'],
      ] as const;
      for (const [index, [localDate, startsAt, endsAt]] of thursdays.entries()) {
        await session(tx, {
          enrollmentId: id,
          teacherId: on.teacherId,
          studentId: enrolled,
          sequenceNumber: index + 1,
          localDate,
          time: '09:00:00',
          startsAt,
          endsAt,
        });
      }
      const who = studentOf((await person(tx)).id);
      expect(await slotIdsOf(tx, who, on.packageId)).toEqual([on.saturday]);
      const wednesday = new Date('2026-11-04T10:00:00Z');
      // Still confirmed, the package keeps its slot past the week after its final session (the
      // owner's rule of 2026-11-10; FR-394 as amended): offered again only once it is completed.
      const confirmed = await bookingSlotsOf(
        tx,
        bookingSlotsStore,
        who,
        { packageId: on.packageId },
        clock(wednesday),
      );
      expect(confirmed.slots.map(({ slotId }) => slotId)).toEqual([on.saturday]);
      await tx.enrollment.update({ where: { id }, data: { status: 'completed' } });
      const answer = await bookingSlotsOf(
        tx,
        bookingSlotsStore,
        who,
        { packageId: on.packageId },
        clock(wednesday),
      );
      expect(answer.slots.map(({ slotId, firstSession }) => [slotId, firstSession])).toEqual([
        [on.saturday, { localDate: '2026-11-07', startsAt: '2026-11-07T08:00:00Z' }],
        [on.thursday, { localDate: '2026-11-12', startsAt: '2026-11-12T07:00:00Z' }],
      ]);
    });
  });
});

describe("booking.slots: the student's own sessions (R-205, FR-BOOK-5)", () => {
  /** The student's session with another teacher, Thursday 11-05 09:30 to 10:30 in Cairo. */
  async function ownSession(
    tx: Transaction,
    studentId: string,
    options: { status?: 'scheduled' | 'cancelled_by_admin'; deleted?: boolean } = {},
  ): Promise<void> {
    const elsewhere = await offer(tx);
    const id = await enrollment(tx, elsewhere, elsewhere.thursday, studentId, 'confirmed');
    await session(tx, {
      enrollmentId: id,
      teacherId: elsewhere.teacherId,
      studentId,
      sequenceNumber: 1,
      localDate: '2026-11-05',
      time: '09:30:00',
      startsAt: '2026-11-05T07:30:00Z',
      endsAt: '2026-11-05T08:30:00Z',
      ...options,
    });
  }

  it('leaves out the slot whose first session overlaps one of them, and no other student’s', async () => {
    await rolledBack(async (tx) => {
      const on = await offer(tx);
      const busy = (await person(tx)).id;
      await ownSession(tx, busy);
      expect(await slotIdsOf(tx, studentOf(busy), on.packageId)).toEqual([on.saturday]);
      const free = studentOf((await person(tx)).id);
      expect(await slotIdsOf(tx, free, on.packageId)).toEqual([on.thursday, on.saturday]);
    });
  });

  it('keeps it when that session is cancelled or soft-deleted, as the overlap constraint frees it', async () => {
    await rolledBack(async (tx) => {
      const on = await offer(tx);
      const cancelled = (await person(tx)).id;
      await ownSession(tx, cancelled, { status: 'cancelled_by_admin' });
      const deleted = (await person(tx)).id;
      await ownSession(tx, deleted, { deleted: true });
      for (const id of [cancelled, deleted]) {
        expect(await slotIdsOf(tx, studentOf(id), on.packageId)).toEqual([
          on.thursday,
          on.saturday,
        ]);
      }
    });
  });
});

describe('booking.slots: the previews are what generation writes (R-209, FR-368, FR-386)', () => {
  it('previews the first and last sessions T034 generates for a confirmation at the same instant', async () => {
    await rolledBack(async (tx) => {
      const on = await offer(tx);
      const student = (await person(tx)).id;
      // Monday 2026-10-12 10:00 in Cairo: the four Thursdays straddle the October change.
      const now = new Date('2026-10-12T07:00:00Z');
      const answer = await bookingSlotsOf(
        tx,
        bookingSlotsStore,
        studentOf(student),
        { packageId: on.packageId },
        clock(now),
      );
      const preview = answer.slots.find(({ slotId }) => slotId === on.thursday);
      expect(answer.teacherTimezone).toBe(CAIRO);
      const id = await enrollment(tx, on, on.thursday, student, 'confirmed');
      const generated = await generateForEnrollment(
        tx,
        {
          id,
          teacherUserId: on.teacherId,
          studentUserId: student,
          snapshotSessionCount: 4,
          snapshotDurationMinutes: 60,
          snapshotSlotTimezone: CAIRO,
          slot: { dayOfWeek: 4, startTimeLocal: '09:00:00' },
        },
        now,
        LEAD,
      );
      const first = generated.at(0);
      const last = generated.at(-1);
      expect(preview).toMatchObject({
        firstSession: { localDate: first?.scheduledDateLocal, startsAt: first?.scheduledStartAt },
        lastSession: { localDate: last?.scheduledDateLocal, startsAt: last?.scheduledStartAt },
      });
      expect(preview?.firstSession).toEqual({
        localDate: '2026-10-15',
        startsAt: '2026-10-15T06:00:00Z',
      });
      expect(preview?.lastSession).toEqual({
        localDate: '2026-11-05',
        startsAt: '2026-11-05T07:00:00Z',
      });
    });
  });
});
