// T060 of specs/004-sessions/tasks.md — a student's complaint of the teacher's absence and an
// administrator's decision, over the real tables as the application role, through
// `sessions.complaint.raise`'s and `cases.decideComplaint`'s services as the surface calls them
// (FR-452, FR-453; SC-415; research R-322; contracts/kernel.md's three complaint rows). Every world
// is committed: accounts, a Thursday 09:00 Cairo slot and a four-session enrollment confirmed by the
// job; identity's `StandingService` with booking's subscriber bound as `main.ts` binds it.
//
// - SC-415: two complaints raised at once leave one open, the other answering COMPLAINT_OPEN with
//   the open one's id, one `complaint_raised` event; a third while it is open is refused the same;
// - (a) `end_enrollment`: the enrollment `terminated_no_show`, its remaining sessions
//   `cancelled_by_admin` naming the new `absence_termination` case, an open and a frozen remedy
//   handed to it, the complaint `resolved` `enrollment_ended`, one `complaint_decided` event; on an
//   enrollment no longer `confirmed`, refused CONFLICT with nothing written;
// - (b) `suspend_teacher`: the teacher suspended, the enrollment paused by the subscriber (T071,
//   FR-504: kept `confirmed`, a `teacher_suspended` case), the complaint `resolved` `party_suspended`;
// - (c) `close`: the complaint `dismissed` with the note, the enrollment `confirmed`, its sessions
//   untouched.
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
import { orderStandingsOf } from '../../apps/api/src/modules/payments/index.js';
import {
  createAbsenceComplaint,
  createComplaintDecision,
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
import { DomainError } from '../../apps/api/src/platform/errors/domain-error.js';
import { createLogger } from '../../apps/api/src/platform/logging/logger.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
import {
  confirmationWorld,
  NOW,
  settings as worldSettings,
  type World,
} from './confirmation-world';
import { connectAsApplication, type Db, makeAdmin } from './harness';

const SETTINGS: Record<string, number> = { admin_list_page_size: 50 };
const settings: SettingsReader = { read: async (key, schema) => schema.parse(SETTINGS[key]) };
/** The decision's clock: after the confirmation, before the sessions' Thursdays. */
const AT = new Date('2026-11-04T08:00:00Z');
const SILENT = { info: () => undefined, warn: () => undefined };
const log = createLogger({ level: 'fatal' });
const NOTE = 'ثبت غياب المعلم';

let database: Database;
let db: Db;
let admin: string;
let standing: StandingService;

const enrollments = createEnrollmentSide({ settings, now: () => AT });

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

/** A confirmed four-session enrollment. */
async function confirmedWorld(): Promise<World> {
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
  return made;
}

const complaints = () =>
  createAbsenceComplaint({ transactions: transactionsOver(database), enrollments });

const decisions = () =>
  createComplaintDecision({
    enrollments,
    standing,
    lockActiveHolds: lockActiveHoldsOf,
    log: SILENT,
    clock: async () => AT,
  });

function raise(made: World, reason = 'غاب المعلم عن الحصة') {
  return complaints().raise({ userId: made.studentId }, { enrollmentId: made.enrollmentId, reason }, log);
}

function decide(caseId: string, decision: 'end_enrollment' | 'suspend_teacher' | 'close') {
  return database.$transaction((tx: Transaction) =>
    decisions().decideComplaint(tx, admin, { caseId, decision, note: NOTE }),
  );
}

async function refusalOf(attempt: Promise<unknown>) {
  const thrown: unknown = await attempt.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(thrown instanceof DomainError)) throw new Error(`expected a refusal, got ${String(thrown)}`);
  return { code: thrown.code, details: thrown.details };
}

const disputesOf = (enrollmentId: string) =>
  database.dispute.findMany({
    where: { enrollmentId },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      kind: true,
      reason: true,
      status: true,
      resolution: true,
      resolutionNotes: true,
      raisedByUserId: true,
    },
  });

const eventsOf = (enrollmentId: string, kind: 'complaint_raised' | 'complaint_decided') =>
  database.sessionEvent.findMany({
    where: { enrollmentId, kind },
    select: { sessionId: true, caseId: true },
  });

