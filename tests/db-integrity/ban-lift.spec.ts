// T072 of specs/004-sessions/tasks.md — a ban's or a revocation's lift over the real tables as the
// application role (FR-502, FR-503; SRS FR-ADMIN-5 as amended, FR-GENDER-6, DEC-66, DEC-69; the note
// under T072: N1, Q6 (a), Q7 (a), Q9 (a), Q10 (a), N12; contracts/kernel.md, the lifts' row). Every
// world is committed: accounts, a Thursday Cairo slot per teacher and four-session enrollments
// confirmed by the job; identity's `StandingService` with booking's subscriber bound as `main.ts`
// binds it, keyed through the kernel's idempotency, and sessions' `createBanLift` over the one
// `createRestore` handed in as the admin module hands it.
//
// - every ban writes `banned_at` and, for a profile, the two statuses before it; the lift clears them;
// - a student's lift inside the window restores every enrollment; after it, the one whose slot is
//   free restored and the one another student took refused `slot_taken`; one refused `slot_taken`
//   after a release while another is restored; a counterparty banned meanwhile `party_restricted`;
//   a pairing whose genders differ `gender_mismatch` (Q10 (a)), each left ended with its case open;
// - an applicant never approved, and a revoked teacher who reapplied, banned through
//   `applications.ban`'s path and lifted, the account and both statuses back as before the ban, the
//   note and decision left as history; a teacher banned after a revocation back to `revoked`, its
//   enrollments refused `party_restricted`; a revocation's lift, the subjects of the approved
//   credentials granted again and the enrollments restored;
// - a teacher banned while suspended (T071's note): the lift returns them `active` (N12) and the
//   enrollment restored with every session the suspension and the ban cancelled, none owed twice;
// - the refusals `not_banned`, `not_revoked` and `NOT_FOUND`, each writing nothing; the replay and
//   the same key with another input `CONFLICT`;
// - `users.get`'s hold end through sessions' `slotHeldUntilOf` (Q9 (a));
// - races: a lift against a hold on a held slot, against `users.requireIdentity`, and against
//   `sessions.restore` on the same enrollment, each order and at once.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { confirmEnrollment } from '../../apps/api/src/jobs/confirm-enrollment';
import {
  createEnrollmentSide,
  holdsStore,
  placeHold,
  terminationSubscriber,
} from '../../apps/api/src/modules/booking/index.js';
import {
  credentialsOfTeachers,
  grantSubjects,
  revokeSubjects,
} from '../../apps/api/src/modules/catalog/index.js';
import {
  AccountConsequences,
  lockAccount,
  StandingService,
  standingStoreOver,
} from '../../apps/api/src/modules/identity/index.js';
import { orderStandingsOf, refundedOf } from '../../apps/api/src/modules/payments/index.js';
import {
  createBanLift,
  createRemedyOffer,
  createRestore,
  restorableUntil,
} from '../../apps/api/src/modules/sessions/index.js';
import {
  createIdentityRequestStore,
  openRequestOf,
} from '../../apps/api/src/modules/verification/index.js';
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
import {
  confirmationWorld,
  NOW,
  settings as worldSettings,
  type World,
} from './confirmation-world';
import { connectAsApplication, type Db, makeAdmin, makeCredential, makeUser } from './harness';

const SETTINGS: Record<string, number> = {
  admin_list_page_size: 50,
  dispute_window_hours: 72,
  makeup_choice_window_days: 7,
  makeup_counter_answer_hours: 72,
  first_session_lead_hours: 24,
  slot_release_buffer_weeks: 0,
  slot_hold_ttl_minutes: 10,
  slot_hold_grace_minutes: 5,
  enrollment_restore_window_days: 14,
  ban_restore_window_days: 14,
  idempotency_key_ttl_hours: 24,
};
const settings: SettingsReader = { read: async (key, schema) => schema.parse(SETTINGS[key]) };
const SILENT = { info: () => undefined, warn: () => undefined };
/** Long before any lift: a closing whose case opened then has its hold over against any clock. */
const LONG_AGO = new Date('2026-10-01T08:00:00Z');
const OPTIONS = { maxWait: 5_000, timeout: 30_000 };

