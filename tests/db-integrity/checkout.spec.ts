// T036 — the checkout over the real tables and the stand-in gateway (ARCHITECTURE §8.1, FR-BOOK-12,
// FR-351 to FR-357; the owner's decisions of 2026-11-03), through the services `main.ts` binds
// (`createCheckoutServices`) with the kernel's real idempotency and a column cipher. What needs a
// real commit:
//
//   - a new checkout over the student's own unexpired hold: (a) with no payable order, the old hold
//     released and its enrollment cancelled `checkout_abandoned` with its event; (b) with a payable
//     order, the stand-in asked to cancel it, the order recorded `failed` with its `order_failed`
//     event, then (a); the stand-in answering `paid` refuses PREVIOUS_CHECKOUT as processing and
//     writes nothing; (c) a gateway with no cancellation refuses it as payable with the time left;
//   - Retry: the order created no later than the hold's expiry minus the grace, recorded `created`
//     with its address encrypted to its row; another student's enrollment answering NOT_FOUND with
//     no order created; past the last moment an order may be created ORDER_NOT_PAYABLE with none;
//   - keyed in two steps: a repeat with a completed key calls no gateway and reads the address again;
//     two Retries with one key at the same moment record one order, both answer its one address,
//     and the extra order is cancelled at the gateway;
//   - `checkout.current`'s first and last session (T085, FR-386): the booking sheet's previews of the
//     held slot at the same instant, and the dates of a later read moving with its instant.
//
// HOW THE ROWS GO. The parents are committed as the application role through the API's client; the
// suite removes every row it recorded creating through an OWNER connection afterwards, as
// `hold-concurrency.spec.ts` does.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomBytes, randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createBookingServices } from '../../apps/api/src/modules/booking/index.js';
import {
  type CheckoutServices,
  createCheckoutServices,
} from '../../apps/api/src/modules/payments/index.js';
import { ColumnCipher } from '../../apps/api/src/platform/crypto/encryption.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import { DomainError } from '../../apps/api/src/platform/errors/domain-error.js';
import type { RequesterGender } from '../../apps/api/src/platform/guards/requester-gender.js';
import { IdempotencyRepository } from '../../apps/api/src/platform/idempotency/idempotency.repository.js';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service.js';
import {
  createPaymentPort,
  type PaymentConfig,
  type StandInCheckout,
  standInCheckoutOf,
} from '../../apps/api/src/platform/ports/payment/index.js';
import type {
  CancelOutcome,
  PaymentPort,
} from '../../apps/api/src/platform/ports/payment/payment.port.js';
import {
  SettingError,
  type SettingsReader,
} from '../../apps/api/src/platform/settings/settings-reader.js';
import { addMinutes, addSeconds } from '../../packages/time/src/index.js';
import { type GatewayStandIn, gatewayStandIn } from '../support/gateway-stand-in';

const CAIRO = 'Africa/Cairo';
const CHECKOUT_URL_COLUMN = 'payments.checkout_url_encrypted';

const SETTINGS: Readonly<Record<string, unknown>> = {
  slot_hold_ttl_minutes: 10,
  slot_hold_grace_minutes: 5,
  first_session_lead_hours: 24,
  slot_release_buffer_weeks: 0,
  idempotency_key_ttl_hours: 24,
};
const settings: SettingsReader = {
  async read(key, schema) {
    if (!Object.hasOwn(SETTINGS, key)) throw new SettingError(key, 'missing');
    return schema.parse(SETTINGS[key]);
  },
};

let database: Database;
let gateway: PaymentPort;
let standIn: StandInCheckout;
let stand: GatewayStandIn;
let cipher: ColumnCipher;
let checkout: CheckoutServices;
const calls = { create: 0, cancel: [] as string[] };
/** When set, each order's creation waits until `count` creations have arrived: both read the key first. */
let together:
  { count: number; arrived: number; open: () => void; opened: Promise<void> } | undefined;

function meetAt(count: number): void {
  let open = () => undefined as void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  together = { count, arrived: 0, open, opened };
}
const users: string[] = [];
const subjects: string[] = [];

