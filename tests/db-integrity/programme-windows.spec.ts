// 006:T008 of specs/006-programme/tasks.md (FR-706, FR-706a, FR-706b, FR-709; R-505, R-508, R-510,
// R-513; SRS DEC-101; B-P2's conflict check, Q-2 (a), Q-3 (a) amended; kernel.md, 006:T008's row) —
// the windows, the cancellation, the refusal, the decision and the close hook over the real tables:
// - the owner's example (Q-3 (a) amended): the deadline derived from session 1's outcome chain on
//   every read and written; a re-resolution to a teacher's no-show moves it, no `no_offer` item at
//   the old one, and the make-up's delivery sets the new one;
// - the `no_offer` item once per deadline, an administrator's approval (`assessment_refused`) and
//   extension (counted from the decision, a new item at the new deadline);
// - past `pay_by_at`: «unverified in live mode: no lapse, one item», «the same in test mode lapses»,
//   «verified while the item is open: no lapse», «the student's cancellation withdraws the item»,
//   the decision's approval (`offer_lapsed`) and extension;
// - (SRS DEC-112) no refusal request: `programme.request` takes `stop` only; a `no_offer` decision
//   carries the administrator's reason, and approving one waits for session 1's pending make-up;
// - the close hook on every close: the programme `closed`, its open items `withdrawn`, payments'
//   card entry called (a stub until T013);
// - two races: an administrator's decision against the sweep's step (both under the programme's row
//   lock), and an account's termination against the decision (the programme's row before the
//   enrollment's on both: no deadlock).
//
// Committed worlds of their own (the step and the services run their own transactions), as
// `programme-offer.spec.ts`' are; the database's clock decides every deadline, so the worlds place
// session 1's end and `pay_by_at` relative to the run.
//
// Observed red: every case against T008's stubs (the step answering `none` and writing nothing, the
// cancellation, the request and the decision doing nothing); the races under named mutants (M-B17:
// the termination without the programme's row lock; M-B18: the decision without it), restored and
// `cmp`-checked.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createProgrammeDecisions,
  createProgrammeServices,
  createProgrammeWindows,
  type ProgrammeDecisions,
  type ProgrammeServices,
  terminationSubscriber,
} from '../../apps/api/src/modules/booking/index';
import { lockAccount } from '../../apps/api/src/modules/identity/index';
import {
  createProgrammePayee,
  orderStandingsOf,
  type PaymentMode,
  programmeOfferAmountsOf,
} from '../../apps/api/src/modules/payments/index';
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
// 006:T008 (Q-B1 (a)): every refusal's cause is one of the contract's.
import { programmesDecideRefusal } from '../../packages/contracts/src/admin/index.js';
import { programmeCancelRefusal } from '../../packages/contracts/src/index.js';
import { addHours, addMinutes, addSeconds } from '../../packages/time/src/index.js';
import { CAIRO, confirmationWorld, THURSDAY_0900 } from './confirmation-world';

let database: Database;
let services: ProgrammeServices;
let decisions: ProgrammeDecisions;
let idempotency: IdempotencyService<Transaction>;
const lines: Readonly<Record<string, unknown>>[] = [];
const log = { info: (fields: Readonly<Record<string, unknown>>) => lines.push(fields) };
/** Payments' `deleteProgrammeCard` as the root hands it (a stub until T013), its calls recorded. */
const cardsDeleted: string[] = [];
const deleteProgrammeCard = async (_tx: Transaction, enrollmentId: string): Promise<void> => {
  cardsDeleted.push(enrollmentId);
};

const HOURS: Record<string, number> = {
  programme_offer_hours: 24,
  programme_pay_rest_hours: 48,
  idempotency_key_ttl_hours: 24,
};
const settings: SettingsReader = { read: async (key, schema) => schema.parse(HOURS[key]) };
const noSignal = { afterCommit: () => undefined };
/** The cipher's stand-in: a verified account's reference, never read for its value here. */
const cipher = { decrypt: () => 'rcpt_probe' };

function windowsIn(paymentMode: PaymentMode) {
  return createProgrammeWindows({
    transactions: transactionsOver(database),
    settings,
    payee: createProgrammePayee({ paymentMode, cipher }),
    deleteProgrammeCard,
    log,
  });
}

