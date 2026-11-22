// 005:T031 of specs/005-certification/tasks.md — a teacher's deletion waits for their requests and
// enrollments, and keeps the signature, over the real tables as the application role, every port
// bound as `main.ts` binds it (FR-630, FR-631; R-411, R-414; DEC-72; the note under T031, Q-D1 (a) to
// Q-D6 (a)).
//
// - THE COUNT (research.md:264-265). A teacher's own deletion is refused `CONFLICT`
//   `pending_ijazah_requests`, nothing changed, while a request of theirs is `awaiting_student_name`
//   or `pending`, or `approved` with an ijazah neither signed off nor revoked; a rejected or closed
//   request, a signed-off ijazah and a revoked one count nothing.
// - AN ADMINISTRATOR'S DELETION OF A TEACHER is refused `active_enrollments` for an enrollment
//   `pending_payment` or `confirmed`, `pending_ijazah_requests` for such a request, `open_cases` for
//   an open compensation case on any of the teacher's enrollments (a closed one lets it go on); a
//   student's goes on over a confirmed enrollment, as before.
// - THE RACE. A direct end with `slot: 'hold'` moves `confirmed` to `cancelled` and opens its case in
//   one transaction without the teacher's lock. Committed between the deletion's two reads, it is
//   still seen: `live` is read before the open cases (red first with the two reads swapped).
// - THE SIGNATURE ⚠️ final at its erasure. An approved teacher's file and row are kept after the
//   deletion, `erase-deleted-files` included, and gone only after the kept data's erasure («now», or
//   its date through `erase-kept-data`), file first, then the row; a teacher never approved has it
//   erased at the deletion (defensive: such a row cannot be uploaded).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { confirmEnrollment } from '../../apps/api/src/jobs/confirm-enrollment';
import { eraseDeletedFiles } from '../../apps/api/src/jobs/erase-deleted-files';
import {
  createEnrollmentSide,
  createOngoingEnrollments,
  enrollmentIdsOfTeacher,
} from '../../apps/api/src/modules/booking/index';
import {
  catalogDeletionConsequence,
  createCredentialReviewService,
  credentialHistory,
  credentialsAdminRouter,
} from '../../apps/api/src/modules/catalog/index';
import { openRequestCountOfTeacher } from '../../apps/api/src/modules/certification/index';
import {
  AccountConsequences,
  createIdentityServices,
  type IdentityServiceDependencies,
} from '../../apps/api/src/modules/identity/index';
import { openCompensationCasesAmong } from '../../apps/api/src/modules/moderation/index';
import { createEnrollmentEnd } from '../../apps/api/src/modules/sessions/index';
import {
  createKeptData,
  createKeptDataErasureSweep,
  createKeptSignatureErasure,
} from '../../apps/api/src/modules/verification/index';
import type { AuditRecord } from '../../apps/api/src/platform/audit/audit-writer';
import { ColumnCipher } from '../../apps/api/src/platform/crypto/encryption';
import { hashPassword } from '../../apps/api/src/platform/crypto/hashing';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures';
import { transactionsOver } from '../../apps/api/src/platform/db/transaction.repository';
import { DomainError } from '../../apps/api/src/platform/errors/domain-error';
import type { RateLimiter } from '../../apps/api/src/platform/guards/rate-limit.guard';
import { IdempotencyRepository } from '../../apps/api/src/platform/idempotency/idempotency.repository';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service';
import {
  bindToTransaction,
  RequestLive,
  unboundBus,
} from '../../apps/api/src/platform/live/live-publisher';
import { createLogger } from '../../apps/api/src/platform/logging/logger';
import { MemorySingleUseMarks } from '../../apps/api/src/platform/redis/single-use-marks.fixtures';
import {
  SettingError,
  type SettingsReader,
} from '../../apps/api/src/platform/settings/settings-reader';
import { type AdminSurfaceServices, createAdminContext } from '../../apps/api/src/surfaces/context';
import {
  createAdminCallerFactory,
  createAdminRouter,
} from '../../apps/api/src/surfaces/procedures';
import { unusedAdminServices } from '../../apps/api/src/surfaces/services.fixtures';
import { confirmationWorld, NOW, SETTINGS as CONFIRMATION_SETTINGS } from './confirmation-world';

