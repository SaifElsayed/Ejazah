// 006:T005 of specs/006-programme/tasks.md (FR-701, FR-702, R-504) — the assessment's confirmation
// over the real tables: a paid `assessment` order confirms its enrollment, generates session 1 only,
// at the assessment's length (30 minutes on a 60-minute weekly time), and writes its programme
// `awaiting_offer`; run twice it leaves what one run leaves (R-API-14). A `package` order writes no
// programme. Committed worlds, as `confirm-enrollment.spec.ts`' (the job runs its own transactions).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { confirmEnrollment } from '../../apps/api/src/jobs/confirm-enrollment';
import { runOnceAndTwice } from '../../apps/api/src/jobs/double-run';
import { createNotificationWriter } from '../../apps/api/src/modules/notifications/index';
import {
  closeDatabase,
  type Database,
  openDatabase,
} from '../../apps/api/src/platform/db/prisma.repository';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures';
import {
  CAIRO,
  confirmationWorld,
  LATER,
  NOW,
  settings,
  THURSDAY_0900,
} from './confirmation-world';

let database: Database;
let writer: ReturnType<typeof createNotificationWriter>;

beforeAll(() => {
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 4,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  writer = createNotificationWriter({
    database,
    queue: { enqueue: async () => undefined },
    log: { info: () => undefined, warn: () => undefined },
  });
});

afterAll(async () => {
  await closeDatabase(database);
});

const { person, paidEvent, enrollmentOf, eventsOf, casesOf } = confirmationWorld(() => database);

const confirm = (paymentId: string) =>
  confirmEnrollment({ database, settings, notices: writer, clock: () => NOW }).handle({
    paymentId,
  });

/**
 * A programme package's assessment awaiting payment: its enrollment's snapshot one session of 30
 * minutes at 200 EGP on Thursday 09:00 for 60 minutes, its hold running, and its paid order of
 * `kind`, written by SQL (the amount column is named only in payments, R-MONEY-6).
 */
async function assessment(kind: 'assessment' | 'package' = 'assessment') {
  const teacherId = await person('female');
  await database.teacherProfile.create({
    data: {
      userId: teacherId,
      bio: 'Probe',
      qualificationSummary: 'Probe',
      verificationStatus: 'approved',
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
      track: 'ijazah_track',
      isProgramme: true,
      price30Piasters: 20_000n,
      price45Piasters: 28_000n,
      price60Piasters: 35_000n,
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
  const studentId = await person('female');
  const { id: enrollmentId } = await database.enrollment.create({
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
      status: 'pending_payment',
      purchasedAt: new Date('2026-11-03T07:55:00Z'),
      quotedFirstSessionLocalDate: new Date('2026-11-05T00:00:00Z'),
    },
    select: { id: true },
  });
  await database.slotHold.create({
    data: {
      slotId,
      packageId,
      sessionCount: 1,
      studentUserId: studentId,
      enrollmentId,
      expiresAt: LATER,
    },
  });
  const [row] = await database.$queryRaw<{ id: string }[]>`
    INSERT INTO payments (enrollment_id, gateway, gateway_order_id, gross_piasters, currency,
                          status, expires_at, updated_at, kind)
    VALUES (${enrollmentId}::uuid, 'fake', ${`probe-order-${enrollmentId}`}, 20000, 'EGP',
            'paid'::payment_status, ${LATER}, now(), ${kind}::order_kind)
    RETURNING id::text AS id`;
  if (row === undefined) throw new Error('no order written');
  await paidEvent(row.id);
  return { enrollmentId, paymentId: row.id };
}

async function sessionsOf(enrollmentId: string) {
  const rows = await database.session.findMany({
    where: { enrollmentId },
    orderBy: { sequenceNumber: 'asc' },
    select: {
      sequenceNumber: true,
      scheduledStartAt: true,
      scheduledEndAt: true,
      programmeMonth: true,
    },
  });
  return rows.map((row) => ({
    sequence: row.sequenceNumber,
    startsAt: row.scheduledStartAt.toISOString(),
    endsAt: row.scheduledEndAt.toISOString(),
    month: row.programmeMonth,
  }));
}

const programmesOf = (enrollmentId: string) =>
  database.programme.findMany({ where: { enrollmentId }, select: { state: true } });

describe('the assessment’s confirmation (006:T005; FR-701, R-504)', () => {
  it('confirms, generates session 1 only at the assessment’s length, and writes the programme awaiting its offer; twice as once', async () => {
    const { once, twice } = await runOnceAndTwice({
      world: assessment,
      run: ({ paymentId }) => confirm(paymentId),
      observe: async ({ enrollmentId }) => ({
        enrollment: (await enrollmentOf(enrollmentId)).status,
        sessions: await sessionsOf(enrollmentId),
        programmes: await programmesOf(enrollmentId),
        events: (await eventsOf(enrollmentId)).map(({ kind }) => kind),
        cases: (await casesOf(enrollmentId)).length,
      }),
    });
    expect(once).toEqual({
      enrollment: 'confirmed',
      // Thursday 2026-11-05 09:00 in Cairo, for 30 minutes; no month (data-model.md «sessions»).
      sessions: [
        {
          sequence: 1,
          startsAt: '2026-11-05T07:00:00.000Z',
          endsAt: '2026-11-05T07:30:00.000Z',
          month: null,
        },
      ],
      programmes: [{ state: 'awaiting_offer' }],
      events: ['confirmed'],
      cases: 0,
    });
    expect(twice).toEqual(once);
  });

  it('writes no programme for a `package` order on the same enrollment', async () => {
    const { enrollmentId, paymentId } = await assessment('package');
    await confirm(paymentId);
    expect(await programmesOf(enrollmentId)).toEqual([]);
  });
});