let database: Database;
let db: Db;
let watcher: Db;
let admin: string;
let standing: StandingService;
let banLift: ReturnType<typeof createBanLift>;
let idempotency: IdempotencyService<Transaction>;
let restoreCore: ReturnType<typeof createRestore>;

const enrollments = createEnrollmentSide({ settings, now: () => new Date() });

beforeAll(async () => {
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 6,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  [db, watcher] = await Promise.all([connectAsApplication(), connectAsApplication()]);
  admin = await makeAdmin(db);
  idempotency = new IdempotencyService({ store: new IdempotencyRepository(database), settings });
  restoreCore = createRestore({
    enrollments,
    idempotency,
    offers: createRemedyOffer({ enrollments, settings, log: SILENT }),
    settings,
    log: SILENT,
    payments: { refundedOf },
  });
  banLift = createBanLift({ enrollments, restore: restoreCore, settings, log: SILENT });
  const consequences = new AccountConsequences();
  consequences.subscribe(
    terminationSubscriber({ orders: orderStandingsOf, now: () => NOW, log: SILENT }),
  );
  standing = new StandingService({
    store: standingStoreOver(database),
    consequences,
    revokeSubjects,
    hasOpenIdentityRequest: async (tx, userId) => (await openRequestOf(tx, userId)) !== null,
    // As the admin module binds it (`apps/api/src/modules/admin/index.ts`).
    lift: {
      counterpartiesOf: banLift.counterpartiesOf,
      restoreClosed: banLift.restoreClosed,
      grantApprovedSubjects: async (tx, teacherUserId) => {
        const approved = (await credentialsOfTeachers(tx, [teacherUserId]))
          .filter(({ status }) => status === 'approved')
          .map(({ subjectId }) => subjectId);
        await grantSubjects(tx, teacherUserId, [...new Set(approved)]);
      },
    },
    log: SILENT,
    idempotency,
  });
});

afterAll(async () => {
  await Promise.all([db?.end(), watcher?.end()]);
  if (database !== undefined) await closeDatabase(database);
});

const { world, order, person } = confirmationWorld(() => database);

/** Confirms a world's enrollment through the job, both roles written as onboarding writes them. */
async function confirmed(made: World, roles = true): Promise<World> {
  if (roles) {
    await database.userRole.createMany({
      data: [
        { userId: made.studentId, role: 'student', status: 'active' },
        { userId: made.teacherId, role: 'teacher', status: 'active' },
      ],
      skipDuplicates: true,
    });
  }
  await confirmEnrollment({ database, settings: worldSettings, clock: () => NOW }).handle({
    paymentId: await order(made.enrollmentId),
  });
  return made;
}

/** A confirmed four-session enrollment on Thursday 09:00 Cairo. */
const confirmedWorld = async (): Promise<World> => confirmed(await world());

/**
 * A second enrollment of the same student with another teacher, on Thursday 11:00 Cairo (so the
 * student's two sessions never overlap), confirmed by the job.
 */
async function secondOf(first: World): Promise<World> {
  const made = await world();
  await database.availabilitySlot.update({
    where: { id: made.slotId },
    data: { startTimeLocal: new Date('1970-01-01T11:00:00Z') },
  });
  await database.enrollment.update({
    where: { id: made.enrollmentId },
    data: { studentUserId: first.studentId },
  });
  await database.slotHold.update({
    where: { id: made.holdId },
    data: { studentUserId: first.studentId },
  });
  await database.userRole.create({
    data: { userId: made.teacherId, role: 'teacher', status: 'active' },
  });
  return confirmed({ ...made, studentId: first.studentId }, false);
}

const banStudent = (studentId: string) =>
  database.$transaction((tx: Transaction) => standing.banStudent(tx, admin, studentId));
