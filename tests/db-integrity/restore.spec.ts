// T061 of specs/004-sessions/tasks.md — an administrator's restore over the real tables as the
// application role, through `sessions.restore`'s service on the transaction the administrator kind
// opens (FR-454, FR-455; SC-416; research R-322, «The restore»; contracts/kernel.md, the restore
// row). Every world is committed: a Thursday 09:00 Cairo slot and a four-session enrollment
// confirmed by the job, a complaint raised and decided (a) through T060's services.
//
// - the restore: `confirmed`, `cancellation_reason` NULL, `confirmed_at` untouched, one `restored`
//   event; the sessions still owed created after the last number from the first Thursday at least
//   24 h after the restore, a session the closing cancelled kept; the make-up the case held offered
//   again (`awaiting_choice`, `case_id` and `decided_at` cleared, one `remedy_offered` row with no
//   case); the case `dismissed` `restored`; a repeated key answering the first result, writing
//   nothing, and the same key with another input `CONFLICT`;
// - causes on real rows, each writing nothing: `case_closed`, `slot_changed`, `slot_inactive`;
// - SC-416: another student's hold on the slot and the restore, one winning and the other refused,
//   nothing half-written, in each order and raced at once.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { confirmEnrollment } from '../../apps/api/src/jobs/confirm-enrollment';
import {
  createEnrollmentSide,
  holdsStore,
  lockActiveHoldsOf,
  placeHold,
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
  createRemedyOffer,
  createRestore,
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
import type { RequesterGender } from '../../apps/api/src/platform/guards/requester-gender.js';
import { IdempotencyRepository } from '../../apps/api/src/platform/idempotency/idempotency.repository.js';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service.js';
import { createLogger } from '../../apps/api/src/platform/logging/logger.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
import {
  confirmationWorld,
  NOW,
  settings as worldSettings,
  type World,
} from './confirmation-world';
import { connectAsApplication, type Db, makeAdmin, makeUser } from './harness';

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
/** The decision: a Wednesday, the first Thursday (Nov 5) not yet held. */
const DECIDED = new Date('2026-11-04T08:00:00Z');
/** The restore: Tuesday Nov 10; the first Thursday at least 24 h after it is Nov 12. */
const RESTORED = new Date('2026-11-10T08:00:00Z');
const SILENT = { info: () => undefined, warn: () => undefined };
const log = createLogger({ level: 'fatal' });

let database: Database;
let db: Db;
let admin: string;
let standing: StandingService;

const enrollments = createEnrollmentSide({ settings, now: () => RESTORED });

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

/**
 * A confirmed four-session enrollment whose first session was a Teacher-No-Show with a make-up
 * remedy open, ended on a complaint (decision (a)) at `DECIDED`: sessions 2 to 4 cancelled, the
 * remedy handed to the `absence_termination` case.
 */
async function terminatedWorld(): Promise<
  World & { readonly caseId: string; readonly remedyId: string }
> {
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
  const first = await database.session.findFirstOrThrow({
    where: { enrollmentId: made.enrollmentId, sequenceNumber: 1 },
    select: { id: true },
  });
  await database.session.update({ where: { id: first.id }, data: { status: 'teacher_no_show' } });
  const { id: remedyId } = await database.sessionRemedy.create({
    data: {
      sessionId: first.id,
      kind: 'makeup',
      status: 'awaiting_choice',
      offeredAt: new Date('2026-11-03T08:00:00Z'),
      choiceClosesAt: new Date('2026-11-10T08:00:00Z'),
      snapshotAnswerWindowHours: 72,
      snapshotFirstSessionLeadHours: 24,
      proposedDate: new Date('2026-12-03T00:00:00Z'),
    },
    select: { id: true },
  });
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
    }).decideComplaint(tx, admin, { caseId: complaintId, decision: 'end_enrollment', note: 'ثبت' }),
  );
  if (decided.newCaseId === undefined) throw new Error('no termination case');
  // The case opened at the decision's instant, as the closing's own transaction writes it.
  await database.dispute.update({ where: { id: decided.newCaseId }, data: { createdAt: DECIDED } });
  return { ...made, caseId: decided.newCaseId, remedyId };
}

