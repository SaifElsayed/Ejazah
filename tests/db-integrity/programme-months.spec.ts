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
import {
  checkedProgrammePay,
  enrollOnHold,
  payStoreOver,
  payTargetOf,
  placeCheckoutHold,
  readHoldTerms,
} from '../../apps/api/src/modules/booking/index';
import { openCompensationCase } from '../../apps/api/src/modules/moderation/index';
import { createNotificationWriter } from '../../apps/api/src/modules/notifications/index';
import {
  checkoutOrdersAmong,
  heldOrdersOf,
  orderStandingsOf,
  payableProgrammeOrderAmong,
} from '../../apps/api/src/modules/payments/index';
import { DomainError } from '../../apps/api/src/platform/errors/domain-error';
import type { RequesterGender } from '../../apps/api/src/platform/guards/requester-gender';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository';
import { lockRows } from '../../apps/api/src/platform/db/row-lock';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures';
import { piasters } from '../../packages/money/src/index';
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

const confirm = (paymentId: string, clock: Date = NOW) =>
  confirmEnrollment({ database, settings, notices: writer, clock: () => clock }).handle({
    paymentId,
  });

/** When the world's processed orders were processed: their marker. */
const PROCESSED_AT = new Date('2026-10-20T07:00:00Z');

/**
 * A paid order of the enrollment, by SQL (the amount column is named only in payments,
 * R-MONEY-6): its kind, its month, and its marker when the step already processed it.
 */