const sessionsOf = (enrollmentId: string) =>
  database.session.findMany({
    where: { enrollmentId },
    orderBy: { sequenceNumber: 'asc' },
    select: { id: true, status: true },
  });

async function remedyOn(
  enrollmentId: string,
  sequenceNumber: number,
  status: 'awaiting_choice' | 'frozen',
): Promise<string> {
  const session = await database.session.findFirstOrThrow({
    where: { enrollmentId, sequenceNumber },
    select: { id: true },
  });
  await database.session.update({ where: { id: session.id }, data: { status: 'teacher_no_show' } });
  const { id } = await database.sessionRemedy.create({
    data: {
      sessionId: session.id,
      kind: 'makeup',
      status,
      offeredAt: new Date('2026-11-02T08:00:00Z'),
      choiceClosesAt: new Date('2026-11-09T08:00:00Z'),
      snapshotAnswerWindowHours: 72,
      snapshotFirstSessionLeadHours: 24,
      proposedDate: new Date('2026-12-10T00:00:00Z'),
    },
    select: { id: true },
  });
  return id;
}

describe('sessions.complaint.raise (FR-452, SC-415)', () => {
  it('leaves one complaint open when two are raised at once, the other refused COMPLAINT_OPEN with its id', async () => {
    const made = await confirmedWorld();
    const settled = await Promise.allSettled([raise(made), raise(made)]);
    const opened = settled.flatMap((one) => (one.status === 'fulfilled' ? [one.value] : []));
    const refused = settled.flatMap((one) => (one.status === 'rejected' ? [one.reason] : []));
    expect(opened).toHaveLength(1);
    expect(refused).toHaveLength(1);
    const [only] = await disputesOf(made.enrollmentId);
    expect(await disputesOf(made.enrollmentId)).toEqual([
      {
        id: opened[0]?.complaintId,
        kind: 'absence_complaint',
        reason: 'غاب المعلم عن الحصة',
        status: 'open',
        resolution: null,
        resolutionNotes: null,
        raisedByUserId: made.studentId,
      },
    ]);
    expect(refused[0]).toBeInstanceOf(DomainError);
    expect((refused[0] as DomainError).code).toBe('COMPLAINT_OPEN');
    expect((refused[0] as DomainError).details).toEqual([
      { path: 'complaintId', code: only?.id },
    ]);
    expect(await eventsOf(made.enrollmentId, 'complaint_raised')).toEqual([
      { sessionId: null, caseId: only?.id },
    ]);
    // A third, while it is open.
    expect(await refusalOf(raise(made))).toEqual({
      code: 'COMPLAINT_OPEN',
      details: [{ path: 'complaintId', code: only?.id }],
    });
    expect(await disputesOf(made.enrollmentId)).toHaveLength(1);
  });

  it('answers the enrollment’s teacher NOT_FOUND, writing nothing', async () => {
    const made = await confirmedWorld();
    expect(
      await refusalOf(
        complaints().raise(
          { userId: made.teacherId },
          { enrollmentId: made.enrollmentId, reason: 'x' },
          log,
        ),
      ),
    ).toEqual({ code: 'NOT_FOUND', details: undefined });
    expect(await disputesOf(made.enrollmentId)).toEqual([]);
  });
});