const banTeacher = (teacherId: string, applicantNote?: string) =>
  database.$transaction((tx: Transaction) =>
    standing.ban(tx, admin, teacherId, applicantNote === undefined ? undefined : { applicantNote }),
  );

let keys = 0;
type Scope = 'students.liftBan' | 'teachers.liftBan' | 'teachers.liftRevocation';
function lift(
  scope: Scope,
  userId: string,
  key = `lift-key-${String(++keys).padStart(12, '0')}`,
  reason = 'رفع',
) {
  return database.$transaction(
    (tx: Transaction) =>
      standing.keyedLift(tx, admin, { scope, userId, reason, idempotencyKey: key }),
    OPTIONS,
  );
}

async function causeOf(attempt: Promise<unknown>): Promise<unknown> {
  const thrown: unknown = await attempt.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(thrown instanceof DomainError))
    throw new Error(`expected a refusal, got ${String(thrown)}`);
  return thrown.details?.find(({ path }) => path === 'cause')?.code ?? thrown.code;
}

/** The account, the profile and every enrollment of the person, read whole. */
async function stateOf(userId: string) {
  const [user, profile, enrollmentRows, subjects] = await Promise.all([
    database.user.findUniqueOrThrow({
      where: { id: userId },
      select: { accountStatus: true, bannedAt: true },
    }),
    database.teacherProfile.findUnique({
      where: { userId },
      select: {
        verificationStatus: true,
        applicationStatus: true,
        verificationStatusBeforeBan: true,
        applicationStatusBeforeBan: true,
        applicationNote: true,
        applicationDecidedAt: true,
      },
    }),
    database.enrollment.findMany({
      where: { OR: [{ studentUserId: userId }, { teacherUserId: userId }] },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        status: true,
        cancellationReason: true,
        disputes: {
          orderBy: { id: 'asc' },
          select: { reason: true, status: true, resolutionNotes: true },
        },
        _count: { select: { sessions: true } },
      },
    }),
    database.teacherSubject.findMany({
      where: { teacherUserId: userId },
      select: { subjectId: true },
    }),
  ]);
  return { user, profile, enrollments: enrollmentRows, subjects };
}

/** Another student's hold on the slot, placed now, on `on`'s transaction or one of its own. */
async function otherStudentHold(w: World, on?: Transaction) {
  const other = await makeUser(db, { gender: 'female' });
  await database.userRole.create({ data: { userId: other, role: 'student', status: 'active' } });
  const hold = (tx: Transaction) =>
    placeHold(
      tx,
      { userId: other, gender: 'female' as RequesterGender },
      { packageId: w.packageId, slotId: w.slotId },
      {
        terms: {
          now: new Date(),
          ttlMinutes: 10,
          graceMinutes: 5,
          leadHours: 24,
          bufferWeeks: async () => 0,
          windowDays: async (setting) => SETTINGS[setting] ?? 0,
        },
        orders: orderStandingsOf,
        store: holdsStore,
      },
    );
  return on === undefined ? database.$transaction(hold, OPTIONS) : hold(on);
}

/** The enrollment's closing case opened long ago: its hold over. */
const holdOver = (enrollmentId: string) =>
  database.dispute.updateMany({
    where: { enrollmentId, kind: 'compensation_case' },
    data: { createdAt: LONG_AGO },
  });

/** Resolves once backend `pid` waits on a lock; fails after about two seconds. */
async function seenWaiting(pid: number): Promise<void> {
  for (let look = 0; look < 100; look += 1) {
    const { rows } = await watcher.query<{ waiting: boolean }>(
      `SELECT wait_event_type IN ('Lock', 'LWLock') AS waiting FROM pg_stat_activity WHERE pid = $1`,
      [pid],
    );
    if (rows[0]?.waiting === true) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`backend ${String(pid)} never waited on a lock`);
}

/**
 * A runs `first` and stays open; B runs `second` and is seen waiting; A commits. Answers how B
 * ended: its value, or what it threw.
 */