beforeAll(() => {
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 8,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 30_000,
  });
  // The stand-in as `main.ts` selects it; no event is delivered here, so its origin is never reached.
  const config: PaymentConfig = {
    PAYMENT_GATEWAY: 'fake',
    ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  };
  gateway = createPaymentPort(config);
  const page = standInCheckoutOf(gateway);
  if (page === undefined) throw new Error('the payment port is not the stand-in');
  standIn = page;
  stand = gatewayStandIn({ origin: 'http://127.0.0.1:9', config, payment: gateway });
  cipher = new ColumnCipher(randomBytes(32).toString('base64'));
  checkout = createCheckoutServices({
    database,
    settings,
    idempotency: new IdempotencyService<Transaction>({
      store: new IdempotencyRepository(database),
      settings,
    }),
    payment: {
      createCheckout: async (...args) => {
        calls.create += 1;
        if (together !== undefined) {
          together.arrived += 1;
          if (together.arrived === together.count) together.open();
          await together.opened;
        }
        return gateway.createCheckout(...args);
      },
      cancelCheckout: (gatewayOrderId) => {
        calls.cancel.push(gatewayOrderId);
        return gateway.cancelCheckout(gatewayOrderId);
      },
    },
    cipher,
    gateway: 'fake',
  });
});

/** The services as `beforeAll` binds them, with the clock stopped at `at`. */
function servicesAt(at: Date): CheckoutServices {
  return createCheckoutServices({
    database,
    settings,
    idempotency: new IdempotencyService<Transaction>({
      store: new IdempotencyRepository(database),
      settings,
    }),
    payment: {
      createCheckout: (...args) => {
        calls.create += 1;
        return gateway.createCheckout(...args);
      },
      cancelCheckout: (gatewayOrderId) => {
        calls.cancel.push(gatewayOrderId);
        return gateway.cancelCheckout(gatewayOrderId);
      },
    },
    cipher,
    gateway: 'fake',
    now: () => at,
  });
}

afterAll(async () => {
  await closeDatabase(database);
  if (users.length === 0) return;
  const owner = new pg.Client({
    connectionString: specDatabaseUrl('DATABASE_URL_OWNER'),
    connectionTimeoutMillis: 5_000,
  });
  await owner.connect();
  try {
    await owner.query('BEGIN');
    const enrollments =
      'SELECT id FROM "enrollments" WHERE teacher_user_id = ANY($1) OR student_user_id = ANY($1)';
    await owner.query(`DELETE FROM "enrollment_events" WHERE enrollment_id IN (${enrollments})`, [
      users,
    ]);
    await owner.query(`DELETE FROM "payments" WHERE enrollment_id IN (${enrollments})`, [users]);
    await owner.query(
      'DELETE FROM "slot_holds" WHERE student_user_id = ANY($1) OR slot_id IN (SELECT id FROM "availability_slots" WHERE teacher_user_id = ANY($1))',
      [users],
    );
    await owner.query(
      'DELETE FROM "enrollments" WHERE teacher_user_id = ANY($1) OR student_user_id = ANY($1)',
      [users],
    );
    await owner.query('DELETE FROM "idempotency_keys" WHERE actor_id = ANY($1)', [users]);
    await owner.query('DELETE FROM "availability_slots" WHERE teacher_user_id = ANY($1)', [users]);
    await owner.query('DELETE FROM "packages" WHERE teacher_user_id = ANY($1)', [users]);
    await owner.query('DELETE FROM "teacher_profiles" WHERE user_id = ANY($1)', [users]);
    await owner.query('DELETE FROM "subjects" WHERE id = ANY($1)', [subjects]);
    await owner.query('DELETE FROM "users" WHERE id = ANY($1)', [users]);
    await owner.query('COMMIT');
  } finally {
    await owner.end();
  }
});

async function person(): Promise<string> {
  const { id } = await database.user.create({
    data: {
      email: `checkout-${randomUUID()}@example.invalid`,
      gender: 'female',
      dateOfBirth: new Date('1990-01-01T00:00:00Z'),
      displayName: 'Probe person',
      preferredLanguage: 'ar',
      timezone: CAIRO,
      accountStatus: 'active',
    },
    select: { id: true },
  });
  users.push(id);
  return id;
}

