// 006:T007 of specs/006-programme/tasks.md (FR-705; R-505, R-506; K-5; kernel.md's one order) — the
// offer over the real tables: the programme `offered` with the offer, `pay_by_at` 48 hours later and
// ⌈N ÷ 4⌉ months, and the enrollment's snapshot (N + 1, the length, N × the price for it) on one
// transaction; a replay of its key writes nothing more; a refusal writes nothing; two offers at once
// move the programme once (the second waits on the programme's row and reads `offered`); and a price
// edit holding the teacher's `users` row, the lock every price writer takes, makes the offer wait and
// price at the edited price.
//
// Committed worlds of their own (the offer runs its own keyed transaction), as
// `programme-months.spec.ts`' are. The database's clock decides the deadline and the offer's instant,
// so session 1 ends an hour before the run.
//
// Observed red: every case against T007's stubs (`offerEnrollmentOf` answering null, `writeOffer`
// writing nothing), and the price race under M-A7 (the teacher's lock removed from the offer),
// restored and `cmp`-checked.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createProgrammeServices,
  type ProgrammeServices,
} from '../../apps/api/src/modules/booking/index';
import { lockAccount } from '../../apps/api/src/modules/identity/index';
import { programmeOfferAmountsOf } from '../../apps/api/src/modules/payments/index';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures';
import { IdempotencyRepository } from '../../apps/api/src/platform/idempotency/idempotency.repository';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader';
import { addHours, addMinutes, wholeHoursSince } from '../../packages/time/src/index.js';
import { CAIRO, confirmationWorld, THURSDAY_0900 } from './confirmation-world';

let database: Database;
let services: ProgrammeServices;
const lines: string[] = [];

const HOURS: Record<string, number> = {
  programme_offer_hours: 24,
  programme_pay_rest_hours: 48,
  idempotency_key_ttl_hours: 24,
};
const settings: SettingsReader = { read: async (key, schema) => schema.parse(HOURS[key]) };

beforeAll(() => {
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 6,
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
    log: { info: (fields) => lines.push(String(fields.reason)) },
  });
});

afterAll(async () => {
  await closeDatabase(database);
});

const { person } = confirmationWorld(() => database);
const noSignal = { afterCommit: () => undefined };

/**
 * A programme awaiting its offer: a programme package (30 / 45 / 60 minutes at 200 / 250 / 300 EGP)
 * on a 60-minute weekly time, the assessment confirmed, and session 1 settled `status`, ending
 * `endedHoursAgo` hours before the run.
 */
async function awaitingOffer(status: 'done' | 'scheduled' = 'done', endedHoursAgo = 1) {
  const teacherId = await person('male');
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
      snapshotPricePiasters: 50_000n,
      snapshotSessionCount: 1,
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
  await database.programme.create({ data: { enrollmentId, state: 'awaiting_offer' } });
  const endsAt = new Date(addHours(new Date(), -endedHoursAgo));
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
      status,
    },
  });
  return { teacherId, studentId, packageId, enrollmentId };
}

function offerOf(enrollmentId: string, key: string = randomUUID()) {
  return {
    enrollmentId,
    level: 'يحفظ جزء عم',
    readiness: 'جاهز',
    expectedLength: 'عشرة أشهر',
    durationMinutes: 45 as const,
    sessionCount: 40,
    idempotencyKey: key,
  };
}

async function rowsOf(enrollmentId: string) {
  const programme = await database.programme.findUniqueOrThrow({
    where: { enrollmentId },
    select: {
      state: true,
      level: true,
      readiness: true,
      expectedLength: true,
      offeredAt: true,
      payByAt: true,
      monthCount: true,
    },
  });
  const enrollment = await database.enrollment.findUniqueOrThrow({
    where: { id: enrollmentId },
    select: {
      snapshotSessionCount: true,
      snapshotDurationMinutes: true,
      snapshotPricePiasters: true,
    },
  });
  return { programme, enrollment };
}

/** The refusal's cause, or the answer's text when it was not refused. */
async function causeOf(call: Promise<unknown>): Promise<string> {
  try {
    return `answered ${JSON.stringify(await call)}`;
  } catch (error: unknown) {
    const details = (error as { details?: readonly { code: string }[] }).details;
    return details?.[0]?.code ?? String(error);
  }
}