// 005:T016 (rule d): the payment and cancellation pushes' port, which records nothing here.
const NO_PUSH = { record: async () => undefined };

const KEY = Buffer.alloc(32, 7).toString('base64');
const PASSWORD = 'a long probe passphrase 31';
const CAIRO = 'Africa/Cairo';
const SILENT = { info: () => undefined, warn: () => undefined, error: () => undefined };

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
  ban_restore_window_days: 14,
  admin_list_page_size: 50,
  dispute_window_hours: 72,
  makeup_choice_window_days: 7,
  makeup_counter_answer_hours: 72,
  repeated_absence_flag_count: 3,
  document_link_ttl_seconds: 300,
};

const settings: SettingsReader = {
  async read(key, schema) {
    if (!Object.hasOwn(SETTINGS, key)) throw new SettingError(key, 'missing');
    const parsed = schema.safeParse(SETTINGS[key]);
    if (!parsed.success) throw new SettingError(key, 'invalid');
    return parsed.data;
  },
};

/** The storage port's removals, recorded. */
const storage = {
  removed: [] as string[],
  async remove(key: string) {
    storage.removed.push(key);
  },
  temporaryLink: async (key: string) => `https://storage.invalid/${key}`,
};

let database: Database;
let passwordHash: string;
let adminId: string;

/** The ports as `main.ts` binds them (the note under T031, Q-D1 (a)). */
type Ports = Pick<
  IdentityServiceDependencies,
  'ongoingEnrollments' | 'openIjazahRequests' | 'openCases'
>;
const bound = (): Ports => ({
  ongoingEnrollments: createOngoingEnrollments({ settings }),
  openIjazahRequests: { count: openRequestCountOfTeacher },
  openCases: {
    count: async (tx, teacherUserId) =>
      openCompensationCasesAmong(tx, await enrollmentIdsOfTeacher(tx, teacherUserId)),
  },
});

// T174: the registry handed in, so a probe subscribes catalog's consequence as `main.ts` does.
function deletionOver(ports: Ports = bound(), consequences = new AccountConsequences()) {
  const unreachable = () => Promise.reject(new Error('probe: not reached'));
  return createIdentityServices({
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
    storage: { temporaryLink: unreachable, remove: (key) => storage.remove(key) },
    log: SILENT,
    payment: { registerPayoutRecipient: unreachable },
    idempotency: new IdempotencyService<Transaction>({
      store: new IdempotencyRepository(database),
      settings,
    }),
    consequences,
    // As `main.ts` hands it (005:T031): the kept signature's erasure after the deletion's commit.
    fileErasures: [createKeptSignatureErasure({ database, storage })],
    ...ports,
    report: () => undefined,
  }).deletion;
}

beforeAll(async () => {
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 6,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  passwordHash = await hashPassword(PASSWORD);
  ({ id: adminId } = await database.adminUser.create({
    data: {
      email: `probe-admin-${randomUUID()}@example.invalid`,
      passwordHash: 'probe-hash',
      mfaSecretEncrypted: Buffer.from('probe'),
      displayName: 'Probe administrator',
      isActive: true,
    },
    select: { id: true },
  }));
});

afterAll(async () => {
  if (database !== undefined) await closeDatabase(database);
});

const { world, order } = confirmationWorld(() => database);

async function person(role: 'student' | 'teacher'): Promise<string> {
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
  await database.userRole.create({ data: { userId: id, role, status: 'active' } });
  return id;
}

/** A teacher with a password, approved (`approved_at` set) unless told otherwise. */
async function teacher(approved = true): Promise<string> {
  const teacherId = await person('teacher');
  await database.teacherProfile.create({
    data: {
      userId: teacherId,
      bio: 'Probe',
      qualificationSummary: 'Probe',
      verificationStatus: approved ? 'approved' : 'pending',
      applicationStatus: approved ? 'approved' : 'in_review',
      approvedAt: approved ? new Date('2026-09-01T00:00:00Z') : null,
      payoutVerifiedAt: approved ? new Date('2026-10-01T00:00:00Z') : null,
    },
  });
  return teacherId;
}

type Status = 'pending_payment' | 'confirmed' | 'completed' | 'cancelled';