async function race<T>(
  first: (tx: Transaction) => Promise<unknown>,
  second: (tx: Transaction) => Promise<T>,
): Promise<{ readonly value: T } | { readonly thrown: unknown }> {
  let release = (): void => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ran = (): void => undefined;
  const firstRan = new Promise<void>((resolve) => {
    ran = resolve;
  });
  const a = database.$transaction(async (tx) => {
    await first(tx);
    ran();
    await released;
  }, OPTIONS);
  await Promise.race([firstRan, a]);
  let pidOfB = (_pid: number): void => undefined;
  const bStarted = new Promise<number>((resolve) => {
    pidOfB = resolve;
  });
  const b = database
    .$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      pidOfB(row?.pid ?? 0);
      return second(tx);
    }, OPTIONS)
    .then(
      (value) => ({ value }),
      (thrown: unknown) => ({ thrown }),
    );
  try {
    await seenWaiting(await bStarted);
  } finally {
    release();
    await a;
  }
  return b;
}

const codeOfThrown = (ended: { readonly thrown?: unknown }): unknown =>
  ended.thrown instanceof DomainError
    ? (ended.thrown.details?.find(({ path }) => path === 'cause')?.code ?? ended.thrown.code)
    : ended.thrown;

describe('every ban writes its instant and the statuses before it (T069’s columns)', () => {
  it('banStudent and teachers.ban write banned_at; the profile keeps both statuses', async () => {
    const w = await confirmedWorld();
    await banStudent(w.studentId);
    await banTeacher(w.teacherId);
    const [student, teacher] = await Promise.all([stateOf(w.studentId), stateOf(w.teacherId)]);
    expect(student.user.accountStatus).toBe('banned');
    expect(student.user.bannedAt).toBeInstanceOf(Date);
    expect(teacher.user.bannedAt).toBeInstanceOf(Date);
    expect(teacher.profile).toMatchObject({
      verificationStatus: 'banned',
      verificationStatusBeforeBan: 'approved',
      applicationStatusBeforeBan: null,
    });
  });
});

