// PR #133's review, round 2, Minor and nit 4 (the follow-up under T036 of
// specs/004-sessions/tasks.md, placed in B40's lane D after T061 by the owner's decision of
// 2026-11-11, Q5 (a)): a cleared suspension case links only an end case opened after it. Over the
// real tables as the application role, through T060's complaint and decision, T061's restore and
// T036's clearing (`cases.resolve` on a `student_suspended` case).
//
// The scenario: a complaint decided (a) opens the `absence_termination` case; the restore closes it
// `dismissed` `restored`; the student is suspended (a `student_suspended` case) and reinstated; the
// enrollment completes while that case is open (no new end case); the case is then cleared. Before
// the fix, `endCaseOf` read the enrollment's latest end case with no bound and linked the
// suspension case to the old, closed `absence_termination` case (`covered_by_case_id`), so its
// sessions sat in that case's `covers`. Now it reads only an end case opened after the suspension
// case: none, so no link.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { confirmEnrollment } from '../../apps/api/src/jobs/confirm-enrollment';
import {
  createEnrollmentSide,
  lockActiveHoldsOf,
  terminationSubscriber,
} from '../../apps/api/src/modules/booking/index.js';
import { revokeSubjects } from '../../apps/api/src/modules/catalog/index.js';
import {
  AccountConsequences,
  StandingService,
  standingStoreOver,
} from '../../apps/api/src/modules/identity/index.js';
import { orderStandingsOf, refundedOf } from '../../apps/api/src/modules/payments/index.js';
import {
  createAbsenceComplaint,
  createCaseClosing,
  createComplaintDecision,
  createRemedyOffer,
  createRestore,
  createSuspensionCase,
} from '../../apps/api/src/modules/sessions/index.js';
import { openRequestOf } from '../../apps/api/src/modules/verification/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import { transactionsOver } from '../../apps/api/src/platform/db/transaction.repository.js';
import { IdempotencyRepository } from '../../apps/api/src/platform/idempotency/idempotency.repository.js';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service.js';
import { createLogger } from '../../apps/api/src/platform/logging/logger.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
import { confirmationWorld, NOW, settings as worldSettings } from './confirmation-world';
import { connectAsApplication, type Db, makeAdmin } from './harness';

const SETTINGS: Record<string, number> = {
  admin_list_page_size: 50,
  dispute_window_hours: 72,
  makeup_choice_window_days: 7,
  makeup_counter_answer_hours: 72,
  first_session_lead_hours: 24,
  enrollment_restore_window_days: 7,
  idempotency_key_ttl_hours: 24,
};
const settings: SettingsReader = { read: async (key, schema) => schema.parse(SETTINGS[key]) };
const DECIDED = new Date('2026-11-04T08:00:00Z');
const RESTORED = new Date('2026-11-10T08:00:00Z');
const SILENT = { info: () => undefined, warn: () => undefined };
const log = createLogger({ level: 'fatal' });

let database: Database;
let db: Db;
let admin: string;
let standing: StandingService;

const enrollments = createEnrollmentSide({ settings, now: () => RESTORED });
const offers = createRemedyOffer({
  enrollments,
  settings,
  clock: async () => RESTORED,
  log: SILENT,
});

beforeAll(async () => {
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 4,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  db = await connectAsApplication();
  admin = await makeAdmin(db);
  const consequences = new AccountConsequences();
  consequences.subscribe(
    terminationSubscriber({ orders: orderStandingsOf, now: () => NOW, log: SILENT }),
  );
  standing = new StandingService({
    store: standingStoreOver(database),
    consequences,
    revokeSubjects,
    hasOpenIdentityRequest: async (tx, userId) => (await openRequestOf(tx, userId)) !== null,
  });
});

afterAll(async () => {
  await db?.end();
  if (database !== undefined) await closeDatabase(database);
});

const { world, order } = confirmationWorld(() => database);

describe('a cleared suspension case links only an end case opened after it (PR #133, r2 Minor)', () => {
  it('after a complaint’s end, a restore, a suspension and a completion, the clearing links no case', async () => {
    const made = await world();
    await database.userRole.createMany({
      data: [
        { userId: made.studentId, role: 'student', status: 'active' },
        { userId: made.teacherId, role: 'teacher', status: 'active' },
      ],
    });
    await confirmEnrollment({ database, settings: worldSettings, clock: () => NOW }).handle({
      paymentId: await order(made.enrollmentId),
    });
    // A complaint decided (a): the `absence_termination` case.
    const { complaintId } = await createAbsenceComplaint({
      transactions: transactionsOver(database),
      enrollments,
    }).raise({ userId: made.studentId }, { enrollmentId: made.enrollmentId, reason: 'غاب' }, log);
    const decided = await database.$transaction((tx: Transaction) =>
      createComplaintDecision({
        enrollments,
        standing,
        lockActiveHolds: lockActiveHoldsOf,
        log: SILENT,
        clock: async () => DECIDED,
      }).decideComplaint(tx, admin, {
        caseId: complaintId,
        decision: 'end_enrollment',
        note: 'ثبت',
      }),
    );
    const endCase = decided.newCaseId;
    if (endCase === undefined) throw new Error('no termination case');
    await database.dispute.update({ where: { id: endCase }, data: { createdAt: DECIDED } });
    // The restore: that case closed `dismissed` `restored`.
    await database.$transaction((tx: Transaction) =>
      createRestore({
        enrollments,
        idempotency: new IdempotencyService({
          store: new IdempotencyRepository(database),
          settings,
        }),
        offers,
        settings,
        log: SILENT,
        clock: async () => RESTORED,
        payments: { refundedOf }, // T073 (rule d): the restore's new port
      }).restore(tx, admin, {
        enrollmentId: made.enrollmentId,
        reason: 'خطأ',
        idempotencyKey: `restore-${made.enrollmentId}`,
      }),
    );
    // The student suspended (its case) and reinstated.
    await database.$transaction((tx) => standing.suspendStudent(tx, admin, made.studentId));
    await database.$transaction((tx) => standing.reinstateStudent(tx, admin, made.studentId));
    const suspension = await database.dispute.findFirstOrThrow({
      where: { enrollmentId: made.enrollmentId, reason: 'student_suspended' },
      select: { id: true },
    });
    // The enrollment completed while that case is open: no new end case.
    await database.enrollment.update({
      where: { id: made.enrollmentId },
      data: { status: 'completed' },
    });
    // Cleared.
    await database.$transaction((tx: Transaction) =>
      createCaseClosing({
        log: SILENT,
        suspension: createSuspensionCase({
          enrollments,
          offers,
          log: SILENT,
          clock: async () => RESTORED,
        }),
      }).resolve(tx, admin, { caseId: suspension.id, note: 'بُرّئ الطالب' }),
    );
    const closed = await database.dispute.findUniqueOrThrow({
      where: { id: suspension.id },
      select: { status: true, coveredByCaseId: true },
    });
    expect(closed).toEqual({ status: 'resolved', coveredByCaseId: null });
  });
});
