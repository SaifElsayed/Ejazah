// 006:T006 of specs/006-programme/tasks.md (FR-718, R-502, R-507; V-3; kernel.md, the confirm step's
// row) — the confirm step by kind over the real tables: a month paid on an active programme takes the
// path with no hold and generates its sessions with their month, from the last number + 1; a replay
// does nothing (the order's own `payments.confirmed_at`); month m+1 paid while month m's
// `duplicate_payment` case is open still generates; two paid events for one month, run at once,
// generate one month and open one `duplicate_payment` case (the enrollment's lock serialises them,
// the second reads the first's marker); and the step waits on the programme's row, which it locks
// after the holds and before the enrollment.
//
// Committed worlds, as `confirm-enrollment.spec.ts`' (the job runs its own transactions).
//
// Observed red: every case against T005's code (no path with no hold, no marker), and the lock's
// case under M-E25 (the programme's lock removed from `lockForConfirmation`), restored and
// `cmp`-checked.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { confirmEnrollment } from '../../apps/api/src/jobs/confirm-enrollment';
import { runOnceAndTwice } from '../../apps/api/src/jobs/double-run';
import { openCompensationCase } from '../../apps/api/src/modules/moderation/index';
import { createNotificationWriter } from '../../apps/api/src/modules/notifications/index';
import {
  closeDatabase,
  type Database,
  openDatabase,
} from '../../apps/api/src/platform/db/prisma.repository';
import { lockRows } from '../../apps/api/src/platform/db/row-lock';
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
    poolMax: 6,
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

const { person, paidEvent, casesOf } = confirmationWorld(() => database);

const confirm = (paymentId: string) =>
  confirmEnrollment({ database, settings, notices: writer, clock: () => NOW }).handle({
    paymentId,
  });

/**
 * A paid order of the enrollment, by SQL (the amount column is named only in payments,
 * R-MONEY-6): its kind, its month, and its marker when the step already processed it.
 */
async function order(
  enrollmentId: string,
  kind: 'assessment' | 'instalment',
  month: number | null,
  processed: boolean,
): Promise<string> {
  const [row] = await database.$queryRaw<{ id: string }[]>`
    INSERT INTO payments (enrollment_id, gateway, gateway_order_id, gross_piasters, currency,
                          status, expires_at, updated_at, kind, instalment_month, confirmed_at)
    VALUES (${enrollmentId}::uuid, 'fake', ${`probe-order-${randomUUID()}`}, 140000, 'EGP',
            'paid'::payment_status, ${LATER}, now(), ${kind}::order_kind, ${month}::smallint,
            ${processed ? new Date('2026-10-20T07:00:00Z') : null}::timestamptz)
    RETURNING id::text AS id`;
  if (row === undefined) throw new Error('no order written');
  await paidEvent(row.id);
  return row.id;
}

/**
 * An active programme after its offer (10 sessions, N + 1 = 11, months of 4, 4 and 2) on Thursday
 * 09:00 for 60 minutes: its assessment (session 1, done) and month 1 (sessions 2 to 5, the last
 * ending 2026-10-29) already paid and processed.
 */
async function activeProgramme() {
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
      snapshotSessionCount: 11,
      snapshotDurationMinutes: 60,
      snapshotSubjectId: subjectId,
      snapshotSlotTimezone: CAIRO,
      snapshotTrack: 'ijazah_track',
      status: 'confirmed',
      confirmedAt: new Date('2026-09-30T07:01:00Z'),
      purchasedAt: new Date('2026-09-30T07:00:00Z'),
      quotedFirstSessionLocalDate: new Date('2026-10-01T00:00:00Z'),
    },
    select: { id: true },
  });
  await database.programme.create({
    data: {
      enrollmentId,
      state: 'active',
      offeredAt: new Date('2026-10-02T07:00:00Z'),
      monthCount: 3,
      paymentPlan: 'monthly',
      monthsPaid: 1,
    },
  });
  // Thursdays 2026-10-01 (the assessment) and 10-08 to 10-29 (month 1), 09:00 Cairo (+03:00 until
  // the October change, after 10-29), written whole as the instants they resolve to.
  const thursdays = [
    {
      localDate: new Date('2026-10-01T00:00:00Z'),
      startsAt: new Date('2026-10-01T06:00:00Z'),
      endsAt: new Date('2026-10-01T07:00:00Z'),
    },
    {
      localDate: new Date('2026-10-08T00:00:00Z'),
      startsAt: new Date('2026-10-08T06:00:00Z'),
      endsAt: new Date('2026-10-08T07:00:00Z'),
    },
    {
      localDate: new Date('2026-10-15T00:00:00Z'),
      startsAt: new Date('2026-10-15T06:00:00Z'),
      endsAt: new Date('2026-10-15T07:00:00Z'),
    },
    {
      localDate: new Date('2026-10-22T00:00:00Z'),
      startsAt: new Date('2026-10-22T06:00:00Z'),
      endsAt: new Date('2026-10-22T07:00:00Z'),
    },
    {
      localDate: new Date('2026-10-29T00:00:00Z'),
      startsAt: new Date('2026-10-29T06:00:00Z'),
      endsAt: new Date('2026-10-29T07:00:00Z'),
    },
  ];
  await database.session.createMany({
    data: thursdays.map((thursday, index) => {
      return {
        enrollmentId,
        teacherUserId: teacherId,
        studentUserId: studentId,
        sequenceNumber: index + 1,
        scheduledDateLocal: thursday.localDate,
        scheduledStartTimeLocal: THURSDAY_0900,
        timezone: CAIRO,
        scheduledStartAt: thursday.startsAt,
        scheduledEndAt: thursday.endsAt,
        status: index === 0 ? ('done' as const) : ('scheduled' as const),
        ...(index === 0 ? {} : { programmeMonth: 1 }),
      };
    }),
  });
  await order(enrollmentId, 'assessment', null, true);
  await order(enrollmentId, 'instalment', 1, true);
  return { enrollmentId };
}