describe('a student’s lift (students.liftBan)', () => {
  it('inside the window: the account active, banned_at cleared, every enrollment restored and its case closed restored', async () => {
    const one = await confirmedWorld();
    const two = await secondOf(one);
    await banStudent(one.studentId);
    const { move, replayed } = await lift('students.liftBan', one.studentId);
    expect(replayed).toBe(false);
    expect(move.before).toEqual({ accountStatus: 'banned' });
    expect(move.after).toEqual({ accountStatus: 'active' });
    expect(move.enrollments).toEqual(
      [one.enrollmentId, two.enrollmentId]
        .sort()
        .map((enrollmentId) => ({ enrollmentId, restored: true })),
    );
    const after = await stateOf(one.studentId);
    expect(after.user).toEqual({ accountStatus: 'active', bannedAt: null });
    for (const enrollment of after.enrollments) {
      expect(enrollment).toMatchObject({ status: 'confirmed', cancellationReason: null });
      expect(enrollment.disputes).toEqual([
        { reason: 'student_banned', status: 'dismissed', resolutionNotes: 'restored' },
      ]);
      // The four the ban cancelled, kept, and four recreated.
      expect(enrollment._count.sessions).toBe(8);
    }
  });

  it('after the window: the enrollment whose slot is free restored, the one another student took refused slot_taken and left ended with its case open', async () => {
    const one = await confirmedWorld();
    const two = await secondOf(one);
    await banStudent(one.studentId);
    await holdOver(one.enrollmentId);
    await holdOver(two.enrollmentId);
    await otherStudentHold(one);
    const { move } = await lift('students.liftBan', one.studentId);
    expect(move.enrollments).toContainEqual({
      enrollmentId: one.enrollmentId,
      restored: false,
      cause: 'slot_taken',
    });
    expect(move.enrollments).toContainEqual({ enrollmentId: two.enrollmentId, restored: true });
    const after = await stateOf(one.studentId);
    expect(after.user.accountStatus).toBe('active');
    expect(after.enrollments.find(({ id }) => id === one.enrollmentId)).toMatchObject({
      status: 'cancelled',
      disputes: [{ reason: 'student_banned', status: 'open', resolutionNotes: null }],
    });
  });

  it('one enrollment refused slot_taken after a release while another is restored', async () => {
    const one = await confirmedWorld();
    const two = await secondOf(one);
    await banStudent(one.studentId);
    // An administrator's release (T070), as `enrollments.releaseSlot` writes it.
    await database.enrollment.update({
      where: { id: one.enrollmentId },
      data: { slotReleasedAt: new Date() },
    });
    await database.enrollmentEvent.create({
      data: { enrollmentId: one.enrollmentId, kind: 'slot_released', occurredAt: new Date() },
    });
    await otherStudentHold(one);
    const { move } = await lift('students.liftBan', one.studentId);
    expect(move.enrollments).toEqual(
      [
        { enrollmentId: one.enrollmentId, restored: false, cause: 'slot_taken' },
        { enrollmentId: two.enrollmentId, restored: true },
      ].sort((a, b) => (a.enrollmentId < b.enrollmentId ? -1 : 1)),
    );
  });

  it('a counterparty banned meanwhile: party_restricted, the enrollment left ended', async () => {
    const w = await confirmedWorld();
    await banStudent(w.studentId);
    await banTeacher(w.teacherId);
    const { move } = await lift('students.liftBan', w.studentId);
    expect(move.enrollments).toEqual([
      { enrollmentId: w.enrollmentId, restored: false, cause: 'party_restricted' },
    ]);
    expect((await stateOf(w.studentId)).user.accountStatus).toBe('active');
  });

  it('a pairing the rule forbids (the genders differ): gender_mismatch, never restored (Q10 (a))', async () => {
    const w = await confirmedWorld();
    await banStudent(w.studentId);
    // A gender-fraud ban (SRS FR-GENDER-6): the teacher's declared gender corrected meanwhile.
    await database.user.update({ where: { id: w.teacherId }, data: { gender: 'male' } });
    const { move } = await lift('students.liftBan', w.studentId);
    expect(move.enrollments).toEqual([
      { enrollmentId: w.enrollmentId, restored: false, cause: 'gender_mismatch' },
    ]);
    expect((await stateOf(w.studentId)).enrollments[0]).toMatchObject({
      status: 'cancelled',
      disputes: [{ reason: 'student_banned', status: 'open', resolutionNotes: null }],
    });
  });

  it('answers a repeated key the first result, writing nothing, and the same key with another input CONFLICT', async () => {
    const w = await confirmedWorld();
    await banStudent(w.studentId);
    const key = 'lift-key-repeat-000000001';
    const first = await lift('students.liftBan', w.studentId, key);
    const state = await stateOf(w.studentId);
    expect(await lift('students.liftBan', w.studentId, key)).toEqual({
      move: first.move,
      replayed: true,
    });
    expect(await stateOf(w.studentId)).toEqual(state);
    expect(await causeOf(lift('students.liftBan', w.studentId, key, 'سبب آخر'))).toBe('CONFLICT');
  });

  it('refuses a student not banned not_banned, and a teacher NOT_FOUND, writing nothing', async () => {
    const w = await confirmedWorld();
    const before = await stateOf(w.studentId);
    expect(await causeOf(lift('students.liftBan', w.studentId))).toBe('not_banned');
    expect(await causeOf(lift('students.liftBan', w.teacherId))).toBe('NOT_FOUND');
    expect(await stateOf(w.studentId)).toEqual(before);
  });
});

