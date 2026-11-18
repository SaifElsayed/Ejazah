// T080 of specs/004-sessions/tasks.md — a deletion refused with an ongoing enrollment, over the real
// tables as the application role, with booking's count bound to identity's port as `main.ts` binds
// it (FR-511; SRS FR-AUTH-14 as amended, DEC-67, DEC-69; the note under T080, Q-R10 (a), Q-R11 (a),
// N4).
//
// - Counted, so the person's own deletion is refused `CONFLICT` `active_enrollments` with nothing
//   changed: an enrollment of theirs, as student or teacher, `pending_payment` or `confirmed` (one
//   paused by a teacher's suspension included), and the closing of their own ban (a student's
//   `student_banned`) or ban or revocation (a teacher's `teacher_ended`) while its slot is held: the
//   case open, `slot_released_at` NULL and the database's clock before the hold's end.
// - Not counted, so the deletion goes on: every other status and closing (a completion, a
//   complaint's, a fault's, a payment's, a deletion's), the own closing once its hold is over, once
//   its slot was released or once its case closed, and the counterparty of a ban's closing.
// - A deletion raced against a confirmation of the same student's enrollment (a late payment of a
//   cancelled one): the deletion takes the account's lock before it counts, so it never leaves a
//   deleted account with a confirmed enrollment. The confirmation is held at the account's lock by
//   a probe transaction, the deletion queued behind it, then both let go.
//
// Each world is committed with accounts, a slot and a package of its own: the deletion runs its
// own transaction.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { confirmEnrollment } from '../../apps/api/src/jobs/confirm-enrollment';
import { createOngoingEnrollments } from '../../apps/api/src/modules/booking/index';
import {
  AccountConsequences,
  createIdentityServices,
} from '../../apps/api/src/modules/identity/index';
import { ColumnCipher } from '../../apps/api/src/platform/crypto/encryption';
import { hashPassword } from '../../apps/api/src/platform/crypto/hashing';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures';
import { IdempotencyRepository } from '../../apps/api/src/platform/idempotency/idempotency.repository';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service';
import { MemorySingleUseMarks } from '../../apps/api/src/platform/redis/single-use-marks.fixtures';
import {
  SettingError,
  type SettingsReader,
} from '../../apps/api/src/platform/settings/settings-reader';
import { confirmationWorld, NOW, SETTINGS as CONFIRMATION_SETTINGS } from './confirmation-world';

const KEY = Buffer.alloc(32, 7).toString('base64');
const PASSWORD = 'a long probe passphrase 80';
const CAIRO = 'Africa/Cairo';

const SETTINGS: Readonly<Record<string, unknown>> = {
  ...CONFIRMATION_SETTINGS,
  otp_code_ttl_minutes: 10,
  otp_max_attempts: 5,
  onboarding_token_ttl_minutes: 15,
  session_access_ttl_minutes: 15,
  session_refresh_ttl_days: 30,
  session_refresh_grace_seconds: 30,
  provider_nonce_ttl_minutes: 10,
  idempotency_key_ttl_hours: 24,
  enrollment_restore_window_days: 14,
  ban_restore_window_days: 3,
};

const settings: SettingsReader = {
  async read(key, schema) {
    if (!Object.hasOwn(SETTINGS, key)) throw new SettingError(key, 'missing');
    const parsed = schema.safeParse(SETTINGS[key]);
    if (!parsed.success) throw new SettingError(key, 'invalid');
    return parsed.data;
  },
};

let database: Database;
let passwordHash: string;
let deletion: ReturnType<typeof createIdentityServices>['deletion'];
const infos: object[] = [];

beforeAll(async () => {
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 4,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  passwordHash = await hashPassword(PASSWORD);
  const unreachable = () => Promise.reject(new Error('probe: not reached'));
  deletion = createIdentityServices({
    database,
    settings,
    encryptionKey: KEY,
    cipher: new ColumnCipher(KEY),
    marks: new MemorySingleUseMarks(() => new Date()),
    signIn: {
      verifyIdentityToken: unreachable,
      exchangeAuthorization: unreachable,
      revoke: unreachable,
    },
    email: { deliver: async () => undefined },
    storage: { temporaryLink: unreachable, remove: async () => undefined },
    log: { warn: () => undefined, info: (entry: object) => void infos.push(entry) },
    payment: { registerPayoutRecipient: unreachable },
    idempotency: new IdempotencyService<Transaction>({
      store: new IdempotencyRepository(database),
      settings,
    }),
    consequences: new AccountConsequences(),
    // As `main.ts` binds it (the note under T080, Q-R11 (a)).
    ongoingEnrollments: createOngoingEnrollments({ settings }),
    // 005:T031 (rule d): a teacher's two counts, none in this spec's worlds.
    openIjazahRequests: { count: async () => 0 },
    openCases: { count: async () => 0 },
    report: () => undefined,
  }).deletion;
});

afterAll(async () => {
  if (database !== undefined) await closeDatabase(database);
});

