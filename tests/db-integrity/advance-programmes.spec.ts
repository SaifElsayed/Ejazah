// 006:T015 of specs/006-programme/tasks.md (FR-714, FR-717, FR-721; R-508; SRS DEC-110, DEC-113;
// B-P3's conflict check, Q-1 (a), Q-3 (a), Q-6 (a), Q-8 (a); kernel.md, 006:T015's row) — the
// `advance-programmes` sweep's steps over the real tables:
// - the windows' step waits while a suspension case is open (a suspension pauses; analyze N-1);
// - «pending» at `pay_by_at` (A-1; PR #158 r2 Follow-up 1, Q-8 (a)): no lapse while a programme
//   order is payable or paid and not yet processed by the confirm step; `programme.cancel` refused
//   `payment_processing` then;
// - the race: the webhook's paid holding the order's locks while the step runs (the step waits on
//   the enrollment's row, then reads the paid order and lapses nothing).
//
// Committed worlds of their own (the step and the services run their own transactions), as
// `programme-windows.spec.ts`' are; the database's clock decides every deadline.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createEnrollmentSide,
  createProgrammeServices,
  createProgrammeWindows,
  type ProgrammeServices,
} from '../../apps/api/src/modules/booking/index';
import {
  checkoutOrdersAmong,
  createProgrammePayee,
  type PaymentMode,
  programmeOfferAmountsOf,
} from '../../apps/api/src/modules/payments/index';
import { createCompletion } from '../../apps/api/src/modules/sessions/index';
import { lockRows } from '../../apps/api/src/platform/db/row-lock';
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
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader';
import { programmeCancelRefusal } from '../../packages/contracts/src/index.js';
import { addHours, addMinutes } from '../../packages/time/src/index.js';
import { CAIRO, confirmationWorld, THURSDAY_0900 } from './confirmation-world';

let database: Database;
let services: ProgrammeServices;
const lines: Readonly<Record<string, unknown>>[] = [];
const log = { info: (fields: Readonly<Record<string, unknown>>) => lines.push(fields) };
const cardsDeleted: string[] = [];
const deleteProgrammeCard = async (_tx: Transaction, enrollmentId: string): Promise<void> => {
  cardsDeleted.push(enrollmentId);
};

const VALUES: Record<string, unknown> = {
  programme_offer_hours: 24,
  programme_pay_rest_hours: 48,
  idempotency_key_ttl_hours: 24,
};
const settings: SettingsReader = { read: async (key, schema) => schema.parse(VALUES[key]) };
const noSignal = { afterCommit: () => undefined };
const cipher = { decrypt: () => 'rcpt_probe' };

function windowsIn(paymentMode: PaymentMode) {
  return createProgrammeWindows({
    transactions: transactionsOver(database),
    settings,
    payee: createProgrammePayee({ paymentMode, cipher }),
    deleteProgrammeCard,
    orders: checkoutOrdersAmong,
    log,
  });
}

