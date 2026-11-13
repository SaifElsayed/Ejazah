// T071 of specs/004-sessions/tasks.md — a teacher's suspension pauses, over the real tables as the
// application role (FR-504; SRS FR-SESS-16 as amended; research R-313's table; the two notes under
// T071: Q5 (a) widened, Q5.2 (a), Q5.3 (a), Q6 (a), N2; contracts/kernel.md, the rows «a teacher's
// suspension, the pause», «an end of a paused enrollment» and «a teacher's reinstatement»). Every
// world is committed: accounts, a Thursday 09:00 Cairo slot and a four-session enrollment confirmed
// by the job; identity's `StandingService` with booking's subscriber bound as `main.ts` binds it, and
// sessions' `createTeacherReinstatement` handed in as the admin module hands it.
//
// - the pause, on each track, with a session in its join period: the enrollment kept `confirmed`
//   with no `enrollment_events` row, every remaining session `cancelled_by_admin` naming one
//   `teacher_suspended` case, the open remedy frozen; the completion held while the case is open;
//   the frozen remedy's offer postponed while the teacher is suspended (N2), and made once reinstated;
// - the reinstatement: each session the suspension cancelled offered (`awaiting_choice` on
//   recitation, `proposed` on the ijazah track), one `remedy_offered` row each, the case `resolved`,
//   `compensation_ordered`, the note `reinstated`, by the administrator; with no free week refused
//   `CONFLICT` `no_free_week`, nothing written, the teacher still suspended;
// - each covered end of a paused enrollment (P1 a teacher's ban, P2 a revocation, P3 the student's
//   ban, P6 a complaint decided (a), P7 a student's suspension case's fault confirmed) closes the
//   `teacher_suspended` case `resolved`, `compensation_ordered`, `ended_meanwhile`, covered by the
//   end's case, by the ending administrator, and the end case's `covers` holds the sessions the
//   suspension cancelled (U2); P5, the student's own deletion, leaves it open with one warn line;
// - `cases.resolve` and `cases.dismiss` refuse the case `CONFLICT` `closed_by_reinstatement`,
//   writing nothing.
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
  lockAccount,
  StandingService,
  standingStoreOver,
} from '../../apps/api/src/modules/identity/index.js';
import { orderStandingsOf } from '../../apps/api/src/modules/payments/index.js';
import {
  createCaseClosing,
  createCaseQueue,
  createComplaintDecision,
  createCompletion,
  createRemedyOffer,
  createSuspensionCase,
  createTeacherReinstatement,
} from '../../apps/api/src/modules/sessions/index.js';
import { openRequestOf } from '../../apps/api/src/modules/verification/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import { DomainError } from '../../apps/api/src/platform/errors/domain-error.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
import {
  confirmationWorld,
  NOW,
  settings as worldSettings,
  type World,
} from './confirmation-world';
import { connectAsApplication, type Db, makeAdmin } from './harness';

const SETTINGS: Record<string, number> = {
  dispute_window_hours: 72,
  makeup_choice_window_days: 7,
  makeup_counter_answer_hours: 72,
  first_session_lead_hours: 24,
  slot_release_buffer_weeks: 0,
  slot_hold_ttl_minutes: 10,
  slot_hold_grace_minutes: 5,
  admin_list_page_size: 50,
  repeated_absence_flag_count: 5,
};
const settings: SettingsReader = { read: async (key, schema) => schema.parse(SETTINGS[key]) };
/** The reinstatement's and the closings' clock: after the suspension, before the sessions' weeks. */
const AT = new Date('2026-11-04T08:00:00Z');
const NOTE = 'ملاحظة الإدارة';

/** The lines the subscriber, the offers and the reinstatement write, by level. */
const lines: { level: 'info' | 'warn'; fields: unknown; message: string }[] = [];
const log = {
  info: (fields: unknown, message: string) => void lines.push({ level: 'info', fields, message }),
  warn: (fields: unknown, message: string) => void lines.push({ level: 'warn', fields, message }),
} as never;