interface Offer {
  readonly teacherId: string;
  readonly packageId: string;
  readonly subjectId: string;
  readonly slotId: string;
}

/** A committed Cairo teacher, approved and payable, with a four-session package and one slot. */
async function offer(): Promise<Offer> {
  const teacherId = await person();
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
  subjects.push(subjectId);
  const { id: packageId } = await database.package.create({
    data: {
      teacherUserId: teacherId,
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
      teacherUserId: teacherId,
      dayOfWeek: 4,
      startTimeLocal: new Date('1970-01-01T09:00:00Z'),
      durationMinutes: 60,
      timezone: CAIRO,
      isActive: true,
    },
    select: { id: true },
  });
  return { teacherId, packageId, subjectId, slotId };
}

const studentOf = (id: string) => ({ userId: id, gender: 'female' as RequesterGender });

/**
 * The student's enrollment awaiting payment on an active hold of the offer's slot, as `checkout.pay`
 * writes them (until it lands), the hold expiring `holdMinutes` from now.
 */
async function pendingEnrollment(student: string, on: Offer, holdMinutes = 15) {
  return database.$transaction(async (tx) => {
    const { id: enrollmentId } = await tx.enrollment.create({
      data: {
        studentUserId: student,
        teacherUserId: on.teacherId,
        packageId: on.packageId,
        slotId: on.slotId,
        snapshotPricePiasters: 100_000n,
        snapshotSessionCount: 4,
        snapshotDurationMinutes: 60,
        snapshotSubjectId: on.subjectId,
        snapshotSlotTimezone: CAIRO,
        snapshotTrack: 'recitation',
        status: 'pending_payment',
        purchasedAt: new Date(),
        quotedFirstSessionLocalDate: new Date('2026-12-03T00:00:00Z'),
      },
      select: { id: true },
    });
    const hold = await tx.slotHold.create({
      data: {
        slotId: on.slotId,
        studentUserId: student,
        packageId: on.packageId,
        sessionCount: 4,
        enrollmentId,
        expiresAt: new Date(addMinutes(new Date(), holdMinutes)),
      },
      select: { id: true, expiresAt: true },
    });
    return { enrollmentId, holdId: hold.id, holdExpiresAt: hold.expiresAt };
  });
}

const holdOn = (student: string, on: Offer) =>
  checkout.hold(studentOf(student), {
    packageId: on.packageId,
    slotId: on.slotId,
    idempotencyKey: randomUUID(),
  });

const retryOn = (student: string, enrollmentId: string, idempotencyKey = randomUUID()) =>
  checkout.retry(studentOf(student), { enrollmentId, idempotencyKey });

async function refusal(promise: Promise<unknown>): Promise<DomainError> {
  return promise.then(
    () => {
      throw new Error('expected a refusal');
    },
    (error: unknown) => {
      if (!(error instanceof DomainError)) throw error;
      return error;
    },
  );
}

function ordersOf(enrollmentId: string) {
  return database.payment.findMany({
    where: { enrollmentId },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      gatewayOrderId: true,
      status: true,
      expiresAt: true,
      checkoutUrlEncrypted: true,
      currency: true,
    },
  });
}

function eventsOf(enrollmentId: string) {
  return database.enrollmentEvent.findMany({
    where: { enrollmentId },
    orderBy: { id: 'asc' },
    select: { kind: true, cancellationReason: true, paymentId: true },
  });
}