beforeAll(() => {
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 8,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  services = createProgrammeServices({
    idempotency: new IdempotencyService<Transaction>({
      store: new IdempotencyRepository(database),
      settings,
    }),
    settings,
    amounts: programmeOfferAmountsOf,
    log,
    deleteProgrammeCard,
    orders: checkoutOrdersAmong,
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
 * An offered programme: a programme package on a 60-minute Thursday time, its assessment session 1
 * delivered an hour ago, its `pay_by_at` `passedMinutesAgo` minutes before the run (negative: still
 * to come), its 10 months, the teacher's payout account unverified.
 */
async function offered(passedMinutesAgo = 5) {
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
      price30Piasters: 20_000n,
      price45Piasters: 25_000n,
      price60Piasters: 30_000n,
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
      snapshotDurationMinutes: 45,
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
  const now = await dbNow();
  const payByAt = new Date(addMinutes(now, -passedMinutesAgo));
  await database.programme.create({
    data: {
      enrollmentId,
      state: 'offered',
      level: 'يحفظ جزء عم',
      readiness: 'جاهز',
      expectedLength: 'عشرة أشهر',
      offeredAt: new Date(addHours(payByAt, -48)),
      payByAt,
      monthCount: 10,
    },
  });
  const endsAt = new Date(addHours(now, -60));
  await database.session.create({
    data: {
      enrollmentId,
      teacherUserId: teacherId,
      studentUserId: studentId,
      sequenceNumber: 1,
      scheduledDateLocal: new Date('2026-11-20T00:00:00Z'),
      scheduledStartTimeLocal: THURSDAY_0900,
      timezone: CAIRO,
      scheduledStartAt: new Date(addMinutes(endsAt, -30)),
      scheduledEndAt: endsAt,
      status: 'done',
    },
  });
  return { teacherId, studentId, enrollmentId, payByAt };
}

/**
 * A programme order of the enrollment, month 1: `created` and payable, `created` and expired, or
 * paid and not yet processed by the confirm step; written by SQL as `expiry-world.ts`' orders are
 * (the amount column is named only in payments, R-MONEY-6). Its id.
 */
async function programmeOrder(
  enrollmentId: string,
  standing: 'payable' | 'processing' | 'expired',
): Promise<string> {
  const expiresAt = new Date(addMinutes(await dbNow(), standing === 'payable' ? 10 : -10));
  const status = standing === 'processing' ? 'paid' : 'created';
  const [row] = await database.$queryRaw<{ id: string }[]>`
    INSERT INTO payments (enrollment_id, gateway, gateway_order_id, gross_piasters, currency,
                          status, expires_at, kind, instalment_month, teacher_share_rate_percent,
                          teacher_share_piasters, updated_at)
    VALUES (${enrollmentId}::uuid, 'fake', ${`probe-order-${randomUUID()}`}, 100000, 'EGP',
            ${status}::payment_status, ${expiresAt}, 'instalment', 1, 70, 70000, now())
    RETURNING id::text AS id`;
  if (row === undefined) throw new Error('no order written');
  return row.id;
}

/** A suspension case open on the enrollment (the termination subscriber's, FR-SESS-16). */
async function suspended(enrollmentId: string, reason: 'teacher_suspended' | 'student_suspended') {
  await database.dispute.create({
    data: { enrollmentId, kind: 'compensation_case', reason, status: 'open' },
  });
}

async function stateOf(enrollmentId: string) {
  const programme = await database.programme.findUniqueOrThrow({
    where: { enrollmentId },
    select: { state: true },
  });
  const enrollment = await database.enrollment.findUniqueOrThrow({
    where: { id: enrollmentId },
    select: { status: true, cancellationReason: true },
  });
  return { state: programme.state, ...enrollment };
}

async function causeOf(call: Promise<unknown>): Promise<string> {
  try {
    return `answered ${JSON.stringify(await call)}`;
  } catch (error: unknown) {
    const details = (error as { details?: readonly { code: string }[] }).details;
    return details?.[0]?.code ?? (error as { code?: string }).code ?? String(error);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

describe('the windows’ step waits while a suspension is open (006:T015; R-508, analyze N-1)', () => {
  it.each(['teacher_suspended', 'student_suspended'] as const)(
    'red first: past pay_by_at with an open %s case, no lapse and nothing written',
    async (reason) => {
      const { enrollmentId } = await offered();
      await suspended(enrollmentId, reason);
      expect(await windowsIn('test').step(enrollmentId)).toBe('none');
      expect(await stateOf(enrollmentId)).toStrictEqual({
        state: 'offered',
        status: 'confirmed',
        cancellationReason: null,
      });
    },
  );
});

describe('«pending» at pay_by_at (006:T015; A-1, PR #158 r2 Follow-up 1, Q-8 (a))', () => {
  it.each(['payable', 'processing'] as const)(
    'red first: a programme order %s at pay_by_at: no lapse',
    async (standing) => {
      const { enrollmentId } = await offered();
      await programmeOrder(enrollmentId, standing);
      expect(await windowsIn('test').step(enrollmentId)).toBe('none');
      expect((await stateOf(enrollmentId)).state).toBe('offered');
    },
  );

  it('an expired, unpaid order does not hold the lapse', async () => {
    const { enrollmentId } = await offered();
    await programmeOrder(enrollmentId, 'expired');
    expect(await windowsIn('test').step(enrollmentId)).toBe('lapsed');
    expect(await stateOf(enrollmentId)).toStrictEqual({
      state: 'closed',
      status: 'cancelled',
      cancellationReason: 'offer_lapsed',
    });
  });

  it.each(['payable', 'processing'] as const)(
    'red first: programme.cancel is refused payment_processing while an order is %s; nothing written',
    async (standing) => {
      const { studentId, enrollmentId } = await offered(-60);
      await programmeOrder(enrollmentId, standing);
      const cause = await causeOf(
        services.cancel(studentId, { enrollmentId, idempotencyKey: randomUUID() }, noSignal),
      );
      expect(cause).toBe('payment_processing');
      expect(programmeCancelRefusal.options).toContain(cause);
      expect((await stateOf(enrollmentId)).state).toBe('offered');
      expect(lines).toContainEqual({
        studentUserId: studentId,
        enrollmentId,
        reason: 'payment_processing',
      });
    },
  );

  it('programme.cancel still cancels with only an expired order', async () => {
    const { studentId, enrollmentId } = await offered(-60);
    await programmeOrder(enrollmentId, 'expired');
    await expect(
      services.cancel(studentId, { enrollmentId, idempotencyKey: randomUUID() }, noSignal),
    ).resolves.toStrictEqual({ ok: true });
    expect((await stateOf(enrollmentId)).cancellationReason).toBe('offer_declined');
  });

  it('race, red first: the webhook’s paid holds the order’s locks; the step waits on the enrollment, then reads it paid and lapses nothing', async () => {
    const { enrollmentId } = await offered();
    const paymentId = await programmeOrder(enrollmentId, 'payable');
    // The payable order would hold the lapse on its own: expire it first, so only the paid move can.
    await database.payment.update({
      where: { id: paymentId },
      data: { expiresAt: new Date(addMinutes(await dbNow(), -1)) },
    });
    let releasePaid: () => void = () => undefined;
    const paidHeld = new Promise<void>((resolve) => {
      releasePaid = resolve;
    });
    let locked: () => void = () => undefined;
    const paidLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });
    // The webhook's order branch: `lockOrder` (the enrollment, then the order), the paid move.
    const webhook = database.$transaction(
      async (tx) => {
        await lockRows(tx as Transaction, 'enrollments', [enrollmentId]);
        await lockRows(tx as Transaction, 'payments', [paymentId]);
        await tx.payment.update({ where: { id: paymentId }, data: { status: 'paid' } });
        locked();
        await paidHeld;
      },
      { timeout: 20_000 },
    );
    await paidLocked;
    const step = windowsIn('test').step(enrollmentId);
    await sleep(300);
    releasePaid();
    await webhook;
    expect(await step).toBe('none');
    expect((await stateOf(enrollmentId)).state).toBe('offered');
  });
});

// 006:T015 (PR #158 r1 Follow-up 2; Q-6 (a)): over the real cases, a programme paid in full whose
// rest was never generated (session 1 alone, the confirm step's `slot_unavailable` case open) is
// not completed past the dispute window; resolved, it is.
describe('completion waits for a refused generation’s case (006:T015, Q-6 (a))', () => {
  const completionSettings: SettingsReader = {
    read: async (key, schema) => schema.parse({ ...VALUES, dispute_window_hours: 72 }[key]),
  };

  it.each(['slot_unavailable', 'party_restricted'] as const)(
    'red first: an open %s case holds it; its resolution lets it complete',
    async (reason) => {
      const { enrollmentId } = await offered(-60);
      await database.programme.update({
        where: { enrollmentId },
        data: { state: 'active', paymentPlan: 'in_full', monthsPaid: 10 },
      });
      // Session 1 alone, delivered 100 hours ago: past the 72-hour dispute window.
      const endsAt = new Date(addHours(await dbNow(), -100));
      await database.session.updateMany({
        where: { enrollmentId },
        data: { scheduledStartAt: new Date(addMinutes(endsAt, -30)), scheduledEndAt: endsAt },
      });
      const { id: caseId } = await database.dispute.create({
        data: { enrollmentId, kind: 'compensation_case', reason, status: 'open' },
        select: { id: true },
      });
      const completion = createCompletion({
        enrollments: createEnrollmentSide({ settings: completionSettings }),
        settings: completionSettings,
      });
      const complete = () =>
        database.$transaction(async (tx) => {
          await lockRows(tx as Transaction, 'programmes', [enrollmentId]);
          await lockRows(tx as Transaction, 'enrollments', [enrollmentId]);
          return completion.completeIfDue(tx as Transaction, enrollmentId);
        });
      expect(await complete()).toBe(false);
      expect((await stateOf(enrollmentId)).status).toBe('confirmed');
      await database.dispute.update({
        where: { id: caseId },
        data: {
          status: 'resolved',
          resolution: 'compensation_ordered',
          resolutionNotes: 'Probe: refunded through the gateway',
          resolvedByAdminId: await admin(),
          resolvedAt: new Date(),
        },
      });
      expect(await complete()).toBe(true);
      expect((await stateOf(enrollmentId)).status).toBe('completed');
    },
  );
});