async function order(
  enrollmentId: string,
  kind: 'assessment' | 'instalment' | 'rest_in_full',
  month: number | null,
  processed: boolean,
): Promise<string> {
  const [row] = await database.$queryRaw<{ id: string }[]>`
    INSERT INTO payments (enrollment_id, gateway, gateway_order_id, gross_piasters, currency,
                          status, expires_at, updated_at, kind, instalment_month, confirmed_at)
    VALUES (${enrollmentId}::uuid, 'fake', ${`probe-order-${randomUUID()}`}, 140000, 'EGP',
            'paid'::payment_status, ${LATER}, now(), ${kind}::order_kind, ${month}::smallint,
            ${processed ? PROCESSED_AT : null}::timestamptz)
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
async function activeProgramme(offered?: { readonly payByAt: Date }) {
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
    data:
      offered === undefined
        ? {
            enrollmentId,
            state: 'active',
            offeredAt: new Date('2026-10-02T07:00:00Z'),
            monthCount: 3,
            paymentPlan: 'monthly',
            monthsPaid: 1,
          }
        : // 006:T009: offered, awaiting its first payment until pay_by_at; only session 1 is written.
          {
            enrollmentId,
            state: 'offered',
            offeredAt: new Date('2026-10-02T07:00:00Z'),
            payByAt: offered.payByAt,
            monthCount: 3,
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
    data: thursdays.slice(0, offered === undefined ? undefined : 1).map((thursday, index) => {
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
  if (offered === undefined) await order(enrollmentId, 'instalment', 1, true);
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

  // PR #156 r1 Major 1 (PROBE-P4): a duplicate the step processed never moves the awaited month.
  it('generates month 2 after month 1 was paid again and processed as a duplicate', async () => {
    const { enrollmentId } = await activeProgramme();
    await confirm(await order(enrollmentId, 'instalment', 1, false));
    await confirm(await order(enrollmentId, 'instalment', 2, false));
    expect((await sessionsOf(enrollmentId)).slice(5)).toEqual(MONTH_TWO);
    expect((await casesOf(enrollmentId)).map(({ reason }) => reason)).toEqual([
      'duplicate_payment',
    ]);
  });

  it('walks the processed months in the order they were processed, not by their ids', async () => {
    const { enrollmentId } = await activeProgramme();
    // Month 2, processed after month 1 (10-20) but with an id below month 1's.
    const lowId = `00000000-${randomUUID().slice(9)}`;
    await database.$executeRaw`
      INSERT INTO payments (id, enrollment_id, gateway, gateway_order_id, gross_piasters, currency,
                            status, expires_at, updated_at, kind, instalment_month, confirmed_at)
      VALUES (${lowId}::uuid, ${enrollmentId}::uuid, 'fake',
              ${`probe-order-${randomUUID()}`}, 140000, 'EGP', 'paid'::payment_status, ${LATER},
              now(), 'instalment'::order_kind, 2, ${new Date('2026-10-27T07:00:00Z')}::timestamptz)`;
    await confirm(await order(enrollmentId, 'instalment', 3, false));
    expect((await sessionsOf(enrollmentId)).slice(5).map(([, , month]) => month)).toEqual([3, 3]);
    expect(await casesOf(enrollmentId)).toEqual([]);
  });

  // 006:T009 (the conflict check's settled reading): month 1 starts at the first Thursday after
  // pay_by_at (Friday 2026-11-06 10:00Z), with no lead: 11-12, not 11-05 (NOW + the 24 hours' lead).
  it('generates month 1 from the first weekly occurrence after pay_by_at, with no lead', async () => {
    const { enrollmentId } = await activeProgramme({ payByAt: new Date('2026-11-06T10:00:00Z') });
    await confirm(await order(enrollmentId, 'instalment', 1, false));
    expect((await sessionsOf(enrollmentId)).slice(1)).toEqual([
      [2, '2026-11-12T07:00:00.000Z', 1],
      [3, '2026-11-19T07:00:00.000Z', 1],
      [4, '2026-11-26T07:00:00.000Z', 1],
      [5, '2026-12-03T07:00:00.000Z', 1],
    ]);
  });

  // 006:T009 (the owner's Q-C1 (a)): the first payment moves the programme to active with its plan
  // and months; a second first payment is a duplicate, and programme.pay then answers not_offered.
  it('records month 1 on the programme, takes no second first payment, and refuses programme.pay after it', async () => {
    const { enrollmentId } = await activeProgramme({ payByAt: new Date('2026-11-06T10:00:00Z') });
    await confirm(await order(enrollmentId, 'instalment', 1, false));
    const row = () =>
      database.programme.findUniqueOrThrow({
        where: { enrollmentId },
        select: { state: true, paymentPlan: true, monthsPaid: true },
      });
    expect(await row()).toEqual({ state: 'active', paymentPlan: 'monthly', monthsPaid: 1 });
    await confirm(await order(enrollmentId, 'rest_in_full', null, false));
    expect((await casesOf(enrollmentId)).map(({ reason }) => reason)).toEqual([
      'duplicate_payment',
    ]);
    expect(await row()).toEqual({ state: 'active', paymentPlan: 'monthly', monthsPaid: 1 });
    const { studentUserId } = await database.enrollment.findUniqueOrThrow({
      where: { id: enrollmentId },
      select: { studentUserId: true },
    });
    const refused: unknown = await database
      .$transaction((tx) =>
        checkedProgrammePay(
          tx,
          { studentUserId, enrollmentId },
          { orders: checkoutOrdersAmong, log: { info: () => undefined } },
        ),
      )
      .catch((error: unknown) => error);
    expect((refused as DomainError).details).toEqual([{ path: 'cause', code: 'not_offered' }]);
  });

  // 006:T009, PR #156 r2 Follow-up 1 (PROBE-R2a): the marker is the database's instant under the
  // locks, never the clock a job read before them, so the walk follows the order of settlement.
  it('walks month 2 after month 1 when month 2’s job read its clock before month 1’s marker, then month 3 generates', async () => {
    const { enrollmentId } = await activeProgramme();
    // 1 ms before PROCESSED_AT, month 1's marker.
    const before = new Date('2026-10-20T06:59:59.999Z');
    await confirm(await order(enrollmentId, 'instalment', 2, false), before);
    expect((await sessionsOf(enrollmentId)).slice(5)).toEqual(MONTH_TWO);
    await confirm(await order(enrollmentId, 'instalment', 3, false));
    expect((await casesOf(enrollmentId)).map(({ reason }) => reason)).toEqual([]);
    expect((await sessionsOf(enrollmentId)).slice(9).map(([, , month]) => month)).toEqual([3, 3]);
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
    // PR #158 r1 Minor 3 (M8): the instant the holder lets go, its last read before the commit.
    let releasedAt = new Date(0);
    const holder = database.$transaction(
      async (tx) => {
        await lockRows(tx, 'programmes', [enrollmentId]);
        held();
        await gate;
        const [read] = await tx.$queryRaw<{ at: Date }[]>`SELECT clock_timestamp() AS at`;
        releasedAt = read?.at ?? releasedAt;
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
    // The marker is taken under the locks, so at or after the holder released them, never the
    // waiting transaction's start (`now()`), which is before it.
    expect((await markerOf(paymentId))!.getTime()).toBeGreaterThanOrEqual(releasedAt.getTime());
  });
});

// ---------------------------------------------------------------------------------------------
// 006:T009 (FR-BOOK-12 both ways, R-509): a first payment and a new checkout of one student never
// pass each other. programme.pay's check takes the student's account first, as a new hold does, so
// the one that waits reads the other's payable order and is refused PREVIOUS_CHECKOUT.

/** pay_by_at well after the database's clock, which the check reads. */
const FAR_PAY_BY = new Date('2099-01-01T00:00:00Z');

/** A created programme order of month 1, payable until well after the database's clock. */
async function payableMonthOne(tx: Transaction, enrollmentId: string): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO payments (enrollment_id, gateway, gateway_order_id, gross_piasters, currency,
                          status, expires_at, updated_at, kind, instalment_month)
    VALUES (${enrollmentId}::uuid, 'fake', ${`probe-order-${randomUUID()}`}, 140000, 'EGP',
            'created'::payment_status, ${FAR_PAY_BY}, now(), 'instalment'::order_kind, 1)`;
}