let database: Database;
let db: Db;
let admin: string;
let standing: StandingService;

const enrollments = createEnrollmentSide({ settings, now: () => AT });
const offers = createRemedyOffer({ enrollments, settings, clock: async () => AT, log });
const reinstatement = createTeacherReinstatement({ enrollments, offers, log });
const closing = createCaseClosing({
  log,
  suspension: createSuspensionCase({ enrollments, offers, log, clock: async () => AT }),
});
const queue = createCaseQueue({ enrollments, settings, log });
const completion = createCompletion({ enrollments, settings, clock: async () => AT });
const subscriber = terminationSubscriber({ orders: orderStandingsOf, now: () => NOW, log });

function standingWith(handedIn: typeof reinstatement): StandingService {
  const consequences = new AccountConsequences();
  consequences.subscribe(subscriber);
  return new StandingService({
    store: standingStoreOver(database),
    consequences,
    revokeSubjects,
    hasOpenIdentityRequest: async (tx, userId) => (await openRequestOf(tx, userId)) !== null,
    reinstatement: handedIn,
  });
}

beforeAll(async () => {
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 4,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  db = await connectAsApplication();
  admin = await makeAdmin(db);
  standing = standingWith(reinstatement);
});

afterAll(async () => {
  await db?.end();
  if (database !== undefined) await closeDatabase(database);
});

const { world, order } = confirmationWorld(() => database);

/** A confirmed four-session enrollment, its track as given. */
async function confirmedWorld(track: 'recitation' | 'ijazah_track' = 'recitation'): Promise<World> {
  const made = await world();
  // The roles onboarding writes (ADR 0016 D3), which the standing's moves read.
  await database.userRole.createMany({
    data: [
      { userId: made.studentId, role: 'student', status: 'active' },
      { userId: made.teacherId, role: 'teacher', status: 'active' },
    ],
  });
  if (track !== 'recitation') {
    await database.enrollment.update({
      where: { id: made.enrollmentId },
      data: { snapshotTrack: track },
    });
  }
  await confirmEnrollment({ database, settings: worldSettings, clock: () => NOW }).handle({
    paymentId: await order(made.enrollmentId),
  });
  return made;
}

async function sessionsOf(enrollmentId: string) {
  return database.session.findMany({
    where: { enrollmentId },
    orderBy: { sequenceNumber: 'asc' },
    select: { id: true, sequenceNumber: true, status: true },
  });
}

/** The second session moved inside its join period at NOW: started ten minutes before. */
async function secondInItsJoinPeriod(enrollmentId: string): Promise<string> {
  const { id } = await database.session.findFirstOrThrow({
    where: { enrollmentId, sequenceNumber: 2 },
    select: { id: true },
  });
  await database.session.update({
    where: { id },
    data: {
      scheduledDateLocal: new Date('2026-11-03T00:00:00Z'),
      scheduledStartTimeLocal: new Date('1970-01-01T09:50:00Z'),
      scheduledStartAt: new Date('2026-11-03T07:50:00Z'),
      scheduledEndAt: new Date('2026-11-03T08:50:00Z'),
    },
  });
  return id;
}

/**
 * The first session a past Teacher-No-Show (Thursday 2026-10-29, its dispute window closed by AT)
 * with an open remedy awaiting the student's choice; the remedy's id.
 */
