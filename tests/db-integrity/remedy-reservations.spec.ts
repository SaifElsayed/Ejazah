// T027 of specs/004-sessions/tasks.md (FR-466; research R-311, "Reservation"; R-320, H3; R-323,
// GAP-8; the notes under T027, B34's (b), Q1 (a), Q2 (a), Q7 (a)) — reservations over the real
// tables, each world committed with accounts, a slot and an enrollment of its own:
//
//   - `reservedTimesOf` answers a `proposed` remedy's time on its `proposed_date` at the enrollment's
//     slot's local start, and nothing for a `frozen` one with the same date; a pending counter during
//     its answer window beside the proposal;
//   - `booking.slots` does not offer, and `checkout.hold` refuses `SLOT_TAKEN`, another teacher's slot
//     whose session falls on the proposal's time for the same student, and offers and places it once
//     the remedy is frozen (every query reserving time reads the remedy's status);
//   - an open remedy keeps its enrollment's slot in use past its release (Q1 (a)): `slotInUse` says so
//     and discovery's nearest-slot card does not offer it, until the remedy settles;
//   - a late payment whose sessions would overlap a reservation of the teacher takes the refusal
//     branch: cancelled `slot_unavailable`, one case, no session (Q2 (a)); and with the remedy frozen,
//     the same payment confirms;
//   - every release and the conversion write their reason with `released_at` (rule 48, GAP-8).
//
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { confirmEnrollment } from '../../apps/api/src/jobs/confirm-enrollment';
import {
  bookingSlotsOf,
  bookingSlotsStore,
  createEnrollmentSide,
  nearestFreeSlots,
  placeHold,
  releaseHolds,
  slotInUse,
} from '../../apps/api/src/modules/booking/index.js';
import { orderStandingsOf } from '../../apps/api/src/modules/payments/index.js';
import { reservedTimesOf } from '../../apps/api/src/modules/sessions/index.js';
import { DomainError } from '../../apps/api/src/platform/errors/domain-error.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import type { RequesterGender } from '../../apps/api/src/platform/guards/requester-gender.js';
import {
  CAIRO,
  confirmationWorld,
  NOW,
  settings,
  THURSDAY_0900,
  type World,
} from './confirmation-world';

// 005:T016 (rule d): the payment and cancellation pushes' port, which records nothing here.
const NO_PUSH = { record: async () => undefined };

const FEMALE = 'female' as RequesterGender;
/** The proposal's date: the Thursday after the world's last session (2026-11-26). */
const PROPOSED = new Date('2026-12-03T00:00:00Z');
/** 09:00 Cairo on 2026-12-03, the slot's local start in the enrollment's zone. */
const PROPOSAL = {
  startsAt: new Date('2026-12-03T07:00:00Z'),
  endsAt: new Date('2026-12-03T08:00:00Z'),
};
/** A clock from which the first session at least 24 hours on is Thursday 2026-12-03 09:00. */
const BEFORE_PROPOSAL = new Date('2026-11-30T08:00:00Z');
const DECEMBER = { from: new Date('2026-12-01T00:00:00Z'), to: new Date('2027-01-01T00:00:00Z') };

let database: Database;
const terms = () => createEnrollmentSide({ settings });

beforeAll(() => {
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 4,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
});

afterAll(async () => {
  if (database !== undefined) await closeDatabase(database);
});

const { person, world, order, enrollmentOf, sessionsOf, casesOf } = confirmationWorld(
  () => database,
);

/** The world's enrollment confirmed through the job: four Thursdays from 2026-11-05. */
async function confirmedWorld(): Promise<World> {
  const confirmed = await world();
  await confirmEnrollment({ database, settings, notices: NO_PUSH, clock: () => NOW }).handle({
    paymentId: await order(confirmed.enrollmentId),
  });
  expect(await enrollmentOf(confirmed.enrollmentId)).toMatchObject({ status: 'confirmed' });
  return confirmed;
}

