// T070 of specs/004-sessions/tasks.md — the slot held through the window, and its release, over the
// real tables as the application role (FR-503; SRS FR-CANCEL-9, DEC-69; contracts/admin-surface.md,
// `enrollments.releaseSlot`; contracts/kernel.md, the release's row).
//
// - The hold: a complaint's, a fault's and a ban's closing keep the slot taken to discovery
//   (`booking.slots`), a hold (`placeHold`) and a make-up or restore of another enrollment
//   (`slotWeekTaken`) inside the window of its kind, its own enrollment's use left out, and leave it
//   free after the window and after a release; a ban's window is `ban_restore_window_days`. A
//   deletion's closing, a closing whose case is closed and a completion are unchanged.
// - The release: `slot_released_at` and one `slot_released` row at the database's instant; each
//   refusal (`CONFLICT` `slot_not_held`) writing nothing; the replay answering the first result and
//   writing nothing; the same key with another input the kernel's `CONFLICT`.
// - A release raced against another student's hold on the same slot: the release kept, the hold
//   placed only once the release has committed, refused `SLOT_TAKEN` otherwise; nothing half-written.
//
// The hold reads the database's clock, so every case's opening is written relative to it. The reads'
// probes write on one transaction and roll back; the release's and the race's worlds are committed
// (a refusal rolls its own transaction back, as the administrator kind's does).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  bookingSlotsOf,
  bookingSlotsStore,
  createEnrollmentSide,
  createHeldSlotRelease,
  holdsStore,
  placeHold,
} from '../../apps/api/src/modules/booking/index.js';
import { orderStandingsOf } from '../../apps/api/src/modules/payments/index.js';
import { windowDaysOf } from '../../apps/api/src/modules/sessions/index.js';
import { clockTimestamp } from '../../apps/api/src/platform/db/db-clock.js';
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
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';

// 005:T016 (rule d): the payment and cancellation pushes' port, which records nothing here.
const NO_PUSH = { record: async () => undefined };

const SETTINGS: Record<string, number> = {
  enrollment_restore_window_days: 14,
  ban_restore_window_days: 3,
  slot_release_buffer_weeks: 0,
  first_session_lead_hours: 24,
  idempotency_key_ttl_hours: 24,
};
const settings: SettingsReader = { read: async (key, schema) => schema.parse(SETTINGS[key]) };
const windowDays = windowDaysOf(settings);
const SILENT = { info: () => undefined, warn: () => undefined };
const CAIRO = 'Africa/Cairo';
const FEMALE = 'female' as RequesterGender;
/** A Thursday well after any hold these probes open, for `slotWeekTaken`. */
const LATER_THURSDAY = '2027-03-04';
const ADMIN = randomUUID();

let database: Database;

beforeAll(() => {
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 4,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
});

afterAll(async () => {
  if (database !== undefined) await closeDatabase(database);
});

const ROLLED_BACK = Symbol('rolled back');

/** Runs `probe` on one transaction and rolls back whatever it wrote. */
async function rolledBack(probe: (tx: Transaction) => Promise<void>): Promise<void> {
  try {
    await database.$transaction(
      async (tx) => {
        await probe(tx);
        throw ROLLED_BACK;
      },
      { timeout: 30_000 },
    );
  } catch (thrown) {
    if (thrown !== ROLLED_BACK) throw thrown;
  }
}

async function person(tx: Transaction, role: 'student' | 'teacher'): Promise<string> {
  const { id } = await tx.user.create({
    data: {
      email: `probe-${randomUUID()}@example.invalid`,
      gender: 'female',
      dateOfBirth: new Date('1990-01-01T00:00:00Z'),
      displayName: 'Probe person',
      preferredLanguage: 'ar',
      timezone: CAIRO,
      accountStatus: 'active',
    },
    select: { id: true },
  });
  await tx.userRole.create({ data: { userId: id, role, status: 'active' } });
  return id;
}

interface Offer {
  readonly teacherId: string;
  readonly subjectId: string;
  readonly packageId: string;
  readonly slotId: string;
}

