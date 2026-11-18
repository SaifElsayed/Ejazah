// T015 of specs/005-certification — the fraud ban over the real tables as the application role
// (FR-617; SRS FR-GENDER-6; research R-409; the note under T015, Q-G5 (b)), on committed worlds:
//
// - a student's and a teacher's: the declared gender written the other one, then the ban by role with
//   its own closings and reasons (`student_banned`, `teacher_ended`), the flag `fraud_ban`;
// - an applicant's, with the note the applicant sees;
// - the ban's lift (`students.liftBan`, `teachers.liftBan`) leaves each pairing the corrected genders
//   forbid ended, `gender_mismatch` (DEC-69): red first under the mutant «the gender not written»,
//   with which `ban-lift.service.ts:250-260` passes vacuously and the enrollment is restored.
//
// THE FRAUD BAN HERE. R-API-3 and R-API-4 keep this file from importing the admin module, so
// `fraudBanAsComposed` takes the admin composition's calls, in the order
// `admin/gender-fraud-ban.service.spec.ts` pins for `gender-decisions.service.ts`, from the owners'
// entries (`ban-lift.spec.ts`'s «as the admin module binds it»). The mutant is applied to the
// composition's own setter step: `setDeclaredGender`, skipped.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { confirmEnrollment } from '../../apps/api/src/jobs/confirm-enrollment';
import {
  createEnrollmentSide,
  terminationSubscriber,
} from '../../apps/api/src/modules/booking/index.js';
import {
  credentialsOfTeachers,
  grantSubjects,
  revokeSubjects,
} from '../../apps/api/src/modules/catalog/index.js';
import { createPartyRerender } from '../../apps/api/src/modules/certification/index.js';
import {
  AccountConsequences,
  declaredGenderOf,
  lockAccount,
  readStanding,
  setDeclaredGender,
  StandingService,
  standingStoreOver,
} from '../../apps/api/src/modules/identity/index.js';
import { genderFlagStore } from '../../apps/api/src/modules/moderation/index.js';
import { orderStandingsOf, refundedOf } from '../../apps/api/src/modules/payments/index.js';
import {
  createBanLift,
  createRemedyOffer,
  createRestore,
} from '../../apps/api/src/modules/sessions/index.js';
import { openRequestOf } from '../../apps/api/src/modules/verification/index.js';
import { clockTimestamp } from '../../apps/api/src/platform/db/db-clock.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import { IdempotencyRepository } from '../../apps/api/src/platform/idempotency/idempotency.repository.js';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service.js';
import { bindToTransaction, RequestLive } from '../../apps/api/src/platform/live/live-publisher.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
import {
  confirmationWorld,
  NOW,
  settings as worldSettings,
  type World,
} from './confirmation-world';
import { connectAsApplication, type Db, makeAdmin } from './harness';

// 005:T016 (rule d): the payment and cancellation pushes' port, which records nothing here.
const NO_PUSH = { record: async () => undefined };

type Gender = 'male' | 'female';

const SETTINGS: Record<string, number> = {
  admin_list_page_size: 50,
  dispute_window_hours: 72,
  makeup_choice_window_days: 7,
  makeup_counter_answer_hours: 72,
  first_session_lead_hours: 24,
  slot_release_buffer_weeks: 0,
  enrollment_restore_window_days: 14,
  ban_restore_window_days: 14,
  idempotency_key_ttl_hours: 24,
};
const settings: SettingsReader = { read: async (key, schema) => schema.parse(SETTINGS[key]) };
const SILENT = { info: () => undefined, warn: () => undefined };
const REASON = 'ثبت تزوير الجنس المعلن';
const NOTE = 'رُفض طلبك لمخالفة الشروط';
const OPTIONS = { maxWait: 5_000, timeout: 30_000 };

let database: Database;
let db: Db;
let admin: string;
let standing: StandingService;