/** An enrollment of the teacher's with a student of their own, in `status`. */
async function enrollment(teacherId: string, status: Status) {
  const studentId = await person('student');
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
      cancellationReason: status === 'cancelled' ? 'teacher_suspended' : null,
      confirmedAt: status === 'pending_payment' ? null : new Date('2026-10-01T09:00:00Z'),
      purchasedAt: new Date('2026-10-01T08:50:00Z'),
      quotedFirstSessionLocalDate: new Date('2026-10-08T00:00:00Z'),
    },
    select: { id: true },
  });
  return { studentId, subjectId, enrollmentId };
}

type RequestState =
  | 'awaiting_student_name'
  | 'pending'
  | 'rejected'
  | 'closed'
  | 'approved_unsigned'
  | 'approved_signed_off'
  | 'approved_revoked';

/** A request of the teacher's on a completed enrollment, in `state`, with its ijazah once approved. */
async function request(teacherId: string, state: RequestState): Promise<void> {
  const { studentId, subjectId, enrollmentId } = await enrollment(teacherId, 'completed');
  const approved = state.startsWith('approved');
  const status = approved
    ? 'approved'
    : (state as 'awaiting_student_name' | 'pending' | 'rejected' | 'closed');
  const decided = approved || status === 'rejected';
  const { id: requestId } = await database.ijazahRequest.create({
    data: {
      enrollmentId,
      teacherUserId: teacherId,
      studentUserId: studentId,
      subjectId,
      completionDate: new Date('2026-11-11T00:00:00Z'),
      language: 'ar',
      status,
      chainSnapshot: [['محمد ﷺ'], ['فاطمة بنت علي']],
      teacherNamePrinted: 'فاطمة بنت علي',
      riwayaPrinted: 'حفص عن عاصم',
      tariqPrinted: null,
      ...(status === 'rejected' ? { reason: 'probe' } : {}),
      ...(decided
        ? { decidedByAdminId: adminId, decidedAt: new Date('2026-11-12T08:00:00Z') }
        : {}),
    },
    select: { id: true },
  });
  if (!approved) return;
  const rendered = new Date('2026-11-12T09:00:00Z');
  await database.ijazah.create({
    data: {
      certificateNumber: `probe-${randomUUID()}`,
      enrollmentId,
      studentUserId: studentId,
      teacherUserId: teacherId,
      subjectId,
      mode: 'generated',
      language: 'ar',
      chainSnapshot: [['محمد ﷺ'], ['فاطمة بنت علي']],
      certificateStorageKey: `certificates/${requestId}/0.pdf`,
      paperCopyIntended: false,
      verificationTokenHash: `probe-${randomUUID()}`,
      grantedAt: rendered,
      studentNamePrinted: 'مريم بنت أحمد',
      teacherNamePrinted: 'فاطمة بنت علي',
      riwayaPrinted: 'حفص عن عاصم',
      tariqPrinted: null,
      completionDate: new Date('2026-11-11T00:00:00Z'),
      requestId,
      renderedAt: rendered,
      ...(state === 'approved_signed_off'
        ? { signedOffAt: new Date('2026-11-13T09:00:00Z'), signedOffByAdminId: adminId }
        : {}),
      ...(state === 'approved_revoked'
        ? {
            revokedAt: new Date('2026-11-13T09:00:00Z'),
            revokedReason: 'probe',
            revokedByAdminId: adminId,
          }
        : {}),
    },
  });
}

/** A compensation case on the enrollment, open or closed with the amount compensated. */
async function compensationCase(enrollmentId: string, open: boolean): Promise<void> {
  await database.dispute.create({
    data: {
      enrollmentId,
      kind: 'compensation_case',
      reason: 'teacher_ended',
      status: open ? 'open' : 'resolved',
      ...(open
        ? {}
        : {
            resolution: 'compensation_ordered',
            resolvedAt: new Date(),
            resolutionNotes: 'probe',
            resolvedByAdminId: adminId,
          }),
    },
  });
}

function deleteOwn(userId: string, over = deletionOver()): Promise<void> {
  return over.deleteAccount(userId, {
    confirmation: 'DELETE',
    reauth: { kind: 'password', password: PASSWORD },
    idempotencyKey: randomUUID(),
  });
}