describe('a teacher’s or an applicant’s lift (teachers.liftBan) and a revocation’s (teachers.liftRevocation)', () => {
  /** An applicant who never was approved, with the application in `status`. */
  async function applicant(status: 'in_review' | 'needs_document'): Promise<string> {
    const userId = await person('female');
    await database.userRole.create({ data: { userId, role: 'teacher', status: 'active' } });
    await database.teacherProfile.create({
      data: {
        userId,
        bio: '',
        qualificationSummary: 'Probe',
        verificationStatus: 'pending',
        applicationStatus: status,
        applicationSubmittedAt: new Date('2026-10-18T09:00:00Z'),
      },
    });
    return userId;
  }

  it('a never-approved applicant’s ban lifted: the account active and the application back to its status, the note and decision kept as history', async () => {
    const userId = await applicant('needs_document');
    await banTeacher(userId, 'وثائق مزوّرة');
    const banned = await stateOf(userId);
    const { move } = await lift('teachers.liftBan', userId);
    expect(move).toEqual({
      before: {
        accountStatus: 'banned',
        verificationStatus: 'banned',
        applicationStatus: 'banned',
      },
      after: {
        accountStatus: 'active',
        verificationStatus: 'pending',
        applicationStatus: 'needs_document',
      },
      enrollments: [],
    });
    expect((await stateOf(userId)).profile).toEqual({
      verificationStatus: 'pending',
      applicationStatus: 'needs_document',
      verificationStatusBeforeBan: null,
      applicationStatusBeforeBan: null,
      applicationNote: 'وثائق مزوّرة',
      applicationDecidedAt: banned.profile?.applicationDecidedAt,
    });
  });

  it('a revoked teacher who reapplied and was banned through applications.ban lifted: the account and both statuses back', async () => {
    const w = await confirmedWorld();
    await database.$transaction((tx: Transaction) =>
      standing.revokeApproval(tx, admin, w.teacherId, 'شكوى'),
    );
    // The reapplication, as `teacher.application.submit` opens it after a revocation.
    await database.teacherProfile.update({
      where: { userId: w.teacherId },
      data: { verificationStatus: 'pending', applicationStatus: 'in_review' },
    });
    await banTeacher(w.teacherId, 'هوية مزوّرة');
    const { move } = await lift('teachers.liftBan', w.teacherId);
    expect(move.after).toEqual({
      accountStatus: 'active',
      verificationStatus: 'pending',
      applicationStatus: 'in_review',
    });
    // The revocation's closing: the teacher not approved, so refused party_restricted, kept ended.
    expect(move.enrollments).toEqual([
      { enrollmentId: w.enrollmentId, restored: false, cause: 'party_restricted' },
    ]);
  });

  it('a teacher banned after a revocation returns to revoked; a revocation’s lift then grants the approved subjects again and restores the enrollment', async () => {
    const w = await confirmedWorld();
    const rejectedSubject = (
      await database.subject.create({ data: { nameAr: 'أخرى', nameEn: 'Other', isActive: true } })
    ).id;
    await makeCredential(db, {
      teacherId: w.teacherId,
      subjectId: w.subjectId,
      status: 'approved',
      admin,
    });
    await makeCredential(db, {
      teacherId: w.teacherId,
      subjectId: rejectedSubject,
      status: 'rejected',
      admin,
    });
    await database.teacherSubject.create({
      data: { teacherUserId: w.teacherId, subjectId: w.subjectId },
    });
    await database.$transaction((tx: Transaction) =>
      standing.revokeApproval(tx, admin, w.teacherId, 'شكوى'),
    );
    await banTeacher(w.teacherId);
    const banned = await lift('teachers.liftBan', w.teacherId);
    expect(banned.move.after).toEqual({
      accountStatus: 'active',
      verificationStatus: 'revoked',
      applicationStatus: 'rejected',
    });
    expect(banned.move.enrollments).toEqual([
      { enrollmentId: w.enrollmentId, restored: false, cause: 'party_restricted' },
    ]);
    expect((await stateOf(w.teacherId)).subjects).toEqual([]);
    const revoked = await lift('teachers.liftRevocation', w.teacherId);
    expect(revoked.move).toEqual({
      before: { verificationStatus: 'revoked', applicationStatus: 'rejected' },
      after: { verificationStatus: 'approved', applicationStatus: 'approved' },
      enrollments: [{ enrollmentId: w.enrollmentId, restored: true }],
    });
    const after = await stateOf(w.teacherId);
    expect(after.subjects).toEqual([{ subjectId: w.subjectId }]);
    expect(after.profile).toMatchObject({ applicationNote: 'شكوى' });
    expect(after.enrollments[0]).toMatchObject({
      status: 'confirmed',
      disputes: [{ reason: 'teacher_ended', status: 'dismissed', resolutionNotes: 'restored' }],
    });
  });

  it('a teacher banned while suspended (T071’s note): active again (N12), the enrollment restored with no session owed twice', async () => {
    const w = await confirmedWorld();
    await database.$transaction((tx: Transaction) => standing.suspend(tx, admin, w.teacherId));
    await banTeacher(w.teacherId);
    const ended = await stateOf(w.studentId);
    expect(ended.enrollments[0]?.disputes).toEqual([
      { reason: 'teacher_suspended', status: 'resolved', resolutionNotes: 'ended_meanwhile' },
      { reason: 'teacher_ended', status: 'open', resolutionNotes: null },
    ]);
    const { move } = await lift('teachers.liftBan', w.teacherId);
    expect(move.after).toMatchObject({ accountStatus: 'active', verificationStatus: 'approved' });
    expect(move.enrollments).toEqual([{ enrollmentId: w.enrollmentId, restored: true }]);
    const sessions = await database.session.findMany({
      where: { enrollmentId: w.enrollmentId },
      select: { status: true, remedy: { select: { id: true } } },
    });
    // The four the suspension cancelled, kept, and four recreated; nothing offered on top.
    expect(sessions.filter(({ status }) => status === 'cancelled_by_admin')).toHaveLength(4);
    expect(sessions.filter(({ status }) => status === 'scheduled')).toHaveLength(4);
    expect(sessions.filter(({ remedy }) => remedy !== null)).toEqual([]);
  });

  it('refuses not_banned, not_revoked and NOT_FOUND, writing nothing', async () => {
    const w = await confirmedWorld();
    const before = await stateOf(w.teacherId);
    expect(await causeOf(lift('teachers.liftBan', w.teacherId))).toBe('not_banned');
    expect(await causeOf(lift('teachers.liftRevocation', w.teacherId))).toBe('not_revoked');
    expect(await causeOf(lift('teachers.liftBan', w.studentId))).toBe('NOT_FOUND');
    expect(await stateOf(w.teacherId)).toEqual(before);
  });
});

