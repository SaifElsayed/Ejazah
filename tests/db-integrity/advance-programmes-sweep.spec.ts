// 006:T015 of specs/006-programme/tasks.md (R-508, R-509; SRS DEC-110, DEC-113; Q-1 (a); kernel.md,
// 006:T015's row; the review session's note before the merge) — the `advance-programmes` sweep over
// the real tables, composed as `worker.ts` composes it (`programmeSweepOver`), the stand-in gateway
// behind the port:
// - the double run: two sweeps at once record one automatic order and send its payment once; over an
//   unanswered charge, two sweeps at once open one `charge_unknown` item and report no failure;
// - the races of the month step, each serialised on the programme's row then the enrollment's:
//   (a) the due charge against the webhook's paid of the month's order (its `lockOrder` and its
//   move): the step waits on the enrollment, then reads the order paid and records nothing;
//   (b) the due charge against a manual checkout of the same month recorded under `programmes` and
//   `enrollments`: the step waits, then reads it payable and records nothing;
//   (c) the due step against `programme.cancel`'s lock on the programme: the step waits; the cancel
//   is refused `rest_paid` on a paid programme; one order.
// Red under named mutants of the month step's locks (MD1: both removed; MD2: the enrollment's).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  advanceProgrammes,
  programmeSweepOver,
} from '../../apps/api/src/jobs/advance-programmes';
import { createProgrammeServices } from '../../apps/api/src/modules/booking/index';
import {
  checkoutOrdersAmong,
  createProgrammeCharges,
  createProgrammePayee,
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
import { lockRows } from '../../apps/api/src/platform/db/row-lock';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures';
import { IdempotencyRepository } from '../../apps/api/src/platform/idempotency/idempotency.repository';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service';
import { createLogger } from '../../apps/api/src/platform/logging/logger';
import {
  createPaymentPort,
  type PaymentConfig,
} from '../../apps/api/src/platform/ports/payment/index';
import type { PaymentPort } from '../../apps/api/src/platform/ports/payment/payment.port';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader';
import { addHours, addMinutes, addSeconds } from '../../packages/time/src/index.js';
import { CAIRO, confirmationWorld, SETTINGS, THURSDAY_0900 } from './confirmation-world';

const KEY = Buffer.alloc(32, 7).toString('base64');
const cipher = new ColumnCipher(KEY);
const PAYMENT: PaymentConfig = { PAYMENT_GATEWAY: 'fake', PAYMENT_MODE: 'test', ENCRYPTION_KEY: KEY };
const TOKEN = 'placeholder-card-token';

/** The stand-in behind the port (`fake.adapter.ts`), named structurally as lane b's spec does. */
interface StandInGateway extends PaymentPort {
  readonly calls: readonly { readonly operation: string; readonly args: readonly unknown[] }[];
  onInquiry(gatewayOrderId: string, answer: 'none' | 'no_answer'): void;
}

const VALUES: Record<string, unknown> = {
  ...SETTINGS,
  programme_offer_hours: 24,
  programme_pay_rest_hours: 48,
  programme_charge_retry_days: [1, 3, 5, 7],
  programme_charge_inquiry_tries: 6,
  idempotency_key_ttl_hours: 24,
};
const settings: SettingsReader = { read: async (key, schema) => schema.parse(VALUES[key]) };
const silent = createLogger({ level: 'error', destination: { write: () => undefined } });
const errors: Error[] = [];

let database: Database;
const fake = createPaymentPort(PAYMENT) as StandInGateway;

beforeAll(() => {
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 8,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
});

afterAll(async () => {
  await closeDatabase(database);
});

const { person } = confirmationWorld(() => database);

/** The enrollment id just before `id` in uuid order, so booking's real page starts at `id`. */
function justBefore(id: string): string {
  const hex = (BigInt(`0x${id.replaceAll('-', '')}`) - 1n).toString(16).padStart(32, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The sweep as `worker.ts` composes it (`programmeSweepOver`), the stand-in gateway behind the port;
 * its page is booking's own, started just before this world's enrollment and narrowed to it, so the
 * suite's other programmes on the shared database are left alone.
 */
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

async function dbNow(): Promise<Date> {
  const [{ now }] = await database.$queryRaw<[{ now: Date }]>`SELECT clock_timestamp() AS now`;
  return now;
}

/**
 * A monthly programme of 40 offer sessions, month 1 paid, its last session (Thursday 09:00 Cairo,
 * 60 minutes) ended an hour ago: month 2 is due. The assessment's order processed at 70 %, and a
 * saved card (its token sealed by the cipher).
 */
async function dueWorld() {
  const teacherId = await person('male');
  await database.teacherProfile.create({
    data: { userId: teacherId, bio: 'Probe', qualificationSummary: 'Probe', verificationStatus: 'approved' },
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
      confirmedAt: new Date('2026-11-01T07:01:00Z'),
      purchasedAt: new Date('2026-11-01T07:00:00Z'),
      quotedFirstSessionLocalDate: new Date('2026-11-05T00:00:00Z'),
    },
    select: { id: true },
  });
  await database.programme.create({
    data: {
      enrollmentId,
      state: 'active',
      offeredAt: new Date('2026-11-01T07:00:00Z'),
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
            '2026-11-01T07:10:00Z', 'assessment', 70, 17500, '2026-11-01T07:01:00Z', now())`;
  const endsAt = new Date(addHours(await dbNow(), -1));
  await database.session.create({
    data: {
      enrollmentId,
      teacherUserId: teacherId,
      studentUserId: studentId,
      sequenceNumber: 2,
      scheduledDateLocal: new Date('2026-11-19T00:00:00Z'),
      scheduledStartTimeLocal: THURSDAY_0900,
      timezone: CAIRO,
      scheduledStartAt: new Date(addMinutes(endsAt, -60)),
      scheduledEndAt: endsAt,
      status: 'done',
      programmeMonth: 1,
    },
  });
  await database.programmeCard.create({
    data: {
      enrollmentId,
      tokenEncrypted: Uint8Array.from(
        cipher.encrypt(TOKEN, 'programme_cards.token_encrypted', enrollmentId),
      ),
      last4: '4242',
      brand: 'Visa',
      consentedAt: new Date('2026-11-01T08:00:00Z'),
    },
  });
  return { teacherId, studentId, enrollmentId };
}

/** A month-2 order by SQL (R-MONEY-6): automatic or manual, in `status`, expiring `minutes` away. */
async function monthTwoOrder(
  enrollmentId: string,
  {
    automatic,
    status,
    minutes,
  }: { automatic: boolean; status: 'created' | 'paid'; minutes: number },
): Promise<{ paymentId: string; gatewayOrderId: string }> {
  const gatewayOrderId = `probe-order-${randomUUID()}`;
  const expiresAt = new Date(addSeconds(await dbNow(), minutes * 60));
  const [row] = await database.$queryRaw<{ id: string }[]>`
    INSERT INTO payments (enrollment_id, gateway, gateway_order_id, gross_piasters, currency,
                          status, expires_at, kind, instalment_month, automatic, attempt,
                          teacher_share_rate_percent, teacher_share_piasters, updated_at)
    VALUES (${enrollmentId}::uuid, 'fake', ${gatewayOrderId}, 100000, 'EGP',
            ${status}::payment_status, ${expiresAt}, 'instalment', 2, ${automatic},
            ${automatic ? 0 : null}, 70, 70000, now())
    RETURNING id::text AS id`;
  if (row === undefined) throw new Error('no order written');
  return { paymentId: row.id, gatewayOrderId };
}

async function automaticOrdersOf(enrollmentId: string) {
  return database.payment.findMany({
    where: { enrollmentId, automatic: true },
    orderBy: { id: 'asc' },
    select: { id: true, status: true, attempt: true, instalmentMonth: true },
  });
}

function chargesSentFor(paymentIds: readonly string[]): number {
  return fake.calls.filter(
    ({ operation, args }) => operation === 'chargeSavedCard' && paymentIds.includes(String(args[0])),
  ).length;
}

/** A transaction that takes `tables`' rows of the enrollment in order, does `work`, and waits. */
function holding(
  enrollmentId: string,
  tables: readonly ('programmes' | 'enrollments')[],
  work: (tx: Transaction) => Promise<void> = async () => undefined,
) {
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let locked: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const done = database.$transaction(
    async (tx) => {
      for (const table of tables) await lockRows(tx as Transaction, table, [enrollmentId]);
      await work(tx as Transaction);
      locked();
      await released;
    },
    { timeout: 30_000 },
  );
  return { held, release, done };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('the double run over the real tables (006:T015; R-API-14)', () => {
  it('red first: two sweeps at once record month 2’s automatic order once and send its payment once', async () => {
    const { enrollmentId } = await dueWorld();
    const one = sweepOf(enrollmentId);
    const other = sweepOf(enrollmentId);
    await Promise.all([one.run(), other.run()]);
    const orders = await automaticOrdersOf(enrollmentId);
    expect(orders).toMatchObject([{ attempt: 0, instalmentMonth: 2 }]);
    expect(chargesSentFor(orders.map(({ id }) => id))).toBe(1);
    const programme = await database.programme.findUniqueOrThrow({
      where: { enrollmentId },
      select: { nextDueAt: true, retriesDone: true, firstFailureAt: true },
    });
    expect(programme.nextDueAt).not.toBeNull();
    expect(errors).toEqual([]);
  });

  it('two sweeps at once over a charge unanswered for six asks open one charge_unknown item', async () => {
    const { enrollmentId } = await dueWorld();
    // Month 2's automatic order, charged by a first sweep through the stand-in, its answer lost;
    // its expiry then moved 50 minutes and a few seconds back: the sixth ask is due.
    await sweepOf(enrollmentId).run();
    const [order] = await automaticOrdersOf(enrollmentId);
    if (order === undefined) throw new Error('no automatic order recorded');
    const { gatewayOrderId } = await database.payment.findUniqueOrThrow({
      where: { id: order.id },
      select: { gatewayOrderId: true },
    });
    if (gatewayOrderId === null) throw new Error('the stand-in recorded no order');
    await database.$executeRaw`
      UPDATE payments SET expires_at = clock_timestamp() - interval '50 minutes 5 seconds'
      WHERE id = ${order.id}::uuid`;
    fake.onInquiry(gatewayOrderId, 'no_answer');
    fake.onInquiry(gatewayOrderId, 'no_answer');
    await Promise.all([sweepOf(enrollmentId).run(), sweepOf(enrollmentId).run()]);
    const items = await database.programmeRequest.findMany({
      where: { enrollmentId, kind: 'charge_unknown' },
      select: { status: true },
    });
    expect(items).toEqual([{ status: 'open' }]);
    expect(await automaticOrdersOf(enrollmentId)).toHaveLength(1);
    expect(errors).toEqual([]);
  });
});

describe('the month step’s races (006:T015; kernel.md, 006:T015’s row)', () => {
  it('(a) red first: the due charge against the webhook’s paid: the step waits on the enrollment, reads the order paid, records nothing', async () => {
    const { enrollmentId } = await dueWorld();
    // A manual month-2 order, expired, that the gateway pays late (FR-PAYG-19).
    const { paymentId } = await monthTwoOrder(enrollmentId, {
      automatic: false,
      status: 'created',
      minutes: -1,
    });
    const webhook = holding(enrollmentId, ['enrollments'], async (tx) => {
      await lockRows(tx, 'payments', [paymentId]);
      await tx.payment.update({ where: { id: paymentId }, data: { status: 'paid' } });
    });
    await webhook.held;
    const sweep = sweepOf(enrollmentId).run();
    await sleep(400);
    webhook.release();
    await webhook.done;
    await sweep;
    expect(await automaticOrdersOf(enrollmentId)).toEqual([]);
  });

  it('(b) red first: the due charge against a manual checkout of the same month: the step waits, reads it payable, records nothing', async () => {
    const { enrollmentId } = await dueWorld();
    // The checkout's recording transaction: `programmes`, `enrollments`, then its `created` order.
    const checkout = holding(enrollmentId, ['programmes', 'enrollments'], async (tx) => {
      await tx.$executeRaw`
        INSERT INTO payments (enrollment_id, gateway, gateway_order_id, gross_piasters, currency,
                              status, expires_at, kind, instalment_month,
                              teacher_share_rate_percent, teacher_share_piasters, updated_at)
        VALUES (${enrollmentId}::uuid, 'fake', ${`probe-order-${randomUUID()}`}, 100000, 'EGP',
                'created', clock_timestamp() + interval '10 minutes', 'instalment', 2, 70, 70000,
                now())`;
    });
    await checkout.held;
    const sweep = sweepOf(enrollmentId).run();
    await sleep(400);
    checkout.release();
    await checkout.done;
    await sweep;
    expect(await automaticOrdersOf(enrollmentId)).toEqual([]);
  });

  it('(c) red first: the due step waits while programme.cancel holds the programme; the cancel is refused rest_paid; one order', async () => {
    const { studentId, enrollmentId } = await dueWorld();
    const cancelLock = holding(enrollmentId, ['programmes']);
    await cancelLock.held;
    let finished = false;
    const sweep = sweepOf(enrollmentId)
      .run()
      .then(() => {
        finished = true;
      });
    await sleep(400);
    expect(finished).toBe(false);
    cancelLock.release();
    await cancelLock.done;
    await sweep;
    const services = createProgrammeServices({
      idempotency: new IdempotencyService<Transaction>({
        store: new IdempotencyRepository(database),
        settings,
      }),
      settings,
      amounts: programmeOfferAmountsOf,
      log: { info: () => undefined },
      deleteProgrammeCard,
      orders: checkoutOrdersAmong,
    });
    const [cancelled] = await Promise.allSettled([
      services.cancel(
        studentId,
        { enrollmentId, idempotencyKey: randomUUID() },
        { afterCommit: () => undefined },
      ),
      sweepOf(enrollmentId).run(),
    ]);
    expect(cancelled.status).toBe('rejected');
    expect(
      (cancelled as PromiseRejectedResult).reason.details?.[0]?.code as string | undefined,
    ).toBe('rest_paid');
    expect(await automaticOrdersOf(enrollmentId)).toHaveLength(1);
  });
});