/** The enrollment's last session settled a Teacher-No-Show with an open remedy in `status`. */
async function remedyOn(
  enrollmentId: string,
  status: 'proposed' | 'counter_proposed' | 'frozen',
  counterSlotId?: string,
): Promise<{ remedyId: string; sessionId: string }> {
  const { id: sessionId } = await database.session.findFirstOrThrow({
    where: { enrollmentId },
    orderBy: { sequenceNumber: 'desc' },
    select: { id: true },
  });
  await database.session.update({ where: { id: sessionId }, data: { status: 'teacher_no_show' } });
  const { id: remedyId } = await database.sessionRemedy.create({
    data: {
      sessionId,
      kind: 'makeup',
      status,
      proposedDate: PROPOSED,
      offeredAt: new Date('2026-11-27T08:00:00Z'),
      choiceClosesAt: new Date('2026-12-04T08:00:00Z'),
      snapshotAnswerWindowHours: 72,
      snapshotFirstSessionLeadHours: 24,
      ...(status === 'counter_proposed'
        ? {
            counterSlotId: counterSlotId ?? '',
            counterDate: new Date('2026-12-10T00:00:00Z'),
            counterStartTimeLocal: THURSDAY_0900,
            counterTimezone: CAIRO,
            // The database's clock now, so the answer window is open.
            counterProposedAt: new Date(),
          }
        : {}),
    },
    select: { id: true },
  });
  return { remedyId, sessionId };
}

async function setStatus(remedyId: string, status: 'frozen' | 'booked'): Promise<void> {
  await database.sessionRemedy.update({
    where: { id: remedyId },
    data: {
      status,
      ...(status === 'booked' ? { decidedAt: new Date() } : {}),
    },
  });
}

/** Another female teacher, bookable, with a one-session package on a Thursday 09:00 slot. */
async function otherTeacher(): Promise<{ teacherId: string; packageId: string; slotId: string }> {
  const teacherId = await person('female');
  await database.teacherProfile.create({
    data: {
      userId: teacherId,
      bio: 'Probe',
      qualificationSummary: 'Probe',
      verificationStatus: 'approved',
      applicationStatus: 'approved',
      payoutVerifiedAt: new Date('2026-10-01T00:00:00Z'),
    },
  });
  const { id: subjectId } = await database.subject.create({
    data: { nameAr: 'مادة', nameEn: 'Subject', isActive: true },
    select: { id: true },
  });
  const { id: packageId } = await database.package.create({
    data: {
      teacherUserId: teacherId,
      subjectId,
      sessionCount: 1,
      sessionDurationMinutes: 60,
      pricePiasters: 100_000n,
      isActive: true,
    },
    select: { id: true },
  });
  const { id: slotId } = await database.availabilitySlot.create({
    data: {
      teacherUserId: teacherId,
      dayOfWeek: 4,
      startTimeLocal: THURSDAY_0900,
      durationMinutes: 60,
      timezone: CAIRO,
      isActive: true,
    },
    select: { id: true },
  });
  return { teacherId, packageId, slotId };
}

const holdTerms = {
  now: BEFORE_PROPOSAL,
  ttlMinutes: 10,
  graceMinutes: 5,
  leadHours: 24,
  bufferWeeks: async () => 0,
  windowDays: async () => 14, // T070 (rule d)
};

/** A sentinel thrown to roll a placement back once it has been seen to succeed. */
class Placed extends Error {}

