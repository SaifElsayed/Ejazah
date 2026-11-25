// 006:T018 of specs/006-programme/tasks.md (FR-726, FR-727; app-surface.md `programme.get`,
// admin-surface.md `programmes.queue` and `programmes.get`) — the reads over the real tables, composed
// as `main.ts` composes them:
// - `programme.get`: the student's card (last four and brand, never the token, SC-707), the teacher's
//   none, the due point from the paid month's sessions, NOT_FOUND to anyone else; `payeePending`
//   through the real `createProgrammePayee`, true in live mode with the teacher's payout account
//   unverified and false in test mode, and `renewOpen` closed by it;
// - `programmes.get`: the orders by kind, `cardSaved` a boolean only, the items with their reasons,
//   and «the assessment was held» on a closed programme with no `assessment` release, absent once one
//   is written;
// - `programmes.queue`: an open `charge_unknown` item listed with its parties' names.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createBookingServices,
  createProgrammeAdminReads,
} from '../../apps/api/src/modules/booking/index';
import {
  createProgrammePayee,
  enrollmentOrdersOf,
  programmeCardOf,
  programmeMonthOrdersOf,
  programmeOfferAmountsOf,
  releasesOf,
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
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader';
import {
  enrollmentsGetOutput,
  enrollmentsListOutput,
  teacherStudentsGetOutput,
  teacherStudentsListOutput,
} from '../../packages/contracts/src/index.js';
import { addHours, addMinutes } from '../../packages/time/src/index.js';
import { CAIRO, confirmationWorld, SETTINGS, THURSDAY_0900 } from './confirmation-world';

const KEY = Buffer.alloc(32, 7).toString('base64');
const cipher = new ColumnCipher(KEY);
const TOKEN = 'placeholder-card-token';
const VALUES: Record<string, unknown> = {
  ...SETTINGS,
  programme_renew_early_days: 3,
  // 006:T019, T020 (B-P4): the stop's 7 days and the reminder's 12 hours (DEC-114), as seeded.
  programme_stop_request_days: 7,
  programme_pay_reminder_hours: 12,
  // B-P4 round 2 (Q-B2 (a)): the offer's 24 hours, the window `programme.get`'s terms follow.
  programme_offer_hours: 24,
  // The lists' page size (`LIST_PAGE_SIZE_SETTING`), read by the enrollment lists.
  discovery_page_size: 20,
  admin_list_page_size: 100,
  idempotency_key_ttl_hours: 24,
};
const settings: SettingsReader = { read: async (key, schema) => schema.parse(VALUES[key]) };

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

async function dbNow(): Promise<Date> {
  const [{ now }] = await database.$queryRaw<[{ now: Date }]>`SELECT clock_timestamp() AS now`;
  return now;
}

/** `programme.get` composed as `main.ts` composes it, in `mode`. */
function programmeGet(mode: 'test' | 'live') {
  return bookingServices(mode).programme;
}

/** Booking's services composed as `main.ts` composes them, in `mode` (006:T019: the enrollment reads). */
function bookingServices(mode: 'test' | 'live') {
  return createBookingServices({
    database,
    settings,
    ijazahRequests: { of: async () => new Map() },
    idempotency: new IdempotencyService<Transaction>({
      store: new IdempotencyRepository(database),
      settings,
    }),
    log: { info: () => undefined },
    programmeAmounts: programmeOfferAmountsOf,
    programmeReads: {
      payee: createProgrammePayee({ paymentMode: mode, cipher }),
      monthOrders: programmeMonthOrdersOf,
      cardOf: programmeCardOf,
    },
  });
}

/** The administrator's reads composed as `main.ts` composes them. */
const adminReads = createProgrammeAdminReads({
  settings,
  payments: {
    payee: createProgrammePayee({ paymentMode: 'live', cipher }),
    monthOrders: programmeMonthOrdersOf,
    ordersOf: enrollmentOrdersOf,
    assessmentReleased: async (tx, enrollmentId) =>
      (await releasesOf(tx, [enrollmentId])).some(({ milestone }) => milestone === 'assessment'),
  },
});

/**
 * A monthly programme of 40 offer sessions, month 1 paid, its last session ended `endedAgoHours`
 * ago; the assessment and month 1 paid; a saved card when `card`. The teacher's payout account is
 * not verified.
 */
async function monthlyWorld({ card, endedAgoHours }: { card: boolean; endedAgoHours: number }) {
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
      level: 'يحفظ جزء عم',
      readiness: 'جاهز',
      expectedLength: 'عشرة أشهر',
      offeredAt: new Date('2026-10-01T07:00:00Z'),
      payByAt: new Date('2026-10-03T07:00:00Z'),
      monthCount: 10,
      paymentPlan: 'monthly',
      monthsPaid: 1,
    },
  });
  for (const [kind, month, gross, share] of [
    ['assessment', null, 25_000, 17_500],
    ['instalment', 1, 100_000, 70_000],
  ] as const) {
    await database.$executeRaw`
      INSERT INTO payments (enrollment_id, gateway, gateway_order_id, gross_piasters, currency,
                            status, expires_at, kind, instalment_month, teacher_share_rate_percent,
                            teacher_share_piasters, confirmed_at, updated_at)
      VALUES (${enrollmentId}::uuid, 'fake', ${`fake_ord_${randomUUID()}`}, ${gross}, 'EGP', 'paid',
              '2026-10-01T07:10:00Z', ${kind}::order_kind, ${month}, 70, ${share},
              '2026-10-01T07:01:00Z', now())`;
  }
  const endsAt = new Date(addHours(await dbNow(), -endedAgoHours));
  for (const [sequenceNumber, programmeMonth] of [
    [1, null],
    [2, 1],
  ] as const) {
    await database.session.create({
      data: {
        enrollmentId,
        teacherUserId: teacherId,
        studentUserId: studentId,
        sequenceNumber,
        scheduledDateLocal: new Date('2026-10-08T00:00:00Z'),
        scheduledStartTimeLocal: THURSDAY_0900,
        timezone: CAIRO,
        // Session 1 first, then month 1's, the last ending at `endsAt`.
        scheduledStartAt: new Date(addMinutes(endsAt, -60 * (3 - sequenceNumber))),
        scheduledEndAt: new Date(addMinutes(endsAt, -60 * (2 - sequenceNumber))),
        status: 'done',
        programmeMonth,
      },
    });
  }
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
  return { teacherId, studentId, enrollmentId, endsAt };
}