const enrollments = createEnrollmentSide({ settings, now: () => new Date() });
const rerender = createPartyRerender({ renders: { enqueue: async () => undefined }, log: SILENT });

beforeAll(async () => {
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 6,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  db = await connectAsApplication();
  admin = await makeAdmin(db);
  const idempotency = new IdempotencyService<Transaction>({
    store: new IdempotencyRepository(database),
    settings,
  });
  const restore = createRestore({
    enrollments,
    idempotency,
    offers: createRemedyOffer({ enrollments, settings, log: SILENT }),
    settings,
    log: SILENT,
    payments: { refundedOf },
  });
  const banLift = createBanLift({ enrollments, restore, settings, log: SILENT });
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
  await db?.end();
  if (database !== undefined) await closeDatabase(database);
});

const { world, order } = confirmationWorld(() => database);

const other = (gender: Gender): Gender => (gender === 'male' ? 'female' : 'male');

/**
 * The admin composition's fraud ban, in its pinned order, from the owners' entries (this file's
 * head): the flag, the person's lock, the standing, the claim, the gender, the ban by role, the
 * re-render.
 */
async function fraudBanAsComposed(tx: Transaction, flagId: string, applicantNote?: string) {
  const seen = await genderFlagStore.flagOf(tx, flagId);
  if (seen === null) throw new Error('no flag');
  const person = seen.flaggedUserId;
  await lockAccount(tx, person);
  const read = await readStanding(tx, person);
  if (read === null) throw new Error('no person');
  const { teacher } = read;
  const role =
    teacher === null
      ? 'student'
      : teacher.verificationStatus === 'approved' || teacher.verificationStatus === 'revoked'
        ? 'teacher'
        : 'applicant';
  const at = await clockTimestamp(tx);
  if (
    !(await genderFlagStore.resolve(tx, {
      flagId,
      outcome: 'fraud_ban',
      note: REASON,
      adminId: admin,
      at,
    }))
  ) {
    throw new Error('already resolved');
  }
  const from = await declaredGenderOf(tx, person);
  if (from === null) throw new Error('no person');
  await setDeclaredGender(tx, person, from, other(from));
  if (role === 'student') await standing.banStudent(tx, admin, person);
  else if (role === 'teacher') await standing.ban(tx, admin, person);
  else await standing.ban(tx, admin, person, { applicantNote: applicantNote ?? '' });
  await rerender.rerenderOfParty(tx, person);
}

async function fraudBan(flaggedUserId: string, applicantNote?: string): Promise<string> {
  const { id: flagId } = await database.genderFlag.create({
    data: { flaggedUserId, raisedByUserId: null, reason: 'بلاغ', status: 'open' },
    select: { id: true },
  });
  const list = new RequestLive({ publish: () => undefined }, SILENT);
  await database.$transaction(async (tx) => {
    const unbind = bindToTransaction(tx, list);
    try {
      await fraudBanAsComposed(tx, flagId, applicantNote);
    } finally {
      unbind();
    }
  }, OPTIONS);
  list.flush();
  return flagId;
}

/** A four-session enrollment of `gender` confirmed by the job, both parties' roles active. */
async function confirmedWorld(gender: Gender): Promise<World> {
  const made = await world({ gender });
  await database.userRole.createMany({
    data: [
      { userId: made.studentId, role: 'student', status: 'active' },
      { userId: made.teacherId, role: 'teacher', status: 'active' },
    ],
    skipDuplicates: true,
  });
  await confirmEnrollment({ database, settings: worldSettings, notices: NO_PUSH, clock: () => NOW }).handle({
    paymentId: await order(made.enrollmentId),
  });
  return made;
}

function lift(scope: 'students.liftBan' | 'teachers.liftBan', userId: string) {
  return database.$transaction(
    (tx: Transaction) =>
      standing.keyedLift(tx, admin, {
        scope,
        userId,
        reason: 'رفع',
        idempotencyKey: `lift-${randomUUID()}`,
      }),
    OPTIONS,
  );
}