async function sessionsOf(enrollmentId: string) {
  const rows = await database.session.findMany({
    where: { enrollmentId },
    orderBy: { sequenceNumber: 'asc' },
    select: { sequenceNumber: true, scheduledStartAt: true, programmeMonth: true },
  });
  return rows.map((row) => [
    row.sequenceNumber,
    row.scheduledStartAt.toISOString(),
    row.programmeMonth,
  ]);
}

async function markerOf(paymentId: string) {
  return (
    await database.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: { confirmedAt: true },
    })
  ).confirmedAt;
}

/** Month 2's four Thursdays, 09:00 Cairo, from the first at least 24 hours after NOW (11-03). */
const MONTH_TWO = [
  [6, '2026-11-05T07:00:00.000Z', 2],
  [7, '2026-11-12T07:00:00.000Z', 2],
  [8, '2026-11-19T07:00:00.000Z', 2],
  [9, '2026-11-26T07:00:00.000Z', 2],
];

describe('a month paid, the path with no hold (006:T006; FR-718, R-502, R-507)', () => {
  it('generates month 2 from the last number + 1 with its month and writes the order’s marker; twice as once', async () => {
    const { once, twice } = await runOnceAndTwice({
      world: async () => {
        const { enrollmentId } = await activeProgramme();
        return { enrollmentId, paymentId: await order(enrollmentId, 'instalment', 2, false) };
      },
      run: ({ paymentId }) => confirm(paymentId),
      observe: async ({ enrollmentId, paymentId }) => ({
        sessions: (await sessionsOf(enrollmentId)).slice(5),
        marked: (await markerOf(paymentId)) !== null,
        cases: (await casesOf(enrollmentId)).length,
      }),
    });
    expect(once).toEqual({ sessions: MONTH_TWO, marked: true, cases: 0 });
    expect(twice).toEqual(once);
  });

  it('generates month m+1 while month m’s duplicate_payment case is open', async () => {
    const { enrollmentId } = await activeProgramme();
    await database.$transaction((tx) =>
      openCompensationCase(tx, enrollmentId, 'duplicate_payment'),
    );
    const paymentId = await order(enrollmentId, 'instalment', 2, false);
    await confirm(paymentId);
    expect((await sessionsOf(enrollmentId)).slice(5)).toEqual(MONTH_TWO);
    expect((await casesOf(enrollmentId)).map(({ reason }) => reason)).toEqual([
      'duplicate_payment',
    ]);
  });

  it('two paid events for one month, at once: one month generated, one duplicate_payment case, both marked', async () => {
    const { enrollmentId } = await activeProgramme();
    const first = await order(enrollmentId, 'instalment', 2, false);
    const second = await order(enrollmentId, 'instalment', 2, false);
    await Promise.all([confirm(first), confirm(second)]);
    expect((await sessionsOf(enrollmentId)).slice(5)).toEqual(MONTH_TWO);
    expect((await casesOf(enrollmentId)).map(({ reason }) => reason)).toEqual([
      'duplicate_payment',
    ]);
    expect([(await markerOf(first)) !== null, (await markerOf(second)) !== null]).toEqual([
      true,
      true,
    ]);
    const enrollment = await database.enrollment.findUniqueOrThrow({
      where: { id: enrollmentId },
      select: { status: true },
    });
    expect(enrollment.status).toBe('confirmed');
  });

  it('waits on the programme’s row, locked after the holds and before the enrollment', async () => {
    const { enrollmentId } = await activeProgramme();
    const paymentId = await order(enrollmentId, 'instalment', 2, false);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held: () => void = () => undefined;
    const holding = new Promise<void>((resolve) => {
      held = resolve;
    });
    const holder = database.$transaction(
      async (tx) => {
        await lockRows(tx, 'programmes', [enrollmentId]);
        held();
        await gate;
      },
      { timeout: 30_000 },
    );
    await holding;
    let finished = false;
    const taker = confirm(paymentId).then(() => {
      finished = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 750));
    const whileHeld = finished;
    release();
    await holder;
    await taker;
    expect([whileHeld, finished]).toEqual([false, true]);
  });
});