describe('reservedTimesOf on Postgres (T027, FR-466, H3, Q7 (a))', () => {
  it('answers a proposed remedy’s time and nothing for a frozen one with the same proposed_date', async () => {
    const confirmed = await confirmedWorld();
    const { remedyId, sessionId } = await remedyOn(confirmed.enrollmentId, 'proposed');
    const read = () =>
      database.$transaction((tx) => reservedTimesOf(tx, [confirmed.studentId], DECEMBER, terms()));

    expect(await read()).toEqual([{ remedyId, sessionId, ...PROPOSAL }]);
    expect(
      await database.$transaction((tx) =>
        reservedTimesOf(tx, [confirmed.teacherId], DECEMBER, terms()),
      ),
    ).toEqual([{ remedyId, sessionId, ...PROPOSAL }]);

    await setStatus(remedyId, 'frozen');
    expect(await read()).toEqual([]);
  });

  it('answers a pending counter during its answer window beside the proposal', async () => {
    const confirmed = await confirmedWorld();
    const { remedyId, sessionId } = await remedyOn(
      confirmed.enrollmentId,
      'counter_proposed',
      confirmed.slotId,
    );
    expect(
      await database.$transaction((tx) =>
        reservedTimesOf(tx, [confirmed.studentId], DECEMBER, terms()),
      ),
    ).toEqual([
      { remedyId, sessionId, ...PROPOSAL },
      {
        remedyId,
        sessionId,
        startsAt: new Date('2026-12-10T07:00:00Z'),
        endsAt: new Date('2026-12-10T08:00:00Z'),
      },
    ]);
  });
});

describe('booking.slots and checkout.hold read the remedy’s status (the note under T027, B34’s (b))', () => {
  it('booking.slots leaves out a slot whose session falls on a proposed remedy’s time of the student, and lists it once the remedy is frozen', async () => {
    const confirmed = await confirmedWorld();
    const { remedyId } = await remedyOn(confirmed.enrollmentId, 'proposed');
    const elsewhere = await otherTeacher();
    const listed = async () =>
      (
        await database.$transaction((tx) =>
          bookingSlotsOf(
            tx,
            bookingSlotsStore,
            { userId: confirmed.studentId, gender: FEMALE },
            { packageId: elsewhere.packageId },
            {
              now: BEFORE_PROPOSAL,
              leadHours: 24,
              bufferWeeks: async () => 0,
              windowDays: async () => 14,
            },
          ),
        )
      ).slots.map(({ slotId, firstSession }) => [slotId, firstSession.startsAt]);

    expect(await listed()).toEqual([]);
    await setStatus(remedyId, 'frozen');
    expect(await listed()).toEqual([[elsewhere.slotId, '2026-12-03T07:00:00Z']]);
  });

  it('checkout.hold refuses SLOT_TAKEN over a proposed remedy’s time of the student, writing nothing, and places the hold once the remedy is frozen', async () => {
    const confirmed = await confirmedWorld();
    const { remedyId } = await remedyOn(confirmed.enrollmentId, 'proposed');
    const elsewhere = await otherTeacher();
    const place = () =>
      database.$transaction(async (tx) => {
        await placeHold(
          tx,
          { userId: confirmed.studentId, gender: FEMALE },
          { packageId: elsewhere.packageId, slotId: elsewhere.slotId },
          { terms: holdTerms, orders: orderStandingsOf, notices: NO_PUSH },
        );
        throw new Placed('probe: placed, rolled back');
      });

    await expect(place()).rejects.toEqual(new DomainError('SLOT_TAKEN'));
    await setStatus(remedyId, 'frozen');
    await expect(place()).rejects.toBeInstanceOf(Placed);
    expect(await database.slotHold.count({ where: { slotId: elsewhere.slotId } })).toBe(0);
  });
});

