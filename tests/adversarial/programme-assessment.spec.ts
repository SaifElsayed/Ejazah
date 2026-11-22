// 006:T005 of specs/006-programme/tasks.md (FR-701, R-504; U-1; Q-5 (a)) — a programme package's
// assessment and the student's own programme's weekly time, over the real tables, in both gender
// directions (a female world and a male world).
//
// Over `booking.slots` and the hold with their real stores (catalog's, identity's and sessions'
// entries, booking's rows): a programme package is held as its assessment, one session on a weekly
// time at least the assessment's length, and refused `CONFLICT` with its cause while the programme
// is closed; a student with an active programme (`awaiting_offer`, `offered`, `active`, `paused`)
// is not offered, and is refused (`SLOT_TAKEN`), another package's weekly time overlapping the
// programme's, while a `closed` programme keeps nothing.
//
// Every probe runs in one transaction that is rolled back.
//
// Run by `test:adversarial`; not a `registered-attacks.ts` entry: `booking.slots` and `checkout.*`
// are registered there already, over a world with no programme package, and this file adds the
// programme package's cases in both directions at the services, as `package-average-price.spec.ts`
// is the teacher-kind spec beside the registry.
//
// Observed red (lane e's runs): the hidden time under M-E16 (the hold reading no programme time)
// and M-E17 (the sheet reading none), a closed programme under M-E18 (`closed` among the active
// states), each restored and `cmp`-checked.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  bookingSlotsOf,
  bookingSlotsStore,
  type HoldTerms,
  placeHold,
} from '../../apps/api/src/modules/booking/index.js';
import type { ProgrammeAvailability } from '../../apps/api/src/modules/catalog/index.js';
import { orderStandingsOf } from '../../apps/api/src/modules/payments/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import { DomainError } from '../../apps/api/src/platform/errors/domain-error.js';
import type { RequesterGender } from '../../apps/api/src/platform/guards/requester-gender.js';
import { piasters } from '../../packages/money/src/index.js';

const NO_PUSH = { record: async () => undefined };

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
/** Tuesday 2026-11-03 10:00 in Cairo. */
const NOW = new Date('2026-11-03T08:00:00Z');

/** The assessment 30 minutes at 200 EGP (20,000 piasters), the programme on. */
const OPEN: ProgrammeAvailability = {
  open: true,
  assessmentPrice_piasters: piasters(20_000),
  assessmentDurationMinutes: 30,
};

const termsWith = (programme: ProgrammeAvailability): HoldTerms => ({
  now: NOW,
  ttlMinutes: 10,
  graceMinutes: 5,
  leadHours: 24,
  bufferWeeks: async () => 0,
  windowDays: async () => 14,
  programme: async () => programme,
});

type Gender = 'male' | 'female';
const GENDERS: readonly Gender[] = ['female', 'male'];

const TIME_COLUMN = {
  '09:00:00': new Date('1970-01-01T09:00:00Z'),
  '09:30:00': new Date('1970-01-01T09:30:00Z'),
  '10:00:00': new Date('1970-01-01T10:00:00Z'),
} as const;

async function person(tx: Transaction, gender: Gender): Promise<string> {
  const { id } = await tx.user.create({
    data: {
      email: `probe-${randomUUID()}@example.invalid`,
      gender,
      dateOfBirth: new Date('1990-01-01T00:00:00Z'),
      displayName: 'Probe person',
      preferredLanguage: 'ar',
      timezone: CAIRO,
      accountStatus: 'active',
    },
    select: { id: true },
  });
  return id;
}