/** `users.delete` as the administrator kind runs it: its list bound to the transaction. */
async function deleteByAdministrator(userId: string, over = deletionOver()): Promise<void> {
  const live = new RequestLive(unboundBus, SILENT);
  try {
    await database.$transaction(
      async (tx) => {
        const unbind = bindToTransaction(tx, live);
        try {
          await over.deleteByAdministrator(tx, adminId, {
            targetUserId: userId,
            reason: 'طلب صاحب الحساب الحذف عبر الدعم',
            idempotencyKey: randomUUID(),
          });
        } finally {
          unbind();
        }
      },
      { timeout: 30_000 },
    );
  } catch (error: unknown) {
    live.drop();
    throw error;
  }
  live.flush();
}

async function causeOf(attempt: Promise<unknown>): Promise<string | undefined> {
  const thrown: unknown = await attempt.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(thrown instanceof DomainError) || thrown.code !== 'CONFLICT') {
    throw new Error(`expected a CONFLICT, got ${String(thrown)}`);
  }
  return thrown.details?.find(({ path }) => path === 'cause')?.code;
}

async function live(userId: string): Promise<boolean> {
  const user = await database.user.findUnique({ where: { id: userId }, select: { id: true } });
  return user !== null;
}

describe('a teacher’s own deletion waits for their undecided ijazah requests (FR-630)', () => {
  it.each(['awaiting_student_name', 'pending', 'approved_unsigned'] as const)(
    'refuses CONFLICT pending_ijazah_requests over a request %s, changing nothing',
    async (state) => {
      const teacherId = await teacher();
      await request(teacherId, state);
      expect(await causeOf(deleteOwn(teacherId))).toBe('pending_ijazah_requests');
      expect(await live(teacherId)).toBe(true);
    },
  );

  it.each(['rejected', 'closed', 'approved_signed_off', 'approved_revoked'] as const)(
    'goes on over a request %s, which counts nothing',
    async (state) => {
      const teacherId = await teacher();
      await request(teacherId, state);
      await deleteOwn(teacherId);
      expect(await live(teacherId)).toBe(false);
    },
  );

  it('counts the teacher’s own requests only, never another teacher’s', async () => {
    const teacherId = await teacher();
    await request(await teacher(), 'pending');
    await deleteOwn(teacherId);
    expect(await live(teacherId)).toBe(false);
  });
});

describe('an administrator’s deletion of a teacher waits (FR-630)', () => {
  it.each([
    ['an enrollment pending payment', 'active_enrollments', 'pending_payment'],
    ['a confirmed enrollment', 'active_enrollments', 'confirmed'],
  ] as const)('refuses %s CONFLICT %s, changing nothing', async (_case, cause, status) => {
    const teacherId = await teacher();
    await enrollment(teacherId, status);
    expect(await causeOf(deleteByAdministrator(teacherId))).toBe(cause);
    expect(await live(teacherId)).toBe(true);
  });

  it('refuses an undecided ijazah request CONFLICT pending_ijazah_requests', async () => {
    const teacherId = await teacher();
    await request(teacherId, 'approved_unsigned');
    expect(await causeOf(deleteByAdministrator(teacherId))).toBe('pending_ijazah_requests');
    expect(await live(teacherId)).toBe(true);
  });

  it('refuses an open compensation case on a closed enrollment CONFLICT open_cases', async () => {
    const teacherId = await teacher();
    const { enrollmentId } = await enrollment(teacherId, 'cancelled');
    await compensationCase(enrollmentId, true);
    expect(await causeOf(deleteByAdministrator(teacherId))).toBe('open_cases');
    expect(await live(teacherId)).toBe(true);
  });

  it('goes on once the case is closed with the amount compensated', async () => {
    const teacherId = await teacher();
    const { enrollmentId } = await enrollment(teacherId, 'cancelled');
    await compensationCase(enrollmentId, false);
    await deleteByAdministrator(teacherId);
    expect(await live(teacherId)).toBe(false);
  });

  it('a student’s is unchanged: deleted over a confirmed enrollment', async () => {
    const teacherId = await teacher();
    const { studentId } = await enrollment(teacherId, 'confirmed');
    await deleteByAdministrator(studentId);
    expect(await live(studentId)).toBe(false);
  });
});