describe('a new checkout over the student’s own unexpired hold (FR-BOOK-12)', () => {
  it('(a) with no payable order: releases it, cancels its enrollment checkout_abandoned with its event, and holds the new slot', async () => {
    const [first, second] = [await offer(), await offer()];
    const student = await person();
    const own = await pendingEnrollment(student, first);

    const answer = await holdOn(student, second);

    const held = await database.slotHold.findMany({
      where: { studentUserId: student },
      select: { id: true, slotId: true, releasedAt: true },
    });
    expect(held.find(({ id }) => id === own.holdId)?.releasedAt).not.toBeNull();
    expect(held.filter(({ releasedAt }) => releasedAt === null)).toEqual([
      { id: answer.holdId, slotId: second.slotId, releasedAt: null },
    ]);
    const enrollment = await database.enrollment.findUniqueOrThrow({
      where: { id: own.enrollmentId },
      select: { status: true, cancellationReason: true },
    });
    expect(enrollment).toEqual({ status: 'cancelled', cancellationReason: 'checkout_abandoned' });
    expect(await eventsOf(own.enrollmentId)).toEqual([
      { kind: 'cancelled', cancellationReason: 'checkout_abandoned', paymentId: null },
    ]);
  });

  it('(b) with a payable order: the gateway cancels it, the order is recorded failed with its event, then (a)', async () => {
    const [first, second] = [await offer(), await offer()];
    const student = await person();
    const own = await pendingEnrollment(student, first);
    await retryOn(student, own.enrollmentId);
    const [order] = await ordersOf(own.enrollmentId);
    if (order === undefined) throw new Error('no order');

    await holdOn(student, second);

    expect(calls.cancel).toContain(order.gatewayOrderId);
    const [after] = await ordersOf(own.enrollmentId);
    expect(after?.status).toBe('failed');
    expect(after?.checkoutUrlEncrypted).toBeNull();
    expect(await eventsOf(own.enrollmentId)).toEqual([
      { kind: 'order_failed', cancellationReason: null, paymentId: order.id },
      { kind: 'cancelled', cancellationReason: 'checkout_abandoned', paymentId: null },
    ]);
  });

  it.each([
    ['paid', 'processing'],
    ['in_progress', 'processing'],
    ['unsupported', 'payable'],
  ] as const)(
    '(b, c) the gateway answering %s refuses PREVIOUS_CHECKOUT as %s and writes nothing',
    async (outcome: CancelOutcome, state) => {
      const [first, second] = [await offer(), await offer()];
      const student = await person();
      const own = await pendingEnrollment(student, first);
      await retryOn(student, own.enrollmentId);
      const [order] = await ordersOf(own.enrollmentId);
      if (order === undefined) throw new Error('no order');
      stand.onCancel(order.gatewayOrderId, outcome);

      const error = await refusal(holdOn(student, second));

      expect(error.code).toBe('PREVIOUS_CHECKOUT');
      expect(error.details).toEqual([
        { path: 'enrollmentId', code: own.enrollmentId },
        { path: 'state', code: state },
        ...(state === 'payable'
          ? [{ path: 'expiresAt', code: order.expiresAt.toISOString() }]
          : []),
      ]);
      expect((await ordersOf(own.enrollmentId)).map(({ status }) => status)).toEqual(['created']);
      expect(await eventsOf(own.enrollmentId)).toEqual([]);
      const active = await database.slotHold.findMany({
        where: { studentUserId: student, releasedAt: null },
        select: { id: true },
      });
      expect(active).toEqual([{ id: own.holdId }]);
    },
  );
});