/** programme.pay's check, then its order, on a transaction held open until `gate` opens. */
function payHeldOpen(enrollmentId: string, studentUserId: string, gate: Promise<void>) {
  let held: () => void = () => undefined;
  const holding = new Promise<void>((resolve) => {
    held = resolve;
  });
  const done = database.$transaction(
    async (tx) => {
      await checkedProgrammePay(
        tx,
        { studentUserId, enrollmentId },
        { orders: checkoutOrdersAmong, log: { info: () => undefined } },
      );
      await payableMonthOne(tx, enrollmentId);
      held();
      await gate;
    },
    { timeout: 30_000 },
  );
  return { holding, done };
}

async function studentOfProgramme(enrollmentId: string): Promise<string> {
  const { studentUserId } = await database.enrollment.findUniqueOrThrow({
    where: { id: enrollmentId },
    select: { studentUserId: true },
  });
  return studentUserId;
}

/** Whether `call` was still waiting 750 ms after it began; its outcome after `release`. */
async function waitsUntil(call: () => Promise<unknown>, release: () => void) {
  let finished = false;
  const outcome = call().then(
    (value) => {
      finished = true;
      return value;
    },
    (error: unknown) => {
      finished = true;
      return error;
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 750));
  const waited = !finished;
  release();
  return { waited, outcome: await outcome };
}

