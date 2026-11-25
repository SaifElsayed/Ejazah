// 006:T021 of specs/006-programme/tasks.md (B-P4's conflict check, Q-1 (a) amended, the owner,
// 2026-11-25; SRS DEC-113; kernel.md, 006:T021's row; PR #160 r1 FU1) — an administrator's decision
// on a `charge_unknown` item over the real tables, composed as `main.ts` composes it (payments'
// `programmeMonthOrdersOf`, `lockedAutomaticOrderStatus` and `expireAutomaticOrder` handed in):
// - approve, the month's automatic order still `created`: the order `expired` (a soft decline, no
//   gateway call, no `payment_events` row), the item `approved` with its administrator, the month's
//   first failure at the decision's instant (the retries start from it), or kept as it is when an
//   earlier failure set it (PR #161 r1 Minor 2);
// - extend: the item `extended`, the order still `created`, no first failure;
// - the order already answered (the inquiry recorded it paid): refused `charge_answered`, the item
//   still open, nothing written;
// - the race against the inquiry's answer, both under the enrollment's lock (payments' `lockOrder`):
//   (a) the decision queued first approves and expires the order, and the gateway's paid answer then
//   lands on the expired order through today's expired-then-paid path (FR-PAYG-19); (b) the answer
//   queued first records the order paid, and the decision then reads it answered (`charge_answered`).
// Committed worlds of their own (the entry and the decision run their own transactions).
// Amounts are never named here (R-MONEY-6).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createProgrammeDecisions,
  type ProgrammeDecisions,
} from '../../apps/api/src/modules/booking/index';
import {
  createProgrammeCharges,
  deleteProgrammeCard,
  expireAutomaticOrder,
  lockedAutomaticOrderStatus,
  programmeMonthOrdersOf,
} from '../../apps/api/src/modules/payments/index';
import { ColumnCipher } from '../../apps/api/src/platform/crypto/encryption';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository';
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
import { piasters } from '../../packages/money/src/index';
import { addMinutes } from '../../packages/time/src/index.js';
import { CAIRO, confirmationWorld, SETTINGS, THURSDAY_0900 } from './confirmation-world';

const KEY = Buffer.alloc(32, 11).toString('base64');
const cipher = new ColumnCipher(KEY);
const PAYMENT: PaymentConfig = {
  PAYMENT_GATEWAY: 'fake',
  PAYMENT_MODE: 'test',
  ENCRYPTION_KEY: KEY,
};
const TOKEN = 'placeholder-card-token';
/** Past an automatic order's 10-minute expiry, as the sweep's asks are. */
const PAST_EXPIRY_MINUTES = 20;

/** What this spec drives of the stand-in behind the port (`fake.adapter.ts`), named structurally. */
interface StandInGateway extends PaymentPort {
  onCharge(answer: 'paid' | 'soft' | 'hard' | 'order_unanswered' | 'payment_lost'): void;
  onInquiry(gatewayOrderId: string, answer: 'none' | 'no_answer'): void;
}

const VALUES: Record<string, unknown> = {
  ...SETTINGS,
  programme_offer_hours: 24,
  programme_pay_rest_hours: 48,
  idempotency_key_ttl_hours: 24,
};
const settings: SettingsReader = { read: async (key, schema) => schema.parse(VALUES[key]) };
const silent = createLogger({ level: 'error', destination: { write: () => undefined } });
const lines: [Readonly<Record<string, unknown>>, string][] = [];
const enqueued: string[] = [];

let database: Database;
let decisions: ProgrammeDecisions;
const fake = createPaymentPort(PAYMENT) as StandInGateway;

beforeAll(() => {
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 8,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  decisions = createProgrammeDecisions({
    idempotency: new IdempotencyService<Transaction>({
      store: new IdempotencyRepository(database),
      settings,
    }),
    settings,
    deleteProgrammeCard,
    log: { info: (fields, message) => void lines.push([fields, message]) },
    charges: {
      monthOrders: programmeMonthOrdersOf,
      lockOrder: lockedAutomaticOrderStatus,
      expireOrder: expireAutomaticOrder,
    },
  });
});

afterAll(async () => {
  await closeDatabase(database);
});

const { person } = confirmationWorld(() => database);