describe('the race: a direct end committed between the deletion’s two reads (FR-630, the note under T031)', () => {
  const enrollments = createEnrollmentSide({ settings });
  const directEnd = (enrollmentId: string) =>
    database.$transaction(
      (tx: Transaction) =>
        createEnrollmentEnd({
          enrollments,
          idempotency: new IdempotencyService({
            store: new IdempotencyRepository(database),
            settings,
          }),
          log: SILENT,
        }).endEnrollment(tx, adminId, {
          enrollmentId,
          partyReason: 'تعذر استمرار الاشتراك',
          internalNote: 'ملاحظة داخلية',
          slot: 'hold',
          // 003:T112 (rule d): the cause the router's schema defaults.
          cause: 'admin_ended',
          idempotencyKey: randomUUID(),
        }),
      { timeout: 30_000 },
    );

  it('is still refused: live is read before the open cases', async () => {
    const made = await world();
    await database.userRole.createMany({
      data: [
        { userId: made.studentId, role: 'student', status: 'active' },
        { userId: made.teacherId, role: 'teacher', status: 'active' },
      ],
    });
    await confirmEnrollment({ database, settings, notices: NO_PUSH, clock: () => NOW }).handle({
      paymentId: await order(made.enrollmentId),
    });
    // The direct end commits right after the deletion's first read, whichever read that is.
    let ended = false;
    const afterFirstRead = async () => {
      if (ended) return;
      ended = true;
      await directEnd(made.enrollmentId);
    };
    const ports = bound();
    const raced: Ports = {
      ongoingEnrollments: {
        hasOngoing: ports.ongoingEnrollments.hasOngoing,
        live: async (tx, userId) => {
          const answer = await ports.ongoingEnrollments.live(tx, userId);
          await afterFirstRead();
          return answer;
        },
      },
      openIjazahRequests: ports.openIjazahRequests,
      openCases: {
        count: async (tx, userId) => {
          const answer = await ports.openCases.count(tx, userId);
          await afterFirstRead();
          return answer;
        },
      },
    };

    const cause = await causeOf(deleteByAdministrator(made.teacherId, deletionOver(raced)));

    expect(ended).toBe(true);
    expect(['active_enrollments', 'open_cases']).toContain(cause);
    expect(await live(made.teacherId)).toBe(true);
    const ending = await database.enrollment.findUniqueOrThrow({
      where: { id: made.enrollmentId },
      select: { status: true, cancellationReason: true },
    });
    expect(ending).toEqual({ status: 'cancelled', cancellationReason: 'admin' });
  });
});