describe('programme.pay against another checkout of the student (006:T009, FR-BOOK-12)', () => {
  it('a second first payment waits on the first, then is refused PREVIOUS_CHECKOUT naming its order', async () => {
    const { enrollmentId } = await activeProgramme({ payByAt: FAR_PAY_BY });
    const studentUserId = await studentOfProgramme(enrollmentId);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = payHeldOpen(enrollmentId, studentUserId, gate);
    await first.holding;
    const second = await waitsUntil(
      () =>
        database.$transaction((tx) =>
          checkedProgrammePay(
            tx,
            { studentUserId, enrollmentId },
            { orders: checkoutOrdersAmong, log: { info: () => undefined } },
          ),
        ),
      release,
    );
    await first.done;
    expect(second.waited).toBe(true);
    expect((second.outcome as DomainError).code).toBe('PREVIOUS_CHECKOUT');
    expect((second.outcome as DomainError).details).toEqual([
      { path: 'enrollmentId', code: enrollmentId },
      { path: 'state', code: 'payable' },
      { path: 'expiresAt', code: FAR_PAY_BY.toISOString() },
    ]);
  });

  it('a new hold waits on the first payment’s account, then is refused PREVIOUS_CHECKOUT, holding nothing', async () => {
    const { enrollmentId } = await activeProgramme({ payByAt: FAR_PAY_BY });
    const studentUserId = await studentOfProgramme(enrollmentId);
    // Another teacher's recitation package on Sunday 09:00, the student's new checkout.
    const other = await person('female');
    await database.teacherProfile.create({
      data: {
        userId: other,
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
        teacherUserId: other,
        subjectId,
        sessionCount: 4,
        sessionDurationMinutes: 60,
        pricePiasters: 100_000n,
        isActive: true,
      },
      select: { id: true },
    });
    const { id: slotId } = await database.availabilitySlot.create({
      data: {
        teacherUserId: other,
        dayOfWeek: 0,
        startTimeLocal: THURSDAY_0900,
        durationMinutes: 60,
        timezone: CAIRO,
        isActive: true,
      },
      select: { id: true },
    });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = payHeldOpen(enrollmentId, studentUserId, gate);
    await first.holding;
    const terms = await readHoldTerms(settings, new Date());
    const hold = await waitsUntil(
      () =>
        database.$transaction((tx) =>
          placeCheckoutHold(
            tx,
            { userId: studentUserId, gender: 'female' as RequesterGender },
            { packageId, slotId },
            {
              terms,
              orders: orderStandingsOf,
              heldOrders: heldOrdersOf,
              programmeOrders: payableProgrammeOrderAmong,
              notices: writer,
            },
          ),
        ),
      release,
    );
    await first.done;
    expect(hold.waited).toBe(true);
    expect((hold.outcome as DomainError).code).toBe('PREVIOUS_CHECKOUT');
    expect((hold.outcome as DomainError).details?.[0]).toEqual({
      path: 'enrollmentId',
      code: enrollmentId,
    });
    expect(await database.slotHold.count({ where: { studentUserId, releasedAt: null } })).toBe(0);
  });

  // 006:T009 (the owner's Q-C5 (a), SRS DEC-112): Pay on a bare own hold against a first payment.
  it('checkout.pay on a bare own hold waits on the first payment’s account, then is refused PREVIOUS_CHECKOUT, writing nothing', async () => {
    const { enrollmentId } = await activeProgramme({ payByAt: FAR_PAY_BY });
    const studentUserId = await studentOfProgramme(enrollmentId);
    const student = { userId: studentUserId, gender: 'female' as RequesterGender };
    const { packageId, slotId } = await otherTeachersPackage();
    const terms = await readHoldTerms(settings, new Date());
    const placed = await database.$transaction((tx) =>
      placeCheckoutHold(
        tx,
        student,
        { packageId, slotId },
        {
          terms,
          orders: orderStandingsOf,
          heldOrders: heldOrdersOf,
          programmeOrders: payableProgrammeOrderAmong,
          notices: writer,
        },
      ),
    );
    const store = payStoreOver(payableProgrammeOrderAmong);
    const quoted = {
      price_piasters: piasters(100_000),
      sessionCount: 4,
      sessionDurationMinutes: 60,
      track: 'recitation' as const,
    };
    // Pay's check before the gateway passes: no programme order yet.
    const target = await database.$transaction((tx) =>
      payTargetOf(tx, { studentUserId, holdId: placed.holdId, at: terms.now }, quoted, store),
    );
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = payHeldOpen(enrollmentId, studentUserId, gate);
    await first.holding;
    const pay = await waitsUntil(
      () =>
        database.$transaction((tx) =>
          enrollOnHold(
            tx,
            target,
            {
              student,
              enrollmentId: randomUUID(),
              at: terms.now,
              leadHours: terms.leadHours,
              quoted,
            },
            store,
          ),
        ),
      release,
    );
    await first.done;
    expect(pay.waited).toBe(true);
    expect((pay.outcome as DomainError).code).toBe('PREVIOUS_CHECKOUT');
    expect((pay.outcome as DomainError).details?.slice(0, 2)).toEqual([
      { path: 'enrollmentId', code: enrollmentId },
      { path: 'state', code: 'payable' },
    ]);
    expect(
      await database.slotHold.findUniqueOrThrow({
        where: { id: placed.holdId },
        select: { enrollmentId: true },
      }),
    ).toEqual({ enrollmentId: null });
  });
});