describe('an open remedy keeps its enrollment’s slot in use until it settles (T027, Q1 (a), R-207)', () => {
  it('slotInUse says so past the release, and discovery’s nearest-slot card does not offer the slot; both free it once the remedy is booked', async () => {
    const confirmed = await confirmedWorld();
    const { remedyId } = await remedyOn(confirmed.enrollmentId, 'proposed');
    // The release of a final session on 2026-11-26 is 2026-12-03; this is well after it.
    const after = new Date('2026-12-20T08:00:00Z');
    const inUse = () =>
      database.$transaction((tx) =>
        slotInUse(tx, confirmed.slotId, {
          now: () => after,
          bufferWeeks: async () => 0,
          windowDays: async () => 14,
        }),
      );
    const card = () =>
      database.$transaction((tx) =>
        nearestFreeSlots(tx, FEMALE, [confirmed.teacherId], {
          now: after,
          leadHours: 24,
          bufferWeeks: async () => 0,
          windowDays: async () => 14, // T070 (rule d)
        }),
      );

    expect(await inUse()).toBe(true);
    expect((await card()).has(confirmed.teacherId)).toBe(false);

    // Booked, the make-up is a session of the enrollment, which is still confirmed: the slot stays
    // until the enrollment is completed (the owner's rule of 2026-11-10, the follow-up under T027).
    await setStatus(remedyId, 'booked');
    expect(await inUse()).toBe(true);
    await database.enrollment.update({
      where: { id: confirmed.enrollmentId },
      data: { status: 'completed' },
    });
    expect(await inUse()).toBe(false);
    expect((await card()).get(confirmed.teacherId)?.startsAt).toBe('2026-12-24T07:00:00Z');
  });

  // The owner's rule of 2026-11-10 (the follow-up under T027; FR-BOOK-10, FR-394, FR-423 as amended):
  // a package's slot returns only once the package is completed, so a dispute still open on its last
  // session past the week after it, with no remedy yet, keeps the slot.
  it('a dispute open on the last session past its release keeps the slot, from slotInUse and from discovery’s card, until the enrollment is completed', async () => {
    const confirmed = await confirmedWorld();
    const { id: lastId } = await database.session.findFirstOrThrow({
      where: { enrollmentId: confirmed.enrollmentId },
      orderBy: { sequenceNumber: 'desc' },
      select: { id: true },
    });
    await database.session.update({ where: { id: lastId }, data: { status: 'disputed' } });
    // The release of a final session on 2026-11-26 is 2026-12-03; this is well after it.
    const after = new Date('2026-12-20T08:00:00Z');
    const inUse = () =>
      database.$transaction((tx) =>
        slotInUse(tx, confirmed.slotId, {
          now: () => after,
          bufferWeeks: async () => 0,
          windowDays: async () => 14,
        }),
      );
    const card = () =>
      database.$transaction((tx) =>
        nearestFreeSlots(tx, FEMALE, [confirmed.teacherId], {
          now: after,
          leadHours: 24,
          bufferWeeks: async () => 0,
          windowDays: async () => 14, // T070 (rule d)
        }),
      );

    expect(await inUse()).toBe(true);
    expect((await card()).has(confirmed.teacherId)).toBe(false);

    await database.enrollment.update({
      where: { id: confirmed.enrollmentId },
      data: { status: 'completed' },
    });
    expect(await inUse()).toBe(false);
    expect((await card()).get(confirmed.teacherId)?.startsAt).toBe('2026-12-24T07:00:00Z');
  });

  it('keeps it in use while the remedy is frozen too', async () => {
    const confirmed = await confirmedWorld();
    await remedyOn(confirmed.enrollmentId, 'frozen');
    expect(
      await database.$transaction((tx) =>
        slotInUse(tx, confirmed.slotId, {
          now: () => new Date('2026-12-20T08:00:00Z'),
          bufferWeeks: async () => 0,
          windowDays: async () => 14, // T070 (rule d)
        }),
      ),
    ).toBe(true);
  });
});

/**
 * An earlier, confirmed enrollment of `late`'s teacher on the same slot, its one session settled a
 * Teacher-No-Show and its remedy in `status`, proposed on 2026-11-19, the third Thursday `late`'s
 * confirmation at NOW would generate.
 */
