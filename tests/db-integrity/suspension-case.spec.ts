// T036 of specs/004-sessions/tasks.md — a suspended student's case closed, over the real tables as
// the application role, through T035's `cases.resolve` and `cases.dismiss` services as the router
// calls them (FR-449, FR-462, FR-486; research R-312, R-313; contracts/kernel.md, the row «a
// `student_suspended` case closed»; the three B39 notes under T036). Every world is committed:
// accounts, a Thursday 09:00 Cairo slot and a four-session enrollment confirmed by the job; the
// student suspended, reinstated and banned through identity's `StandingService`, booking's
// subscriber bound to its registry as `main.ts` binds it.
//
// - quickstart.md §6, suspend, reinstate and resolve: every session the suspension cancelled is
//   offered in the resolve's transaction, `proposed` on either track (a make-up only, T111 of
//   specs/003-booking, DEC-84), one `remedy_offered` row each, the case `resolved` with its
//   closing; the enrollment does not complete while the case is open (T015), and would with it
//   closed;
// - refused `STUDENT_SUSPENDED` while the account is suspended, writing nothing; an account
//   `verification_required` passes (Q4 (b));
// - quickstart.md §6, suspend, reinstate, a make-up booked, and dismiss: the enrollment `cancelled`
//   `admin`, the make-up booked after the reinstatement `cancelled_by_admin` with the new
//   `student_fault_confirmed` case on its event, an open and a frozen remedy handed to the new case
//   and none to the dismissed one, the dismissed case closed; the new case's `covers` holds a
//   session owed and never offered and the make-up the suspension cancelled (U1), and none of the
//   ordinary sessions it cancelled;
// - on an enrollment a ban ended meanwhile, the resolve offers nothing and the sessions the
//   suspension cancelled join the `student_banned` case's `covers` (U2); on one a teacher's end
//   ended meanwhile, the dismissal cancels nothing and opens no case.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { confirmEnrollment } from '../../apps/api/src/jobs/confirm-enrollment';
import {
  addMinutes,
  addSeconds,
  dateColumnOf,
  type LocalDate,
  resolveLocalDateTime,
} from '../../packages/time/src/index.js';
import {
  createEnrollmentSide,
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
  createCaseClosing,
  createCaseQueue,
  createCompletion,
  createRemedyOffer,
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
import { DomainError } from '../../apps/api/src/platform/errors/domain-error.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
import {
  CAIRO,
  confirmationWorld,
  NOW,
  settings as worldSettings,
  THURSDAY_0900,
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
/** The resolve's clock: after the reinstatement, before the sessions' Thursdays. */
const AT = new Date('2026-11-04T08:00:00Z');
const SILENT = { info: () => undefined, warn: () => undefined };

let database: Database;
let db: Db;
let admin: string;
let standing: StandingService;

const enrollments = createEnrollmentSide({ settings, now: () => AT });
const offers = createRemedyOffer({ enrollments, settings, clock: async () => AT, log: SILENT });
const closing = createCaseClosing({
  log: SILENT,
  suspension: createSuspensionCase({ enrollments, offers, log: SILENT, clock: async () => AT }),
});
const queue = createCaseQueue({ enrollments, settings, log: SILENT });
const completion = createCompletion({ enrollments, settings, clock: async () => AT });

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

async function sessionNumbered(enrollmentId: string, sequenceNumber: number): Promise<string> {
  const { id } = await database.session.findFirstOrThrow({
    where: { enrollmentId, sequenceNumber },
    select: { id: true },
  });
  return id;
}

/** A remedy of the session in `status`, as an offer before the suspension left it. */
async function remedyFor(
  sessionId: string,
  status: 'awaiting_choice' | 'proposed' | 'booked',
): Promise<string> {
  const { id } = await database.sessionRemedy.create({
    data: {
      sessionId,
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

/** A make-up session of `madeUp`, scheduled on a later Thursday at 09:00 Cairo. */
async function makeupOf(
  on: World,
  madeUp: string,
  sequenceNumber: number,
  localDate: LocalDate,
): Promise<string> {
  const startsAt = new Date(
    resolveLocalDateTime({ localDate, localTime: '09:00:00', timezone: CAIRO }).startsAt,
  );
  const { id } = await database.session.create({
    data: {
      enrollmentId: on.enrollmentId,
      teacherUserId: on.teacherId,
      studentUserId: on.studentId,
      sequenceNumber,
      makeupForSessionId: madeUp,
      scheduledDateLocal: dateColumnOf(localDate),
      scheduledStartTimeLocal: THURSDAY_0900,
      timezone: CAIRO,
      scheduledStartAt: startsAt,
      scheduledEndAt: new Date(addMinutes(startsAt, 60)),
      status: 'scheduled',
    },
    select: { id: true },
  });
  return id;
}

async function setSession(
  sessionId: string,
  status: 'teacher_no_show' | 'both_no_show' | 'done',
): Promise<void> {
  await database.session.update({ where: { id: sessionId }, data: { status } });
}

async function suspensionCaseOf(enrollmentId: string): Promise<string> {
  const { id } = await database.dispute.findFirstOrThrow({
    where: { enrollmentId, kind: 'compensation_case', reason: 'student_suspended' },
    select: { id: true },
  });
  return id;
}

async function caseRow(caseId: string) {
  return database.dispute.findUniqueOrThrow({
    where: { id: caseId },
    select: {
      status: true,
      resolution: true,
      resolutionNotes: true,
      resolvedByAdminId: true,
      resolvedAt: true,
    },
  });
}

function suspend(studentId: string) {
  return database.$transaction((tx) => standing.suspendStudent(tx, admin, studentId));
}

function reinstate(studentId: string) {
  return database.$transaction((tx) => standing.reinstateStudent(tx, admin, studentId));
}

function resolve(caseId: string) {
  return database.$transaction((tx: Transaction) =>
    closing.resolve(tx, admin, { caseId, note: 'بُرّئ الطالب' }),
  );
}

function dismiss(caseId: string) {
  return database.$transaction((tx: Transaction) =>
    closing.dismiss(tx, admin, { caseId, note: 'ثبت الخطأ' }),
  );
}

async function codeOf(call: Promise<unknown>): Promise<string> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(thrown instanceof DomainError)) throw new Error('expected a DomainError');
  return thrown.code;
}

describe('cleared: suspend, reinstate and resolve (quickstart.md §6; FR-486; R-313)', () => {
  // T111 of specs/003-booking (DEC-84; FR-ADMIN-5 as amended): a cleared student is owed a make-up
  // only, on recitation too.
  it.each([
    ['recitation', 'proposed'],
    ['ijazah_track', 'proposed'],
  ] as const)(
    'on %s offers every session the suspension cancelled %s in the resolve’s transaction, and closes the case',
    async (track, status) => {
      const on = await confirmedWorld(track);
      await suspend(on.studentId);
      const caseId = await suspensionCaseOf(on.enrollmentId);
      const cancelled = await sessionsOf(on.enrollmentId);
      expect(cancelled.map((session) => session.status)).toEqual(
        Array.from({ length: 4 }, () => 'cancelled_by_admin'),
      );
      await reinstate(on.studentId);

      // T015: no completion while the case is open; with it closed nothing else would hold it.
      expect(await database.$transaction((tx) => completion.completeIfDue(tx, on.enrollmentId))).toBe(
        false,
      );
      expect(await completesOnceClosed(caseId, on.enrollmentId)).toBe(true);

      expect(await resolve(caseId)).toEqual({ caseId, status: 'resolved' });
      const remedies = await database.sessionRemedy.findMany({
        where: { session: { enrollmentId: on.enrollmentId } },
        orderBy: { sessionId: 'asc' },
        select: { sessionId: true, status: true, offeredAt: true, proposedDate: true },
      });
      expect(remedies.map(({ sessionId }) => sessionId)).toEqual(
        cancelled.map(({ id }) => id).sort(),
      );
      expect(remedies.every((remedy) => remedy.status === status)).toBe(true);
      expect(remedies.every(({ offeredAt }) => offeredAt.getTime() === AT.getTime())).toBe(true);
      // Each proposal on its own week (R-311: each after the latest the enrollment reaches).
      expect(new Set(remedies.map(({ proposedDate }) => proposedDate?.toISOString())).size).toBe(4);
      expect(
        await database.sessionEvent.count({
          where: { enrollmentId: on.enrollmentId, kind: 'remedy_offered' },
        }),
      ).toBe(4);
      expect(await caseRow(caseId)).toMatchObject({
        status: 'resolved',
        resolution: 'compensation_ordered',
        resolutionNotes: 'بُرّئ الطالب',
        resolvedByAdminId: admin,
      });
      expect((await caseRow(caseId)).resolvedAt).not.toBeNull();
    },
  );

  it('refuses STUDENT_SUSPENDED while the account is suspended, writing nothing; verification_required passes (Q4 (b))', async () => {
    const on = await confirmedWorld();
    await suspend(on.studentId);
    const caseId = await suspensionCaseOf(on.enrollmentId);
    expect(await codeOf(resolve(caseId))).toBe('STUDENT_SUSPENDED');
    expect(await caseRow(caseId)).toMatchObject({ status: 'open', resolvedAt: null });
    expect(
      await database.sessionRemedy.count({ where: { session: { enrollmentId: on.enrollmentId } } }),
    ).toBe(0);
    await database.user.update({
      where: { id: on.studentId },
      data: { accountStatus: 'verification_required' },
    });
    expect(await resolve(caseId)).toEqual({ caseId, status: 'resolved' });
  });

  it('on an enrollment a ban ended meanwhile offers nothing, and the sessions join the student_banned case’s covers (U2)', async () => {
    const on = await confirmedWorld();
    await suspend(on.studentId);
    const caseId = await suspensionCaseOf(on.enrollmentId);
    const cancelled = await sessionsOf(on.enrollmentId);
    await database.$transaction((tx) => standing.banStudent(tx, admin, on.studentId));
    expect((await database.enrollment.findUniqueOrThrow({ where: { id: on.enrollmentId } })).status).toBe(
      'cancelled',
    );
    expect(await resolve(caseId)).toEqual({ caseId, status: 'resolved' });
    expect(
      await database.sessionRemedy.count({ where: { session: { enrollmentId: on.enrollmentId } } }),
    ).toBe(0);
    const { id: banCase } = await database.dispute.findFirstOrThrow({
      where: { enrollmentId: on.enrollmentId, reason: 'student_banned' },
      select: { id: true },
    });
    const covers = await database.$transaction((tx) => queue.get(tx, admin, { caseId: banCase }));
    expect(covers.covers.map(({ sessionId }) => sessionId)).toEqual(cancelled.map(({ id }) => id));
  });

  it('the student_banned case covers them by the link, whatever its created_at says (PR #133’s Major 1, the owner’s (c))', async () => {
    const on = await confirmedWorld();
    await suspend(on.studentId);
    const caseId = await suspensionCaseOf(on.enrollmentId);
    const cancelled = await sessionsOf(on.enrollmentId);
    await database.$transaction((tx) => standing.banStudent(tx, admin, on.studentId));
    await resolve(caseId);
    const { id: banCase } = await database.dispute.findFirstOrThrow({
      where: { enrollmentId: on.enrollmentId, reason: 'student_banned' },
      select: { id: true },
    });
    // Saif's mutant as a world: the end case's opening read from an application clock a second ahead
    // of the database's, so after the suspension case's closing.
    const { resolvedAt } = await caseRow(caseId);
    await database.dispute.update({
      where: { id: banCase },
      data: { createdAt: new Date(addSeconds(resolvedAt!, 1)) },
    });
    const covers = await database.$transaction((tx) => queue.get(tx, admin, { caseId: banCase }));
    expect(covers.covers.map(({ sessionId }) => sessionId)).toEqual(cancelled.map(({ id }) => id));
  });
});

/** Whether completion would complete the enrollment with the case closed (rolled back). */
async function completesOnceClosed(caseId: string, enrollmentId: string): Promise<boolean> {
  const ROLLED_BACK = Symbol('rolled back');
  let completed = false;
  try {
    await database.$transaction(async (tx) => {
      await tx.dispute.update({
        where: { id: caseId },
        data: {
          status: 'dismissed',
          resolutionNotes: 'probe',
          resolvedByAdminId: admin,
          resolvedAt: AT,
        },
      });
      completed = await completion.completeIfDue(tx, enrollmentId);
      throw ROLLED_BACK;
    });
  } catch (thrown) {
    if (thrown !== ROLLED_BACK) throw thrown;
  }
  return completed;
}

describe('the fault confirmed: suspend, reinstate, a make-up booked, and dismiss (quickstart.md §6; R-313; C1)', () => {
  it('cancels the enrollment admin and its make-up, and hands an open and a frozen remedy to a new fault case', async () => {
    const on = await confirmedWorld();
    const [s1, s2, s3, s4] = await Promise.all(
      [1, 2, 3, 4].map((n) => sessionNumbered(on.enrollmentId, n)),
    );
    for (const id of [s1, s2, s3]) await setSession(id!, 'teacher_no_show');
    const frozen = await remedyFor(s1!, 'proposed');
    const reoffered = await remedyFor(s2!, 'awaiting_choice');
    const booked = await remedyFor(s3!, 'booked');
    await suspend(on.studentId);
    const caseId = await suspensionCaseOf(on.enrollmentId);
    await reinstate(on.studentId);
    // After the reinstatement: one frozen remedy offered again (as the sweep does), and a make-up
    // of another remedy booked.
    await database.sessionRemedy.update({ where: { id: reoffered }, data: { status: 'awaiting_choice' } });
    const makeup = await makeupOf(on, s3!, 5, '2026-12-03');

    expect(await dismiss(caseId)).toEqual({ caseId, status: 'dismissed' });

    expect(await database.enrollment.findUniqueOrThrow({ where: { id: on.enrollmentId } })).toMatchObject({
      status: 'cancelled',
      cancellationReason: 'admin',
    });
    const { id: faultCase } = await database.dispute.findFirstOrThrow({
      where: { enrollmentId: on.enrollmentId, reason: 'student_fault_confirmed', status: 'open' },
      select: { id: true },
    });
    expect((await database.session.findUniqueOrThrow({ where: { id: makeup } })).status).toBe(
      'cancelled_by_admin',
    );
    expect(
      await database.sessionEvent.findFirst({
        where: { sessionId: makeup, kind: 'cancelled_by_admin' },
        select: { caseId: true },
      }),
    ).toEqual({ caseId: faultCase });
    const remedies = await database.sessionRemedy.findMany({
      where: { id: { in: [frozen, reoffered, booked] } },
      select: { id: true, status: true, caseId: true },
    });
    expect(new Map(remedies.map(({ id, status, caseId: held }) => [id, [status, held]]))).toEqual(
      new Map([
        [frozen, ['refund_case', faultCase]],
        [reoffered, ['refund_case', faultCase]],
        [booked, ['booked', null]],
      ]),
    );
    expect(await caseRow(caseId)).toMatchObject({
      status: 'dismissed',
      resolution: null,
      resolutionNotes: 'ثبت الخطأ',
    });
    expect((await sessionsOf(on.enrollmentId)).find(({ id }) => id === s4)?.status).toBe(
      'cancelled_by_admin',
    );
    // None of them in the dismissed case's covers, which keeps the ordinary session its suspension
    // cancelled, owed nothing (the owner's decision of 2026-11-11 on lane B's questions, item 2).
    const dismissed = await database.$transaction((tx) => queue.get(tx, admin, { caseId }));
    expect(dismissed.covers.map(({ sessionId }) => sessionId)).toEqual([s4]);
  });

  it('the new case covers a session owed and never offered and the make-up the suspension cancelled, not the ordinary sessions (U1)', async () => {
    const on = await confirmedWorld();
    const [s1, s2, s3, s4] = await Promise.all(
      [1, 2, 3, 4].map((n) => sessionNumbered(on.enrollmentId, n)),
    );
    await setSession(s1!, 'teacher_no_show');
    await remedyFor(s1!, 'booked');
    const makeup = await makeupOf(on, s1!, 5, '2026-12-03');
    await setSession(s2!, 'both_no_show');
    await suspend(on.studentId);
    const caseId = await suspensionCaseOf(on.enrollmentId);
    await reinstate(on.studentId);
    await dismiss(caseId);
    const { id: faultCase } = await database.dispute.findFirstOrThrow({
      where: { enrollmentId: on.enrollmentId, reason: 'student_fault_confirmed' },
      select: { id: true },
    });
    const covers = await database.$transaction((tx) => queue.get(tx, admin, { caseId: faultCase }));
    expect(covers.covers.map(({ sessionId }) => sessionId)).toEqual([s2, makeup]);
    expect(covers.covers.map(({ sessionId }) => sessionId)).not.toContain(s3);
    expect(covers.covers.map(({ sessionId }) => sessionId)).not.toContain(s4);
    // The dismissed case keeps only the ordinary sessions its suspension cancelled (item 2, (c)).
    const dismissed = await database.$transaction((tx) => queue.get(tx, admin, { caseId }));
    expect(dismissed.covers.map(({ sessionId }) => sessionId)).toEqual([s3, s4]);
  });

  it('the new case covers the make-up by the link, whatever its created_at says (PR #133’s Major 1, the owner’s (c))', async () => {
    const on = await confirmedWorld();
    const [s1, s2] = await Promise.all([1, 2].map((n) => sessionNumbered(on.enrollmentId, n)));
    await setSession(s1!, 'teacher_no_show');
    await remedyFor(s1!, 'booked');
    const makeup = await makeupOf(on, s1!, 5, '2026-12-03');
    await setSession(s2!, 'both_no_show');
    await suspend(on.studentId);
    const caseId = await suspensionCaseOf(on.enrollmentId);
    await reinstate(on.studentId);
    await dismiss(caseId);
    const { id: faultCase } = await database.dispute.findFirstOrThrow({
      where: { enrollmentId: on.enrollmentId, reason: 'student_fault_confirmed' },
      select: { id: true },
    });
    // Saif's mutant as a world: the fault case's opening read from an application clock a second
    // ahead of the database's, so after the dismissed case's closing.
    const { resolvedAt } = await caseRow(caseId);
    await database.dispute.update({
      where: { id: faultCase },
      data: { createdAt: new Date(addSeconds(resolvedAt!, 1)) },
    });
    const covers = await database.$transaction((tx) => queue.get(tx, admin, { caseId: faultCase }));
    expect(covers.covers.map(({ sessionId }) => sessionId)).toEqual([s2, makeup]);
  });

  it('on an enrollment a teacher’s end ended meanwhile cancels nothing and opens no case (U2)', async () => {
    const on = await confirmedWorld();
    await suspend(on.studentId);
    const caseId = await suspensionCaseOf(on.enrollmentId);
    await reinstate(on.studentId);
    // T071 (rule d, an approved change): a teacher's suspension pauses now, so the teacher's end is
    // a ban, which still cancels the enrollment.
    await database.$transaction((tx) => standing.ban(tx, admin, on.teacherId));
    const before = await database.dispute.count({ where: { enrollmentId: on.enrollmentId } });
    const events = await database.enrollmentEvent.count({ where: { enrollmentId: on.enrollmentId } });
    expect(await dismiss(caseId)).toEqual({ caseId, status: 'dismissed' });
    expect(await database.dispute.count({ where: { enrollmentId: on.enrollmentId } })).toBe(before);
    expect(await database.enrollmentEvent.count({ where: { enrollmentId: on.enrollmentId } })).toBe(
      events,
    );
    expect(
      await database.dispute.count({
        where: { enrollmentId: on.enrollmentId, reason: 'student_fault_confirmed' },
      }),
    ).toBe(0);
    expect((await caseRow(caseId)).status).toBe('dismissed');
  });
});