// ---------------------------------------------------------------------------------------------
// PR #158 r1 Major 1 (PROBE-S1; FR-BOOK-12: a new checkout is refused while an earlier payment
// «went through or is still being processed»). Between the gateway's signed paid event and the
// confirm step the programme is still `offered` and its order no longer payable: a second first
// payment is refused PREVIOUS_CHECKOUT `processing`, as the own hold's paid order is. Observed red:
// PROBE-S1 against the code before the fix, and the race under M-R1 (the processing check dropped
// from `checkedProgrammePay`), restored and `cmp`-checked.

/** The order kinds that pay for the programme's rest. */
const PROGRAMME_KINDS = { kind: { in: ['rest_in_full' as const, 'instalment' as const] } };

function payNow(enrollmentId: string, studentUserId: string) {
  return database.$transaction((tx) =>
    checkedProgrammePay(
      tx,
      { studentUserId, enrollmentId },
      { orders: checkoutOrdersAmong, log: { info: () => undefined } },
    ),
  );
}

describe('programme.pay while the first payment is paid and not yet confirmed (PR #158 r1 Major 1)', () => {
  it('PROBE-S1: the rest paid, not yet confirmed: a second first payment is refused PREVIOUS_CHECKOUT processing', async () => {
    const { enrollmentId } = await activeProgramme({ payByAt: FAR_PAY_BY });
    const studentUserId = await studentOfProgramme(enrollmentId);
    await order(enrollmentId, 'rest_in_full', null, false);
    const refused: unknown = await payNow(enrollmentId, studentUserId).catch(
      (error: unknown) => error,
    );
    expect((refused as DomainError).code).toBe('PREVIOUS_CHECKOUT');
    expect((refused as DomainError).details).toEqual([
      { path: 'enrollmentId', code: enrollmentId },
      { path: 'state', code: 'processing' },
    ]);
  });

  it('against the confirm job, both waiting on the programme’s row: the pay that takes it first is refused processing; one programme order, the programme active', async () => {
    const { enrollmentId } = await activeProgramme({ payByAt: FAR_PAY_BY });
    const studentUserId = await studentOfProgramme(enrollmentId);
    const paid = await order(enrollmentId, 'rest_in_full', null, false);
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
    // The pay queues on the programme's row first, writing its order if its check lets it through.
    const pay = database
      .$transaction(
        async (tx) => {
          await checkedProgrammePay(
            tx,
            { studentUserId, enrollmentId },
            { orders: checkoutOrdersAmong, log: { info: () => undefined } },
          );
          await payableMonthOne(tx, enrollmentId);
        },
        { timeout: 30_000 },
      )
      .then(
        () => 'a second order written',
        (error: unknown) => error,
      );
    await new Promise((resolve) => setTimeout(resolve, 750));
    const job = confirm(paid);
    await new Promise((resolve) => setTimeout(resolve, 750));
    release();
    await holder;
    const [outcome] = await Promise.all([pay, job]);
    expect((outcome as DomainError).details).toEqual([
      { path: 'enrollmentId', code: enrollmentId },
      { path: 'state', code: 'processing' },
    ]);
    expect(await database.payment.count({ where: { enrollmentId, ...PROGRAMME_KINDS } })).toBe(1);
    expect(
      (
        await database.programme.findUniqueOrThrow({
          where: { enrollmentId },
          select: { state: true },
        })
      ).state,
    ).toBe('active');
    // Once the step ran, the programme is no longer offered.
    const after: unknown = await payNow(enrollmentId, studentUserId).catch(
      (error: unknown) => error,
    );
    expect((after as DomainError).details).toEqual([{ path: 'cause', code: 'not_offered' }]);
  });
});

/** Another teacher's recitation package of 4 sessions on Sunday 09:00, the student's other checkout. */
async function otherTeachersPackage(): Promise<{ packageId: string; slotId: string }> {
  const other = await person('female');
  await database.teacherProfile.create({
    data: {
      userId: other,
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
      teacherUserId: other,
      subjectId,
      sessionCount: 4,
      sessionDurationMinutes: 60,
      pricePiasters: 100_000n,
      isActive: true,
    },
    select: { id: true },
  });
  const { id: slotId } = await database.availabilitySlot.create({
    data: {
      teacherUserId: other,
      dayOfWeek: 0,
      startTimeLocal: THURSDAY_0900,
      durationMinutes: 60,
      timezone: CAIRO,
      isActive: true,
    },
    select: { id: true },
  });
  return { packageId, slotId };
}