async function teacherReservationOn(late: World, status: 'proposed' | 'frozen'): Promise<string> {
  const earlierStudent = await person('female');
  const { id: enrollmentId } = await database.enrollment.create({
    data: {
      studentUserId: earlierStudent,
      teacherUserId: late.teacherId,
      packageId: late.packageId,
      slotId: late.slotId,
      snapshotPricePiasters: 100_000n,
      snapshotSessionCount: 1,
      snapshotDurationMinutes: 60,
      snapshotSubjectId: late.subjectId,
      snapshotSlotTimezone: CAIRO,
      status: 'confirmed',
      confirmedAt: new Date('2026-10-01T08:00:00Z'),
      purchasedAt: new Date('2026-10-01T07:00:00Z'),
      quotedFirstSessionLocalDate: new Date('2026-10-08T00:00:00Z'),
    },
    select: { id: true },
  });
  const { id: sessionId } = await database.session.create({
    data: {
      enrollmentId,
      teacherUserId: late.teacherId,
      studentUserId: earlierStudent,
      sequenceNumber: 1,
      scheduledDateLocal: new Date('2026-10-08T00:00:00Z'),
      scheduledStartTimeLocal: THURSDAY_0900,
      timezone: CAIRO,
      scheduledStartAt: new Date('2026-10-08T06:00:00Z'),
      scheduledEndAt: new Date('2026-10-08T07:00:00Z'),
      status: 'teacher_no_show',
    },
    select: { id: true },
  });
  const { id } = await database.sessionRemedy.create({
    data: {
      sessionId,
      kind: 'makeup',
      status,
      proposedDate: new Date('2026-11-19T00:00:00Z'),
      offeredAt: new Date('2026-10-12T08:00:00Z'),
      choiceClosesAt: new Date('2026-10-19T08:00:00Z'),
      snapshotAnswerWindowHours: 72,
      snapshotFirstSessionLeadHours: 24,
    },
    select: { id: true },
  });
  return id;
}

describe('a late payment over a reservation (T027, FR-PAYG-19, Q2 (a))', () => {
  it('takes the refusal branch: cancelled slot_unavailable, one case, no session, no new hold', async () => {
    const late = await world({ enrollment: { status: 'cancelled', reason: 'payment_expired' } });
    await teacherReservationOn(late, 'proposed');
    const job = confirmEnrollment({ database, settings, notices: NO_PUSH, clock: () => NOW });
    const paymentId = await order(late.enrollmentId);

    await job.handle({ paymentId });
    await job.handle({ paymentId });

    expect(await enrollmentOf(late.enrollmentId)).toMatchObject({
      status: 'cancelled',
      cancellationReason: 'slot_unavailable',
      confirmedAt: null,
    });
    expect(await sessionsOf(late.enrollmentId)).toEqual([]);
    expect(
      (await casesOf(late.enrollmentId)).map(({ reason, status }) => [reason, status]),
    ).toEqual([['slot_unavailable', 'open']]);
    expect(
      await database.slotHold.count({
        where: { enrollmentId: late.enrollmentId, releasedAt: null },
      }),
    ).toBe(0);
  });

  it('confirms the same payment when the reservation’s remedy is frozen', async () => {
    const late = await world({ enrollment: { status: 'cancelled', reason: 'payment_expired' } });
    await teacherReservationOn(late, 'frozen');
    await confirmEnrollment({ database, settings, notices: NO_PUSH, clock: () => NOW }).handle({
      paymentId: await order(late.enrollmentId),
    });
    expect(await enrollmentOf(late.enrollmentId)).toMatchObject({ status: 'confirmed' });
    expect(await sessionsOf(late.enrollmentId)).toHaveLength(4);
  });
});

describe('every release and the conversion write their reason (rule 48, GAP-8)', () => {
  it('the conversion writes converted with released_at', async () => {
    const confirmed = await confirmedWorld();
    expect(
      await database.slotHold.findUniqueOrThrow({
        where: { id: confirmed.holdId },
        select: { releasedAt: true, releaseReason: true },
      }),
    ).toEqual({ releasedAt: NOW, releaseReason: 'converted' });
  });

  it.each([
    'expired',
    'checkout_abandoned',
    'slot_unavailable',
    'admin',
    'teacher_suspended',
    'account_deleted',
  ] as const)('a release under %s writes it with released_at', async (reason) => {
    const running = await world();
    // Every reason releases a hold; `expired` only one past its expiry.
    const at = reason === 'expired' ? new Date('2026-11-03T09:00:00Z') : NOW;
    await database.$transaction((tx) =>
      releaseHolds(tx, [running.holdId], reason, { at, orders: orderStandingsOf, notices: NO_PUSH }),
    );
    expect(
      await database.slotHold.findUniqueOrThrow({
        where: { id: running.holdId },
        select: { releasedAt: true, releaseReason: true },
      }),
    ).toEqual({ releasedAt: at, releaseReason: reason });
  });
});