/** The automatic charges' entry, its clock `aheadMinutes` past the real one. */
function charges(aheadMinutes = 0) {
  return createProgrammeCharges({
    database,
    payment: fake,
    cipher,
    gateway: 'fake',
    paymentMode: 'test',
    settings,
    log: silent,
    confirmations: {
      enqueue: async (paymentId: string) => {
        enqueued.push(paymentId);
      },
    },
    notices: { record: async () => undefined } as never,
    report: () => undefined,
    now: () => new Date(addMinutes(new Date(), aheadMinutes)),
  });
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

/**
 * An active programme of 40 offer sessions, month 1 paid, a saved card; month 2's automatic order
 * charged through the stand-in (its gateway id recorded, the payment sent, no answer delivered) and
 * a `charge_unknown` item open on it.
 */
async function unknownChargeWorld() {
  const teacherId = await person('female');
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
  const studentId = await person('female');
  const { id: enrollmentId } = await database.enrollment.create({
    data: {
      studentUserId: studentId,
      teacherUserId: teacherId,
      packageId,
      slotId,
      snapshotPricePiasters: 1_025_000n,
      snapshotSessionCount: 41,
      snapshotDurationMinutes: 30,
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
      offeredAt: new Date('2026-11-20T07:00:00Z'),
      monthCount: 10,
      paymentPlan: 'monthly',
      monthsPaid: 1,
    },
  });
  // The assessment's order, processed, with its rate (R-511); by SQL (R-MONEY-6).
  await database.$executeRaw`
    INSERT INTO payments (enrollment_id, gateway, gateway_order_id, gross_piasters, currency, status,
                          expires_at, kind, teacher_share_rate_percent, teacher_share_piasters,
                          confirmed_at, updated_at)
    VALUES (${enrollmentId}::uuid, 'fake', ${`fake_ord_${randomUUID()}`}, 25000, 'EGP', 'paid',
            '2026-11-01T07:10:00Z', 'assessment', 70, 17500, '2026-11-01T07:01:00Z', now())`;
  await database.programmeCard.create({
    data: {
      enrollmentId,
      tokenEncrypted: Uint8Array.from(
        cipher.encrypt(TOKEN, 'programme_cards.token_encrypted', enrollmentId),
      ),
      last4: '4242',
      brand: 'Visa',
      consentedAt: new Date('2026-11-20T08:00:00Z'),
    },
  });
  const recorded = await database.$transaction((tx) =>
    charges().record(tx as Transaction, {
      enrollmentId,
      teacherUserId: teacherId,
      instalmentMonth: 2,
      attempt: 0,
      offerTotal_piasters: piasters(1_000_000),
      offerSessionCount: 40,
    }),
  );
  if (recorded.outcome !== 'recorded') throw new Error('month 2 was not recorded');
  fake.onCharge('paid');
  await expect(recorded.charge()).resolves.toBe('sent');
  const { id: requestId } = await database.programmeRequest.create({
    data: { enrollmentId, teacherUserId: teacherId, kind: 'charge_unknown', status: 'open' },
    select: { id: true },
  });
  return { teacherId, studentId, enrollmentId, paymentId: recorded.paymentId, requestId };
}

function decide(adminId: string, requestId: string, decision: 'approve' | 'decline' | 'extend') {
  return database.$transaction(
    (tx) =>
      decisions.decide(tx as Transaction, adminId, {
        requestId,
        decision,
        idempotencyKey: randomUUID(),
      }),
    { timeout: 30_000 },
  );
}

async function causeOf(call: Promise<unknown>): Promise<string> {
  try {
    return `answered ${JSON.stringify(await call)}`;
  } catch (error: unknown) {
    const { code, details } = error as { code?: string; details?: { code: string }[] };
    return details?.[0]?.code ?? code ?? String(error);
  }
}

async function rowsOf(world: { enrollmentId: string; paymentId: string; requestId: string }) {
  const [order, item, programme, events] = await Promise.all([
    database.payment.findUniqueOrThrow({
      where: { id: world.paymentId },
      select: { status: true },
    }),
    database.programmeRequest.findUniqueOrThrow({
      where: { id: world.requestId },
      select: { status: true, decidedByAdminId: true, decidedAt: true },
    }),
    database.programme.findUniqueOrThrow({
      where: { enrollmentId: world.enrollmentId },
      select: { firstFailureAt: true },
    }),
    database.paymentEvent.findMany({
      where: { paymentId: world.paymentId },
      select: { eventType: true },
    }),
  ]);
  return {
    order: order.status,
    item: item.status,
    decidedBy: item.decidedByAdminId,
    decidedAt: item.decidedAt,
    firstFailureAt: programme.firstFailureAt,
    events: events.map(({ eventType }) => eventType),
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('programmes.decide on a charge_unknown item over the real tables (006:T021)', () => {
  it('approve: the still-created order expired, the item approved, the first failure at the decision, no event', async () => {
    const world = await unknownChargeWorld();
    const adminId = await admin();
    await expect(decide(adminId, world.requestId, 'approve')).resolves.toMatchObject({
      answer: { status: 'approved' },
    });
    const rows = await rowsOf(world);
    expect(rows).toMatchObject({ order: 'expired', item: 'approved', decidedBy: adminId, events: [] });
    expect(rows.firstFailureAt?.toISOString()).toBe(rows.decidedAt?.toISOString());
  });

  // PR #161 r1 Minor 2 (the owner's reading in lane s's stop): the first failure is written only
  // when none is set. Month 2 soft-declined Mon 23 Nov 10:00 Cairo, retry 1 (Tue 10:00) unanswered;
  // the approval keeps Mon 10:00, so retry 2 stays due Thu 26 Nov 10:00 (days 1, 3, 5, 7).
  it('approve after an earlier failure: the first failure kept, the order expired, the item approved', async () => {
    const world = await unknownChargeWorld();
    const monday = new Date('2026-11-23T08:00:00Z');
    await database.programme.update({
      where: { enrollmentId: world.enrollmentId },
      data: { firstFailureAt: monday, retriesDone: 1 },
    });
    const adminId = await admin();
    await expect(decide(adminId, world.requestId, 'approve')).resolves.toMatchObject({
      answer: { status: 'approved' },
    });
    const rows = await rowsOf(world);
    expect(rows).toMatchObject({ order: 'expired', item: 'approved', decidedBy: adminId, events: [] });
    expect(rows.firstFailureAt?.toISOString()).toBe(monday.toISOString());
  });

  it('extend: the item extended, the order still created, no first failure', async () => {
    const world = await unknownChargeWorld();
    const adminId = await admin();
    await expect(decide(adminId, world.requestId, 'extend')).resolves.toMatchObject({
      answer: { status: 'extended' },
    });
    expect(await rowsOf(world)).toMatchObject({
      order: 'created',
      item: 'extended',
      firstFailureAt: null,
      events: [],
    });
  });

  it('the order already answered paid by the inquiry: refused charge_answered, nothing written', async () => {
    const world = await unknownChargeWorld();
    const adminId = await admin();
    await expect(charges(PAST_EXPIRY_MINUTES).inquire(world.paymentId)).resolves.toBe('paid');
    expect(await causeOf(decide(adminId, world.requestId, 'approve'))).toBe('charge_answered');
    expect(await rowsOf(world)).toMatchObject({
      order: 'paid',
      item: 'open',
      decidedBy: null,
      firstFailureAt: null,
      events: ['paid'],
    });
  });
});

describe('the decision against the inquiry’s answer (006:T021; kernel.md, 006:T021’s row)', () => {
  /**
   * A holder of the enrollment's row (the lock both paths wait on: the decision's own, and the
   * answer's through payments' `lockOrder`), released on `release()`.
   */
  async function enrollmentHeld(enrollmentId: string) {
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held: () => void = () => undefined;
    const holding = new Promise<void>((resolve) => {
      held = resolve;
    });
    const holder = database.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM enrollments WHERE id = ${enrollmentId}::uuid FOR UPDATE`;
        held();
        await released;
      },
      { timeout: 30_000 },
    );
    await holding;
    return { release, holder };
  }

  it('(a) red first: the decision queued first expires the order; the paid answer then lands on it as expired-then-paid', async () => {
    const world = await unknownChargeWorld();
    const adminId = await admin();
    const { release, holder } = await enrollmentHeld(world.enrollmentId);
    const decision = decide(adminId, world.requestId, 'approve');
    await sleep(400);
    const answer = charges(PAST_EXPIRY_MINUTES).inquire(world.paymentId);
    await sleep(400);
    release();
    await holder;
    const [decided, answered] = await Promise.allSettled([decision, answer]);
    expect(decided).toMatchObject({ status: 'fulfilled', value: { answer: { status: 'approved' } } });
    expect(answered).toMatchObject({ status: 'fulfilled', value: 'paid' });
    const rows = await rowsOf(world);
    // FR-PAYG-19: the gateway's signed word that the student paid is recorded on the expired order.
    expect(rows).toMatchObject({ order: 'paid', item: 'approved', events: ['paid'] });
    expect(rows.firstFailureAt).not.toBeNull();
    expect(enqueued).toContain(world.paymentId);
  });

  it('(b) red first: the answer queued first records the order paid; the decision then reads it answered', async () => {
    const world = await unknownChargeWorld();
    const adminId = await admin();
    const { release, holder } = await enrollmentHeld(world.enrollmentId);
    const answer = charges(PAST_EXPIRY_MINUTES).inquire(world.paymentId);
    await sleep(400);
    const decision = decide(adminId, world.requestId, 'approve');
    await sleep(400);
    release();
    await holder;
    const [answered] = await Promise.allSettled([answer]);
    expect(answered).toMatchObject({ status: 'fulfilled', value: 'paid' });
    expect(await causeOf(decision)).toBe('charge_answered');
    expect(await rowsOf(world)).toMatchObject({
      order: 'paid',
      item: 'open',
      firstFailureAt: null,
      events: ['paid'],
    });
  });

  it('logs the refusal as one line of ids and the cause, never an amount or a card detail', async () => {
    const world = await unknownChargeWorld();
    const adminId = await admin();
    await charges(PAST_EXPIRY_MINUTES).inquire(world.paymentId);
    lines.length = 0;
    await causeOf(decide(adminId, world.requestId, 'extend'));
    expect(lines).toEqual([
      [
        {
          adminId,
          requestId: world.requestId,
          enrollmentId: world.enrollmentId,
          reason: 'charge_answered',
        },
        'A programme decision was refused',
      ],
    ]);
    expect(JSON.stringify(lines)).not.toMatch(/4242|Visa|placeholder-card-token/);
  });
});