async function firstOwedAnOpenRemedy(enrollmentId: string): Promise<{ sessionId: string; remedyId: string }> {
  const { id: sessionId } = await database.session.findFirstOrThrow({
    where: { enrollmentId, sequenceNumber: 1 },
    select: { id: true },
  });
  await database.session.update({
    where: { id: sessionId },
    data: {
      status: 'teacher_no_show',
      scheduledDateLocal: new Date('2026-10-29T00:00:00Z'),
      scheduledStartAt: new Date('2026-10-29T07:00:00Z'),
      scheduledEndAt: new Date('2026-10-29T08:00:00Z'),
    },
  });
  const { id: remedyId } = await database.sessionRemedy.create({
    data: {
      sessionId,
      kind: 'makeup',
      status: 'awaiting_choice',
      offeredAt: new Date('2026-11-01T08:00:00Z'),
      choiceClosesAt: new Date('2026-11-08T08:00:00Z'),
      snapshotAnswerWindowHours: 72,
      snapshotFirstSessionLeadHours: 24,
    },
    select: { id: true },
  });
  return { sessionId, remedyId };
}

async function caseOf(enrollmentId: string, reason: string) {
  return database.dispute.findFirstOrThrow({
    where: { enrollmentId, kind: 'compensation_case', reason },
    orderBy: { id: 'desc' },
    select: {
      id: true,
      status: true,
      resolution: true,
      resolutionNotes: true,
      resolvedByAdminId: true,
      coveredByCaseId: true,
    },
  });
}

async function accountStatusOf(userId: string): Promise<string> {
  const { accountStatus } = await database.user.findUniqueOrThrow({
    where: { id: userId },
    select: { accountStatus: true },
  });
  return accountStatus;
}

async function enrollmentStatusOf(enrollmentId: string): Promise<string> {
  const { status } = await database.enrollment.findUniqueOrThrow({
    where: { id: enrollmentId },
    select: { status: true },
  });
  return status;
}

function suspendTeacher(on: World) {
  return database.$transaction((tx) => standing.suspend(tx, admin, on.teacherId));
}

function reinstateTeacher(on: World, over: StandingService = standing) {
  return database.$transaction((tx) => over.reinstate(tx, admin, on.teacherId));
}

async function refusalOf(call: Promise<unknown>): Promise<DomainError> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(thrown instanceof DomainError)) throw new Error(`expected a DomainError, got ${String(thrown)}`);
  return thrown;
}

/** Everything a refused write could have touched on the enrollment. */
async function snapshotOf(on: World) {
  return {
    teacher: await accountStatusOf(on.teacherId),
    enrollment: await enrollmentStatusOf(on.enrollmentId),
    disputes: await database.dispute.findMany({
      where: { enrollmentId: on.enrollmentId },
      orderBy: { id: 'asc' },
      select: { id: true, status: true, resolution: true, resolvedAt: true, coveredByCaseId: true },
    }),
    remedies: await database.sessionRemedy.findMany({
      where: { session: { enrollmentId: on.enrollmentId } },
      orderBy: { id: 'asc' },
      select: { id: true, status: true, offeredAt: true },
    }),
    sessionEvents: await database.sessionEvent.count({ where: { enrollmentId: on.enrollmentId } }),
    enrollmentEvents: await database.enrollmentEvent.count({
      where: { enrollmentId: on.enrollmentId },
    }),
  };
}

const ENDED_MEANWHILE = (coveredBy: string) => ({
  status: 'resolved',
  resolution: 'compensation_ordered',
  resolutionNotes: 'ended_meanwhile',
  resolvedByAdminId: admin,
  coveredByCaseId: coveredBy,
});