async function person(): Promise<string> {
  const { id } = await database.user.create({
    data: {
      email: `probe-${randomUUID()}@example.invalid`,
      passwordHash,
      gender: 'female',
      dateOfBirth: new Date('1990-01-01T00:00:00Z'),
      displayName: 'Probe person',
      preferredLanguage: 'ar',
      timezone: CAIRO,
      accountStatus: 'active',
    },
    select: { id: true },
  });
  return id;
}

interface Pair {
  readonly teacherId: string;
  readonly studentId: string;
  readonly enrollmentId: string;
}

type Status = 'pending_payment' | 'confirmed' | 'completed' | 'terminated_no_show' | 'cancelled';
type Reason = 'admin' | 'teacher_suspended' | 'account_deleted' | 'payment_expired';

/** A teacher's Thursday slot and package, a student, and their enrollment in `status`. */
async function enrolled(
  status: Status,
  reason: Reason | null = null,
  options: { readonly paid?: boolean; readonly released?: boolean } = {},
): Promise<Pair> {
  const teacherId = await person();
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
  const studentId = await person();
  const paid = options.paid ?? status !== 'pending_payment';
  const { id: enrollmentId } = await database.enrollment.create({
    data: {
      studentUserId: studentId,
      teacherUserId: teacherId,
      packageId,
      slotId,
      snapshotPricePiasters: 100_000n,
      snapshotSessionCount: 4,
      snapshotDurationMinutes: 60,
      snapshotSubjectId: subjectId,
      snapshotSlotTimezone: CAIRO,
      status,
      cancellationReason: reason,
      confirmedAt: paid ? new Date('2026-10-01T09:00:00Z') : null,
      slotReleasedAt: options.released === true ? new Date('2026-10-02T09:00:00Z') : null,
      purchasedAt: new Date('2026-10-01T08:50:00Z'),
      quotedFirstSessionLocalDate: new Date('2026-10-08T00:00:00Z'),
    },
    select: { id: true },
  });
  return { teacherId, studentId, enrollmentId };
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

/** A compensation case of `reason` on the enrollment, opened `daysAgo` days before the database's clock. */
async function caseOn(
  enrollmentId: string,
  reason: string,
  daysAgo: number,
  status: 'open' | 'dismissed' = 'open',
): Promise<void> {
  const [{ opened } = { opened: new Date() }] = await database.$queryRaw<{ opened: Date }[]>`
    SELECT clock_timestamp() - make_interval(days => ${daysAgo}::int) AS opened`;
  await database.dispute.create({
    data: {
      enrollmentId,
      kind: 'compensation_case',
      reason,
      status,
      createdAt: opened,
      ...(status === 'open'
        ? {}
        : {
            resolvedAt: new Date(),
            resolutionNotes: 'closed',
            resolvedByAdminId: await admin(),
          }),
    },
  });
}

function deleteOwn(userId: string): Promise<void> {
  return deletion.deleteAccount(userId, {
    confirmation: 'DELETE',
    reauth: { kind: 'password', password: PASSWORD },
    idempotencyKey: randomUUID(),
  });
}

async function accountOf(userId: string) {
  return database.includeDeleted.user.findUniqueOrThrow({
    where: { id: userId },
    select: { deletedAt: true, email: true, passwordHash: true },
  });
}

async function enrollmentOf(enrollmentId: string) {
  return database.enrollment.findUniqueOrThrow({
    where: { id: enrollmentId },
    select: { status: true, cancellationReason: true, confirmedAt: true, slotReleasedAt: true },
  });
}

async function refusalOf(attempt: Promise<unknown>): Promise<unknown> {
  return attempt.then(
    () => 'deleted',
    (error: unknown) => error,
  );
}

const ACTIVE_ENROLLMENTS = expect.objectContaining({
  code: 'CONFLICT',
  details: [{ path: 'cause', code: 'active_enrollments' }],
});

/** The person's own deletion refused, with their account and the enrollment as they were. */
async function expectRefused(userId: string, enrollmentId: string): Promise<void> {
  const enrollment = await enrollmentOf(enrollmentId);
  infos.length = 0;
  expect(await refusalOf(deleteOwn(userId))).toEqual(ACTIVE_ENROLLMENTS);
  expect(await accountOf(userId)).toMatchObject({ deletedAt: null, passwordHash });
  expect(await enrollmentOf(enrollmentId)).toEqual(enrollment);
  expect(infos).toEqual([{ userId, reason: 'active_enrollments' }]);
}

async function expectDeleted(userId: string): Promise<void> {
  await deleteOwn(userId);
  expect(await accountOf(userId)).toMatchObject({ email: null, passwordHash: null });
  expect((await accountOf(userId)).deletedAt).not.toBeNull();
}

describe('counted: the person’s own deletion refused, nothing changed (FR-511, N4)', () => {
  it.each(['pending_payment', 'confirmed'] as const)(
    '%s, for the student and for the teacher',
    async (status) => {
      const { studentId, teacherId, enrollmentId } = await enrolled(status);
      await expectRefused(studentId, enrollmentId);
      await expectRefused(teacherId, enrollmentId);
    },
  );

  it('confirmed and paused by the teacher’s suspension, for the student and for the teacher', async () => {
    const { studentId, teacherId, enrollmentId } = await enrolled('confirmed');
    await caseOn(enrollmentId, 'teacher_suspended', 1);
    await expectRefused(studentId, enrollmentId);
    await expectRefused(teacherId, enrollmentId);
  });

  it('a student’s own ban’s closing while its slot is held; its teacher is not refused', async () => {
    const { studentId, teacherId, enrollmentId } = await enrolled('cancelled', 'admin');
    await caseOn(enrollmentId, 'student_banned', 1);
    await expectRefused(studentId, enrollmentId);
    await expectDeleted(teacherId);
  });

  it('a teacher’s own ban’s or revocation’s closing while its slot is held; its student is not refused', async () => {
    const { studentId, teacherId, enrollmentId } = await enrolled('cancelled', 'teacher_suspended');
    await caseOn(enrollmentId, 'teacher_ended', 1);
    await expectRefused(teacherId, enrollmentId);
    await expectDeleted(studentId);
  });
});

describe('not counted: the person’s own deletion goes on (FR-511, N4)', () => {
  it.each([
    ['completed', null, null],
    ['terminated_no_show', null, 'absence_termination'],
    ['cancelled', 'admin', 'student_fault_confirmed'],
    ['cancelled', 'account_deleted', 'teacher_ended'],
  ] as const)(
    '%s (%s, case %s), for the student and for the teacher',
    async (status, reason, caseReason) => {
      const { studentId, teacherId, enrollmentId } = await enrolled(status, reason);
      if (caseReason !== null) await caseOn(enrollmentId, caseReason, 1);
      await expectDeleted(studentId);
      await expectDeleted(teacherId);
    },
  );

  it('a cancelled enrollment never paid (a payment expired), for both', async () => {
    const { studentId, teacherId } = await enrolled('cancelled', 'payment_expired', {
      paid: false,
    });
    await expectDeleted(studentId);
    await expectDeleted(teacherId);
  });

  it('the own ban’s closing after its hold, after its slot was released, and once its case closed', async () => {
    const over = await enrolled('cancelled', 'admin');
    await caseOn(over.enrollmentId, 'student_banned', 5);
    await expectDeleted(over.studentId);

    const released = await enrolled('cancelled', 'teacher_suspended', { released: true });
    await caseOn(released.enrollmentId, 'teacher_ended', 1);
    await expectDeleted(released.teacherId);

    const closed = await enrolled('cancelled', 'admin');
    await caseOn(closed.enrollmentId, 'student_banned', 1, 'dismissed');
    await expectDeleted(closed.studentId);
  });
});

describe('a deletion raced against a confirmation of the same student’s enrollment', () => {
  const world = confirmationWorld(() => database);

  /** How many backends wait on a lock whose statement names `users`. */
  async function waitingOnAccounts(probe: pg.Client): Promise<number> {
    const { rows } = await probe.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%users%'`,
    );
    return rows[0]?.n ?? 0;
  }

  async function until(probe: pg.Client, waiting: number): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if ((await waitingOnAccounts(probe)) >= waiting) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`fewer than ${waiting} backends ever waited on the account`);
  }

  it('a late payment confirmed while the deletion waits: the deletion is refused, never a deleted account with a confirmed enrollment', async () => {
    const on = await world.world({
      enrollment: { status: 'cancelled', reason: 'payment_expired' },
    });
    await database.user.update({ where: { id: on.studentId }, data: { passwordHash } });
    const paid = await world.order(on.enrollmentId);
    const gate = new pg.Client({ connectionString: specDatabaseUrl('DATABASE_URL') });
    const probe = new pg.Client({ connectionString: specDatabaseUrl('DATABASE_URL') });
    await gate.connect();
    await probe.connect();
    try {
      await gate.query('BEGIN');
      await gate.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [on.studentId]);
      const confirmed = confirmEnrollment({ database, settings, clock: () => NOW }).handle({
        paymentId: paid,
      });
      await until(probe, 1);
      const deleted = refusalOf(deleteOwn(on.studentId));
      await until(probe, 2);
      await gate.query('ROLLBACK');
      await confirmed;
      expect(await deleted).toEqual(ACTIVE_ENROLLMENTS);
    } finally {
      await gate.end();
      await probe.end();
    }
    expect(await enrollmentOf(on.enrollmentId)).toMatchObject({ status: 'confirmed' });
    expect(await accountOf(on.studentId)).toMatchObject({ deletedAt: null });
  });

  it('a payment awaited: the deletion is refused whichever commits first', async () => {
    const on = await world.world();
    await database.user.update({ where: { id: on.studentId }, data: { passwordHash } });
    const paid = await world.order(on.enrollmentId);
    const [deleted] = await Promise.all([
      refusalOf(deleteOwn(on.studentId)),
      confirmEnrollment({ database, settings, clock: () => NOW }).handle({ paymentId: paid }),
    ]);
    expect(deleted).toEqual(ACTIVE_ENROLLMENTS);
    expect(await enrollmentOf(on.enrollmentId)).toMatchObject({ status: 'confirmed' });
    expect(await accountOf(on.studentId)).toMatchObject({ deletedAt: null });
  });
});