/** An approved Cairo teacher, payout verified, with a 60-minute package and a Thursday 09:00 slot. */
async function offer(tx: Transaction): Promise<Offer> {
  const teacherId = await person(tx, 'teacher');
  await tx.teacherProfile.create({
    data: {
      userId: teacherId,
      bio: 'Probe',
      qualificationSummary: 'Probe',
      verificationStatus: 'approved',
      payoutVerifiedAt: new Date('2026-10-01T00:00:00Z'),
    },
  });
  const { id: subjectId } = await tx.subject.create({
    data: { nameAr: 'مادة', nameEn: 'Subject', isActive: true },
    select: { id: true },
  });
  const { id: packageId } = await tx.package.create({
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
  const { id: slotId } = await tx.availabilitySlot.create({
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
  return { teacherId, subjectId, packageId, slotId };
}

/** How each closing leaves its enrollment, and the case it opens (R-313, R-322). */
const CLOSINGS = {
  complaint: { status: 'terminated_no_show', reason: null, caseReason: 'absence_termination' },
  fault: { status: 'cancelled', reason: 'admin', caseReason: 'student_fault_confirmed' },
  ban: { status: 'cancelled', reason: 'admin', caseReason: 'student_banned' },
  teacherEnd: { status: 'cancelled', reason: 'teacher_suspended', caseReason: 'teacher_ended' },
  deletion: { status: 'cancelled', reason: 'account_deleted', caseReason: 'teacher_ended' },
} as const;
type ClosingName = keyof typeof CLOSINGS;

/** An enrollment a payment confirmed, closed by `name` with its case opened `daysAgo` days before now. */
async function closed(
  tx: Transaction,
  on: Offer,
  name: ClosingName,
  daysAgo: number,
  caseStatus: 'open' | 'dismissed' = 'open',
): Promise<{ enrollmentId: string; studentId: string; caseId: string }> {
  const closing = CLOSINGS[name];
  const studentId = await person(tx, 'student');
  const { id: enrollmentId } = await tx.enrollment.create({
    data: {
      studentUserId: studentId,
      teacherUserId: on.teacherId,
      packageId: on.packageId,
      slotId: on.slotId,
      snapshotPricePiasters: 100_000n,
      snapshotSessionCount: 4,
      snapshotDurationMinutes: 60,
      snapshotSubjectId: on.subjectId,
      snapshotSlotTimezone: CAIRO,
      status: closing.status,
      cancellationReason: closing.reason,
      confirmedAt: new Date('2026-10-01T09:00:00Z'),
      purchasedAt: new Date('2026-10-01T08:50:00Z'),
      quotedFirstSessionLocalDate: new Date('2026-10-08T00:00:00Z'),
    },
    select: { id: true },
  });
  const now = await clockTimestamp(tx);
  // The opening `daysAgo` days of 24 hours before the database's clock, computed by the database.
  const [{ opened } = { opened: now }] = await tx.$queryRaw<{ opened: Date }[]>`
    SELECT clock_timestamp() - make_interval(days => ${daysAgo}::int) AS opened`;
  const { id: caseId } = await tx.dispute.create({
    data: {
      enrollmentId,
      kind: 'compensation_case',
      reason: closing.caseReason,
      status: caseStatus,
      createdAt: opened,
      ...(caseStatus === 'open'
        ? {}
        : { resolvedAt: now, resolutionNotes: 'closed', resolvedByAdminId: await admin(tx) }),
    },
    select: { id: true },
  });
  return { enrollmentId, studentId, caseId };
}

async function admin(tx: Transaction): Promise<string> {
  const { id } = await tx.adminUser.create({
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

/** The slots `booking.slots` offers a fresh student for the offer's package. */
async function offered(tx: Transaction, on: Offer): Promise<readonly string[]> {
  const studentId = await person(tx, 'student');
  const { slots } = await bookingSlotsOf(
    tx,
    bookingSlotsStore,
    { userId: studentId, gender: FEMALE },
    { packageId: on.packageId },
    {
      now: new Date(),
      leadHours: 24,
      bufferWeeks: async () => 0,
      windowDays,
    },
  );
  return slots.map(({ slotId }) => slotId);
}

const enrollments = createEnrollmentSide({ settings });

/** Whether the slot is taken on a later Thursday for `enrollmentId`'s make-up or restore. */
function weekTaken(tx: Transaction, on: Offer, enrollmentId: string): Promise<boolean> {
  return enrollments.slotWeekTaken(tx, on.slotId, LATER_THURSDAY, enrollmentId);
}

/** A fresh student's hold on the offer's slot: its id, or the refusal's code. */
async function hold(tx: Transaction, on: Offer): Promise<string> {
  const studentId = await person(tx, 'student');
  try {
    const placed = await placeHold(
      tx,
      { userId: studentId, gender: FEMALE },
      { packageId: on.packageId, slotId: on.slotId },
      {
        notices: NO_PUSH,
        terms: {
          now: new Date(),
          ttlMinutes: 10,
          graceMinutes: 5,
          leadHours: 24,
          bufferWeeks: async () => 0,
          windowDays,
        },
        orders: orderStandingsOf,
        store: holdsStore,
      },
    );
    return placed.holdId;
  } catch (error: unknown) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
}

function releaser() {
  return createHeldSlotRelease({
    idempotency: new IdempotencyService({ store: new IdempotencyRepository(database), settings }),
    settings,
    log: SILENT,
  });
}

const OTHER_ENROLLMENT = randomUUID();

describe('the hold through the window (FR-503; DEC-69)', () => {
  it.each<[ClosingName, number]>([
    ['complaint', 13],
    ['fault', 13],
    ['ban', 2],
  ])(
    'a %s closing inside its window: taken to booking.slots, placeHold and another enrollment’s week, its own week free',
    async (name, daysAgo) => {
      await rolledBack(async (tx) => {
        const on = await offer(tx);
        const { enrollmentId } = await closed(tx, on, name, daysAgo);
        expect(await offered(tx, on)).toEqual([]);
        expect(await weekTaken(tx, on, OTHER_ENROLLMENT)).toBe(true);
        expect(await weekTaken(tx, on, enrollmentId)).toBe(false);
        expect(await hold(tx, on)).toBe('SLOT_TAKEN');
      });
    },
  );

  it.each<[ClosingName, number]>([
    ['complaint', 15],
    ['fault', 15],
    ['ban', 4],
  ])('a %s closing after its window: the slot free to all three', async (name, daysAgo) => {
    await rolledBack(async (tx) => {
      const on = await offer(tx);
      await closed(tx, on, name, daysAgo);
      expect(await offered(tx, on)).toEqual([on.slotId]);
      expect(await weekTaken(tx, on, OTHER_ENROLLMENT)).toBe(false);
      expect(await hold(tx, on)).not.toBe('SLOT_TAKEN');
    });
  });

  it('reads the window of the closing’s kind: a ban’s 3 days over, a fault’s 14 still running', async () => {
    await rolledBack(async (tx) => {
      const banned = await offer(tx);
      await closed(tx, banned, 'ban', 4);
      const faulted = await offer(tx);
      await closed(tx, faulted, 'fault', 4);
      expect(await offered(tx, banned)).toEqual([banned.slotId]);
      expect(await offered(tx, faulted)).toEqual([]);
    });
  });

  it.each<ClosingName>(['complaint', 'fault', 'ban'])(
    'a %s closing’s slot released by an administrator: free to all three at once',
    async (name) => {
      await rolledBack(async (tx) => {
        const on = await offer(tx);
        const { enrollmentId } = await closed(tx, on, name, 1);
        await releaser().releaseSlot(tx, ADMIN, {
          enrollmentId,
          reason: 'الموعد مطلوب',
          idempotencyKey: `release-${enrollmentId}`,
        });
        expect(await offered(tx, on)).toEqual([on.slotId]);
        expect(await weekTaken(tx, on, OTHER_ENROLLMENT)).toBe(false);
        expect(await hold(tx, on)).not.toBe('SLOT_TAKEN');
      });
    },
  );

  it('a teacher’s ban or revocation holds the slot through the ban window', async () => {
    await rolledBack(async (tx) => {
      const on = await offer(tx);
      await closed(tx, on, 'teacherEnd', 2);
      expect(await weekTaken(tx, on, OTHER_ENROLLMENT)).toBe(true);
    });
  });

  it('a deletion’s closing and a closing whose case is closed hold nothing', async () => {
    await rolledBack(async (tx) => {
      const deleted = await offer(tx);
      await closed(tx, deleted, 'deletion', 1);
      const dismissed = await offer(tx);
      await closed(tx, dismissed, 'fault', 1, 'dismissed');
      expect(await offered(tx, deleted)).toEqual([deleted.slotId]);
      expect(await offered(tx, dismissed)).toEqual([dismissed.slotId]);
      expect(await weekTaken(tx, deleted, OTHER_ENROLLMENT)).toBe(false);
      expect(await weekTaken(tx, dismissed, OTHER_ENROLLMENT)).toBe(false);
    });
  });

  it('a completion is unchanged: free from the week after its final session (FR-394)', async () => {
    await rolledBack(async (tx) => {
      const on = await offer(tx);
      const { enrollmentId, studentId } = await closed(tx, on, 'fault', 1);
      // The enrollment completed, its one session on a past Thursday; an end case still open cannot
      // hold a completed enrollment's slot.
      await tx.enrollment.update({
        where: { id: enrollmentId },
        data: { status: 'completed', cancellationReason: null },
      });
      await tx.session.create({
        data: {
          enrollmentId,
          teacherUserId: on.teacherId,
          studentUserId: studentId,
          sequenceNumber: 1,
          scheduledDateLocal: new Date('2026-10-15T00:00:00Z'),
          scheduledStartTimeLocal: new Date('1970-01-01T09:00:00Z'),
          timezone: CAIRO,
          scheduledStartAt: new Date('2026-10-15T06:00:00Z'),
          scheduledEndAt: new Date('2026-10-15T07:00:00Z'),
          status: 'scheduled',
        },
      });
      expect(await offered(tx, on)).toEqual([on.slotId]);
      expect(await weekTaken(tx, on, OTHER_ENROLLMENT)).toBe(false);
    });
  });
});

/** A committed world: an offer and one closing. */
async function committed(name: ClosingName, daysAgo: number, caseStatus?: 'open' | 'dismissed') {
  return database.$transaction(async (tx) => {
    const on = await offer(tx);
    const closing = await closed(tx, on, name, daysAgo, caseStatus);
    return { on, ...closing };
  });
}

/** What a release writes, read whole, so a refusal is seen to write nothing. */
async function stateOf(enrollmentId: string, key: string) {
  const [enrollment, events, keys] = await Promise.all([
    database.enrollment.findUniqueOrThrow({
      where: { id: enrollmentId },
      select: { status: true, cancellationReason: true, slotReleasedAt: true },
    }),
    database.enrollmentEvent.findMany({
      where: { enrollmentId },
      select: { kind: true, occurredAt: true },
    }),
    database.idempotencyKey.count({ where: { scope: 'enrollments.releaseSlot', key } }),
  ]);
  return { enrollment, events, keys };
}

function release(enrollmentId: string, key: string, reason = 'الموعد مطلوب لغيره') {
  return database.$transaction((tx: Transaction) =>
    releaser().releaseSlot(tx, ADMIN, { enrollmentId, reason, idempotencyKey: key }),
  );
}

async function refusalOf(attempt: Promise<unknown>): Promise<[string, unknown]> {
  const thrown: unknown = await attempt.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(thrown instanceof DomainError))
    throw new Error(`expected a refusal, got ${String(thrown)}`);
  return [thrown.code, thrown.details];
}

describe('enrollments.releaseSlot on the real tables (FR-503; SRS FR-CANCEL-9)', () => {
  it('writes slot_released_at and one slot_released row at the same database instant', async () => {
    const w = await committed('ban', 1);
    const key = `release-${w.enrollmentId}`;
    const { answer, replayed } = await release(w.enrollmentId, key);
    expect(replayed).toBe(false);
    const state = await stateOf(w.enrollmentId, key);
    expect(state.enrollment.slotReleasedAt).not.toBeNull();
    expect(answer).toEqual({
      enrollmentId: w.enrollmentId,
      slotReleasedAt: state.enrollment.slotReleasedAt?.toISOString(),
    });
    expect(state.events).toEqual([
      { kind: 'slot_released', occurredAt: state.enrollment.slotReleasedAt },
    ]);
    expect(state.enrollment.status).toBe('cancelled');
    expect(state.keys).toBe(1);
  });

  it('answers a replay the first result and writes nothing; the same key with another input CONFLICT', async () => {
    const w = await committed('fault', 1);
    const key = `release-${w.enrollmentId}`;
    const first = await release(w.enrollmentId, key);
    const after = await stateOf(w.enrollmentId, key);
    const again = await release(w.enrollmentId, key);
    expect(again).toEqual({ answer: first.answer, replayed: true });
    expect(await stateOf(w.enrollmentId, key)).toEqual(after);
    expect((await refusalOf(release(w.enrollmentId, key, 'سبب آخر')))[0]).toBe('CONFLICT');
    expect(await stateOf(w.enrollmentId, key)).toEqual(after);
  });

  it.each<[string, () => ReturnType<typeof committed>]>([
    ['a deletion’s closing', () => committed('deletion', 1)],
    ['a closing whose case is closed', () => committed('fault', 1, 'dismissed')],
    ['a fault’s closing past its window', () => committed('fault', 15)],
    ['a ban’s closing past the ban window', () => committed('ban', 4)],
  ])('refuses %s CONFLICT slot_not_held, writing nothing', async (_name, make) => {
    const w = await make();
    const key = `release-${w.enrollmentId}`;
    const before = await stateOf(w.enrollmentId, key);
    expect(await refusalOf(release(w.enrollmentId, key))).toEqual([
      'CONFLICT',
      [{ path: 'cause', code: 'slot_not_held' }],
    ]);
    expect(await stateOf(w.enrollmentId, key)).toEqual(before);
    expect(before.keys).toBe(0);
  });

  it('refuses an enrollment not closed, and a slot already released, writing nothing', async () => {
    const w = await committed('fault', 1);
    await database.enrollment.update({
      where: { id: w.enrollmentId },
      data: { status: 'confirmed', cancellationReason: null },
    });
    const notClosed = `release-a-${w.enrollmentId}`;
    expect((await refusalOf(release(w.enrollmentId, notClosed)))[1]).toEqual([
      { path: 'cause', code: 'slot_not_held' },
    ]);
    expect((await stateOf(w.enrollmentId, notClosed)).keys).toBe(0);
    const v = await committed('ban', 1);
    await release(v.enrollmentId, `release-b-${v.enrollmentId}`);
    const released = await stateOf(v.enrollmentId, `release-c-${v.enrollmentId}`);
    expect((await refusalOf(release(v.enrollmentId, `release-c-${v.enrollmentId}`)))[1]).toEqual([
      { path: 'cause', code: 'slot_not_held' },
    ]);
    expect(await stateOf(v.enrollmentId, `release-c-${v.enrollmentId}`)).toEqual(released);
  });
});

describe('a release raced against another student’s hold on the same slot (kernel.md)', () => {
  async function racing() {
    const w = await committed('fault', 1);
    const placeOne = () => database.$transaction((tx: Transaction) => hold(tx, w.on));
    const activeHolds = () =>
      database.slotHold.count({ where: { slotId: w.on.slotId, releasedAt: null } });
    return { w, placeOne, activeHolds };
  }

  it('the hold first: refused SLOT_TAKEN, then the release kept', async () => {
    const { w, placeOne, activeHolds } = await racing();
    expect(await placeOne()).toBe('SLOT_TAKEN');
    await release(w.enrollmentId, `release-${w.enrollmentId}`);
    expect(await activeHolds()).toBe(0);
  });

  it('the release first: the hold placed', async () => {
    const { w, placeOne, activeHolds } = await racing();
    await release(w.enrollmentId, `release-${w.enrollmentId}`);
    expect(await placeOne()).not.toBe('SLOT_TAKEN');
    expect(await activeHolds()).toBe(1);
  });

  it('raced at once: the release kept, the hold placed or refused SLOT_TAKEN, never both held and placed', async () => {
    const { w, placeOne, activeHolds } = await racing();
    const [released, placed] = await Promise.allSettled([
      release(w.enrollmentId, `release-${w.enrollmentId}`),
      placeOne(),
    ]);
    expect(released.status).toBe('fulfilled');
    expect(placed.status).toBe('fulfilled');
    const outcome = placed.status === 'fulfilled' ? placed.value : undefined;
    const state = await stateOf(w.enrollmentId, `release-${w.enrollmentId}`);
    expect(state.enrollment.slotReleasedAt).not.toBeNull();
    expect(state.events.filter(({ kind }) => kind === 'slot_released')).toHaveLength(1);
    // The hold waits on the slot's lock the release holds, and reads the slot again under it: placed
    // only once the release committed, refused while the slot was still held.
    expect(await activeHolds()).toBe(outcome === 'SLOT_TAKEN' ? 0 : 1);
  });
});