describe('programme.offer over the real tables (006:T007, FR-705, R-506)', () => {
  it('freezes the offer and the snapshot on one transaction, pay_by_at 48 hours after it', async () => {
    const { teacherId, enrollmentId } = await awaitingOffer();
    await expect(services.offer(teacherId, offerOf(enrollmentId), noSignal)).resolves.toStrictEqual(
      {
        total_piasters: 1_000_000,
        sessionPrice_piasters: 25_000,
        monthCount: 10,
      },
    );
    const { programme, enrollment } = await rowsOf(enrollmentId);
    expect(programme).toMatchObject({
      state: 'offered',
      level: 'يحفظ جزء عم',
      readiness: 'جاهز',
      expectedLength: 'عشرة أشهر',
      monthCount: 10,
    });
    // `packages/time` adds whole hours to the instant to the second, its fraction dropped.
    expect(programme.payByAt).toStrictEqual(new Date(addHours(programme.offeredAt!, 48)));
    expect(wholeHoursSince(programme.offeredAt!, new Date())).toBe(0);
    expect(enrollment).toStrictEqual({
      snapshotSessionCount: 41,
      snapshotDurationMinutes: 45,
      snapshotPricePiasters: 1_000_000n,
    });
  });

  it('answers a replay of its key from the key’s row and writes nothing more', async () => {
    const { teacherId, enrollmentId } = await awaitingOffer();
    const input = offerOf(enrollmentId);
    const first = await services.offer(teacherId, input, noSignal);
    const before = await rowsOf(enrollmentId);
    await expect(services.offer(teacherId, input, noSignal)).resolves.toStrictEqual(first);
    expect(await rowsOf(enrollmentId)).toStrictEqual(before);
  });

  it('writes nothing on a refusal: offer_due_passed, 25 hours after the delivered end', async () => {
    const { teacherId, enrollmentId } = await awaitingOffer('done', 25);
    const before = await rowsOf(enrollmentId);
    expect(await causeOf(services.offer(teacherId, offerOf(enrollmentId), noSignal))).toBe(
      'offer_due_passed',
    );
    expect(await rowsOf(enrollmentId)).toStrictEqual(before);
    expect(before.programme.state).toBe('awaiting_offer');
  });

  it('refuses assessment_not_delivered while session 1 is scheduled', async () => {
    const { teacherId, enrollmentId } = await awaitingOffer('scheduled', -1);
    expect(await causeOf(services.offer(teacherId, offerOf(enrollmentId), noSignal))).toBe(
      'assessment_not_delivered',
    );
  });

  it('moves the programme once for two offers at once; the second reads it offered', async () => {
    const { teacherId, enrollmentId } = await awaitingOffer();
    const causes = await Promise.all([
      causeOf(services.offer(teacherId, offerOf(enrollmentId), noSignal)),
      causeOf(services.offer(teacherId, { ...offerOf(enrollmentId), sessionCount: 20 }, noSignal)),
    ]);
    expect(causes.filter((cause) => cause === 'not_awaiting_offer')).toHaveLength(1);
    const { programme, enrollment } = await rowsOf(enrollmentId);
    const won = causes.findIndex((cause) => cause.startsWith('answered'));
    expect(programme.monthCount).toBe(won === 0 ? 10 : 5);
    expect(enrollment.snapshotSessionCount).toBe(won === 0 ? 41 : 21);
  });

  it('waits on a price edit holding the teacher’s account, then prices at the edited price', async () => {
    const { teacherId, packageId, enrollmentId } = await awaitingOffer();
    let offered: Promise<string> | undefined;
    await database.$transaction(async (tx) => {
      await lockAccount(tx as Transaction, teacherId);
      await tx.package.update({ where: { id: packageId }, data: { price45Piasters: 30_000n } });
      offered = causeOf(services.offer(teacherId, offerOf(enrollmentId), noSignal));
      // The offer is now waiting on the teacher's `users` row this transaction holds.
      await new Promise((resolve) => setTimeout(resolve, 500));
      const { state } = await tx.programme.findUniqueOrThrow({
        where: { enrollmentId },
        select: { state: true },
      });
      expect(state).toBe('awaiting_offer');
    });
    expect(await offered).toBe(
      `answered ${JSON.stringify({ total_piasters: 1_200_000, sessionPrice_piasters: 30_000, monthCount: 10 })}`,
    );
    expect((await rowsOf(enrollmentId)).enrollment.snapshotPricePiasters).toBe(1_200_000n);
  });
});