beforeAll(() => {
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 8,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  idempotency = new IdempotencyService<Transaction>({
    store: new IdempotencyRepository(database),
    settings,
  });
  services = createProgrammeServices({
    idempotency,
    settings,
    amounts: programmeOfferAmountsOf,
    log,
    deleteProgrammeCard,
  });
  decisions = createProgrammeDecisions({ idempotency, settings, deleteProgrammeCard, log });
});

afterAll(async () => {
  await closeDatabase(database);
});

const { person } = confirmationWorld(() => database);

/** The database's clock, as every deadline is decided on it. */
async function dbNow(): Promise<Date> {
  const [{ now }] = await database.$queryRaw<[{ now: Date }]>`SELECT clock_timestamp() AS now`;
  return now;
}

/**
 * A programme awaiting its offer: a programme package (30 / 45 / 60 minutes at 200 / 250 / 300 EGP)
 * on a 60-minute weekly time, the assessment confirmed, and session 1 settled `status`, ending
 * `endedHoursAgo` hours before the run; the teacher's payout account verified or not.
 */
async function awaitingOffer(
  status: 'done' | 'teacher_no_show' | 'cancelled_by_admin' = 'done',
  endedHoursAgo = 1,
  { payoutVerified = false }: { readonly payoutVerified?: boolean } = {},
) {
  const teacherId = await person('male');
  await database.teacherProfile.create({
    data: {
      userId: teacherId,
      bio: 'Probe',
      qualificationSummary: 'Probe',
      verificationStatus: 'approved',
      ...(payoutVerified
        ? {
            payoutVerifiedAt: new Date('2026-10-01T00:00:00Z'),
            payoutAccountRefEncrypted: Buffer.from('probe'),
          }
        : {}),
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
  const endsAt = new Date(addHours(await dbNow(), -endedHoursAgo));
  const { id: sessionId } = await database.session.create({
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
    select: { id: true },
  });
  return { teacherId, studentId, enrollmentId, sessionId, endsAt };
}

/** The make-up of `sessionId`, session 2, settled `status`, ending `endedHoursAgo` before the run. */
async function makeupOf(
  world: Awaited<ReturnType<typeof awaitingOffer>>,
  status: 'done' | 'scheduled',
  endedHoursAgo: number,
) {
  const endsAt = new Date(addHours(await dbNow(), -endedHoursAgo));
  await database.session.create({
    data: {
      enrollmentId: world.enrollmentId,
      teacherUserId: world.teacherId,
      studentUserId: world.studentId,
      sequenceNumber: 2,
      scheduledDateLocal: new Date('2026-11-27T00:00:00Z'),
      scheduledStartTimeLocal: THURSDAY_0900,
      timezone: CAIRO,
      scheduledStartAt: new Date(addMinutes(endsAt, -30)),
      scheduledEndAt: endsAt,
      status,
      makeupForSessionId: world.sessionId,
    },
  });
  return endsAt;
}

/** An offered programme whose `pay_by_at` passed `passedMinutesAgo` minutes before the run. */
async function offered(passedMinutesAgo = 5, options: { readonly payoutVerified?: boolean } = {}) {
  const world = await awaitingOffer('done', 60, options);
  const payByAt = new Date(addMinutes(await dbNow(), -passedMinutesAgo));
  await database.programme.update({
    where: { enrollmentId: world.enrollmentId },
    data: {
      state: 'offered',
      level: 'يحفظ جزء عم',
      readiness: 'جاهز',
      expectedLength: 'عشرة أشهر',
      offeredAt: new Date(addHours(payByAt, -48)),
      payByAt,
      monthCount: 10,
    },
  });
  return { ...world, payByAt };
}

function offerOf(enrollmentId: string) {
  return {
    enrollmentId,
    level: 'يحفظ جزء عم',
    readiness: 'جاهز',
    expectedLength: 'عشرة أشهر',
    durationMinutes: 45 as const,
    sessionCount: 40,
    idempotencyKey: randomUUID(),
  };
}

async function rowsOf(enrollmentId: string) {
  const programme = await database.programme.findUniqueOrThrow({
    where: { enrollmentId },
    select: { state: true, offerDueAt: true, payByAt: true, closedAt: true },
  });
  const enrollment = await database.enrollment.findUniqueOrThrow({
    where: { id: enrollmentId },
    select: { status: true, cancellationReason: true },
  });
  const items = await database.programmeRequest.findMany({
    where: { enrollmentId },
    orderBy: { createdAt: 'asc' },
    select: { kind: true, status: true, decidedAt: true, decidedByAdminId: true },
  });
  const cancelled = await database.enrollmentEvent.count({
    where: { enrollmentId, kind: 'cancelled' },
  });
  return { programme, enrollment, items, cancelled };
}

/** The refusal's cause, or the answer's text when it was not refused. */
async function causeOf(call: Promise<unknown>): Promise<string> {
  try {
    return `answered ${JSON.stringify(await call)}`;
  } catch (error: unknown) {
    const details = (error as { details?: readonly { code: string }[] }).details;
    return details?.[0]?.code ?? (error as { code?: string }).code ?? String(error);
  }
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

async function openItemOf(enrollmentId: string, kind: 'no_offer' | 'pay_blocked') {
  const item = await database.programmeRequest.findFirstOrThrow({
    where: { enrollmentId, kind, status: 'open' },
    select: { id: true },
  });
  return item.id;
}

function decide(
  adminId: string,
  requestId: string,
  decision: 'approve' | 'decline' | 'extend',
  reason?: string,
) {
  return database.$transaction((tx) =>
    decisions.decide(tx as Transaction, adminId, {
      requestId,
      decision,
      ...(reason === undefined ? {} : { reason }),
      idempotencyKey: randomUUID(),
    }),
  );
}

/** 006:T008 (SRS DEC-112): what the teacher sent support, as an administrator records it. */
const SUPPORT_REASON = 'أبلغ المعلم الدعم أن الطالب غير مستعد';

async function reasonOf(requestId: string): Promise<string | null> {
  const { reason } = await database.programmeRequest.findUniqueOrThrow({
    where: { id: requestId },
    select: { reason: true },
  });
  return reason;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('the offer’s deadline follows session 1’s outcome chain (006:T008, Q-3 (a) amended)', () => {
  it('writes the derived deadline on every read: the delivered end + 24 h, no item before it', async () => {
    const { enrollmentId, endsAt } = await awaitingOffer('done', 1);
    await expect(windowsIn('test').step(enrollmentId)).resolves.toBe('none');
    const { programme, items } = await rowsOf(enrollmentId);
    expect(programme.offerDueAt).toStrictEqual(new Date(addHours(endsAt, 24)));
    expect(items).toEqual([]);
  });

  it('the owner’s example: re-resolved as the teacher’s no-show, no deadline and no item at the old one; the make-up’s delivery sets the new one', async () => {
    // Done 25 hours ago, then re-resolved a teacher's no-show before its deadline passed.
    const world = await awaitingOffer('teacher_no_show', 25);
    await expect(windowsIn('test').step(world.enrollmentId)).resolves.toBe('none');
    const waiting = await rowsOf(world.enrollmentId);
    expect(waiting.programme.offerDueAt).toBeNull();
    expect(waiting.items).toEqual([]);
    // The make-up delivered an hour ago: due 23 hours from now; still no item, and the offer is open.
    const makeupEnd = await makeupOf(world, 'done', 1);
    await expect(windowsIn('test').step(world.enrollmentId)).resolves.toBe('none');
    const moved = await rowsOf(world.enrollmentId);
    expect(moved.programme.offerDueAt).toStrictEqual(new Date(addHours(makeupEnd, 24)));
    expect(moved.items).toEqual([]);
    expect(
      await causeOf(services.offer(world.teacherId, offerOf(world.enrollmentId), noSignal)),
    ).toMatch(/^answered/);
  });
});

describe('the no_offer item (006:T008, FR-706a, I-2 (a), N-2, N-10)', () => {
  it('opens once past the deadline with no offer, once per deadline; the offer is then refused', async () => {
    const { teacherId, enrollmentId } = await awaitingOffer('done', 25);
    const windows = windowsIn('test');
    await expect(windows.step(enrollmentId)).resolves.toBe('no_offer_raised');
    await expect(windows.step(enrollmentId)).resolves.toBe('none');
    const { programme, enrollment, items } = await rowsOf(enrollmentId);
    expect(items).toEqual([
      { kind: 'no_offer', status: 'open', decidedAt: null, decidedByAdminId: null },
    ]);
    expect(programme.state).toBe('awaiting_offer');
    expect(enrollment.status).toBe('confirmed');
    expect(await causeOf(services.offer(teacherId, offerOf(enrollmentId), noSignal))).toBe(
      'offer_due_passed',
    );
  });

  it('opens 24 h after the scheduled end when session 1 ended with no make-up pending (N-2)', async () => {
    const { enrollmentId } = await awaitingOffer('cancelled_by_admin', 25);
    await expect(windowsIn('test').step(enrollmentId)).resolves.toBe('no_offer_raised');
  });

  it('approved: the refusal, assessment_refused, through the close hook', async () => {
    const { enrollmentId } = await awaitingOffer('done', 25);
    await windowsIn('test').step(enrollmentId);
    const adminId = await admin();
    const requestId = await openItemOf(enrollmentId, 'no_offer');
    const answer = await decide(adminId, requestId, 'approve', SUPPORT_REASON);
    expect(answer.answer).toStrictEqual({ status: 'approved' });
    // SRS DEC-112: the reason is written on the item.
    expect(await reasonOf(requestId)).toBe(SUPPORT_REASON);
    const { programme, enrollment, items, cancelled } = await rowsOf(enrollmentId);
    expect(enrollment).toStrictEqual({
      status: 'cancelled',
      cancellationReason: 'assessment_refused',
    });
    expect(programme.state).toBe('closed');
    expect(programme.closedAt).not.toBeNull();
    expect(items).toMatchObject([
      { kind: 'no_offer', status: 'approved', decidedByAdminId: adminId },
    ]);
    expect(cancelled).toBe(1);
    expect(cardsDeleted).toContain(enrollmentId);
  });

  it('extended: programme_offer_hours more from the decision, the offer open again, no decline', async () => {
    const { teacherId, enrollmentId } = await awaitingOffer('done', 25);
    await windowsIn('test').step(enrollmentId);
    const adminId = await admin();
    const requestId = await openItemOf(enrollmentId, 'no_offer');
    const declined = await causeOf(decide(adminId, requestId, 'decline'));
    expect(declined).toBe('decision_not_allowed');
    expect(programmesDecideRefusal.options).toContain(declined);
    const before = await dbNow();
    expect((await decide(adminId, requestId, 'extend', SUPPORT_REASON)).answer).toStrictEqual({
      status: 'extended',
    });
    expect(await reasonOf(requestId)).toBe(SUPPORT_REASON);
    const { programme, items } = await rowsOf(enrollmentId);
    expect(items).toMatchObject([
      { kind: 'no_offer', status: 'extended', decidedByAdminId: adminId },
    ]);
    expect(programme.offerDueAt!.getTime()).toBeGreaterThanOrEqual(
      new Date(addSeconds(new Date(addHours(before, 24)), -1)).getTime(),
    );
    await expect(windowsIn('test').step(enrollmentId)).resolves.toBe('none');
    expect(await causeOf(services.offer(teacherId, offerOf(enrollmentId), noSignal))).toMatch(
      /^answered/,
    );
  });

  it('refuses a no_offer decision without a reason reason_required, approve or extend, writing nothing (SRS DEC-112)', async () => {
    const { enrollmentId } = await awaitingOffer('done', 25);
    await windowsIn('test').step(enrollmentId);
    const adminId = await admin();
    const requestId = await openItemOf(enrollmentId, 'no_offer');
    const before = await rowsOf(enrollmentId);
    for (const decision of ['approve', 'extend'] as const) {
      const cause = await causeOf(decide(adminId, requestId, decision));
      expect(cause).toBe('reason_required');
      expect(programmesDecideRefusal.options).toContain(cause);
    }
    expect(await rowsOf(enrollmentId)).toStrictEqual(before);
    expect(await reasonOf(requestId)).toBeNull();
  });

  it('refuses approving a no_offer item while session 1’s make-up is pending makeup_pending; nothing moves (Q-B5 (a))', async () => {
    const world = await awaitingOffer('done', 25);
    await windowsIn('test').step(world.enrollmentId);
    const requestId = await openItemOf(world.enrollmentId, 'no_offer');
    // Re-resolved a teacher's no-show, its make-up booked for tomorrow.
    await database.session.update({
      where: { id: world.sessionId },
      data: { status: 'teacher_no_show' },
    });
    await makeupOf(world, 'scheduled', -24);
    const adminId = await admin();
    const before = await rowsOf(world.enrollmentId);
    const cause = await causeOf(decide(adminId, requestId, 'approve', SUPPORT_REASON));
    expect(cause).toBe('makeup_pending');
    expect(programmesDecideRefusal.options).toContain(cause);
    expect(await rowsOf(world.enrollmentId)).toStrictEqual(before);
    expect(before.enrollment.status).toBe('confirmed');
    expect(await reasonOf(requestId)).toBeNull();
  });
});

describe('past pay_by_at unpaid (006:T008, FR-706, FR-706b, DEC-101)', () => {
  it('unverified in live mode: no lapse, one item', async () => {
    const { enrollmentId } = await offered();
    const windows = windowsIn('live');
    await expect(windows.step(enrollmentId)).resolves.toBe('pay_blocked_raised');
    await expect(windows.step(enrollmentId)).resolves.toBe('none');
    const { programme, enrollment, items, cancelled } = await rowsOf(enrollmentId);
    expect(items).toEqual([
      { kind: 'pay_blocked', status: 'open', decidedAt: null, decidedByAdminId: null },
    ]);
    expect(programme.state).toBe('offered');
    expect(enrollment.status).toBe('confirmed');
    expect(cancelled).toBe(0);
  });

  it('the same in test mode lapses: offer_lapsed, the programme closed through the close hook', async () => {
    const { enrollmentId } = await offered();
    await expect(windowsIn('test').step(enrollmentId)).resolves.toBe('lapsed');
    const { programme, enrollment, items, cancelled } = await rowsOf(enrollmentId);
    expect(enrollment).toStrictEqual({ status: 'cancelled', cancellationReason: 'offer_lapsed' });
    expect(programme.state).toBe('closed');
    expect(items).toEqual([]);
    expect(cancelled).toBe(1);
    expect(cardsDeleted).toContain(enrollmentId);
    await expect(windowsIn('test').step(enrollmentId)).resolves.toBe('none');
  });

  it('nothing before pay_by_at, in either mode', async () => {
    const { enrollmentId } = await offered(-60);
    await expect(windowsIn('test').step(enrollmentId)).resolves.toBe('none');
    await expect(windowsIn('live').step(enrollmentId)).resolves.toBe('none');
    expect((await rowsOf(enrollmentId)).enrollment.status).toBe('confirmed');
  });

  it('verified while the item is open: no lapse', async () => {
    const { teacherId, enrollmentId } = await offered();
    await windowsIn('live').step(enrollmentId);
    await database.teacherProfile.update({
      where: { userId: teacherId },
      data: { payoutVerifiedAt: new Date(), payoutAccountRefEncrypted: Buffer.from('probe') },
    });
    await expect(windowsIn('live').step(enrollmentId)).resolves.toBe('none');
    await expect(windowsIn('test').step(enrollmentId)).resolves.toBe('none');
    const { programme, items } = await rowsOf(enrollmentId);
    expect(programme.state).toBe('offered');
    expect(items).toMatchObject([{ kind: 'pay_blocked', status: 'open' }]);
  });

  it('refuses a cancellation closed or rest_paid, and a second decision not_open, each a contract cause (Q-B1 (a))', async () => {
    const { studentId, enrollmentId } = await offered();
    await windowsIn('live').step(enrollmentId);
    const adminId = await admin();
    const requestId = await openItemOf(enrollmentId, 'pay_blocked');
    await decide(adminId, requestId, 'approve');
    const again = await causeOf(decide(adminId, requestId, 'extend'));
    expect(again).toBe('not_open');
    expect(programmesDecideRefusal.options).toContain(again);
    const closed = await causeOf(
      services.cancel(studentId, { enrollmentId, idempotencyKey: randomUUID() }, noSignal),
    );
    expect(closed).toBe('closed');
    expect(programmeCancelRefusal.options).toContain(closed);
    const paid = await offered(-60);
    await database.programme.update({
      where: { enrollmentId: paid.enrollmentId },
      data: { state: 'active', paymentPlan: 'in_full', monthsPaid: 10 },
    });
    const restPaid = await causeOf(
      services.cancel(
        paid.studentId,
        { enrollmentId: paid.enrollmentId, idempotencyKey: randomUUID() },
        noSignal,
      ),
    );
    expect(restPaid).toBe('rest_paid');
    expect(programmeCancelRefusal.options).toContain(restPaid);
  });

  it('the student’s cancellation withdraws the item: offer_declined, the card deleted', async () => {
    const { studentId, enrollmentId } = await offered();
    await windowsIn('live').step(enrollmentId);
    await expect(
      services.cancel(studentId, { enrollmentId, idempotencyKey: randomUUID() }, noSignal),
    ).resolves.toStrictEqual({ ok: true });
    const { programme, enrollment, items, cancelled } = await rowsOf(enrollmentId);
    expect(enrollment).toStrictEqual({ status: 'cancelled', cancellationReason: 'offer_declined' });
    expect(programme.state).toBe('closed');
    expect(items).toMatchObject([{ kind: 'pay_blocked', status: 'withdrawn' }]);
    expect(cancelled).toBe(1);
    expect(cardsDeleted).toContain(enrollmentId);
  });

  it('the decision approved: the lapse, offer_lapsed', async () => {
    const { enrollmentId } = await offered();
    await windowsIn('live').step(enrollmentId);
    const adminId = await admin();
    const answer = await decide(adminId, await openItemOf(enrollmentId, 'pay_blocked'), 'approve');
    expect(answer).toMatchObject({ answer: { status: 'approved' }, enrollmentId, replayed: false });
    const { programme, enrollment, items } = await rowsOf(enrollmentId);
    expect(enrollment).toStrictEqual({ status: 'cancelled', cancellationReason: 'offer_lapsed' });
    expect(programme.state).toBe('closed');
    expect(items).toMatchObject([{ status: 'approved', decidedByAdminId: adminId }]);
  });

  it('the decision extended: pay_by_at the decision + 48 h, no lapse meanwhile; no decline', async () => {
    const { enrollmentId } = await offered();
    await windowsIn('live').step(enrollmentId);
    const adminId = await admin();
    const requestId = await openItemOf(enrollmentId, 'pay_blocked');
    const declined = await causeOf(decide(adminId, requestId, 'decline'));
    expect(declined).toBe('decision_not_allowed');
    expect(programmesDecideRefusal.options).toContain(declined);
    const before = await dbNow();
    expect((await decide(adminId, requestId, 'extend')).answer).toStrictEqual({
      status: 'extended',
    });
    const { programme, items } = await rowsOf(enrollmentId);
    expect(programme.payByAt!.getTime()).toBeGreaterThanOrEqual(
      new Date(addSeconds(new Date(addHours(before, 48)), -1)).getTime(),
    );
    expect(items).toMatchObject([{ status: 'extended', decidedByAdminId: adminId }]);
    await expect(windowsIn('test').step(enrollmentId)).resolves.toBe('none');
  });
});

// SRS DEC-112: the teacher's app has no refusal request; the refusal is the `no_offer` path above.
describe('programme.request takes stop only (006:T008, SRS DEC-112; T017 builds it)', () => {
  it('refuses a stop not_paused on a programme that is not paused, writing nothing', async () => {
    const { teacherId, enrollmentId } = await awaitingOffer('done', 1);
    expect(
      await causeOf(
        services.request(
          teacherId,
          { enrollmentId, kind: 'stop', reason: 'x', idempotencyKey: randomUUID() },
          noSignal,
        ),
      ),
    ).toBe('not_paused');
    expect(await database.programmeRequest.count({ where: { enrollmentId } })).toBe(0);
  });
});

describe('the decision against the sweep’s step, under the programme’s row lock (006:T008)', () => {
  it('the decision waits on the programme’s row', async () => {
    const { enrollmentId } = await offered();
    await windowsIn('live').step(enrollmentId);
    const adminId = await admin();
    const requestId = await openItemOf(enrollmentId, 'pay_blocked');
    let decided: Promise<unknown> | undefined;
    await database.$transaction(async (tx) => {
      await lockRows(tx as Transaction, 'programmes', [enrollmentId]);
      decided = decide(adminId, requestId, 'approve');
      await sleep(500);
      const item = await tx.programmeRequest.findUniqueOrThrow({
        where: { id: requestId },
        select: { status: true },
      });
      expect(item.status).toBe('open');
    });
    await decided;
    expect((await rowsOf(enrollmentId)).enrollment.cancellationReason).toBe('offer_lapsed');
  });

  it('the step waits on the programme’s row', async () => {
    const { enrollmentId } = await offered();
    let stepped: Promise<unknown> | undefined;
    await database.$transaction(async (tx) => {
      await lockRows(tx as Transaction, 'programmes', [enrollmentId]);
      stepped = windowsIn('test').step(enrollmentId);
      await sleep(500);
      // The step waits on the programme's row before it takes the enrollment's: free here.
      await tx.$queryRaw`SELECT 1 FROM enrollments WHERE id = ${enrollmentId}::uuid FOR UPDATE NOWAIT`;
      const enrollment = await tx.enrollment.findUniqueOrThrow({
        where: { id: enrollmentId },
        select: { status: true },
      });
      expect(enrollment.status).toBe('confirmed');
    });
    expect(await stepped).toBe('lapsed');
  });

  it('the decision and the step at once: one lapse, one event, no deadlock', async () => {
    const { enrollmentId } = await offered();
    await windowsIn('live').step(enrollmentId);
    await database.teacherProfile.updateMany({
      where: { userId: await rowsOfTeacher(enrollmentId) },
      data: { payoutVerifiedAt: new Date(), payoutAccountRefEncrypted: Buffer.from('probe') },
    });
    const adminId = await admin();
    const requestId = await openItemOf(enrollmentId, 'pay_blocked');
    const outcomes = await Promise.allSettled([
      decide(adminId, requestId, 'approve'),
      windowsIn('test').step(enrollmentId),
      windowsIn('live').step(enrollmentId),
    ]);
    expect(outcomes.map(({ status }) => status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
    const { enrollment, cancelled } = await rowsOf(enrollmentId);
    expect(enrollment.cancellationReason).toBe('offer_lapsed');
    expect(cancelled).toBe(1);
  });
});

async function rowsOfTeacher(enrollmentId: string): Promise<string> {
  const { teacherUserId } = await database.enrollment.findUniqueOrThrow({
    where: { id: enrollmentId },
    select: { teacherUserId: true },
  });
  return teacherUserId;
}

describe('an account’s termination against the decision: the programme before the enrollment on both (006:T008, Q-2 (a))', () => {
  it('a teacher’s ban queued behind the decision waits on the programme’s row and never deadlocks', async () => {
    const { teacherId, enrollmentId } = await offered();
    await windowsIn('live').step(enrollmentId);
    const adminId = await admin();
    const requestId = await openItemOf(enrollmentId, 'pay_blocked');
    const subscriber = terminationSubscriber({
      orders: orderStandingsOf,
      log: { info: () => undefined, warn: () => undefined },
      deleteProgrammeCard,
    });
    let decided: Promise<unknown> | undefined;
    let banned: Promise<unknown> | undefined;
    // The programme's row held, so the decision queues on it first; then the ban, which (without the
    // programme's lock) would take the enrollment and wait on the programme behind the decision.
    await database.$transaction(async (tx) => {
      await lockRows(tx as Transaction, 'programmes', [enrollmentId]);
      decided = decide(adminId, requestId, 'approve');
      await sleep(400);
      banned = database.$transaction(async (ban) => {
        await lockAccount(ban as Transaction, teacherId);
        await subscriber(ban as Transaction, teacherId, 'banned');
      });
      await sleep(400);
    });
    const outcomes = await Promise.allSettled([decided, banned]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled']);
    const { programme, enrollment, items, cancelled } = await rowsOf(enrollmentId);
    expect(enrollment.cancellationReason).toBe('offer_lapsed');
    expect(programme.state).toBe('closed');
    expect(items).toMatchObject([{ status: 'approved' }]);
    expect(cancelled).toBe(1);
  });

  it('a teacher’s ban of an offered programme closes it and withdraws its open item', async () => {
    const { teacherId, enrollmentId } = await offered();
    await windowsIn('live').step(enrollmentId);
    const subscriber = terminationSubscriber({
      orders: orderStandingsOf,
      log: { info: () => undefined, warn: () => undefined },
      deleteProgrammeCard,
    });
    await database.$transaction(async (tx) => {
      await lockAccount(tx as Transaction, teacherId);
      await subscriber(tx as Transaction, teacherId, 'banned');
    });
    const { programme, enrollment, items } = await rowsOf(enrollmentId);
    expect(enrollment).toStrictEqual({
      status: 'cancelled',
      cancellationReason: 'teacher_suspended',
    });
    expect(programme.state).toBe('closed');
    expect(items).toMatchObject([{ kind: 'pay_blocked', status: 'withdrawn' }]);
    expect(cardsDeleted).toContain(enrollmentId);
  });
});