function restorer() {
  return createRestore({
    enrollments,
    idempotency: new IdempotencyService({ store: new IdempotencyRepository(database), settings }),
    offers: createRemedyOffer({ enrollments, settings, clock: async () => RESTORED, log: SILENT }),
    settings,
    log: SILENT,
    clock: async () => RESTORED,
  });
}

function restore(enrollmentId: string, key = `restore-${enrollmentId}`, reason = 'خطأ في القرار') {
  return database.$transaction((tx: Transaction) =>
    restorer().restore(tx, admin, { enrollmentId, reason, idempotencyKey: key }),
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

/** What a restore would change, read whole, so a refusal is seen to write nothing. */
async function stateOf(enrollmentId: string) {
  const [enrollment, sessions, remedies, cases, events] = await Promise.all([
    database.enrollment.findUniqueOrThrow({
      where: { id: enrollmentId },
      select: { status: true, cancellationReason: true, confirmedAt: true },
    }),
    database.session.findMany({
      where: { enrollmentId },
      orderBy: { sequenceNumber: 'asc' },
      select: { sequenceNumber: true, status: true, scheduledStartAt: true },
    }),
    database.sessionRemedy.findMany({
      where: { session: { enrollmentId } },
      select: { status: true, caseId: true, decidedAt: true, offeredAt: true },
    }),
    database.dispute.findMany({
      where: { enrollmentId, kind: 'compensation_case' },
      select: { reason: true, status: true, resolutionNotes: true },
    }),
    database.enrollmentEvent.count({ where: { enrollmentId } }),
  ]);
  return { enrollment, sessions, remedies, cases, events };
}

describe('sessions.restore (FR-455, SC-416)', () => {
  it('restores the enrollment, recreates the sessions still owed from the first week after the lead, offers the case’s make-up again and closes the case restored', async () => {
    const w = await terminatedWorld();
    const before = await stateOf(w.enrollmentId);
    const { answer, replayed } = await restore(w.enrollmentId);
    expect(replayed).toBe(false);
    // Owed: 4, less the Teacher-No-Show owed through the case's remedy: sessions 2 to 4 again.
    expect(answer).toMatchObject({
      enrollmentId: w.enrollmentId,
      status: 'confirmed',
      remediesOffered: 1,
      caseId: w.caseId,
    });
    expect(
      answer.sessionsCreated.map(({ sequenceNumber, localDate, startsAt }) => [
        sequenceNumber,
        localDate,
        startsAt,
      ]),
    ).toEqual([
      [5, '2026-11-12', '2026-11-12T07:00:00.000Z'],
      [6, '2026-11-19', '2026-11-19T07:00:00.000Z'],
      [7, '2026-11-26', '2026-11-26T07:00:00.000Z'],
    ]);
    const after = await stateOf(w.enrollmentId);
    expect(after.enrollment).toEqual({
      status: 'confirmed',
      cancellationReason: null,
      confirmedAt: before.enrollment.confirmedAt,
    });
    expect(after.sessions.map(({ sequenceNumber, status }) => [sequenceNumber, status])).toEqual([
      [1, 'teacher_no_show'],
      [2, 'cancelled_by_admin'],
      [3, 'cancelled_by_admin'],
      [4, 'cancelled_by_admin'],
      [5, 'scheduled'],
      [6, 'scheduled'],
      [7, 'scheduled'],
    ]);
    expect(after.remedies).toEqual([
      { status: 'awaiting_choice', caseId: null, decidedAt: null, offeredAt: RESTORED },
    ]);
    expect(after.cases).toEqual([
      { reason: 'absence_termination', status: 'dismissed', resolutionNotes: 'restored' },
    ]);
    const restoredEvents = await database.enrollmentEvent.findMany({
      where: { enrollmentId: w.enrollmentId, kind: 'restored' },
    });
    expect(restoredEvents).toHaveLength(1);
    const offered = await database.sessionEvent.findMany({
      where: { enrollmentId: w.enrollmentId, kind: 'remedy_offered' },
      select: { caseId: true },
    });
    expect(offered).toEqual([{ caseId: null }]);
    const remedy = await database.sessionRemedy.findUniqueOrThrow({
      where: { id: w.remedyId },
      select: { proposedDate: true },
    });
    // After the last recreated session (Nov 26) and past C + A + L from the restore.
    expect(remedy.proposedDate?.toISOString().slice(0, 10)).toBe('2026-12-03');
  });

  it('answers a repeated key the first result, writing nothing, and the same key with another input CONFLICT', async () => {
    const w = await terminatedWorld();
    const first = await restore(w.enrollmentId, 'restore-key-repeat-01');
    const state = await stateOf(w.enrollmentId);
    const again = await restore(w.enrollmentId, 'restore-key-repeat-01');
    expect(again).toEqual({ answer: first.answer, replayed: true });
    expect(await stateOf(w.enrollmentId)).toEqual(state);
    expect(await causeOf(restore(w.enrollmentId, 'restore-key-repeat-01', 'سبب آخر'))).toBe(
      'CONFLICT',
    );
  });

  it.each([
    [
      'case_closed',
      async (w: Awaited<ReturnType<typeof terminatedWorld>>) =>
        database.dispute.update({
          where: { id: w.caseId },
          data: {
            status: 'resolved',
            resolution: 'compensation_ordered',
            resolutionNotes: 'x',
            resolvedByAdminId: admin,
            resolvedAt: DECIDED,
          },
        }),
    ],
    [
      'slot_changed',
      async (w: Awaited<ReturnType<typeof terminatedWorld>>) =>
        database.availabilitySlot.update({
          where: { id: w.slotId },
          data: { startTimeLocal: new Date('1970-01-01T10:00:00Z') },
        }),
    ],
    [
      'slot_inactive',
      async (w: Awaited<ReturnType<typeof terminatedWorld>>) =>
        database.availabilitySlot.update({ where: { id: w.slotId }, data: { isActive: false } }),
    ],
  ])('refuses %s, writing nothing', async (cause, arrange) => {
    const w = await terminatedWorld();
    await arrange(w);
    const before = await stateOf(w.enrollmentId);
    expect(await causeOf(restore(w.enrollmentId))).toBe(cause);
    expect(await stateOf(w.enrollmentId)).toEqual(before);
  });
});

// The note under T061 (B40, settled by the review session on B39 Q5 (a)'s precedent, rule d): a
// make-up the closing's case held for which T028's offer finds no free week refuses the whole
// restore CONFLICT no_free_week, nothing written, the case open. The offer is narrowed to see the
// slot taken from December on, every week its search reads after the recreated sessions; the
// restore's own weeks (Nov 12 to 26) read the real tables.
describe('sessions.restore: no free week for a held remedy (the note under T061)', () => {
  it('answers CONFLICT no_free_week and writes nothing: the enrollment closed, the case open, no session, the remedy unchanged', async () => {
    const w = await terminatedWorld();
    const before = await stateOf(w.enrollmentId);
    const takenFromDecember = {
      ...enrollments,
      slotWeekTaken: async (
        tx: Transaction,
        slotId: string,
        localDate: string,
        enrollmentId: string,
      ) =>
        localDate >= '2026-12-01' ||
        (await enrollments.slotWeekTaken(tx, slotId, localDate, enrollmentId)),
    };
    const narrowed = createRestore({
      enrollments,
      idempotency: new IdempotencyService({ store: new IdempotencyRepository(database), settings }),
      offers: createRemedyOffer({
        enrollments: takenFromDecember,
        settings,
        clock: async () => RESTORED,
        log: SILENT,
      }),
      settings,
      log: SILENT,
      clock: async () => RESTORED,
    });
    const thrown: unknown = await database
      .$transaction((tx: Transaction) =>
        narrowed.restore(tx, admin, {
          enrollmentId: w.enrollmentId,
          reason: 'خطأ',
          idempotencyKey: 'restore-nfw-' + w.enrollmentId,
        }),
      )
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(thrown).toBeInstanceOf(DomainError);
    expect([(thrown as DomainError).code, (thrown as DomainError).details]).toEqual([
      'CONFLICT',
      [{ path: 'cause', code: 'no_free_week' }],
    ]);
    expect(await stateOf(w.enrollmentId)).toEqual(before);
    expect(before.enrollment.status).toBe('terminated_no_show');
    expect(before.cases).toEqual([
      { reason: 'absence_termination', status: 'open', resolutionNotes: null },
    ]);
  });
});

describe('SC-416: a restore against another student’s hold on the same slot', () => {
  async function racing() {
    const w = await terminatedWorld();
    const other = await makeUser(db, { gender: 'female' });
    await database.userRole.create({ data: { userId: other, role: 'student', status: 'active' } });
    const hold = () =>
      database.$transaction((tx: Transaction) =>
        placeHold(
          tx,
          { userId: other, gender: 'female' as RequesterGender },
          { packageId: w.packageId, slotId: w.slotId },
          {
            terms: {
              now: RESTORED,
              ttlMinutes: 10,
              graceMinutes: 5,
              leadHours: 24,
              bufferWeeks: async () => 0,
            },
            orders: orderStandingsOf,
            store: holdsStore,
          },
        ),
      );
    const activeHolds = () =>
      database.slotHold.count({ where: { studentUserId: other, releasedAt: null } });
    return { w, hold, activeHolds };
  }

  /** One winner, nothing half-written: either the restore whole and no hold, or the hold and none of the restore. */
  async function expectOneWinner(
    w: World & { caseId: string },
    activeHolds: () => Promise<number>,
  ) {
    const state = await stateOf(w.enrollmentId);
    if (state.enrollment.status === 'confirmed') {
      expect(await activeHolds()).toBe(0);
      expect(state.cases[0]?.status).toBe('dismissed');
      expect(state.sessions.filter(({ status }) => status === 'scheduled')).toHaveLength(3);
    } else {
      expect(state.enrollment.status).toBe('terminated_no_show');
      expect(await activeHolds()).toBe(1);
      expect(state.cases[0]?.status).toBe('open');
      expect(state.sessions.filter(({ status }) => status === 'scheduled')).toHaveLength(0);
    }
  }

  it('the hold first: the restore refused slot_taken, writing nothing', async () => {
    const { w, hold, activeHolds } = await racing();
    await hold();
    expect(await causeOf(restore(w.enrollmentId))).toBe('slot_taken');
    await expectOneWinner(w, activeHolds);
  });

  it('the restore first: the hold refused, the slot back in the enrollment’s use', async () => {
    const { w, hold, activeHolds } = await racing();
    await restore(w.enrollmentId);
    await expect(hold()).rejects.toBeInstanceOf(DomainError);
    await expectOneWinner(w, activeHolds);
  });

  it('raced at once: one wins, the other is refused, nothing half-written', async () => {
    const { w, hold, activeHolds } = await racing();
    const settled = await Promise.allSettled([restore(w.enrollmentId), hold()]);
    const refused = settled.filter(({ status }) => status === 'rejected');
    expect(refused).toHaveLength(1);
    const [first] = refused;
    expect(first?.status === 'rejected' ? first.reason : undefined).toBeInstanceOf(DomainError);
    await expectOneWinner(w, activeHolds);
  });
});