describe('the pause (T071, FR-504)', () => {
  it.each(['recitation', 'ijazah_track'] as const)(
    'on %s keeps the enrollment confirmed, cancels every remaining session, one in its join period included, naming one teacher_suspended case, and freezes the open remedy',
    async (track) => {
      const on = await confirmedWorld(track);
      const owed = await firstOwedAnOpenRemedy(on.enrollmentId);
      const joining = await secondInItsJoinPeriod(on.enrollmentId);
      await suspendTeacher(on);

      expect(await accountStatusOf(on.teacherId)).toBe('suspended');
      expect(await enrollmentStatusOf(on.enrollmentId)).toBe('confirmed');
      expect(
        (
          await database.enrollmentEvent.findMany({
            where: { enrollmentId: on.enrollmentId },
            select: { kind: true },
          })
        ).map(({ kind }) => kind),
      ).toEqual(['confirmed']);
      const paused = await caseOf(on.enrollmentId, 'teacher_suspended');
      expect(paused.status).toBe('open');
      const sessions = await sessionsOf(on.enrollmentId);
      expect(sessions.map(({ status }) => status)).toEqual([
        'teacher_no_show',
        'cancelled_by_admin',
        'cancelled_by_admin',
        'cancelled_by_admin',
      ]);
      expect(sessions.find(({ id }) => id === joining)?.status).toBe('cancelled_by_admin');
      const cancelled = await database.sessionEvent.findMany({
        where: { enrollmentId: on.enrollmentId, kind: 'cancelled_by_admin' },
        select: { caseId: true },
      });
      expect(cancelled).toHaveLength(3);
      expect(cancelled.every(({ caseId }) => caseId === paused.id)).toBe(true);
      expect(
        await database.sessionRemedy.findUniqueOrThrow({
          where: { id: owed.remedyId },
          select: { status: true, caseId: true },
        }),
      ).toEqual({ status: 'frozen', caseId: null });
    },
  );

  it('holds the completion while the case is open', async () => {
    const on = await confirmedWorld();
    await suspendTeacher(on);
    // Every session cancelled, nothing owed: only the case holds it.
    expect(
      await database.$transaction(async (tx) => {
        await enrollments.lockEnrollments(tx, [on.enrollmentId]);
        return completion.completeIfDue(tx, on.enrollmentId);
      }),
    ).toBe(false);
    expect(await enrollmentStatusOf(on.enrollmentId)).toBe('confirmed');
  });

  it('postpones the frozen remedy’s offer while the teacher is suspended, and makes it once reinstated (N2)', async () => {
    const on = await confirmedWorld();
    const owed = await firstOwedAnOpenRemedy(on.enrollmentId);
    await suspendTeacher(on);
    expect(await database.$transaction((tx) => offers.offer(tx, owed.sessionId))).toBeNull();
    expect(
      (await database.sessionRemedy.findUniqueOrThrow({ where: { id: owed.remedyId } })).status,
    ).toBe('frozen');
    await reinstateTeacher(on);
    expect(await database.$transaction((tx) => offers.offer(tx, owed.sessionId))).toMatchObject({
      remedyId: owed.remedyId,
      reoffered: true,
    });
  });
});

describe('the reinstatement (T071, FR-504; Q6 (a))', () => {
  it.each([
    ['recitation', 'awaiting_choice'],
    ['ijazah_track', 'proposed'],
  ] as const)(
    'on %s offers each session the suspension cancelled %s and closes the case reinstated',
    async (track, status) => {
      const on = await confirmedWorld(track);
      await suspendTeacher(on);
      const paused = await caseOf(on.enrollmentId, 'teacher_suspended');

      expect(await reinstateTeacher(on)).toEqual({
        before: { accountStatus: 'suspended' },
        after: { accountStatus: 'active' },
      });

      const remedies = await database.sessionRemedy.findMany({
        where: { session: { enrollmentId: on.enrollmentId } },
        select: { status: true, offeredAt: true, proposedDate: true },
      });
      expect(remedies).toHaveLength(4);
      expect(remedies.every((remedy) => remedy.status === status)).toBe(true);
      expect(remedies.every(({ offeredAt }) => offeredAt.getTime() === AT.getTime())).toBe(true);
      expect(new Set(remedies.map(({ proposedDate }) => proposedDate?.toISOString())).size).toBe(4);
      expect(
        await database.sessionEvent.count({
          where: { enrollmentId: on.enrollmentId, kind: 'remedy_offered' },
        }),
      ).toBe(4);
      expect(await caseOf(on.enrollmentId, 'teacher_suspended')).toEqual({
        id: paused.id,
        status: 'resolved',
        resolution: 'compensation_ordered',
        resolutionNotes: 'reinstated',
        resolvedByAdminId: admin,
        coveredByCaseId: null,
      });
      expect(await enrollmentStatusOf(on.enrollmentId)).toBe('confirmed');
    },
  );

  it('with no free week refuses CONFLICT no_free_week and writes nothing, the teacher still suspended', async () => {
    const on = await confirmedWorld();
    await suspendTeacher(on);
    const before = await snapshotOf(on);
    const noWeek = standingWith(
      createTeacherReinstatement({
        enrollments,
        // T028's guard answering null for every session: no free week.
        offers: { offerLocked: async () => null },
        log,
      }),
    );
    const refused = await refusalOf(reinstateTeacher(on, noWeek));
    expect(refused.code).toBe('CONFLICT');
    expect(refused.details).toEqual([{ path: 'cause', code: 'no_free_week' }]);
    expect(await snapshotOf(on)).toEqual(before);
    expect(before.teacher).toBe('suspended');
  });
});