describe('checkout.retry (FR-355, FR-356, M3)', () => {
  it('records the order created, no later than the hold’s expiry minus the grace, its address encrypted to its row', async () => {
    const on = await offer();
    const student = await person();
    const own = await pendingEnrollment(student, on);

    const answer = await retryOn(student, own.enrollmentId);

    const [order] = await ordersOf(own.enrollmentId);
    if (order?.checkoutUrlEncrypted == null) throw new Error('no address recorded');
    const lastMoment = new Date(addMinutes(own.holdExpiresAt, -5));
    expect(order.expiresAt.getTime()).toBeLessThanOrEqual(lastMoment.getTime());
    expect(answer.orderExpiresAt).toBe(order.expiresAt.toISOString());
    expect(order).toMatchObject({ status: 'created', currency: 'EGP' });
    // The amount charged is the snapshot price; read by its column name, which R-MONEY-6 keeps in payments.
    const [charged] = await database.$queryRaw<{ amount: string }[]>`
      SELECT gross_piasters::text AS amount FROM payments WHERE id = ${order.id}::uuid`;
    expect(charged?.amount).toBe('100000');
    expect(cipher.decrypt(order.checkoutUrlEncrypted, CHECKOUT_URL_COLUMN, order.id)).toBe(
      answer.checkoutUrl,
    );
  });

  it('answers another student’s enrollment NOT_FOUND, creating no order and writing nothing', async () => {
    const on = await offer();
    const [owner, other] = [await person(), await person()];
    const own = await pendingEnrollment(owner, on);
    const created = calls.create;

    const error = await refusal(retryOn(other, own.enrollmentId));

    expect(error.code).toBe('NOT_FOUND');
    expect(calls.create).toBe(created);
    expect(await ordersOf(own.enrollmentId)).toEqual([]);
  });

  it('refuses ORDER_NOT_PAYABLE past the hold’s expiry minus the grace, creating no order', async () => {
    const on = await offer();
    const student = await person();
    const own = await pendingEnrollment(student, on, 4);
    const created = calls.create;

    const error = await refusal(retryOn(student, own.enrollmentId));

    expect(error.code).toBe('ORDER_NOT_PAYABLE');
    expect(calls.create).toBe(created);
    expect(await ordersOf(own.enrollmentId)).toEqual([]);
  });

  it('answers a repeat with a completed key from the order’s row, calling no gateway', async () => {
    const on = await offer();
    const student = await person();
    const own = await pendingEnrollment(student, on);
    const key = randomUUID();
    const first = await retryOn(student, own.enrollmentId, key);
    const created = calls.create;

    await expect(retryOn(student, own.enrollmentId, key)).resolves.toEqual(first);

    expect(calls.create).toBe(created);
    expect(await ordersOf(own.enrollmentId)).toHaveLength(1);
  });

  it('two Retries with one key at the same moment record one order, answer its one address, and cancel the extra order at the gateway', async () => {
    const on = await offer();
    const student = await person();
    const own = await pendingEnrollment(student, on);
    const key = randomUUID();
    const created = calls.create;
    const cancelled = calls.cancel.length;

    meetAt(2);
    const answers = await Promise.all([
      retryOn(student, own.enrollmentId, key),
      retryOn(student, own.enrollmentId, key),
    ]).finally(() => {
      together = undefined;
    });

    const orders = await ordersOf(own.enrollmentId);
    expect(orders).toHaveLength(1);
    expect(answers[0]).toEqual(answers[1]);
    // Both read the key before either committed, so both created an order at the gateway.
    expect(calls.create - created).toBe(2);
    expect(calls.cancel.length - cancelled).toBe(1);
    for (const gatewayOrderId of calls.cancel.slice(cancelled)) {
      expect(gatewayOrderId).not.toBe(orders[0]?.gatewayOrderId);
      expect(standIn.payableOrder(gatewayOrderId)).toBeUndefined();
    }
  });
});

/** The summary `checkout.hold` answered, as the phone sends it back to Pay. */
const quotedOf = (held: Awaited<ReturnType<typeof holdOn>>) => ({
  price_piasters: held.summary.price_piasters,
  sessionCount: held.summary.sessionCount,
  sessionDurationMinutes: held.summary.sessionDurationMinutes,
  track: held.summary.track,
});

const payOn = (
  student: string,
  held: Awaited<ReturnType<typeof holdOn>>,
  quoted = quotedOf(held),
  idempotencyKey = randomUUID(),
) => checkout.pay(studentOf(student), { holdId: held.holdId, quoted, idempotencyKey });

function enrollmentsOf(student: string) {
  return database.enrollment.findMany({
    where: { studentUserId: student },
    select: {
      id: true,
      status: true,
      packageId: true,
      slotId: true,
      snapshotSessionCount: true,
      snapshotDurationMinutes: true,
      snapshotTrack: true,
      snapshotSlotTimezone: true,
    },
  });
}

