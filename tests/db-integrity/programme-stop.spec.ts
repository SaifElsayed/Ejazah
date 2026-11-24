// 006:T017 of specs/006-programme/tasks.md (FR-723, FR-725, FR-727; R-512, R-513; SRS DEC-112 (3);
// FR-BOOK-18; kernel.md, 006:T017's row) — the stop over the real tables:
// - `programme.request` `stop`: taken from `paused_at` + 7 days on the database's clock, refused
//   `too_early` before and `request_open` while one is open, nothing written by a refusal;
// - `programmes.decide` approving it: the enrollment `cancelled` `programme_stopped`, the programme
//   `closed` (`paused_at` cleared), the item `approved` with its administrator, another open item
//   `withdrawn`, the saved card deleted (payments' own entry), one `cancelled` event, and the weekly
//   time offered again at once (the hidden-times rule); then payments' release sweep writes T011's
//   `programme_stopped` release: the paid orders' shares less every release written (175 + 700 EGP =
//   875 EGP, 87,500 pt); declining it changes nothing but the item; (Q-e4 (b)) approving it is
//   refused `sessions_pending` while a make-up of a paid month is scheduled or a remedy open;
// - the race kernel.md's 006:T015 row leaves to T017: the stop's approval against the sweep's
//   due step, both taking the programme's row before the enrollment's: (a) the approval holds its
//   transaction, the step waits, then reads the programme closed and records no automatic order;
//   (b) a holder of the programme's row (the step's first lock) makes the approval wait before it
//   takes the enrollment's; (c) both at once, no deadlock.
// Committed worlds of their own (the services and the sweep run their own transactions).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { advanceProgrammes, programmeSweepOver } from '../../apps/api/src/jobs/advance-programmes';
import {
  createProgrammeDecisions,
  createProgrammeServices,
  placeHold,
  type ProgrammeDecisions,
  type ProgrammeServices,
  slotInUse,
} from '../../apps/api/src/modules/booking/index';
import {
  checkoutOrdersAmong,
  createProgrammeCharges,
  createProgrammePayee,
  createShareReleaseSweep,
  deleteProgrammeCard,
  orderStandingsOf,
  programmeMonthOrdersOf,
  programmeOfferAmountsOf,
} from '../../apps/api/src/modules/payments/index';
import { ColumnCipher } from '../../apps/api/src/platform/crypto/encryption';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository';
import { lockRows } from '../../apps/api/src/platform/db/row-lock';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures';
import type { RequesterGender } from '../../apps/api/src/platform/guards/requester-gender';
import { transactionsOver } from '../../apps/api/src/platform/db/transaction.repository';
import { IdempotencyRepository } from '../../apps/api/src/platform/idempotency/idempotency.repository';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service';
import { createLogger } from '../../apps/api/src/platform/logging/logger';
import {
  createPaymentPort,
  type PaymentConfig,
} from '../../apps/api/src/platform/ports/payment/index';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader';
import { piasters } from '../../packages/money/src/index';
import {
  addDays,
  dateColumnOf,
  localDateIn,
  resolveOccurrences,
} from '../../packages/time/src/index.js';
import { CAIRO, confirmationWorld, SETTINGS, THURSDAY_0900 } from './confirmation-world';

const KEY = Buffer.alloc(32, 7).toString('base64');
const cipher = new ColumnCipher(KEY);
const PAYMENT: PaymentConfig = {
  PAYMENT_GATEWAY: 'fake',
  PAYMENT_MODE: 'test',
  ENCRYPTION_KEY: KEY,
};
const TOKEN = 'placeholder-card-token';
const STOP_REASON = 'الطالب متأخر عن السداد';

const VALUES: Record<string, unknown> = {
  ...SETTINGS,
  programme_offer_hours: 24,
  programme_pay_rest_hours: 48,
  programme_stop_request_days: 7,
  programme_charge_retry_days: [1, 3, 5, 7],
  programme_charge_inquiry_tries: 6,
  idempotency_key_ttl_hours: 24,
};
const settings: SettingsReader = { read: async (key, schema) => schema.parse(VALUES[key]) };
const silent = createLogger({ level: 'error', destination: { write: () => undefined } });
const noSignal = { afterCommit: () => undefined };
const errors: Error[] = [];

let database: Database;
let services: ProgrammeServices;
let decisions: ProgrammeDecisions;
const fake = createPaymentPort(PAYMENT);

beforeAll(() => {
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 8,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  const idempotency = new IdempotencyService<Transaction>({
    store: new IdempotencyRepository(database),
    settings,
  });
  services = createProgrammeServices({
    idempotency,
    settings,
    amounts: programmeOfferAmountsOf,
    log: { info: () => undefined },
    deleteProgrammeCard,
  });
  decisions = createProgrammeDecisions({
    idempotency,
    settings,
    deleteProgrammeCard,
    log: { info: () => undefined },
  });
});