describe('the kept signature (FR-631, R-411; Q-D3 (a), Q-D4 (a))', () => {
  /** `erase-deleted-files` with the signature's store, as `worker.ts` binds it. */
  const runEraseDeletedFiles = () =>
    eraseDeletedFiles({
      stores: [createKeptSignatureErasure({ database, storage })],
      storage,
      held: async () => new Set(),
    }).handle({});

  async function signed(teacherId: string): Promise<string> {
    const storageKey = `signatures/${teacherId}.png`;
    await database.teacherSignature.create({ data: { teacherUserId: teacherId, storageKey } });
    return storageKey;
  }

  const signatureRow = (teacherId: string) =>
    database.teacherSignature.findUnique({ where: { teacherUserId: teacherId } });

  const keptData = () =>
    createKeptData({
      storage,
      cipher: new ColumnCipher(KEY),
      settings,
      log: SILENT,
      idempotency: new IdempotencyService<Transaction>({
        store: new IdempotencyRepository(database),
        settings,
      }),
    });

  it('an approved teacher’s is kept after the deletion and the hourly sweep, listed, and gone only after «now»', async () => {
    const teacherId = await teacher();
    const key = await signed(teacherId);
    await deleteOwn(teacherId);
    await runEraseDeletedFiles();

    expect(await signatureRow(teacherId)).not.toBeNull();
    expect(storage.removed).not.toContain(key);
    const listed = await database.$transaction((tx: Transaction) =>
      keptData().keptDataOf(tx, teacherId),
    );
    expect(listed.signature).toEqual({ uploadedAt: expect.any(String) });
    const link = await database.$transaction((tx: Transaction) =>
      keptData().signatureLink(tx, adminId, { teacherUserId: teacherId }),
    );
    expect(link.url).toBe(`https://storage.invalid/${key}`);

    await database.$transaction((tx: Transaction) =>
      keptData().eraseNow(tx, adminId, {
        teacherUserId: teacherId,
        reason: 'طلب الجهات',
        idempotencyKey: randomUUID(),
      }),
    );
    expect(await signatureRow(teacherId)).not.toBeNull();
    await runEraseDeletedFiles();

    expect(storage.removed).toContain(key);
    expect(await signatureRow(teacherId)).toBeNull();
    const after = await database.$transaction((tx: Transaction) =>
      keptData().keptDataOf(tx, teacherId),
    );
    expect(after.signature).toBeNull();
  });

  it('is gone after the kept data’s date passes and erase-kept-data runs, then erase-deleted-files', async () => {
    const teacherId = await teacher();
    const key = await signed(teacherId);
    await deleteOwn(teacherId);
    // The date an administrator set, now passed (the 24 hours are the service's rule, not the row's).
    await database.teacherProfile.update({
      where: { userId: teacherId },
      data: { keptEraseAt: new Date('2026-01-01T00:00:00Z') },
    });
    await createKeptDataErasureSweep({
      transactions: transactionsOver(database),
      log: SILENT,
      pageSize: 50,
    }).run();
    await runEraseDeletedFiles();

    expect(storage.removed).toContain(key);
    expect(await signatureRow(teacherId)).toBeNull();
  });

  it('two runs of erase-deleted-files after the erasure remove the file once and leave no row (R-API-14)', async () => {
    const teacherId = await teacher();
    const key = await signed(teacherId);
    await deleteOwn(teacherId);
    await database.$transaction((tx: Transaction) =>
      keptData().eraseNow(tx, adminId, {
        teacherUserId: teacherId,
        reason: 'طلب الجهات',
        idempotencyKey: randomUUID(),
      }),
    );
    await runEraseDeletedFiles();
    await runEraseDeletedFiles();
    expect(storage.removed.filter((removed) => removed === key)).toEqual([key]);
    expect(await signatureRow(teacherId)).toBeNull();
  });

  it('a teacher never approved has it erased at the deletion: the file removed, then the row', async () => {
    const teacherId = await teacher(false);
    const key = await signed(teacherId);
    await deleteOwn(teacherId);

    await vi.waitFor(async () => expect(await signatureRow(teacherId)).toBeNull());
    expect(storage.removed).toContain(key);
  });
});