describe('checkout.pay (FR-354, FR-355, M3; the owner’s decisions of 2026-11-03)', () => {
  it('records the package and its count on the hold, then writes the enrollment awaiting payment with its snapshot, links the hold and records the order', async () => {
    const on = await offer();
    const student = await person();
    const held = await holdOn(student, on);
    const onHold = await database.slotHold.findUniqueOrThrow({
      where: { id: held.holdId },
      select: { packageId: true, sessionCount: true },
    });
    expect(onHold).toEqual({ packageId: on.packageId, sessionCount: 4 });

    const answer = await payOn(student, held);

    expect(await enrollmentsOf(student)).toEqual([
      {
        id: answer.enrollmentId,
        status: 'pending_payment',
        packageId: on.packageId,
        slotId: on.slotId,
        snapshotSessionCount: 4,
        snapshotDurationMinutes: 60,
        snapshotTrack: 'recitation',
        snapshotSlotTimezone: CAIRO,
      },
    ]);
    const linked = await database.slotHold.findUniqueOrThrow({
      where: { id: held.holdId },
      select: { enrollmentId: true, releasedAt: true },
    });
    expect(linked).toEqual({ enrollmentId: answer.enrollmentId, releasedAt: null });
    const [order] = await ordersOf(answer.enrollmentId);
    expect(order?.status).toBe('created');
    expect(answer.orderExpiresAt).toBe(order?.expiresAt.toISOString());
  });

  it('answers payBy on hold and current, the order Pay creates expires at it, and refuses Pay one second after it (FR-355, FR-358)', async () => {
    const on = await offer();
    const student = await person();
    const held = await holdOn(student, on);
    const row = await database.slotHold.findUniqueOrThrow({
      where: { id: held.holdId },
      select: { expiresAt: true },
    });
    const grace = Number(SETTINGS['slot_hold_grace_minutes']);
    expect(held.payBy).toBe(new Date(addMinutes(row.expiresAt, -grace)).toISOString());
    const current = await checkout.current(studentOf(student));
    expect(current.hold?.payBy).toBe(held.payBy);

    const late = servicesAt(new Date(addSeconds(new Date(held.payBy), 1)));
    const created = calls.create;
    const refused = await refusal(
      late.pay(studentOf(student), {
        holdId: held.holdId,
        quoted: quotedOf(held),
        idempotencyKey: randomUUID(),
      }),
    );
    expect(refused.code).toBe('HOLD_EXPIRED');
    expect(calls.create).toBe(created);
    expect(await enrollmentsOf(student)).toEqual([]);

    const answer = await payOn(student, held);
    const [order] = await ordersOf(answer.enrollmentId);
    expect(order?.expiresAt.toISOString()).toBe(held.payBy);
    expect(answer.orderExpiresAt).toBe(held.payBy);
  });

  it('answers another student’s hold NOT_FOUND, creating no order and writing nothing', async () => {
    const on = await offer();
    const [owner, other] = [await person(), await person()];
    const held = await holdOn(owner, on);
    const created = calls.create;

    const error = await refusal(payOn(other, held));

    expect(error.code).toBe('NOT_FOUND');
    expect(calls.create).toBe(created);
    expect(await enrollmentsOf(other)).toEqual([]);
    expect(await enrollmentsOf(owner)).toEqual([]);
  });

  it.each([
    ['the price changed', { pricePiasters: 120_000n }, (q: ReturnType<typeof quotedOf>) => q],
    ['the session count changed', { sessionCount: 8 }, (q: ReturnType<typeof quotedOf>) => q],
    [
      'the session count changed and the student sends the new summary (as `checkout.current` shows it after a restart)',
      { sessionCount: 8 },
      (q: ReturnType<typeof quotedOf>) => ({ ...q, sessionCount: 8 }),
    ],
    ['the package deactivated', { isActive: false }, (q: ReturnType<typeof quotedOf>) => q],
    [
      'the session length changed',
      { sessionDurationMinutes: 45 },
      (q: ReturnType<typeof quotedOf>) => q,
    ],
    [
      'the track changed',
      { track: 'ijazah_track' as const },
      (q: ReturnType<typeof quotedOf>) => q,
    ],
  ])(
    'refuses SUMMARY_CHANGED when %s: no order created and nothing written',
    async (_name, change, sent) => {
      const on = await offer();
      const student = await person();
      const held = await holdOn(student, on);
      await database.package.update({ where: { id: on.packageId }, data: change });
      const created = calls.create;

      const error = await refusal(payOn(student, held, sent(quotedOf(held))));

      expect(error.code).toBe('SUMMARY_CHANGED');
      expect(error.details?.length).toBeGreaterThan(0);
      expect(calls.create).toBe(created);
      expect(await enrollmentsOf(student)).toEqual([]);
      const still = await database.slotHold.findUniqueOrThrow({
        where: { id: held.holdId },
        select: { enrollmentId: true, releasedAt: true },
      });
      expect(still).toEqual({ enrollmentId: null, releasedAt: null });
    },
  );

  it('two calls with one key at the same moment end with one enrollment, one address, and the extra order cancelled at the gateway', async () => {
    const on = await offer();
    const student = await person();
    const held = await holdOn(student, on);
    const key = randomUUID();
    const created = calls.create;
    const cancelled = calls.cancel.length;

    meetAt(2);
    const answers = await Promise.all([
      payOn(student, held, quotedOf(held), key),
      payOn(student, held, quotedOf(held), key),
    ]).finally(() => {
      together = undefined;
    });

    const enrollments = await enrollmentsOf(student);
    expect(enrollments).toHaveLength(1);
    expect(answers[0]).toEqual(answers[1]);
    expect(answers[0]?.enrollmentId).toBe(enrollments[0]?.id);
    const orders = await ordersOf(answers[0]?.enrollmentId ?? '');
    expect(orders).toHaveLength(1);
    expect(calls.create - created).toBe(2);
    expect(calls.cancel.length - cancelled).toBe(1);
    for (const gatewayOrderId of calls.cancel.slice(cancelled)) {
      expect(gatewayOrderId).not.toBe(orders[0]?.gatewayOrderId);
      expect(standIn.payableOrder(gatewayOrderId)).toBeUndefined();
    }
  });
});