afterAll(async () => {
  await closeDatabase(database);
});

const { person } = confirmationWorld(() => database);

async function dbNow(): Promise<Date> {
  const [{ now }] = await database.$queryRaw<[{ now: Date }]>`SELECT clock_timestamp() AS now`;
  return now;
}

/**
 * Thursdays 2026-10-01 (the assessment) to 10-29, 09:00 Cairo (+03:00 until the October change),
 * written whole as the instants they resolve to.
 */
const THURSDAYS = [
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

/** A paid, processed order of the enrollment by SQL (R-MONEY-6): its kind, gross and 70 % share. */
async function paidOrder(
  enrollmentId: string,
  kind: 'assessment' | 'instalment',
  gross: number,
  share: number,
): Promise<string> {
  const [row] = await database.$queryRaw<{ id: string }[]>`
    INSERT INTO payments (enrollment_id, gateway, gateway_order_id, gross_piasters, currency,
                          status, expires_at, updated_at, kind, instalment_month,
                          teacher_share_rate_percent, teacher_share_piasters,
                          half_release_rate_percent, confirmed_at)
    VALUES (${enrollmentId}::uuid, 'fake', ${`probe-order-${randomUUID()}`}, ${gross}, 'EGP',
            'paid'::payment_status, '2026-10-01T07:10:00Z', now(), ${kind}::order_kind,
            ${kind === 'instalment' ? 1 : null}::smallint, 70, ${share}, 25,
            '2026-10-01T07:01:00Z')
    RETURNING id::text AS id`;
  if (row === undefined) throw new Error('no order written');
  return row.id;
}

/**
 * A monthly programme of 40 offer sessions (10,000 EGP, the fee 250 EGP), month 1 paid and its four
 * sessions done in October, paused `pausedDaysAgo` days before the run, with a saved card. The
 * assessment's share 175 EGP, month 1's 700 EGP. Month 2 is due, and unpaid.
 */
async function pausedWorld(pausedDaysAgo: number) {
  const teacherId = await person('male');
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
      track: 'ijazah_track',
      isProgramme: true,
      price30Piasters: 20_000n,
      price45Piasters: 22_500n,
      price60Piasters: 25_000n,
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
  const studentId = await person('male');
  const { id: enrollmentId } = await database.enrollment.create({
    data: {
      studentUserId: studentId,
      teacherUserId: teacherId,
      packageId,
      slotId,
      snapshotPricePiasters: 1_000_000n,
      snapshotSessionCount: 41,
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
      state: 'paused',
      offeredAt: new Date('2026-10-02T07:00:00Z'),
      payByAt: new Date('2026-10-04T07:00:00Z'),
      monthCount: 10,
      paymentPlan: 'monthly',
      monthsPaid: 1,
      pausedAt: new Date(addDays(await dbNow(), -pausedDaysAgo)),
    },
  });
  await database.session.createMany({
    data: THURSDAYS.map((thursday, index) => ({
      enrollmentId,
      teacherUserId: teacherId,
      studentUserId: studentId,
      sequenceNumber: index + 1,
      scheduledDateLocal: thursday.localDate,
      scheduledStartTimeLocal: THURSDAY_0900,
      timezone: CAIRO,
      scheduledStartAt: thursday.startsAt,
      scheduledEndAt: thursday.endsAt,
      status: 'done' as const,
      ...(index === 0 ? {} : { programmeMonth: 1 }),
    })),
  });
  const assessmentId = await paidOrder(enrollmentId, 'assessment', 25_000, 17_500);
  await paidOrder(enrollmentId, 'instalment', 100_000, 70_000);
  await database.programmeCard.create({
    data: {
      enrollmentId,
      tokenEncrypted: Uint8Array.from(
        cipher.encrypt(TOKEN, 'programme_cards.token_encrypted', enrollmentId),
      ),
      last4: '4242',
      brand: 'Visa',
      consentedAt: new Date('2026-10-01T08:00:00Z'),
    },
  });
  return { teacherId, studentId, subjectId, slotId, enrollmentId, assessmentId };
}

async function admin(): Promise<string> {
  const { id } = await database.adminUser.create({
    data: {
      email: `probe-admin-${randomUUID()}@example.invalid`,
      passwordHash: 'probe-hash',
      mfaSecretEncrypted: Buffer.from('probe'),
      displayName: 'Probe administrator',
      isActive: true,
    },
    select: { id: true },
  });
  return id;
}

function requestStop(teacherId: string, enrollmentId: string) {
  return services.request(
    teacherId,
    { enrollmentId, kind: 'stop', reason: STOP_REASON, idempotencyKey: randomUUID() },
    noSignal,
  );
}

function decide(adminId: string, requestId: string, decision: 'approve' | 'decline' | 'extend') {
  return database.$transaction((tx) =>
    decisions.decide(tx as Transaction, adminId, {
      requestId,
      decision,
      idempotencyKey: randomUUID(),
    }),
  );
}

async function causeOf(call: Promise<unknown>): Promise<string> {
  try {
    return `answered ${JSON.stringify(await call)}`;
  } catch (error: unknown) {
    const details = (error as { details?: readonly { code: string }[] }).details;
    return details?.[0]?.code ?? (error as { code?: string }).code ?? String(error);
  }
}

/**
 * An open stop on the world, written as its row (the decision's cases stand on their own; the
 * request's are above): its id.
 */
async function stopRaised(world: Awaited<ReturnType<typeof pausedWorld>>): Promise<string> {
  const { id } = await database.programmeRequest.create({
    data: {
      enrollmentId: world.enrollmentId,
      teacherUserId: world.teacherId,
      kind: 'stop',
      status: 'open',
      reason: STOP_REASON,
    },
    select: { id: true },
  });
  return id;
}

async function rowsOf(enrollmentId: string) {
  const programme = await database.programme.findUniqueOrThrow({
    where: { enrollmentId },
    select: { state: true, pausedAt: true, closedAt: true },
  });
  const enrollment = await database.enrollment.findUniqueOrThrow({
    where: { id: enrollmentId },
    select: { status: true, cancellationReason: true },
  });
  const items = await database.programmeRequest.findMany({
    where: { enrollmentId },
    orderBy: { createdAt: 'asc' },
    select: { kind: true, status: true, reason: true, teacherUserId: true, decidedByAdminId: true },
  });
  const cancelled = await database.enrollmentEvent.count({
    where: { enrollmentId, kind: 'cancelled' },
  });
  const cards = await database.programmeCard.count({ where: { enrollmentId } });
  return { programme, enrollment, items, cancelled, cards };
}

/** Whether the weekly time is in use now (booking's occupancy, R-205 and T070's held closings). */
function slotTaken(slotId: string): Promise<boolean> {
  return database.$transaction((tx) =>
    slotInUse(tx as Transaction, slotId, {
      now: () => new Date(),
      bufferWeeks: async () => 0,
      windowDays: async () => 14,
    }),
  );
}

describe('programme.request stop over the real tables (006:T017, FR-723)', () => {
  it('takes a stop eight days into the pause: one open stop, the reason kept, its teacher the enrollment’s', async () => {
    const world = await pausedWorld(8);
    const { requestId } = await requestStop(world.teacherId, world.enrollmentId);
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect((await rowsOf(world.enrollmentId)).items).toEqual([
      {
        kind: 'stop',
        status: 'open',
        reason: STOP_REASON,
        teacherUserId: world.teacherId,
        decidedByAdminId: null,
      },
    ]);
  });

  it('refuses too_early six days into the pause, writing nothing', async () => {
    const world = await pausedWorld(6);
    expect(await causeOf(requestStop(world.teacherId, world.enrollmentId))).toBe('too_early');
    expect((await rowsOf(world.enrollmentId)).items).toEqual([]);
  });

  it('refuses request_open while a stop is open: one open stop', async () => {
    const world = await pausedWorld(8);
    await stopRaised(world);
    expect(await causeOf(requestStop(world.teacherId, world.enrollmentId))).toBe('request_open');
    expect((await rowsOf(world.enrollmentId)).items).toHaveLength(1);
  });
});

describe('programmes.decide on a stop over the real tables (006:T017, FR-725, R-513)', () => {
  it('approving it closes programme_stopped, withdraws the other item, deletes the card and frees the time at once', async () => {
    const world = await pausedWorld(8);
    const requestId = await stopRaised(world);
    await database.programmeRequest.create({
      data: {
        enrollmentId: world.enrollmentId,
        teacherUserId: world.teacherId,
        kind: 'charge_unknown',
        status: 'open',
      },
    });
    const adminId = await admin();
    // The pause's 7 days kept the weekly time reserved.
    expect(await slotTaken(world.slotId)).toBe(true);

    expect(await decide(adminId, requestId, 'approve')).toMatchObject({
      answer: { status: 'approved' },
      enrollmentId: world.enrollmentId,
    });

    const rows = await rowsOf(world.enrollmentId);
    expect(rows.enrollment).toEqual({
      status: 'cancelled',
      cancellationReason: 'programme_stopped',
    });
    expect(rows.programme).toMatchObject({ state: 'closed', pausedAt: null });
    expect(rows.programme.closedAt).not.toBeNull();
    expect(rows.items).toMatchObject([
      { kind: 'stop', status: 'approved', decidedByAdminId: adminId },
      { kind: 'charge_unknown', status: 'withdrawn' },
    ]);
    expect(rows.cancelled).toBe(1);
    expect(rows.cards).toBe(0);
    expect(await slotTaken(world.slotId)).toBe(false);
  });

  it('then payments’ sweep writes T011’s programme_stopped release: 17,500 + 70,000 = 87,500 pt', async () => {
    const world = await pausedWorld(8);
    const requestId = await stopRaised(world);
    await decide(await admin(), requestId, 'approve');
    await createShareReleaseSweep({
      transactions: transactionsOver(database),
      settings: { read: async (_key, schema) => schema.parse(72) },
      log: { info: () => undefined, warn: () => undefined, error: () => undefined },
      pageSize: 10,
      clock: dbNow,
      ordersAfter: async (_tx, after) =>
        after === undefined
          ? [
              {
                paymentId: world.assessmentId,
                enrollmentId: world.enrollmentId,
                kind: 'assessment' as const,
                instalmentMonth: null,
                paid_piasters: piasters(25_000),
                share_piasters: piasters(17_500),
                sharePercent: 70,
                halfPercent: 25,
                refunded_piasters: piasters(0),
              },
            ]
          : [],
    }).run();
    const releases = await database.teacherShareRelease.findMany({
      where: { enrollmentId: world.enrollmentId },
      select: { milestone: true, amountPiasters: true },
    });
    expect(
      releases.map(({ milestone, amountPiasters }) => [milestone, Number(amountPiasters)]),
    ).toEqual([['programme_stopped', 87_500]]);
  });

  it('declining it closes the item declined and leaves the programme paused, its time and card kept', async () => {
    const world = await pausedWorld(8);
    const requestId = await stopRaised(world);
    expect(await decide(await admin(), requestId, 'decline')).toMatchObject({
      answer: { status: 'declined' },
    });
    const rows = await rowsOf(world.enrollmentId);
    expect(rows.enrollment.status).toBe('confirmed');
    expect(rows.programme.state).toBe('paused');
    expect(rows.items).toMatchObject([{ kind: 'stop', status: 'declined' }]);
    expect(rows.cards).toBe(1);
    expect(await slotTaken(world.slotId)).toBe(true);
  });

  // Q-e4 (b), the owner's worked example: month 1 is 4 × 250 EGP; session 5 a teacher's no-show,
  // its make-up (session 6) set for Thursday 12/03; the administrator approves the stop on 11/30.
  it('refuses the approval sessions_pending while a make-up of a paid month is scheduled, writing nothing', async () => {
    const world = await pausedWorld(8);
    await database.session.update({
      where: {
        enrollmentId_sequenceNumber: { enrollmentId: world.enrollmentId, sequenceNumber: 5 },
      },
      data: { status: 'teacher_no_show' },
    });
    await database.session.create({
      data: {
        enrollmentId: world.enrollmentId,
        teacherUserId: world.teacherId,
        studentUserId: world.studentId,
        sequenceNumber: 6,
        scheduledDateLocal: new Date('2026-12-03T00:00:00Z'),
        scheduledStartTimeLocal: THURSDAY_0900,
        timezone: CAIRO,
        scheduledStartAt: new Date('2026-12-03T07:00:00Z'),
        scheduledEndAt: new Date('2026-12-03T08:00:00Z'),
        status: 'scheduled',
        programmeMonth: 1,
      },
    });
    const requestId = await stopRaised(world);
    expect(await causeOf(decide(await admin(), requestId, 'approve'))).toBe('sessions_pending');
    const rows = await rowsOf(world.enrollmentId);
    expect(rows.enrollment.status).toBe('confirmed');
    expect(rows.items).toMatchObject([{ kind: 'stop', status: 'open' }]);
    expect(rows.cards).toBe(1);
  });

  it('refuses the approval sessions_pending while a paid session’s remedy is open (awaiting the student’s choice)', async () => {
    const world = await pausedWorld(8);
    const session = await database.session.update({
      where: {
        enrollmentId_sequenceNumber: { enrollmentId: world.enrollmentId, sequenceNumber: 5 },
      },
      data: { status: 'teacher_no_show' },
      select: { id: true },
    });
    const offeredAt = await dbNow();
    await database.sessionRemedy.create({
      data: {
        sessionId: session.id,
        kind: 'makeup',
        status: 'awaiting_choice',
        offeredAt,
        choiceClosesAt: new Date(addDays(offeredAt, 7)),
        snapshotAnswerWindowHours: 48,
        snapshotFirstSessionLeadHours: 24,
      },
    });
    const requestId = await stopRaised(world);
    expect(await causeOf(decide(await admin(), requestId, 'approve'))).toBe('sessions_pending');
    expect((await rowsOf(world.enrollmentId)).enrollment.status).toBe('confirmed');
  });
});

// ---------------------------------------------------------------------------------------------
// The race kernel.md's 006:T015 row leaves to T017.

/** The enrollment id just before `id` in uuid order, so booking's real page starts at `id`. */
function justBefore(id: string): string {
  const hex = (BigInt(`0x${id.replaceAll('-', '')}`) - 1n).toString(16).padStart(32, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The sweep as `worker.ts` composes it, its page narrowed to the world's enrollment. */
function sweepOf(enrollmentId: string) {
  const real = programmeSweepOver({
    database,
    settings,
    log: silent,
    payee: createProgrammePayee({ paymentMode: 'test', cipher }),
    deleteProgrammeCard,
    orders: checkoutOrdersAmong,
    monthOrders: programmeMonthOrdersOf,
    charges: createProgrammeCharges({
      database,
      payment: fake,
      cipher,
      gateway: 'fake',
      paymentMode: 'test',
      settings,
      log: silent,
      confirmations: { enqueue: async () => undefined },
      notices: { record: async () => undefined } as never,
      report: () => undefined,
    }),
  });
  const job = advanceProgrammes({
    sweep: {
      ...real,
      page: async (after, take) =>
        after === undefined
          ? (await real.page(justBefore(enrollmentId), take)).filter(
              (row) => row.enrollmentId === enrollmentId,
            )
          : [],
    },
    log: silent,
    report: (error) => errors.push(error),
  });
  return { run: () => job.handle({}) };
}

async function automaticOrdersOf(enrollmentId: string) {
  return database.payment.count({ where: { enrollmentId, automatic: true } });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('the stop’s approval against the sweep’s due step (006:T017; kernel.md, 006:T015’s row)', () => {
  it('(a) red first: the approval holds its transaction; the step waits, then reads the programme closed and records no automatic order', async () => {
    const world = await pausedWorld(8);
    const requestId = await stopRaised(world);
    const adminId = await admin();
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let decided: () => void = () => undefined;
    const done = new Promise<void>((resolve) => {
      decided = resolve;
    });
    const approval = database.$transaction(
      async (tx) => {
        try {
          await decisions.decide(tx as Transaction, adminId, {
            requestId,
            decision: 'approve',
            idempotencyKey: randomUUID(),
          });
        } finally {
          decided();
          await released;
        }
      },
      { timeout: 30_000 },
    );
    await done;
    let finished = false;
    const sweep = sweepOf(world.enrollmentId)
      .run()
      .then(() => {
        finished = true;
      });
    await sleep(400);
    expect(finished).toBe(false);
    release();
    const [approved] = await Promise.allSettled([approval]);
    await sweep;
    expect(approved.status).toBe('fulfilled');
    expect(await automaticOrdersOf(world.enrollmentId)).toBe(0);
    expect((await rowsOf(world.enrollmentId)).enrollment.cancellationReason).toBe(
      'programme_stopped',
    );
    expect(errors).toEqual([]);
  });

  it('(b) red first: while the step holds the programme’s row, the approval waits before it takes the enrollment’s', async () => {
    const world = await pausedWorld(8);
    const requestId = await stopRaised(world);
    const adminId = await admin();
    let approval: Promise<unknown> | undefined;
    await database.$transaction(
      async (tx) => {
        await lockRows(tx as Transaction, 'programmes', [world.enrollmentId]);
        approval = decide(adminId, requestId, 'approve');
        await sleep(500);
        // The approval waits on the programme's row: the enrollment's is still free.
        await tx.$queryRaw`SELECT 1 FROM enrollments WHERE id = ${world.enrollmentId}::uuid FOR UPDATE NOWAIT`;
      },
      { timeout: 30_000 },
    );
    await approval;
    expect((await rowsOf(world.enrollmentId)).enrollment.cancellationReason).toBe(
      'programme_stopped',
    );
  });

  it('(c) the approval and the sweep at once: both finish, no deadlock, the programme stopped once', async () => {
    const world = await pausedWorld(8);
    const requestId = await stopRaised(world);
    const adminId = await admin();
    const outcomes = await Promise.allSettled([
      decide(adminId, requestId, 'approve'),
      sweepOf(world.enrollmentId).run(),
    ]);
    expect(outcomes.map(({ status }) => status)).toEqual(['fulfilled', 'fulfilled']);
    const rows = await rowsOf(world.enrollmentId);
    expect(rows.enrollment.cancellationReason).toBe('programme_stopped');
    expect(rows.cancelled).toBe(1);
    // A charge the step recorded first stays (it cannot be recalled); none after the close.
    expect(await automaticOrdersOf(world.enrollmentId)).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// 006:T017 — `programmes.reopen` over the real tables (FR-725, R-513; kernel.md, 006:T017's row):
// a stopped programme back to `paused` since the reopen, the enrollment `confirmed` again (its
// reason, `slot_released_at` and `admin_end_reason` cleared, `confirmed_at` untouched), one
// `programme_reopened` event, the weekly time in use again and no session generated; stopped again,
// its time is free again (T070's follow-up 2); refused as restore is, nothing written: `not_stopped`,
// `slot_inactive`, `slot_taken` (another student took the weekly time), `time_taken` (the student
// booked another teacher on it), `party_restricted`, `gender_mismatch` in both directions. Its race against a new booking of the same weekly time
// (`placeHold`, users then the slot): (a) the booking holds its transaction, the reopen waits, then
// reads the slot taken; (b) the reopen holds its transaction, the booking waits, then reads the slot
// taken (`SLOT_TAKEN`).

const NO_PUSH = { record: async () => undefined };
const REOPEN_REASON = 'سدد الطالب المتأخرات خارج التطبيق';

/** A world paused eight days whose stop an administrator approved: closed `programme_stopped`. */
async function stoppedWorld() {
  const world = await pausedWorld(8);
  const adminId = await admin();
  await decide(adminId, await stopRaised(world), 'approve');
  return { ...world, adminId };
}

function reopen(adminId: string, enrollmentId: string) {
  return database.$transaction((tx) =>
    decisions.reopen(tx as Transaction, adminId, {
      enrollmentId,
      reason: REOPEN_REASON,
      idempotencyKey: randomUUID(),
    }),
  );
}

/** Another male student, and a four-session package of the world's teacher on its weekly time. */
async function takenBy(world: Awaited<ReturnType<typeof stoppedWorld>>) {
  const studentId = await person('male');
  const { id: packageId } = await database.package.create({
    data: {
      teacherUserId: world.teacherId,
      subjectId: world.subjectId,
      sessionCount: 4,
      sessionDurationMinutes: 60,
      pricePiasters: 100_000n,
      isActive: true,
    },
    select: { id: true },
  });
  return { studentId, packageId };
}

describe('programmes.reopen over the real tables (006:T017, FR-725, R-513)', () => {
  it('reopens the stopped programme paused since the reopen: confirmed again, one event, the time in use, no session', async () => {
    const world = await stoppedWorld();
    // A released slot's instant, planted, so the reopen is seen clearing it (T070's follow-up 2).
    await database.enrollment.update({
      where: { id: world.enrollmentId },
      data: { slotReleasedAt: await dbNow() },
    });
    const sessionsBefore = await database.session.count({
      where: { enrollmentId: world.enrollmentId },
    });
    const before = await dbNow();
    expect(await reopen(world.adminId, world.enrollmentId)).toMatchObject({
      answer: { state: 'paused' },
      replayed: false,
    });
    const rows = await rowsOf(world.enrollmentId);
    expect(rows.enrollment).toEqual({ status: 'confirmed', cancellationReason: null });
    expect(
      await database.enrollment.findUniqueOrThrow({
        where: { id: world.enrollmentId },
        select: {
          cancellationReason: true,
          slotReleasedAt: true,
          adminEndReason: true,
          confirmedAt: true,
        },
      }),
    ).toEqual({
      cancellationReason: null,
      slotReleasedAt: null,
      adminEndReason: null,
      // R-HONEST-1: the first payment's confirmation, never written again.
      confirmedAt: new Date('2026-09-30T07:01:00Z'),
    });
    expect(rows.programme.state).toBe('paused');
    expect(rows.programme.closedAt).toBeNull();
    expect(rows.programme.pausedAt?.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(
      await database.enrollmentEvent.count({
        where: { enrollmentId: world.enrollmentId, kind: 'programme_reopened' },
      }),
    ).toBe(1);
    expect(await slotTaken(world.slotId)).toBe(true);
    expect(await database.session.count({ where: { enrollmentId: world.enrollmentId } })).toBe(
      sessionsBefore,
    );
    // `paused_at` is the reopen's instant: a new stop waits the 7 days again.
    expect(await causeOf(requestStop(world.teacherId, world.enrollmentId))).toBe('too_early');
  });

  it('a reopened programme stopped again frees its weekly time again (T070’s follow-up 2)', async () => {
    const world = await stoppedWorld();
    await reopen(world.adminId, world.enrollmentId);
    expect(await slotTaken(world.slotId)).toBe(true);
    await database.programme.update({
      where: { enrollmentId: world.enrollmentId },
      data: { pausedAt: new Date(addDays(await dbNow(), -8)) },
    });
    const { requestId } = await requestStop(world.teacherId, world.enrollmentId);
    await decide(world.adminId, requestId, 'approve');
    expect((await rowsOf(world.enrollmentId)).enrollment.cancellationReason).toBe(
      'programme_stopped',
    );
    expect(await slotTaken(world.slotId)).toBe(false);
  });

  it('refuses not_stopped on a programme no approved stop closed (still paused), writing nothing', async () => {
    const world = await pausedWorld(8);
    expect(await causeOf(reopen(await admin(), world.enrollmentId))).toBe('not_stopped');
    expect((await rowsOf(world.enrollmentId)).programme.state).toBe('paused');
  });

  it('refuses slot_inactive once the teacher deactivated the weekly time, writing nothing', async () => {
    const world = await stoppedWorld();
    await database.availabilitySlot.update({
      where: { id: world.slotId },
      data: { isActive: false },
    });
    expect(await causeOf(reopen(world.adminId, world.enrollmentId))).toBe('slot_inactive');
    expect((await rowsOf(world.enrollmentId)).programme.state).toBe('closed');
  });

  it('refuses time_taken once the student booked another teacher on the same weekly time (Q-e6), writing nothing', async () => {
    const world = await stoppedWorld();
    // Another teacher's four-session enrollment of the world's student on Thursday 09:00 Cairo,
    // its session two weeks on, resolved on its own date.
    const otherTeacherId = await person('male');
    const { id: otherSlotId } = await database.availabilitySlot.create({
      data: {
        teacherUserId: otherTeacherId,
        dayOfWeek: 4,
        startTimeLocal: THURSDAY_0900,
        durationMinutes: 60,
        timezone: CAIRO,
        isActive: true,
      },
      select: { id: true },
    });
    const { id: otherPackageId } = await database.package.create({
      data: {
        teacherUserId: otherTeacherId,
        subjectId: world.subjectId,
        sessionCount: 4,
        sessionDurationMinutes: 60,
        pricePiasters: 100_000n,
        isActive: true,
      },
      select: { id: true },
    });
    const { id: otherEnrollmentId } = await database.enrollment.create({
      data: {
        studentUserId: world.studentId,
        teacherUserId: otherTeacherId,
        packageId: otherPackageId,
        slotId: otherSlotId,
        snapshotPricePiasters: 100_000n,
        snapshotSessionCount: 4,
        snapshotDurationMinutes: 60,
        snapshotSubjectId: world.subjectId,
        snapshotSlotTimezone: CAIRO,
        status: 'confirmed',
        confirmedAt: new Date('2026-11-25T07:01:00Z'),
        purchasedAt: new Date('2026-11-25T07:00:00Z'),
        quotedFirstSessionLocalDate: new Date('2026-12-03T00:00:00Z'),
      },
      select: { id: true },
    });
    const weekly = {
      dayOfWeek: 4 as const,
      startTimeLocal: '09:00:00',
      durationMinutes: 60,
      timezone: CAIRO,
    };
    const [week] = resolveOccurrences(weekly, {
      fromLocalDate: localDateIn(new Date(addDays(await dbNow(), 14)), CAIRO),
      count: 1,
    });
    if (week === undefined) throw new Error('no occurrence');
    await database.session.create({
      data: {
        enrollmentId: otherEnrollmentId,
        teacherUserId: otherTeacherId,
        studentUserId: world.studentId,
        sequenceNumber: 1,
        scheduledDateLocal: dateColumnOf(week.requestedLocalDate),
        scheduledStartTimeLocal: THURSDAY_0900,
        timezone: CAIRO,
        scheduledStartAt: new Date(week.startsAt),
        scheduledEndAt: new Date(week.endsAt),
        status: 'scheduled',
      },
    });
    expect(await causeOf(reopen(world.adminId, world.enrollmentId))).toBe('time_taken');
    expect((await rowsOf(world.enrollmentId)).programme.state).toBe('closed');
  });

  it('refuses slot_taken once another student’s enrollment took the weekly time, writing nothing', async () => {
    const world = await stoppedWorld();
    const other = await takenBy(world);
    await database.enrollment.create({
      data: {
        studentUserId: other.studentId,
        teacherUserId: world.teacherId,
        packageId: other.packageId,
        slotId: world.slotId,
        snapshotPricePiasters: 100_000n,
        snapshotSessionCount: 4,
        snapshotDurationMinutes: 60,
        snapshotSubjectId: world.subjectId,
        snapshotSlotTimezone: CAIRO,
        status: 'confirmed',
        confirmedAt: new Date('2026-11-20T07:01:00Z'),
        purchasedAt: new Date('2026-11-20T07:00:00Z'),
        quotedFirstSessionLocalDate: new Date('2026-11-26T00:00:00Z'),
      },
    });
    expect(await causeOf(reopen(world.adminId, world.enrollmentId))).toBe('slot_taken');
    expect((await rowsOf(world.enrollmentId)).enrollment.cancellationReason).toBe(
      'programme_stopped',
    );
  });

  it('refuses party_restricted while the student is suspended, writing nothing', async () => {
    const world = await stoppedWorld();
    await database.user.update({
      where: { id: world.studentId },
      data: { accountStatus: 'suspended' },
    });
    expect(await causeOf(reopen(world.adminId, world.enrollmentId))).toBe('party_restricted');
    expect((await rowsOf(world.enrollmentId)).programme.state).toBe('closed');
  });

  it.each([
    ['the student’s gender corrected to female (a male teacher)', 'student' as const],
    ['the teacher’s gender corrected to female (a male student)', 'teacher' as const],
  ])('refuses gender_mismatch with %s, writing nothing', async (_name, who) => {
    const world = await stoppedWorld();
    await database.user.update({
      where: { id: who === 'student' ? world.studentId : world.teacherId },
      data: { gender: 'female' },
    });
    expect(await causeOf(reopen(world.adminId, world.enrollmentId))).toBe('gender_mismatch');
    expect((await rowsOf(world.enrollmentId)).programme.state).toBe('closed');
  });
});

describe('programmes.reopen against a new booking of the same weekly time (006:T017; kernel.md, 006:T017’s row)', () => {
  async function termsNow() {
    return {
      now: await dbNow(),
      ttlMinutes: 10,
      graceMinutes: 5,
      leadHours: 24,
      bufferWeeks: async () => 0,
      windowDays: async () => 14,
    };
  }

  it('(a) red first: the booking holds its transaction; the reopen waits, then reads the slot taken', async () => {
    const world = await stoppedWorld();
    const other = await takenBy(world);
    const terms = await termsNow();
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let placed: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      placed = resolve;
    });
    const booking = database.$transaction(
      async (tx) => {
        try {
          await placeHold(
            tx as Transaction,
            { userId: other.studentId, gender: 'male' as RequesterGender },
            { packageId: other.packageId, slotId: world.slotId },
            { terms, orders: orderStandingsOf, notices: NO_PUSH },
          );
        } finally {
          placed();
          await released;
        }
      },
      { timeout: 30_000 },
    );
    await held;
    let finished = false;
    const reopened = causeOf(reopen(world.adminId, world.enrollmentId)).then((cause) => {
      finished = true;
      return cause;
    });
    await sleep(400);
    expect(finished).toBe(false);
    release();
    await booking;
    expect(await reopened).toBe('slot_taken');
    expect((await rowsOf(world.enrollmentId)).programme.state).toBe('closed');
  });

  it('(b) red first: the reopen holds its transaction; the booking waits, then reads the slot taken', async () => {
    const world = await stoppedWorld();
    const other = await takenBy(world);
    const terms = await termsNow();
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let done: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      done = resolve;
    });
    const reopening = database.$transaction(
      async (tx) => {
        try {
          await decisions.reopen(tx as Transaction, world.adminId, {
            enrollmentId: world.enrollmentId,
            reason: REOPEN_REASON,
            idempotencyKey: randomUUID(),
          });
        } finally {
          done();
          await released;
        }
      },
      { timeout: 30_000 },
    );
    await held;
    let finished = false;
    const booking = causeOf(
      database.$transaction(async (tx) =>
        placeHold(
          tx as Transaction,
          { userId: other.studentId, gender: 'male' as RequesterGender },
          { packageId: other.packageId, slotId: world.slotId },
          { terms, orders: orderStandingsOf, notices: NO_PUSH },
        ),
      ),
    ).then((cause) => {
      finished = true;
      return cause;
    });
    await sleep(400);
    expect(finished).toBe(false);
    release();
    const [reopenedOutcome] = await Promise.allSettled([reopening]);
    expect(reopenedOutcome.status).toBe('fulfilled');
    expect(await booking).toBe('SLOT_TAKEN');
    expect((await rowsOf(world.enrollmentId)).programme.state).toBe('paused');
  });
});