describe('an end of a paused enrollment closes its teacher_suspended case (T071, Q5 (a) widened)', () => {
  /** The pause, its case and the sessions it cancelled. */
  async function pausedWorld() {
    const on = await confirmedWorld();
    await suspendTeacher(on);
    const paused = await caseOf(on.enrollmentId, 'teacher_suspended');
    const cancelled = (await sessionsOf(on.enrollmentId)).map(({ id }) => id);
    return { on, paused, cancelled };
  }

  /** The end case's `covers`, by session id (T035's `cases.get`). */
  async function coversOf(caseId: string): Promise<string[]> {
    const detail = await database.$transaction((tx) => queue.get(tx, admin, { caseId }));
    return detail.covers.map(({ sessionId }) => sessionId);
  }

  it.each([
    ['P1 a teacher’s ban', 'ban'],
    ['P2 a revocation', 'revokeApproval'],
  ] as const)('%s: covered by the teacher_ended case, whose covers hold the paused sessions', async (_, action) => {
    const { on, paused, cancelled } = await pausedWorld();
    await database.$transaction((tx) =>
      action === 'ban'
        ? standing.ban(tx, admin, on.teacherId)
        : standing.revokeApproval(tx, admin, on.teacherId, 'Probe revocation'),
    );
    expect(await enrollmentStatusOf(on.enrollmentId)).toBe('cancelled');
    const end = await caseOf(on.enrollmentId, 'teacher_ended');
    expect(end.status).toBe('open');
    expect(await caseOf(on.enrollmentId, 'teacher_suspended')).toEqual({
      id: paused.id,
      ...ENDED_MEANWHILE(end.id),
    });
    // A ban during the suspension: the end case owes the paused sessions once (U2); the lift that
    // restores them is T072's.
    expect(await coversOf(end.id)).toEqual(cancelled);
  });

  it('P3 the student’s ban: covered by the student_banned case', async () => {
    const { on, paused, cancelled } = await pausedWorld();
    await database.$transaction((tx) => standing.banStudent(tx, admin, on.studentId));
    const end = await caseOf(on.enrollmentId, 'student_banned');
    expect(await caseOf(on.enrollmentId, 'teacher_suspended')).toEqual({
      id: paused.id,
      ...ENDED_MEANWHILE(end.id),
    });
    expect(await coversOf(end.id)).toEqual(cancelled);
  });

  it('P6 a complaint decided (a): covered by the absence_termination case', async () => {
    const on = await confirmedWorld();
    const { id: complaintId } = await database.dispute.create({
      data: {
        enrollmentId: on.enrollmentId,
        kind: 'absence_complaint',
        reason: 'غاب المعلم',
        status: 'open',
        raisedByUserId: on.studentId,
      },
      select: { id: true },
    });
    await suspendTeacher(on);
    const paused = await caseOf(on.enrollmentId, 'teacher_suspended');
    const cancelled = (await sessionsOf(on.enrollmentId)).map(({ id }) => id);
    const decided = await database.$transaction((tx: Transaction) =>
      createComplaintDecision({
        enrollments,
        standing,
        lockActiveHolds: lockActiveHoldsOf,
        log,
        clock: async () => AT,
      }).decideComplaint(tx, admin, { caseId: complaintId, decision: 'end_enrollment', note: NOTE }),
    );
    expect(decided).toMatchObject({ enrollmentStatus: 'terminated_no_show' });
    expect(await caseOf(on.enrollmentId, 'teacher_suspended')).toEqual({
      id: paused.id,
      ...ENDED_MEANWHILE(decided.newCaseId ?? ''),
    });
    expect(await coversOf(decided.newCaseId ?? '')).toEqual(cancelled);
  });

  it('P7 a student’s suspension case’s fault confirmed: covered by the student_fault_confirmed case', async () => {
    const { on, paused, cancelled } = await pausedWorld();
    // A student's suspension of a paused enrollment ends nothing: a second case opens.
    await database.$transaction((tx) => standing.suspendStudent(tx, admin, on.studentId));
    const studentCase = await caseOf(on.enrollmentId, 'student_suspended');
    expect(await enrollmentStatusOf(on.enrollmentId)).toBe('confirmed');
    expect((await caseOf(on.enrollmentId, 'teacher_suspended')).status).toBe('open');

    await database.$transaction((tx: Transaction) =>
      closing.dismiss(tx, admin, { caseId: studentCase.id, note: NOTE }),
    );
    expect(await enrollmentStatusOf(on.enrollmentId)).toBe('cancelled');
    const fault = await caseOf(on.enrollmentId, 'student_fault_confirmed');
    expect(await caseOf(on.enrollmentId, 'teacher_suspended')).toEqual({
      id: paused.id,
      ...ENDED_MEANWHILE(fault.id),
    });
    expect(await coversOf(fault.id)).toEqual(cancelled);
  });

  it('P5 the student’s own deletion leaves it open with one warn line of ids (Q5.3 (a))', async () => {
    const { on, paused } = await pausedWorld();
    lines.length = 0;
    // The deletion's consequence, as `DeletionService` calls it: the account's lock held, no actor.
    await database.$transaction(async (tx) => {
      await lockAccount(tx, on.studentId);
      await subscriber(tx, on.studentId, 'account_deleted');
    });
    expect(await enrollmentStatusOf(on.enrollmentId)).toBe('cancelled');
    expect((await caseOf(on.enrollmentId, 'teacher_suspended')).status).toBe('open');
    expect(lines.filter(({ level }) => level === 'warn')).toEqual([
      {
        level: 'warn',
        fields: {
          userId: on.studentId,
          cause: 'account_deleted',
          enrollmentId: on.enrollmentId,
          caseId: paused.id,
          coveredByCaseId: null,
        },
        message: 'A paused enrollment ended with no administrator: its teacher_suspended case is left open',
      },
    ]);
  });
});

describe('cases.resolve and cases.dismiss refuse a teacher_suspended case (T071)', () => {
  it.each(['resolve', 'dismiss'] as const)(
    '%s refuses it CONFLICT closed_by_reinstatement, writing nothing',
    async (close) => {
      const on = await confirmedWorld();
      await suspendTeacher(on);
      const paused = await caseOf(on.enrollmentId, 'teacher_suspended');
      const before = await snapshotOf(on);
      const refused = await refusalOf(
        database.$transaction((tx: Transaction) =>
          closing[close](tx, admin, { caseId: paused.id, note: NOTE }),
        ),
      );
      expect(refused.code).toBe('CONFLICT');
      expect(refused.details).toEqual([{ path: 'cause', code: 'closed_by_reinstatement' }]);
      expect(await snapshotOf(on)).toEqual(before);
    },
  );
});