async function stateOf(userId: string, enrollmentId: string) {
  const [user, enrollment, cases] = await Promise.all([
    database.user.findUniqueOrThrow({
      where: { id: userId },
      select: { gender: true, accountStatus: true },
    }),
    database.enrollment.findUniqueOrThrow({
      where: { id: enrollmentId },
      select: { status: true, cancellationReason: true },
    }),
    database.dispute.findMany({
      where: { enrollmentId },
      orderBy: { id: 'asc' },
      select: { reason: true, status: true },
    }),
  ]);
  return { user, enrollment, cases };
}

describe('the fraud ban over the real tables (FR-617, FR-GENDER-6)', () => {
  it.each(['female', 'male'] as const)(
    'a %s student: the gender corrected, banned, the enrollment ended with the ban’s own case',
    async (gender) => {
      const made = await confirmedWorld(gender);
      const flagId = await fraudBan(made.studentId);
      expect(await stateOf(made.studentId, made.enrollmentId)).toEqual({
        user: { gender: other(gender), accountStatus: 'banned' },
        enrollment: { status: 'cancelled', cancellationReason: 'admin' },
        cases: [{ reason: 'student_banned', status: 'open' }],
      });
      expect(
        await database.genderFlag.findUniqueOrThrow({
          where: { id: flagId },
          select: { status: true, resolutionNotes: true },
        }),
      ).toEqual({ status: 'fraud_ban', resolutionNotes: REASON });
    },
  );

  it('an approved teacher: the teacher’s ban, teacher_ended', async () => {
    const made = await confirmedWorld('female');
    await fraudBan(made.teacherId);
    expect(await stateOf(made.teacherId, made.enrollmentId)).toEqual({
      user: { gender: 'male', accountStatus: 'banned' },
      enrollment: { status: 'cancelled', cancellationReason: 'teacher_suspended' },
      cases: [{ reason: 'teacher_ended', status: 'open' }],
    });
  });

  it('an applicant: the ban with the note the applicant sees', async () => {
    const made = await world({ gender: 'male' });
    const applicant = made.studentId;
    await database.teacherProfile.create({
      data: {
        userId: applicant,
        bio: '',
        qualificationSummary: 'متقدم',
        verificationStatus: 'pending',
        applicationStatus: 'in_review',
      },
    });
    await fraudBan(applicant, NOTE);
    expect(
      await database.user.findUniqueOrThrow({
        where: { id: applicant },
        select: { gender: true, accountStatus: true },
      }),
    ).toEqual({ gender: 'female', accountStatus: 'banned' });
    expect(
      await database.teacherProfile.findUniqueOrThrow({
        where: { userId: applicant },
        select: { applicationStatus: true, applicationNote: true },
      }),
    ).toEqual({ applicationStatus: 'banned', applicationNote: NOTE });
  });
});

describe('the lift checks each pairing against the corrected genders (DEC-69)', () => {
  it.each(['female', 'male'] as const)(
    'a %s student’s lift leaves the enrollment ended, gender_mismatch',
    async (gender) => {
      const made = await confirmedWorld(gender);
      await fraudBan(made.studentId);
      const { move } = await lift('students.liftBan', made.studentId);
      expect(move.enrollments).toEqual([
        { enrollmentId: made.enrollmentId, restored: false, cause: 'gender_mismatch' },
      ]);
      expect((await stateOf(made.studentId, made.enrollmentId)).enrollment).toEqual({
        status: 'cancelled',
        cancellationReason: 'admin',
      });
    },
  );

  it('a teacher’s lift leaves the enrollment ended, gender_mismatch', async () => {
    const made = await confirmedWorld('male');
    await fraudBan(made.teacherId);
    const { move } = await lift('teachers.liftBan', made.teacherId);
    expect(move.enrollments).toEqual([
      { enrollmentId: made.enrollmentId, restored: false, cause: 'gender_mismatch' },
    ]);
  });
});
