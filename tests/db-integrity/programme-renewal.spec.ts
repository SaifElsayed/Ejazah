// 006:T016 of specs/006-programme/tasks.md (FR-713a, FR-722, FR-724; R-508, R-510; SRS DEC-95;
// kernel.md, 006:T016's row; B-P3's conflict check) — the renewal's races over the real tables, each
// serialised on the programme's row then the enrollment's:
// - `programme.autoRenewOff` against the sweep's due step, the lock the due step reads the card
//   under: (a) the due step first, paused inside its transaction after it read the card: the «off»
//   waits, then deletes the card; the order already recorded stays (DEC-95's reading); (b) the «off»
//   first, paused after its delete: the due step waits, then reads no card and records nothing. An
//   «off» that has answered is never followed by a new automatic order.
// - `programme.renew` against the automatic charge of the same month: (e) a retry recorded while the
//   renewal is at the gateway refuses it `charge_pending` under the record's locks, its order
//   cancelled; (f) the renewal first: the retry step reads the manual order and records nothing;
//   (g), (h) the composed checkout refuses `payee_unverified` in live mode only.
// - the paid month's resume against the sweep's pause: (c) the pause first, paused inside its
//   transaction: the confirm step waits on the programme, then resumes it (`active`, `paused_at`
//   cleared, one `programme_resumed`); (d) the confirm step first, paused after the record: the pause
//   step waits, then reads month 2 paid and pauses nothing.
// Red first under named mutants (the report's table) and the code before T016.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { confirmationStepsOf, confirmEnrollment } from '../../apps/api/src/jobs/confirm-enrollment';
import {
  createProgrammeMonths,
  createProgrammeServices,
} from '../../apps/api/src/modules/booking/index';
import { createNotificationWriter } from '../../apps/api/src/modules/notifications/index';
import {
  checkoutOrdersAmong,
  createCheckoutServices,
  createProgrammeCharges,
  deleteProgrammeCard,
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
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures';
import { transactionsOver } from '../../apps/api/src/platform/db/transaction.repository';
import { IdempotencyRepository } from '../../apps/api/src/platform/idempotency/idempotency.repository';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service';
import { createLogger } from '../../apps/api/src/platform/logging/logger';
import {
  createPaymentPort,
  type PaymentConfig,
} from '../../apps/api/src/platform/ports/payment/index';
import type { RequesterGender } from '../../apps/api/src/platform/guards/requester-gender';
import type { PaymentPort } from '../../apps/api/src/platform/ports/payment/payment.port';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader';
import { addHours, addMinutes } from '../../packages/time/src/index.js';
import { CAIRO, confirmationWorld, SETTINGS, THURSDAY_0900 } from './confirmation-world';

const KEY = Buffer.alloc(32, 7).toString('base64');
const cipher = new ColumnCipher(KEY);
const PAYMENT: PaymentConfig = {
  PAYMENT_GATEWAY: 'fake',
  PAYMENT_MODE: 'test',
  ENCRYPTION_KEY: KEY,
};
const TOKEN = 'placeholder-card-token';

const VALUES: Record<string, unknown> = {
  ...SETTINGS,
  programme_offer_hours: 24,
  programme_pay_rest_hours: 48,
  programme_charge_retry_days: [1, 3, 5, 7],
  programme_charge_inquiry_tries: 6,
  programme_renew_early_days: 3,
  idempotency_key_ttl_hours: 24,
};
const settings: SettingsReader = { read: async (key, schema) => schema.parse(VALUES[key]) };
const silent = createLogger({ level: 'error', destination: { write: () => undefined } });

let database: Database;
let writer: ReturnType<typeof createNotificationWriter>;
const fake = createPaymentPort(PAYMENT);

beforeAll(() => {
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 8,
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

const { person, paidEvent } = confirmationWorld(() => database);

async function dbNow(): Promise<Date> {
  const [{ now }] = await database.$queryRaw<[{ now: Date }]>`SELECT clock_timestamp() AS now`;
  return now;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A gate: `hit` resolves when the work reaches it; the work waits there until `release`. */
function gate() {
  let reached: () => void = () => undefined;
  const hit = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    hit,
    release,
    pass: async () => {
      reached();
      await released;
    },
  };
}

/**
 * A monthly programme of 40 offer sessions on Thursday 09:00 Cairo, month 1 paid, its last session
 * ended `endedAgoHours` ago; the assessment's order processed at 70 %; a saved card when `card`.
 */
async function monthlyWorld({ card, endedAgoHours }: { card: boolean; endedAgoHours: number }) {
  const teacherId = await person('male');
  await database.teacherProfile.create({
    data: {
      userId: teacherId,
      bio: 'Probe',
      qualificationSummary: 'Probe',
      verificationStatus: 'approved',
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
      price30Piasters: 25_000n,
      price45Piasters: 30_000n,
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
      confirmedAt: new Date('2026-10-01T07:01:00Z'),
      purchasedAt: new Date('2026-10-01T07:00:00Z'),
      quotedFirstSessionLocalDate: new Date('2026-10-01T00:00:00Z'),
    },
    select: { id: true },
  });
  await database.programme.create({
    data: {
      enrollmentId,
      state: 'active',
      offeredAt: new Date('2026-10-01T07:00:00Z'),
      monthCount: 10,
      paymentPlan: 'monthly',
      monthsPaid: 1,
    },
  });
  await database.$executeRaw`
    INSERT INTO payments (enrollment_id, gateway, gateway_order_id, gross_piasters, currency, status,
                          expires_at, kind, teacher_share_rate_percent, teacher_share_piasters,
                          confirmed_at, updated_at)
    VALUES (${enrollmentId}::uuid, 'fake', ${`fake_ord_${randomUUID()}`}, 25000, 'EGP', 'paid',
            '2026-10-01T07:10:00Z', 'assessment', 70, 17500, '2026-10-01T07:01:00Z', now())`;
  // Month 1, paid and processed by the confirm step (its marker), so month 2 is the one awaited.
  await database.$executeRaw`
    INSERT INTO payments (enrollment_id, gateway, gateway_order_id, gross_piasters, currency, status,
                          expires_at, kind, instalment_month, teacher_share_rate_percent,
                          teacher_share_piasters, confirmed_at, updated_at)
    VALUES (${enrollmentId}::uuid, 'fake', ${`fake_ord_${randomUUID()}`}, 100000, 'EGP', 'paid',
            '2026-10-02T07:10:00Z', 'instalment', 1, 70, 70000, '2026-10-02T07:01:00Z', now())`;
  const endsAt = new Date(addHours(await dbNow(), -endedAgoHours));
  await database.session.create({
    data: {
      enrollmentId,
      teacherUserId: teacherId,
      studentUserId: studentId,
      sequenceNumber: 2,
      scheduledDateLocal: new Date('2026-10-08T00:00:00Z'),
      scheduledStartTimeLocal: THURSDAY_0900,
      timezone: CAIRO,
      scheduledStartAt: new Date(addMinutes(endsAt, -60)),
      scheduledEndAt: endsAt,
      status: 'done',
      programmeMonth: 1,
    },
  });
  if (card) {
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
  }
  return { teacherId, studentId, enrollmentId };
}

/** Payments' automatic charge over the stand-in gateway, as `worker.ts` composes it. */
function realCharges() {
  return createProgrammeCharges({
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
  });
}

/** Booking's month steps over the real tables; `charges` and `orders` as the caller wraps them. */
function monthsOf({
  charges = realCharges(),
  orders = programmeMonthOrdersOf,
}: {
  charges?: Parameters<typeof createProgrammeMonths>[0]['charges'];
  orders?: Parameters<typeof createProgrammeMonths>[0]['orders'];
} = {}) {
  return createProgrammeMonths({
    transactions: transactionsOver(database),
    settings,
    orders,
    charges,
    log: silent,
  });
}

/** Booking's `programme` services as `main.ts` composes them for the student's procedures. */
function programmeServices() {
  return createProgrammeServices({
    idempotency: new IdempotencyService<Transaction>({
      store: new IdempotencyRepository(database),
      settings,
    }),
    settings,
    amounts: programmeOfferAmountsOf,
    log: silent,
    deleteProgrammeCard,
    orders: checkoutOrdersAmong,
  });
}

function turnOff(studentId: string, enrollmentId: string, services = programmeServices()) {
  return services.autoRenewOff(
    studentId,
    { enrollmentId, idempotencyKey: randomUUID() },
    { afterCommit: () => undefined },
  );
}

async function automaticOrdersOf(enrollmentId: string) {
  return database.payment.findMany({
    where: { enrollmentId, automatic: true },
    orderBy: { id: 'asc' },
    select: { id: true, status: true, instalmentMonth: true },
  });
}

async function cardOf(enrollmentId: string) {
  return database.programmeCard.findUnique({ where: { enrollmentId }, select: { last4: true } });
}

describe('programme.autoRenewOff against the due step (006:T016; DEC-95, R-510; kernel.md)', () => {
  it('(a) red first: the due step first: the «off» waits on the programme, then deletes the card; the order recorded stays', async () => {
    const { studentId, enrollmentId } = await monthlyWorld({ card: true, endedAgoHours: 1 });
    const held = gate();
    const real = realCharges();
    // Paused inside the due step's transaction, after it read the card under its locks.
    const months = monthsOf({
      charges: {
        record: async (tx, request) => {
          await held.pass();
          return real.record(tx, request);
        },
      },
    });
    const due = months.step('due', enrollmentId, { askedNoAnswer: false });
    await held.hit;
    let answered = false;
    const off = turnOff(studentId, enrollmentId).then((answer) => {
      answered = true;
      return answer;
    });
    await sleep(400);
    expect(answered).toBe(false);
    held.release();
    await due;
    await expect(off).resolves.toEqual({ ok: true });
    expect(await automaticOrdersOf(enrollmentId)).toMatchObject([
      { status: 'created', instalmentMonth: 2 },
    ]);
    expect(await cardOf(enrollmentId)).toBeNull();
  });

  it('(b) red first: the «off» first: the due step waits, then reads no card and records nothing', async () => {
    const { studentId, enrollmentId } = await monthlyWorld({ card: true, endedAgoHours: 1 });
    const held = gate();
    const services = createProgrammeServices({
      idempotency: new IdempotencyService<Transaction>({
        store: new IdempotencyRepository(database),
        settings,
      }),
      settings,
      amounts: programmeOfferAmountsOf,
      log: silent,
      // Paused inside the «off»'s transaction, after the delete and before its commit.
      deleteProgrammeCard: async (tx, id) => {
        await deleteProgrammeCard(tx, id);
        await held.pass();
      },
      orders: checkoutOrdersAmong,
    });
    const off = turnOff(studentId, enrollmentId, services);
    await held.hit;
    let stepped = false;
    const due = monthsOf()
      .step('due', enrollmentId, { askedNoAnswer: false })
      .then((done) => {
        stepped = true;
        return done;
      });
    await sleep(400);
    expect(stepped).toBe(false);
    held.release();
    await expect(off).resolves.toEqual({ ok: true });
    await expect(due).resolves.toMatchObject({ action: 'none' });
    expect(await automaticOrdersOf(enrollmentId)).toEqual([]);
    expect(await cardOf(enrollmentId)).toBeNull();
  });
});

/**
 * A month-2 order by hand (the amount column named only by SQL here, R-MONEY-6), `created`; then
 * paid, with its signed event, by `markPaid` (no lock on the enrollment: a status move only).
 */
async function monthTwoOrder(enrollmentId: string): Promise<string> {
  const [row] = await database.$queryRaw<{ id: string }[]>`
    INSERT INTO payments (enrollment_id, gateway, gateway_order_id, gross_piasters, currency,
                          status, expires_at, kind, instalment_month,
                          teacher_share_rate_percent, teacher_share_piasters, updated_at)
    VALUES (${enrollmentId}::uuid, 'fake', ${`probe-order-${randomUUID()}`}, 100000, 'EGP',
            'created', clock_timestamp() + interval '10 minutes', 'instalment', 2, 70, 70000, now())
    RETURNING id::text AS id`;
  if (row === undefined) throw new Error('no order written');
  return row.id;
}

async function markPaid(paymentId: string): Promise<void> {
  await database.payment.update({ where: { id: paymentId }, data: { status: 'paid' } });
  await paidEvent(paymentId);
}

function confirmJob(steps = confirmationStepsOf(writer)) {
  return confirmEnrollment({ database, settings, notices: writer, steps, log: silent });
}

async function programmeOf(enrollmentId: string) {
  return database.programme.findUniqueOrThrow({
    where: { enrollmentId },
    select: { state: true, pausedAt: true, monthsPaid: true },
  });
}

async function eventsOf(enrollmentId: string) {
  const rows = await database.enrollmentEvent.findMany({
    where: { enrollmentId, kind: { in: ['programme_paused', 'programme_resumed'] } },
    orderBy: { occurredAt: 'asc' },
    select: { kind: true },
  });
  return rows.map(({ kind }) => kind);
}

describe('the paid month’s resume against the sweep’s pause (006:T016; FR-722; kernel.md)', () => {
  it('(c) red first: the pause first: the confirm step waits on the programme, then resumes it with one programme_resumed', async () => {
    // Month 1's last session ended 8 days ago: the next Thursday has started unpaid.
    const { enrollmentId } = await monthlyWorld({ card: false, endedAgoHours: 8 * 24 });
    const paymentId = await monthTwoOrder(enrollmentId);
    const held = gate();
    // Paused inside the pause step's transaction, under its locks, before its write.
    const months = monthsOf({
      orders: async (tx, id, month, at) => {
        const answer = await programmeMonthOrdersOf(tx, id, month, at);
        await held.pass();
        return answer;
      },
    });
    const pause = months.step('pause', enrollmentId, { askedNoAnswer: false });
    await held.hit;
    // The gateway pays month 2 while the pause holds the programme (a paid, unprocessed order read
    // before it would have held the pause).
    await markPaid(paymentId);
    let confirmed = false;
    const confirm = confirmJob()
      .handle({ paymentId })
      .then(() => {
        confirmed = true;
      });
    await sleep(400);
    expect(confirmed).toBe(false);
    held.release();
    await expect(pause).resolves.toMatchObject({ action: 'pause' });
    await confirm;
    expect(await programmeOf(enrollmentId)).toEqual({
      state: 'active',
      pausedAt: null,
      monthsPaid: 2,
    });
    expect(await eventsOf(enrollmentId)).toEqual(['programme_paused', 'programme_resumed']);
  });

  it('(d) red first: the confirm step first: the pause step waits, then reads month 2 paid and pauses nothing', async () => {
    const { enrollmentId } = await monthlyWorld({ card: false, endedAgoHours: 8 * 24 });
    const paymentId = await monthTwoOrder(enrollmentId);
    await markPaid(paymentId);
    const held = gate();
    const steps = confirmationStepsOf(writer);
    const confirm = confirmJob({
      ...steps,
      // Paused inside the confirm step's transaction, after the paid month's record.
      recordProgrammePaid: async (tx, id, payment, log) => {
        await steps.recordProgrammePaid(tx, id, payment, log);
        await held.pass();
      },
    }).handle({ paymentId });
    await held.hit;
    let stepped = false;
    const pause = monthsOf()
      .step('pause', enrollmentId, { askedNoAnswer: false })
      .then((done) => {
        stepped = true;
        return done;
      });
    await sleep(400);
    expect(stepped).toBe(false);
    held.release();
    await confirm;
    await expect(pause).resolves.toMatchObject({ action: 'none' });
    expect(await programmeOf(enrollmentId)).toEqual({
      state: 'active',
      pausedAt: null,
      monthsPaid: 2,
    });
    expect(await eventsOf(enrollmentId)).toEqual([]);
  });
});

/** Month 2's first automatic charge, failed `soft` a day and a minute ago: retry 1 is due now. */
async function failedMonthTwo(enrollmentId: string): Promise<void> {
  await database.$executeRaw`
    INSERT INTO payments (enrollment_id, gateway, gateway_order_id, gross_piasters, currency,
                          status, expires_at, kind, instalment_month, automatic, attempt,
                          decline_kind, teacher_share_rate_percent, teacher_share_piasters,
                          updated_at)
    VALUES (${enrollmentId}::uuid, 'fake', ${`probe-order-${randomUUID()}`}, 100000, 'EGP',
            'failed', clock_timestamp() - interval '1 day 1 minute', 'instalment', 2, true, 0,
            'soft', 70, 70000, now())`;
  await database.$executeRaw`
    UPDATE programmes SET first_failure_at = clock_timestamp() - interval '1 day 1 minute'
    WHERE enrollment_id = ${enrollmentId}::uuid`;
}

/** Payments' checkout as `main.ts` composes it, over `payment` and the payment mode. */
function checkoutOver(payment: PaymentPort, paymentMode: 'test' | 'live') {
  return createCheckoutServices({
    database,
    settings,
    idempotency: new IdempotencyService<Transaction>({
      store: new IdempotencyRepository(database),
      settings,
    }),
    payment,
    cipher,
    gateway: 'fake',
    notices: writer,
    paymentMode,
  });
}

async function monthTwoOrdersOf(enrollmentId: string) {
  return database.payment.findMany({
    where: { enrollmentId, instalmentMonth: 2 },
    orderBy: { id: 'asc' },
    select: { automatic: true, status: true, attempt: true },
  });
}

const log = { info: () => undefined };
const student = (userId: string) => ({ userId, gender: 'male' as RequesterGender });

describe('programme.renew against the automatic charge of the same month (006:T016; R-509; kernel.md)', () => {
  it('(e) red first: a retry recorded while the renewal is at the gateway refuses it charge_pending under the record’s locks; its order cancelled, one order for the month', async () => {
    const { studentId, enrollmentId } = await monthlyWorld({ card: true, endedAgoHours: 48 });
    await failedMonthTwo(enrollmentId);
    const cancelled: string[] = [];
    let retried: unknown;
    // While the renewal's order is at the gateway (no lock held), the sweep's retry step runs whole.
    const payment: PaymentPort = {
      ...fake,
      createCheckout: async (...args) => {
        const checkout = await fake.createCheckout(...args);
        retried = await monthsOf().step('retry', enrollmentId, { askedNoAnswer: false });
        return checkout;
      },
      cancelCheckout: async (gatewayOrderId) => {
        cancelled.push(gatewayOrderId);
        return fake.cancelCheckout(gatewayOrderId);
      },
    };
    const error: unknown = await checkoutOver(payment, 'test')
      .programmeRenew(
        student(studentId),
        { enrollmentId, saveCard: false, idempotencyKey: randomUUID() },
        log,
      )
      .catch((thrown: unknown) => thrown);
    expect(retried).toMatchObject({ action: 'retry' });
    expect((error as { details?: { code: string }[] }).details?.[0]?.code).toBe('charge_pending');
    expect(cancelled).toHaveLength(1);
    expect(await monthTwoOrdersOf(enrollmentId)).toEqual([
      { automatic: true, status: 'failed', attempt: 0 },
      { automatic: true, status: 'created', attempt: 1 },
    ]);
  });

  it('(f) the renewal first: the retry step then reads the month’s manual order payable and records nothing', async () => {
    const { studentId, enrollmentId } = await monthlyWorld({ card: true, endedAgoHours: 48 });
    await failedMonthTwo(enrollmentId);
    await expect(
      checkoutOver(fake, 'test').programmeRenew(
        student(studentId),
        { enrollmentId, saveCard: false, idempotencyKey: randomUUID() },
        log,
      ),
    ).resolves.toHaveProperty('checkoutUrl');
    await expect(
      monthsOf().step('retry', enrollmentId, { askedNoAnswer: false }),
    ).resolves.toMatchObject({ action: 'none' });
    expect(await monthTwoOrdersOf(enrollmentId)).toEqual([
      { automatic: true, status: 'failed', attempt: 0 },
      { automatic: false, status: 'created', attempt: null },
    ]);
  });
});

describe('programme.renew and programme.pay in live mode through the composed checkout (006:T016; FR-720)', () => {
  it('(g) red first: the teacher’s payout account unverified refuses payee_unverified before the gateway, nothing written', async () => {
    const { studentId, enrollmentId } = await monthlyWorld({ card: false, endedAgoHours: 48 });
    const created: unknown[] = [];
    const payment: PaymentPort = {
      ...fake,
      createCheckout: async (...args) => {
        created.push(args);
        return fake.createCheckout(...args);
      },
    };
    const error: unknown = await checkoutOver(payment, 'live')
      .programmeRenew(
        student(studentId),
        { enrollmentId, saveCard: false, idempotencyKey: randomUUID() },
        log,
      )
      .catch((thrown: unknown) => thrown);
    expect((error as { details?: { code: string }[] }).details?.[0]?.code).toBe('payee_unverified');
    expect(created).toEqual([]);
    expect(await monthTwoOrdersOf(enrollmentId)).toEqual([]);
  });

  it('(h) test mode takes the same month by hand: the stand-in charges with no payee', async () => {
    const { studentId, enrollmentId } = await monthlyWorld({ card: false, endedAgoHours: 48 });
    await expect(
      checkoutOver(fake, 'test').programmeRenew(
        student(studentId),
        { enrollmentId, saveCard: false, idempotencyKey: randomUUID() },
        log,
      ),
    ).resolves.toHaveProperty('checkoutUrl');
    expect(await monthTwoOrdersOf(enrollmentId)).toEqual([
      { automatic: false, status: 'created', attempt: null },
    ]);
  });
});
