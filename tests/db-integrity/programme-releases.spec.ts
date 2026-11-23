// 006:T011 of specs/006-programme/tasks.md (FR-703, FR-706b, FR-728; R-512; DEC-94) — the release
// sweep over a real programme on the real tables: payments' paid orders with their kinds, booking's
// programme with an open `pay_blocked` item (`enrollmentsAmong`), sessions' outcomes, and the insert
// `ON CONFLICT DO NOTHING`. The sweep's page is narrowed to the spec's own enrollment, so it writes
// only that enrollment's rows.
//
// The worked numbers: an offer of 4 sessions × 250 EGP = 1,000 EGP (100,000 pt), the assessment's
// fee 500 EGP (50,000 pt, share 35,000), month 1 1,000 EGP (share 70,000), the share 70 %, the half
// 25 %; the snapshot's count N + 1 = 5, the half at 3.
// - An offer lapsed while its `pay_blocked` item is open: no release; once the item is withdrawn,
//   the assessment's 350 EGP.
// - Continued by months: the half 25 % × 70 % × (100,000 + 50,000) = 26,250 pt; capped at the paid
//   orders' shares (105,000) less a stop's 90,000 already written: 15,000 pt.
//
// Observed red: the item's case under M-E1 (the `pay_blocked` gate dropped), the cap's case under
// M-E5 (the cap dropped), each restored and `cmp`-checked.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createShareReleaseSweep } from '../../apps/api/src/modules/payments/index';
import {
  closeDatabase,
  type Database,
  openDatabase,
} from '../../apps/api/src/platform/db/prisma.repository';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures';
import { transactionsOver } from '../../apps/api/src/platform/db/transaction.repository';
import { piasters } from '../../packages/money/src/index';
import { CAIRO, confirmationWorld, NOW, THURSDAY_0900 } from './confirmation-world';

let database: Database;

beforeAll(() => {
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 4,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
});

afterAll(async () => {
  await closeDatabase(database);
});

const { person } = confirmationWorld(() => database);

/**
 * Thursdays 2026-10-01 (the assessment) to 10-29, 09:00 Cairo (+03:00 until the October change,
 * after 10-29), written whole as the instants they resolve to.
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

/**
 * A paid order of the enrollment with its share, by SQL (the amount columns are named only in
 * payments, R-MONEY-6): its kind, its month, its gross and its share at 70 %, the half at 25 %.
 */
async function order(
  enrollmentId: string,
  kind: 'assessment' | 'instalment',
  gross: number,
  share: number,
): Promise<string> {
  const [row] = await database.$queryRaw<{ id: string }[]>`
    INSERT INTO payments (enrollment_id, gateway, gateway_order_id, gross_piasters, currency,
                          status, expires_at, updated_at, kind, instalment_month,
                          teacher_share_rate_percent, teacher_share_piasters,
                          half_release_rate_percent)
    VALUES (${enrollmentId}::uuid, 'fake', ${`probe-order-${randomUUID()}`}, ${gross}, 'EGP',
            'paid'::payment_status, ${NOW}, now(), ${kind}::order_kind,
            ${kind === 'instalment' ? 1 : null}::smallint, 70, ${share}, 25)
    RETURNING id::text AS id`;
  if (row === undefined) throw new Error('no order written');
  return row.id;
}

type ProgrammeWorld =
  { readonly kind: 'lapsed' } | { readonly kind: 'continued'; readonly stopReleased?: number };