// ---------------------------------------------------------------------------------------------
// T174 of specs/002-identity/tasks.md (R1a; SRS DEC-97, FR-AUTH-14; the note under T174): the
// credential's side of a teacher's deletion, with catalog's consequence subscribed as `main.ts`
// subscribes it and the credentials reviewed through the administrator surface as it is served, its
// audit entries written to `audit_logs` as the admin module's writer writes them (a spec outside
// admin may not import it, R-API-4; the label is the probe's own).
// - A teacher never approved keeps nothing: every credential's holder name, riwaya, tariq and review
//   reason null, its chain and its history gone; the audit entries hold no name and no note.
// - A teacher once approved keeps all of it, after the kept data's erasure too, a corrected name
//   with its old and new value in the history.
// ⚠️ The blanking and the history's erasure cannot be undone.
describe('a teacher’s credentials at the deletion (T174, DEC-97)', () => {
  const HOLDER = 'عمر بن فاروق';
  const CORRECTED = 'عمر بن فاروق الأنصاري';
  const NOTE = 'السند مقروء كاملًا من أوله';
  const REASON = 'الاسم كما في الملف بعد المراجعة';
  const REJECTION = 'الختم غير واضح في الصفحة الأخيرة';
  // The riwaya and the tariq stay in the entries (admin-surface.md:76 as amended); no name, no note.
  const TEXTS = [HOLDER, CORRECTED, NOTE, REASON, REJECTION, 'جبريل'];

  const review = createCredentialReviewService({
    settings,
    // 005:T006: the correction's re-freeze, which this probe does not assert.
    openRequestsRefreeze: { refreeze: async () => undefined },
  });
  const callerFor = createAdminCallerFactory(
    createAdminRouter({ credentials: credentialsAdminRouter }),
  );
  /** `audit_logs` as `AuditRepository.write` inserts a row, on the action's own transaction. */
  const auditWriter = {
    write: async (tx: Transaction, record: AuditRecord): Promise<void> => {
      await tx.auditLog.create({
        data: {
          adminId: record.adminId,
          action: record.action,
          targetType: record.targetType,
          targetId: record.targetId,
          targetLabel: `probe · ${record.targetId}`,
          reason: record.reason ?? null,
          ...(record.before === undefined ? {} : { before: record.before }),
          ...(record.after === undefined ? {} : { after: record.after }),
        },
      });
    },
  };
  /** The `credentials` namespace as the administrator kind serves it, its entries in `audit_logs`. */
  const reviewer = () =>
    callerFor(
      createAdminContext({
        session: { adminId, sessionId: adminId, mfaVerified: true },
        log: createLogger({ level: 'info', destination: { write: () => undefined } }),
        administration: {
          transactions: {
            run: <T>(work: (tx: Transaction) => Promise<T>): Promise<T> =>
              database.$transaction((tx: Transaction) => work(tx), { timeout: 30_000 }),
          },
          auditWriter,
        } as never,
        services: new Proxy(unusedAdminServices, {
          get: (target, name, receiver) =>
            name === 'credentials' ? review : Reflect.get(target, name, receiver),
        }) as AdminSurfaceServices,
        rateLimiter: { check: async () => undefined } as unknown as RateLimiter,
        clientAddress: '203.0.113.9',
      }),
    ).credentials;

  /** The deletion with catalog's consequence subscribed, as `main.ts` subscribes it. */
  const deletion = () => {
    const consequences = new AccountConsequences();
    consequences.subscribe(catalogDeletionConsequence());
    return deletionOver(bound(), consequences);
  };

  /** A credential of the teacher's waiting for review, over its own PDF and subject. */
  async function pendingCredential(teacherId: string): Promise<string> {
    const { id: subjectId } = await database.subject.create({
      data: { nameAr: 'مادة', nameEn: 'Subject', isActive: true },
      select: { id: true },
    });
    const { id: documentId } = await database.verificationDocument.create({
      data: {
        userId: teacherId,
        documentType: 'credential',
        storageKeyEncrypted: Buffer.from('probe'),
      },
      select: { id: true },
    });
    const { id } = await database.teacherCredential.create({
      data: {
        teacherUserId: teacherId,
        subjectId,
        documentId,
        status: 'pending',
        submittedWithApplication: true,
      },
      select: { id: true },
    });
    return id;
  }

  const TRANSCRIPTION = {
    holderName: HOLDER,
    riwaya: 'حفص عن عاصم',
    tariq: 'الشاطبية',
    chain: [{ names: ['رسول الله ﷺ'] }, { names: ['جبريل'] }],
  };

  /** The application rejected, as a reviewer's rejection leaves the profile (written by the probe). */
  async function rejectApplication(teacherId: string): Promise<void> {
    await database.teacherProfile.update({
      where: { userId: teacherId },
      data: {
        verificationStatus: 'rejected',
        applicationStatus: 'rejected',
        applicationDecidedAt: new Date('2026-10-24T10:00:00Z'),
        applicationDecidedByAdminId: adminId,
      },
    });
  }

  const credentialRow = (id: string) =>
    database.teacherCredential.findUniqueOrThrow({
      where: { id },
      select: { holderName: true, riwaya: true, tariq: true, reviewReason: true, status: true },
    });
  const chainCount = (credentialId: string) =>
    database.isnadEntry.count({ where: { credentialId } });
  const historyCount = (credentialId: string) =>
    database.teacherCredentialHistory.count({ where: { credentialId } });
  const entriesOf = (ids: readonly string[]) =>
    database.auditLog.findMany({
      where: { targetType: 'credential', targetId: { in: [...ids] } },
      select: { action: true, reason: true, before: true, after: true, targetLabel: true },
    });

  it('a credential approved before its teacher, the teacher then rejected and deleted: no name in audit_logs, teacher_credentials or the history', async () => {
    const teacherId = await teacher(false);
    const credentialId = await pendingCredential(teacherId);
    await reviewer().approve({ credentialId, ...TRANSCRIPTION });
    expect(await historyCount(credentialId)).toBe(1);
    await rejectApplication(teacherId);
    await deleteOwn(teacherId, deletion());

    const row = await credentialRow(credentialId);
    // One assertion per blanked column (the line's red).
    expect(row.holderName).toBeNull();
    expect(row.riwaya).toBeNull();
    expect(row.tariq).toBeNull();
    expect(row.reviewReason).toBeNull();
    expect(row.status).toBe('approved');
    expect(await chainCount(credentialId)).toBe(0);
    expect(await historyCount(credentialId)).toBe(0);
    const entries = await entriesOf([credentialId]);
    expect(entries.map(({ action }) => action)).toEqual(['credential.approve']);
    for (const text of TEXTS) expect(JSON.stringify(entries)).not.toContain(text);
  });

  it('approved with a note, corrected with a reason, another rejected with a reason, the teacher then rejected and deleted: no text in audit_logs or the history', async () => {
    const teacherId = await teacher(false);
    const approved = await pendingCredential(teacherId);
    const rejected = await pendingCredential(teacherId);
    await reviewer().approve({ credentialId: approved, ...TRANSCRIPTION, note: NOTE });
    await reviewer().correct({ credentialId: approved, holderName: CORRECTED, reason: REASON });
    await reviewer().reject({ credentialId: rejected, reason: REJECTION });
    expect([await historyCount(approved), await historyCount(rejected)]).toEqual([2, 1]);
    expect((await credentialRow(rejected)).reviewReason).toBe(REJECTION);
    await rejectApplication(teacherId);
    await deleteOwn(teacherId, deletion());

    for (const credentialId of [approved, rejected]) {
      const row = await credentialRow(credentialId);
      expect(row.holderName).toBeNull();
      expect(row.riwaya).toBeNull();
      expect(row.tariq).toBeNull();
      expect(row.reviewReason).toBeNull();
      expect(await historyCount(credentialId)).toBe(0);
    }
    expect(await chainCount(approved)).toBe(0);
    const entries = await entriesOf([approved, rejected]);
    expect(entries.map(({ action, reason }) => `${action} ${String(reason)}`).sort()).toEqual([
      'credential.approve note_given',
      'credential.correct note_given',
      'credential.reject note_given',
    ]);
    for (const text of TEXTS) expect(JSON.stringify(entries)).not.toContain(text);
  });

  it('a corrected name of an approved teacher shows its old and new value in the history, and the deletion and the kept data’s erasure keep it', async () => {
    const teacherId = await teacher();
    const credentialId = await pendingCredential(teacherId);
    await reviewer().approve({ credentialId, ...TRANSCRIPTION, note: NOTE });
    await reviewer().correct({ credentialId, holderName: CORRECTED, reason: REASON });
    await deleteOwn(teacherId, deletion());
    await database.$transaction((tx: Transaction) =>
      createKeptData({
        storage,
        cipher: new ColumnCipher(KEY),
        settings,
        log: SILENT,
        idempotency: new IdempotencyService<Transaction>({
          store: new IdempotencyRepository(database),
          settings,
        }),
      }).eraseNow(tx, adminId, {
        teacherUserId: teacherId,
        reason: 'طلب الجهات',
        idempotencyKey: randomUUID(),
      }),
    );

    expect(await credentialRow(credentialId)).toEqual({
      holderName: CORRECTED,
      riwaya: 'حفص عن عاصم',
      tariq: 'الشاطبية',
      reviewReason: null,
      status: 'approved',
    });
    expect(await chainCount(credentialId)).toBe(2);
    const history = await database.$transaction((tx: Transaction) =>
      credentialHistory.listOf(tx, credentialId),
    );
    expect(history.map(({ action, note }) => [action, note])).toEqual([
      ['approve', NOTE],
      ['correct', REASON],
    ]);
    expect(history[1]?.before?.holderName).toBe(HOLDER);
    expect(history[1]?.after?.holderName).toBe(CORRECTED);
    // The audit log carries no name, whoever the teacher (DEC-97).
    const entries = JSON.stringify(await entriesOf([credentialId]));
    for (const text of [HOLDER, CORRECTED, NOTE, REASON]) expect(entries).not.toContain(text);
  });
});