describe('cases.decideComplaint (FR-453, SC-415)', () => {
  it('(a) ends the enrollment: terminated_no_show, its sessions cancelled into the new absence_termination case with its open and frozen remedies, the complaint resolved enrollment_ended', async () => {
    const made = await confirmedWorld();
    const open = await remedyOn(made.enrollmentId, 1, 'awaiting_choice');
    const frozen = await remedyOn(made.enrollmentId, 2, 'frozen');
    const { complaintId } = await raise(made);
    const decided = await decide(complaintId, 'end_enrollment');
    const termination = await database.dispute.findFirstOrThrow({
      where: { enrollmentId: made.enrollmentId, reason: 'absence_termination' },
      select: { id: true, status: true },
    });
    expect(decided).toEqual({
      caseId: complaintId,
      status: 'resolved',
      enrollmentStatus: 'terminated_no_show',
      newCaseId: termination.id,
    });
    expect(termination.status).toBe('open');
    const enrollment = await database.enrollment.findUniqueOrThrow({
      where: { id: made.enrollmentId },
      select: { status: true },
    });
    expect(enrollment.status).toBe('terminated_no_show');
    const sessions = await sessionsOf(made.enrollmentId);
    expect(sessions.map(({ status }) => status)).toEqual([
      'teacher_no_show',
      'teacher_no_show',
      'cancelled_by_admin',
      'cancelled_by_admin',
    ]);
    const cancelled = await database.sessionEvent.findMany({
      where: { enrollmentId: made.enrollmentId, kind: 'cancelled_by_admin' },
      select: { caseId: true },
    });
    expect(cancelled).toEqual([{ caseId: termination.id }, { caseId: termination.id }]);
    const remedies = await database.sessionRemedy.findMany({
      where: { id: { in: [open, frozen] } },
      select: { status: true, caseId: true },
    });
    expect(remedies).toEqual([
      { status: 'refund_case', caseId: termination.id },
      { status: 'refund_case', caseId: termination.id },
    ]);
    const complaint = (await disputesOf(made.enrollmentId)).find(({ id }) => id === complaintId);
    expect(complaint).toMatchObject({
      status: 'resolved',
      resolution: 'enrollment_ended',
      resolutionNotes: NOTE,
    });
    expect(await eventsOf(made.enrollmentId, 'complaint_decided')).toEqual([
      { sessionId: null, caseId: complaintId },
    ]);
  });

  it('(a) refuses an enrollment no longer confirmed CONFLICT enrollment_not_confirmed, writing nothing', async () => {
    const made = await confirmedWorld();
    const { complaintId } = await raise(made);
    await database.enrollment.update({
      where: { id: made.enrollmentId },
      data: { status: 'completed' },
    });
    expect(await refusalOf(decide(complaintId, 'end_enrollment'))).toEqual({
      code: 'CONFLICT',
      details: [{ path: 'cause', code: 'enrollment_not_confirmed' }],
    });
    expect((await disputesOf(made.enrollmentId)).map(({ kind, status }) => [kind, status])).toEqual(
      [['absence_complaint', 'open']],
    );
    expect(await eventsOf(made.enrollmentId, 'complaint_decided')).toEqual([]);
    expect((await sessionsOf(made.enrollmentId)).every(({ status }) => status === 'scheduled')).toBe(
      true,
    );
  });

  // T071 of specs/004-sessions (rule d, an approved change; FR-504): the suspension pauses the
  // enrollment, kept `confirmed` with a `teacher_suspended` case, where it ended it before.
  it('(b) suspends the teacher, whose pause follows, and resolves the complaint party_suspended', async () => {
    const made = await confirmedWorld();
    const { complaintId } = await raise(made);
    expect(await decide(complaintId, 'suspend_teacher')).toEqual({
      caseId: complaintId,
      status: 'resolved',
      enrollmentStatus: 'confirmed',
    });
    const teacher = await database.user.findUniqueOrThrow({
      where: { id: made.teacherId },
      select: { accountStatus: true },
    });
    expect(teacher.accountStatus).toBe('suspended');
    const rows = await disputesOf(made.enrollmentId);
    expect(rows.find(({ id }) => id === complaintId)).toMatchObject({
      status: 'resolved',
      resolution: 'party_suspended',
    });
    expect(
      rows.some(({ reason, status }) => reason === 'teacher_suspended' && status === 'open'),
    ).toBe(true);
    expect(await eventsOf(made.enrollmentId, 'complaint_decided')).toHaveLength(1);
  });

  it('(c) dismisses the complaint with the note, nothing else changed', async () => {
    const made = await confirmedWorld();
    const { complaintId } = await raise(made);
    expect(await decide(complaintId, 'close')).toEqual({
      caseId: complaintId,
      status: 'dismissed',
      enrollmentStatus: 'confirmed',
    });
    expect(await disputesOf(made.enrollmentId)).toEqual([
      expect.objectContaining({ id: complaintId, status: 'dismissed', resolutionNotes: NOTE }),
    ]);
    expect((await sessionsOf(made.enrollmentId)).every(({ status }) => status === 'scheduled')).toBe(
      true,
    );
    // A new complaint may be raised once the first is closed.
    expect((await raise(made)).status).toBe('open');
  });
});