/** The programme of the world asked, its orders, its sessions and its items; the ids. */
async function programmeWorld(asked: ProgrammeWorld) {
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
  const studentId = await person('female');
  const lapsed = asked.kind === 'lapsed';
  const { id: enrollmentId } = await database.enrollment.create({
    data: {
      studentUserId: studentId,
      teacherUserId: teacherId,
      packageId,
      slotId,
      snapshotPricePiasters: 100_000n,
      snapshotSessionCount: 5,
      snapshotDurationMinutes: 60,
      snapshotSubjectId: subjectId,
      snapshotSlotTimezone: CAIRO,
      snapshotTrack: 'ijazah_track',
      status: lapsed ? 'cancelled' : 'confirmed',
      cancellationReason: lapsed ? 'offer_lapsed' : null,
      confirmedAt: new Date('2026-09-30T07:01:00Z'),
      purchasedAt: new Date('2026-09-30T07:00:00Z'),
      quotedFirstSessionLocalDate: new Date('2026-10-01T00:00:00Z'),
    },
    select: { id: true },
  });
  await database.programme.create({
    data: lapsed
      ? {
          enrollmentId,
          state: 'closed',
          offeredAt: new Date('2026-10-02T07:00:00Z'),
          payByAt: new Date('2026-10-04T07:00:00Z'),
          monthCount: 1,
          closedAt: new Date('2026-10-06T07:00:00Z'),
        }
      : {
          enrollmentId,
          state: 'active',
          offeredAt: new Date('2026-10-02T07:00:00Z'),
          payByAt: new Date('2026-10-04T07:00:00Z'),
          monthCount: 1,
          paymentPlan: 'monthly',
          monthsPaid: 1,
        },
  });
  // Lapsed: the assessment only. Continued: the assessment and sessions 2 and 3 done, 4 and 5 not.
  await database.session.createMany({
    data: THURSDAYS.slice(0, lapsed ? 1 : undefined).map((thursday, index) => ({
      enrollmentId,
      teacherUserId: teacherId,
      studentUserId: studentId,
      sequenceNumber: index + 1,
      scheduledDateLocal: thursday.localDate,
      scheduledStartTimeLocal: THURSDAY_0900,
      timezone: CAIRO,
      scheduledStartAt: thursday.startsAt,
      scheduledEndAt: thursday.endsAt,
      status: index < 3 ? ('done' as const) : ('scheduled' as const),
      ...(index === 0 ? {} : { programmeMonth: 1 }),
    })),
  });
  const assessmentId = await order(enrollmentId, 'assessment', 50_000, 35_000);
  if (!lapsed) await order(enrollmentId, 'instalment', 100_000, 70_000);
  const item = lapsed
    ? await database.programmeRequest.create({
        data: { enrollmentId, teacherUserId: teacherId, kind: 'pay_blocked', status: 'open' },
        select: { id: true },
      })
    : undefined;
  if (asked.kind === 'continued' && asked.stopReleased !== undefined) {
    await database.teacherShareRelease.create({
      data: {
        enrollmentId,
        teacherUserId: teacherId,
        milestone: 'programme_stopped',
        amountPiasters: BigInt(asked.stopReleased),
        dueAt: new Date('2026-10-20T07:00:00Z'),
      },
    });
  }
  return { enrollmentId, assessmentId, itemId: item?.id };
}

/** One run of the sweep over the enrollment's page alone, at `NOW`, the window 72 hours. */
async function sweep(enrollmentId: string, paymentId: string) {
  await createShareReleaseSweep({
    transactions: transactionsOver(database),
    settings: { read: async (_key, schema) => schema.parse(72) },
    log: { info: () => undefined, warn: () => undefined, error: () => undefined },
    pageSize: 10,
    clock: async () => NOW,
    ordersAfter: async (_tx, after) =>
      after === undefined
        ? [
            {
              paymentId,
              enrollmentId,
              kind: 'assessment' as const,
              instalmentMonth: null,
              paid_piasters: piasters(50_000),
              share_piasters: piasters(35_000),
              sharePercent: 70,
              halfPercent: 25,
              refunded_piasters: piasters(0),
            },
          ]
        : [],
  }).run();
}

async function releasesOf(enrollmentId: string) {
  const rows = await database.teacherShareRelease.findMany({
    where: { enrollmentId },
    orderBy: { id: 'asc' },
    select: { milestone: true, amountPiasters: true },
  });
  return rows.map(({ milestone, amountPiasters }) => [milestone, Number(amountPiasters)]);
}

describe('the programme’s releases over the real tables (006:T011)', () => {
  it('writes no `assessment` release while a `pay_blocked` item is open, and 350 EGP once it is withdrawn (FR-706b, DEC-94)', async () => {
    const w = await programmeWorld({ kind: 'lapsed' });

    await sweep(w.enrollmentId, w.assessmentId);
    expect(await releasesOf(w.enrollmentId)).toEqual([]);

    await database.programmeRequest.update({
      where: { id: w.itemId },
      data: { status: 'withdrawn' },
    });
    await sweep(w.enrollmentId, w.assessmentId);
    expect(await releasesOf(w.enrollmentId)).toEqual([['assessment', 35_000]]);
  });

  it('writes the half by months once the student continued: 25 % × 70 % × (1,000 + 500 EGP) = 262.50 EGP', async () => {
    const w = await programmeWorld({ kind: 'continued' });

    await sweep(w.enrollmentId, w.assessmentId);

    expect(await releasesOf(w.enrollmentId)).toEqual([['ijazah_half', 26_250]]);
  });

  it('caps the half at the paid orders’ shares less the releases written: 105,000 − 90,000 = 15,000 pt', async () => {
    const w = await programmeWorld({ kind: 'continued', stopReleased: 90_000 });

    await sweep(w.enrollmentId, w.assessmentId);

    expect(await releasesOf(w.enrollmentId)).toEqual([
      ['programme_stopped', 90_000],
      ['ijazah_half', 15_000],
    ]);
  });
});