async function teacher(tx: Transaction, gender: Gender): Promise<string> {
  const id = await person(tx, gender);
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

async function subject(tx: Transaction): Promise<string> {
  const { id } = await tx.subject.create({
    data: { nameAr: 'مادة', nameEn: 'Subject', isActive: true },
    select: { id: true },
  });
  return id;
}

async function slot(
  tx: Transaction,
  teacherUserId: string,
  values: { day: number; time: keyof typeof TIME_COLUMN; minutes: number },
): Promise<string> {
  const { id } = await tx.availabilitySlot.create({
    data: {
      teacherUserId,
      dayOfWeek: values.day,
      startTimeLocal: TIME_COLUMN[values.time],
      durationMinutes: values.minutes,
      timezone: CAIRO,
      isActive: true,
    },
    select: { id: true },
  });
  return id;
}

/** A programme package: the three prices, none of the old three (ERD section 15 rule 73). */
async function programmePackage(tx: Transaction, teacherUserId: string, subjectId: string) {
  const { id } = await tx.package.create({
    data: {
      teacherUserId,
      subjectId,
      track: 'ijazah_track',
      isProgramme: true,
      price30Piasters: 20_000n,
      price45Piasters: 28_000n,
      price60Piasters: 35_000n,
      isActive: true,
    },
    select: { id: true },
  });
  return id;
}

/** A recitation package of four 60-minute sessions. */
async function fixedPackage(tx: Transaction, teacherUserId: string, subjectId: string) {
  const { id } = await tx.package.create({
    data: {
      teacherUserId,
      subjectId,
      sessionCount: 4,
      sessionDurationMinutes: 60,
      pricePiasters: 100_000n,
      isActive: true,
    },
    select: { id: true },
  });
  return id;
}

/**
 * The student's programme with a teacher of `gender`, on Thursday 09:00 for 60 minutes, in `state`:
 * its enrollment confirmed after the assessment, its one session already delivered (so only the
 * weekly time, not a session, can keep the weeks to come).
 */
async function programmeOf(
  tx: Transaction,
  gender: Gender,
  studentId: string,
  state: 'awaiting_offer' | 'offered' | 'active' | 'paused' | 'closed',
): Promise<void> {
  const teacherId = await teacher(tx, gender);
  const subjectId = await subject(tx);
  const packageId = await programmePackage(tx, teacherId, subjectId);
  const slotId = await slot(tx, teacherId, { day: 4, time: '09:00:00', minutes: 60 });
  const { id: enrollmentId } = await tx.enrollment.create({
    data: {
      studentUserId: studentId,
      teacherUserId: teacherId,
      packageId,
      slotId,
      snapshotPricePiasters: 20_000n,
      snapshotSessionCount: 1,
      snapshotDurationMinutes: 30,
      snapshotSubjectId: subjectId,
      snapshotSlotTimezone: CAIRO,
      snapshotTrack: 'ijazah_track',
      status: state === 'closed' ? 'cancelled' : 'confirmed',
      ...(state === 'closed' ? { cancellationReason: 'offer_declined' as const } : {}),
      confirmedAt: new Date('2026-10-04T07:01:00Z'),
      purchasedAt: new Date('2026-10-04T07:00:00Z'),
      quotedFirstSessionLocalDate: new Date('2026-10-08T00:00:00Z'),
    },
    select: { id: true },
  });
  const offered = state !== 'awaiting_offer';
  await tx.programme.create({
    data: {
      enrollmentId,
      state,
      ...(offered ? { offeredAt: new Date('2026-10-10T07:00:00Z') } : {}),
      ...(state === 'paused' ? { pausedAt: new Date('2026-10-20T07:00:00Z') } : {}),
      ...(state === 'closed' ? { closedAt: new Date('2026-10-20T07:00:00Z') } : {}),
    },
  });
}

/** Another teacher's recitation package on Thursday 09:30 (over the programme) and Saturday 10:00. */
async function otherOffer(tx: Transaction, gender: Gender) {
  const teacherId = await teacher(tx, gender);
  const subjectId = await subject(tx);
  const packageId = await fixedPackage(tx, teacherId, subjectId);
  const thursday = await slot(tx, teacherId, { day: 4, time: '09:30:00', minutes: 60 });
  const saturday = await slot(tx, teacherId, { day: 6, time: '10:00:00', minutes: 60 });
  return { teacherId, packageId, thursday, saturday };
}

const studentOf = (userId: string, gender: Gender) => ({
  userId,
  gender: gender as RequesterGender,
});

const sheetOf = (
  tx: Transaction,
  student: { userId: string; gender: RequesterGender },
  packageId: string,
  programme: ProgrammeAvailability = OPEN,
) =>
  bookingSlotsOf(
    tx,
    bookingSlotsStore,
    student,
    { packageId },
    { now: NOW, leadHours: 24, bufferWeeks: async () => 0, windowDays: async () => 14 },
    async () => programme,
  );

const place = (
  tx: Transaction,
  student: { userId: string; gender: RequesterGender },
  packageId: string,
  slotId: string,
  programme: ProgrammeAvailability = OPEN,
) =>
  placeHold(
    tx,
    student,
    { packageId, slotId },
    { terms: termsWith(programme), orders: orderStandingsOf, notices: NO_PUSH },
  );

describe.each(GENDERS)(
  'a programme package’s assessment, the %s direction (FR-701, R-504)',
  (gender) => {
    it('offers and holds a weekly time longer than the assessment, for one session', async () => {
      await rolledBack(async (tx) => {
        const teacherId = await teacher(tx, gender);
        const packageId = await programmePackage(tx, teacherId, await subject(tx));
        const hour = await slot(tx, teacherId, { day: 4, time: '09:00:00', minutes: 60 });
        const student = studentOf(await person(tx, gender), gender);
        const sheet = await sheetOf(tx, student, packageId);
        expect(sheet.slots).toMatchObject([
          { slotId: hour, durationMinutes: 60, firstSession: { localDate: '2026-11-05' } },
        ]);
        const placed = await place(tx, student, packageId, hour);
        const held = await tx.slotHold.findUniqueOrThrow({
          where: { id: placed.holdId },
          select: { sessionCount: true },
        });
        expect(held.sessionCount).toBe(1);
      });
    });

    it('answers the other gender’s programme package as one that never existed', async () => {
      await rolledBack(async (tx) => {
        const other: Gender = gender === 'female' ? 'male' : 'female';
        const teacherId = await teacher(tx, other);
        const packageId = await programmePackage(tx, teacherId, await subject(tx));
        const hour = await slot(tx, teacherId, { day: 4, time: '09:00:00', minutes: 60 });
        const student = studentOf(await person(tx, gender), gender);
        await expect(sheetOf(tx, student, packageId)).rejects.toEqual(new DomainError('NOT_FOUND'));
        await expect(place(tx, student, packageId, hour)).rejects.toEqual(
          new DomainError('NOT_FOUND'),
        );
      });
    });

    it('offers nothing and refuses the hold with the cause while the programme is closed (Q-5 (a))', async () => {
      await rolledBack(async (tx) => {
        const teacherId = await teacher(tx, gender);
        const packageId = await programmePackage(tx, teacherId, await subject(tx));
        const hour = await slot(tx, teacherId, { day: 4, time: '09:00:00', minutes: 60 });
        const student = studentOf(await person(tx, gender), gender);
        const closed: ProgrammeAvailability = { open: false, refusal: 'assessment_fee_unset' };
        expect((await sheetOf(tx, student, packageId, closed)).slots).toEqual([]);
        await expect(place(tx, student, packageId, hour, closed)).rejects.toEqual(
          new DomainError('CONFLICT', undefined, {
            details: [{ path: 'cause', code: 'assessment_fee_unset' }],
          }),
        );
        expect(await tx.slotHold.count({ where: { studentUserId: student.userId } })).toBe(0);
      });
    });
  },
);

describe.each(GENDERS)(
  'the student’s own programme’s weekly time, the %s direction (U-1)',
  (gender) => {
    for (const state of ['awaiting_offer', 'offered', 'active', 'paused'] as const) {
      it(`hides and refuses another package’s overlapping weekly time while the programme is ${state}`, async () => {
        await rolledBack(async (tx) => {
          const student = studentOf(await person(tx, gender), gender);
          await programmeOf(tx, gender, student.userId, state);
          const other = await otherOffer(tx, gender);
          const sheet = await sheetOf(tx, student, other.packageId);
          expect(sheet.slots.map(({ slotId }) => slotId)).toEqual([other.saturday]);
          await expect(place(tx, student, other.packageId, other.thursday)).rejects.toEqual(
            new DomainError('SLOT_TAKEN'),
          );
        });
      });
    }

    it('keeps nothing for a closed programme: the overlapping weekly time is offered and held', async () => {
      await rolledBack(async (tx) => {
        const student = studentOf(await person(tx, gender), gender);
        await programmeOf(tx, gender, student.userId, 'closed');
        const other = await otherOffer(tx, gender);
        const sheet = await sheetOf(tx, student, other.packageId);
        expect(sheet.slots.map(({ slotId }) => slotId)).toContain(other.thursday);
        await expect(place(tx, student, other.packageId, other.thursday)).resolves.toMatchObject({
          slot: { id: other.thursday },
        });
      });
    });

    it('keeps another student’s programme time free for this student', async () => {
      await rolledBack(async (tx) => {
        const student = studentOf(await person(tx, gender), gender);
        await programmeOf(tx, gender, await person(tx, gender), 'active');
        const other = await otherOffer(tx, gender);
        await expect(place(tx, student, other.packageId, other.thursday)).resolves.toMatchObject({
          slot: { id: other.thursday },
        });
      });
    });
  },
);