describe('users.get’s enrollmentsSlotHeldUntil (Q9 (a))', () => {
  it('the closing case’s opening plus ban_restore_window_days; null once lifted', async () => {
    const w = await confirmedWorld();
    await banStudent(w.studentId);
    const [closingCase] = await database.dispute.findMany({
      where: { enrollmentId: w.enrollmentId, reason: 'student_banned' },
      select: { createdAt: true },
    });
    const held = await database.$transaction((tx: Transaction) =>
      banLift.slotHeldUntilOf(tx, w.studentId),
    );
    if (closingCase === undefined) throw new Error('no ban case');
    // T070's one function over the case's opening and the ban window.
    expect(held).toEqual(
      await restorableUntil(closingCase.createdAt, 'student_banned', async () => 14),
    );
    await lift('students.liftBan', w.studentId);
    expect(
      await database.$transaction((tx: Transaction) => banLift.slotHeldUntilOf(tx, w.studentId)),
    ).toBeNull();
  });
});

describe('races (kernel.md, the lifts’ row)', () => {
  it('a lift against a hold on the held slot: the hold waits, then is refused; at once, the lift restores and the hold is refused', async () => {
    const w = await confirmedWorld();
    await banStudent(w.studentId);
    const ended = await race(
      (tx) =>
        standing.keyedLift(tx, admin, {
          scope: 'students.liftBan',
          userId: w.studentId,
          reason: 'رفع',
          idempotencyKey: `lift-race-hold-${w.enrollmentId.slice(-12)}`,
        }),
      (tx) => otherStudentHold(w, tx),
    );
    expect(codeOfThrown(ended as { thrown?: unknown })).toBe('SLOT_TAKEN');
    expect((await stateOf(w.studentId)).enrollments[0]?.status).toBe('confirmed');

    const v = await confirmedWorld();
    await banStudent(v.studentId);
    const [lifted, held] = await Promise.allSettled([
      lift('students.liftBan', v.studentId),
      otherStudentHold(v),
    ]);
    expect(lifted.status).toBe('fulfilled');
    expect(held.status).toBe('rejected');
    expect((await stateOf(v.studentId)).enrollments[0]?.status).toBe('confirmed');
  });

  it('a lift against users.requireIdentity: either order, the account never lands active with a request open', async () => {
    const requests = createIdentityRequestStore(database);
    const w = await confirmedWorld();
    await banStudent(w.studentId);
    // The request first, under the account's lock: the lift waits, then lands verification_required.
    const ended = await race(
      async (tx) => {
        await lockAccount(tx, w.studentId);
        await requests.openRequest(tx, {
          userId: w.studentId,
          adminId: admin,
          reason: 'بلاغ',
          at: new Date(),
        });
      },
      (tx) =>
        standing.keyedLift(tx, admin, {
          scope: 'students.liftBan',
          userId: w.studentId,
          reason: 'رفع',
          idempotencyKey: `lift-race-identity-${w.enrollmentId.slice(-12)}`,
        }),
    );
    expect(ended).toMatchObject({
      value: {
        move: {
          after: { accountStatus: 'verification_required' },
          // Not active: the restore's step 3 refuses until the request is accepted.
          enrollments: [
            { enrollmentId: w.enrollmentId, restored: false, cause: 'party_restricted' },
          ],
        },
      },
    });

    // The lift first: the request waits, then moves the active account.
    const v = await confirmedWorld();
    await banStudent(v.studentId);
    const second = await race(
      (tx) =>
        standing.keyedLift(tx, admin, {
          scope: 'students.liftBan',
          userId: v.studentId,
          reason: 'رفع',
          idempotencyKey: `lift-race-identity-${v.enrollmentId.slice(-12)}`,
        }),
      async (tx) => {
        await lockAccount(tx, v.studentId);
        await requests.openRequest(tx, {
          userId: v.studentId,
          adminId: admin,
          reason: 'بلاغ',
          at: new Date(),
        });
        return standing.requireIdentity(tx, v.studentId);
      },
    );
    expect(second).toEqual({ value: true });
    expect((await stateOf(v.studentId)).user.accountStatus).toBe('verification_required');
  });

  it('a lift against sessions.restore on the same enrollment: the restore waits, then is refused; sessions created once', async () => {
    const w = await confirmedWorld();
    await banStudent(w.studentId);
    const ended = await race(
      (tx) =>
        standing.keyedLift(tx, admin, {
          scope: 'students.liftBan',
          userId: w.studentId,
          reason: 'رفع',
          idempotencyKey: `lift-race-restore-${w.enrollmentId.slice(-12)}`,
        }),
      (tx) =>
        restoreCore.restore(tx, admin, {
          enrollmentId: w.enrollmentId,
          reason: 'استعادة',
          idempotencyKey: `restore-race-${w.enrollmentId.slice(-12)}`,
        }),
    );
    expect(codeOfThrown(ended as { thrown?: unknown })).toBe('not_restorable');
    expect((await stateOf(w.studentId)).enrollments[0]?._count.sessions).toBe(8);

    const v = await confirmedWorld();
    await banStudent(v.studentId);
    await Promise.allSettled([
      lift('students.liftBan', v.studentId),
      database.$transaction((tx: Transaction) =>
        restoreCore.restore(tx, admin, {
          enrollmentId: v.enrollmentId,
          reason: 'استعادة',
          idempotencyKey: `restore-race-${v.enrollmentId.slice(-12)}`,
        }),
      ),
    ]);
    const after = (await stateOf(v.studentId)).enrollments[0];
    expect(after?.status).toBe('confirmed');
    expect(after?._count.sessions).toBe(8);
  });
});