describe('checkout.current: the first and last session if confirmed now (FR-386, FR-368, T085)', () => {
  it('answers the booking sheet’s previews of the held slot at the same instant, and moves them with the read’s instant', async () => {
    // Wednesday 2026-11-11, 08:55 in Cairo: the offer's Thursday 09:00 slot is 24 hours and five
    // minutes on, just past the lead; ten minutes later it is inside it, and the run starts a week on.
    const at = new Date('2026-11-11T06:55:00Z');
    const later = new Date(addMinutes(at, 10));
    const on = await offer();
    const student = await person();
    const booking = createBookingServices({ database, settings, now: () => at });
    const { slots } = await booking.slots(studentOf(student), { packageId: on.packageId });
    const sheet = slots.find(({ slotId }) => slotId === on.slotId);
    expect(sheet?.firstSession).toEqual({
      localDate: '2026-11-12',
      startsAt: '2026-11-12T07:00:00Z',
    });
    expect(sheet?.lastSession).toEqual({
      localDate: '2026-12-03',
      startsAt: '2026-12-03T07:00:00Z',
    });

    const held = await servicesAt(at).hold(studentOf(student), {
      packageId: on.packageId,
      slotId: on.slotId,
      idempotencyKey: randomUUID(),
    });
    const now = await servicesAt(at).current(studentOf(student));
    expect(now.hold?.holdId).toBe(held.holdId);
    expect(now.hold?.firstSession).toEqual(sheet?.firstSession);
    expect(now.hold?.lastSession).toEqual(sheet?.lastSession);

    const afterwards = await servicesAt(later).current(studentOf(student));
    expect(afterwards.hold?.holdId).toBe(held.holdId);
    expect(afterwards.hold?.firstSession).toEqual({
      localDate: '2026-11-19',
      startsAt: '2026-11-19T07:00:00Z',
    });
    expect(afterwards.hold?.lastSession).toEqual({
      localDate: '2026-12-10',
      startsAt: '2026-12-10T07:00:00Z',
    });
  });
});