describe('programme.get over the real tables (006:T018, FR-726)', () => {
  it('answers the student the card’s last four and brand, the teacher none, and the due point', async () => {
    const w = await monthlyWorld({ card: true, endedAgoHours: 1 });
    const reads = programmeGet('test');
    const student = await reads.get(w.studentId, { enrollmentId: w.enrollmentId });
    expect(student).toMatchObject({
      state: 'active',
      plan: 'monthly',
      monthsPaid: 1,
      monthCount: 10,
      nextDueAt: w.endsAt.toISOString(),
      chargePending: false,
      renewOpen: false,
      payeePending: false,
      payBlocked: false,
      teacherUnavailable: false,
      card: { last4: '4242', brand: 'Visa' },
    });
    expect(student.offer).toMatchObject({ sessionCount: 40, total_piasters: 1_000_000 });
    expect(JSON.stringify(student)).not.toMatch(new RegExp(TOKEN));
    const teacher = await reads.get(w.teacherId, { enrollmentId: w.enrollmentId });
    expect(teacher.card).toBeNull();
    expect(JSON.stringify(teacher)).not.toMatch(/4242|Visa/);
  });

  it('answers anyone but the two parties NOT_FOUND, as an unknown enrollment', async () => {
    const w = await monthlyWorld({ card: false, endedAgoHours: 1 });
    const stranger = await person('female');
    const reads = programmeGet('test');
    await expect(reads.get(stranger, { enrollmentId: w.enrollmentId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(reads.get(w.studentId, { enrollmentId: randomUUID() })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('says payeePending through the real payee read: true in live mode unverified, false in test mode', async () => {
    const w = await monthlyWorld({ card: false, endedAgoHours: 1 });
    const test = await programmeGet('test').get(w.studentId, { enrollmentId: w.enrollmentId });
    expect(test).toMatchObject({ payeePending: false, renewOpen: true });
    const live = await programmeGet('live').get(w.studentId, { enrollmentId: w.enrollmentId });
    expect(live).toMatchObject({ payeePending: true, renewOpen: false });
  });
});

describe('the administrator’s reads over the real tables (006:T018, FR-727)', () => {
  it('programmes.get: the orders by kind, cardSaved a boolean only, and the items with their reasons', async () => {
    const w = await monthlyWorld({ card: true, endedAgoHours: 1 });
    await database.programmeRequest.create({
      data: {
        enrollmentId: w.enrollmentId,
        teacherUserId: w.teacherId,
        kind: 'charge_unknown',
        status: 'open',
      },
    });
    const page = await database.$transaction((tx) => adminReads.get(tx, w.enrollmentId));
    expect(page.cardSaved).toBe(true);
    expect(page.orders.map(({ kind, instalmentMonth }) => [kind, instalmentMonth])).toEqual([
      ['assessment', undefined],
      ['instalment', 1],
    ]);
    expect(page.requests).toEqual([
      expect.objectContaining({ kind: 'charge_unknown', status: 'open' }),
    ]);
    expect(page).not.toHaveProperty('assessmentHeld');
    expect(JSON.stringify(page)).not.toMatch(/4242|Visa|placeholder-card-token/);
  });

  it('programmes.get: the assessment held on a closed programme with no assessment release, absent once one is written', async () => {
    const w = await monthlyWorld({ card: false, endedAgoHours: 1 });
    const closedAt = await dbNow();
    await database.programme.update({
      where: { enrollmentId: w.enrollmentId },
      data: { state: 'closed', closedAt },
    });
    const closed = await database.$transaction((tx) => adminReads.get(tx, w.enrollmentId));
    expect(closed.assessmentHeld).toBe(true);
    await database.teacherShareRelease.create({
      data: {
        enrollmentId: w.enrollmentId,
        teacherUserId: w.teacherId,
        milestone: 'assessment',
        amountPiasters: 17_500n,
        dueAt: closedAt,
      },
    });
    const released = await database.$transaction((tx) => adminReads.get(tx, w.enrollmentId));
    expect(released).not.toHaveProperty('assessmentHeld');
  });

  it('programmes.queue: an open charge_unknown item listed with its parties’ names', async () => {
    const w = await monthlyWorld({ card: true, endedAgoHours: 1 });
    const item = await database.programmeRequest.create({
      data: {
        enrollmentId: w.enrollmentId,
        teacherUserId: w.teacherId,
        kind: 'charge_unknown',
        status: 'open',
      },
      select: { id: true },
    });
    // The shared database holds other specs' items: the pages are walked until this one appears.
    let cursor: string | undefined;
    let found;
    for (let pages = 0; pages < 50 && found === undefined; pages += 1) {
      const page = await database.$transaction((tx) =>
        adminReads.queue(tx, {
          filter: 'charge_unknown',
          ...(cursor === undefined ? {} : { cursor }),
        }),
      );
      found = page.items.find(({ request }) => request?.requestId === item.id);
      if (page.nextCursor === undefined) break;
      cursor = page.nextCursor;
    }
    expect(found).toMatchObject({
      enrollmentId: w.enrollmentId,
      state: 'active',
      request: { kind: 'charge_unknown', status: 'open' },
      payeeVerifiedNow: null,
    });
    expect(found?.teacher.displayName).not.toBe('');
    expect(found?.student.displayName).not.toBe('');
  });
});

// 006:T019, T020 (B-P4's conflict check, the owner, 2026-11-25; Q-2 (a), Q-3 (a), Q-4 (a), Q-5 (b),
// SRS DEC-114): the two instants of `programme.get` and the enrollment reads' marker over the real
// rows, composed as `main.ts` composes them; a 60-session offer's 61 sessions pass the outputs.
describe('programme.get’s instants and the enrollment reads’ marker over the real tables (006, B-P4)', () => {
  it('answers the teacher stopRequestFrom = paused_at + 7 days, the student null', async () => {
    const w = await monthlyWorld({ card: false, endedAgoHours: 1 });
    const pausedAt = new Date('2026-11-23T16:00:00Z');
    await database.programme.update({
      where: { enrollmentId: w.enrollmentId },
      data: { state: 'paused', pausedAt },
    });
    const reads = programmeGet('test');
    const teacher = await reads.get(w.teacherId, { enrollmentId: w.enrollmentId });
    const student = await reads.get(w.studentId, { enrollmentId: w.enrollmentId });
    expect(teacher).toMatchObject({
      paused: { since: pausedAt.toISOString() },
      stopRequestFrom: '2026-11-30T16:00:00.000Z',
      payReminderFrom: null,
    });
    expect(student.stopRequestFrom).toBeNull();
  });

  it('answers an offered programme payReminderFrom = payBy − 12 hours, and marks the four reads', async () => {
    const w = await monthlyWorld({ card: false, endedAgoHours: 1 });
    const payByAt = new Date('2026-11-25T16:00:00Z');
    await database.enrollment.update({
      where: { id: w.enrollmentId },
      data: { snapshotSessionCount: 61 },
    });
    await database.programme.update({
      where: { enrollmentId: w.enrollmentId },
      data: { state: 'offered', payByAt, paymentPlan: null, monthsPaid: 0, monthCount: 15 },
    });
    const marker = {
      state: 'offered',
      payBy: '2026-11-25T16:00:00.000Z',
      payReminderFrom: '2026-11-25T04:00:00.000Z',
    };
    const services = bookingServices('test');
    const got = await services.programme.get(w.studentId, { enrollmentId: w.enrollmentId });
    expect(got.payReminderFrom).toBe(marker.payReminderFrom);
    const detail = enrollmentsGetOutput.parse(
      await services.enrollment(w.studentId, { enrollmentId: w.enrollmentId }),
    );
    expect(detail.programme).toEqual(marker);
    expect(detail.summary.sessionCount).toBe(61);
    const teacherDetail = teacherStudentsGetOutput.parse(
      await services.student(w.teacherId, { enrollmentId: w.enrollmentId }),
    );
    expect(teacherDetail.programme).toEqual(marker);
    const list = enrollmentsListOutput.parse(
      await services.enrollments(w.studentId, { tab: 'active' }),
    );
    expect(list.items.find(({ enrollmentId }) => enrollmentId === w.enrollmentId)?.programme).toEqual(
      marker,
    );
    const teacherList = teacherStudentsListOutput.parse(
      await services.students(w.teacherId, { tab: 'active' }),
    );
    expect(
      teacherList.items.find(({ enrollmentId }) => enrollmentId === w.enrollmentId)?.programme,
    ).toEqual(marker);
  });

  it('answers an enrollment that is no programme with no marker', async () => {
    const w = await monthlyWorld({ card: false, endedAgoHours: 1 });
    await database.programme.delete({ where: { enrollmentId: w.enrollmentId } });
    const detail = await bookingServices('test').enrollment(w.studentId, {
      enrollmentId: w.enrollmentId,
    });
    expect(detail).not.toHaveProperty('programme');
  });
});

// B-P4 round 2 (the owner's delegation to the review session, 2026-11-25; Q-B2 (a), Q-B3 (a)): the
// teacher's two fields over the real rows: the offer's terms (the weekly time's 60 minutes and the
// programme package's three prices) while the offer is open to send, and an open stop request; the
// student is answered neither.
describe('programme.get’s teacher-only fields over the real tables (B-P4 round 2)', () => {
  it('answers the teacher the offer terms while awaiting the offer, the assessment delivered; the student null', async () => {
    const w = await monthlyWorld({ card: false, endedAgoHours: 1 });
    await database.programme.update({
      where: { enrollmentId: w.enrollmentId },
      data: {
        state: 'awaiting_offer',
        offeredAt: null,
        level: null,
        readiness: null,
        expectedLength: null,
        payByAt: null,
        monthCount: null,
        paymentPlan: null,
        monthsPaid: 0,
      },
    });
    const reads = programmeGet('test');
    const teacher = await reads.get(w.teacherId, { enrollmentId: w.enrollmentId });
    expect(teacher.offerTerms).toEqual({
      slotMinutes: 60,
      prices: { m30_piasters: 25_000, m45_piasters: 30_000, m60_piasters: 35_000 },
    });
    const student = await reads.get(w.studentId, { enrollmentId: w.enrollmentId });
    expect(student.offerTerms).toBeNull();
  });

  it('answers the teacher stopRequestOpen while a stop is open; the student false', async () => {
    const w = await monthlyWorld({ card: false, endedAgoHours: 1 });
    await database.programme.update({
      where: { enrollmentId: w.enrollmentId },
      data: { state: 'paused', pausedAt: new Date('2026-11-01T16:00:00Z') },
    });
    const reads = programmeGet('test');
    expect(
      (await reads.get(w.teacherId, { enrollmentId: w.enrollmentId })).stopRequestOpen,
    ).toBe(false);
    await database.programmeRequest.create({
      data: {
        enrollmentId: w.enrollmentId,
        teacherUserId: w.teacherId,
        kind: 'stop',
        status: 'open',
        reason: 'الطالب متأخر عن السداد',
      },
    });
    const teacher = await reads.get(w.teacherId, { enrollmentId: w.enrollmentId });
    const student = await reads.get(w.studentId, { enrollmentId: w.enrollmentId });
    expect(teacher).toMatchObject({ stopRequestOpen: true, offerTerms: null });
    expect(student.stopRequestOpen).toBe(false);
  });
});
