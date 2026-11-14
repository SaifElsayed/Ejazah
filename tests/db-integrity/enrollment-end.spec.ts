// T082 of specs/004-sessions/tasks.md — an administrator's direct end of an enrollment over the real
// tables as the application role, through `sessions.endEnrollment`'s service on the transaction the
// administrator kind opens (FR-513; SRS FR-CANCEL-10, DEC-68; contracts/kernel.md, the direct end's
// row). Every world is committed: a Thursday 09:00 Cairo slot and a four-session enrollment confirmed
// by the job.
//
// - each refusal writing nothing: `NOT_FOUND`, `CONFLICT` `enrollment_not_confirmed`, `CONFLICT`
//   `complaint_open` naming the complaint;
// - on each track: a session in its join period, an open and a `frozen` remedy and a session owed a
//   remedy never offered, all in the `admin_ended` case's `covers`; the enrollment `cancelled`
//   `admin`, its reason written, one `cancelled` row;
// - `hold` keeping the slot through the window and `release` freeing it at once (`booking.slots`,
//   another enrollment's week), the release's `slot_released_at` and its one `slot_released` row;
// - both parties' reads answering the reason, never the note;
// - a student's suspension case open meanwhile: its sessions join the new case when it is cleared
//   (U2); a teacher's suspension (the pause): its case closed covered by the new case, its sessions in
//   the new case's `covers` (T071's widened U2);
// - the replay answering the first result and writing nothing; the same key with another input
//   `CONFLICT`;
// - the restore inside the hold, after it with the slot free, and refused `slot_taken` once another
//   student holds it; the restore clears the reason;
// - races: an end with `release` against another student's hold on the slot (Q-E1 (a): both accounts
//   key-shared first); an end against a hold's confirmation; an end against `sessions.restore` on the
//   same enrollment.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { confirmEnrollment } from '../../apps/api/src/jobs/confirm-enrollment';
import {
  bookingSlotsOf,
  bookingSlotsStore,
  createBookingServices,
  createEnrollmentSide,
  createOngoingEnrollments,
  holdsStore,
  placeHold,
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
  createCaseQueue,
  createEnrollmentEnd,
  createRemedyOffer,
  createRestore,
  createSuspensionCase,
  windowDaysOf,
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
import { connectAsApplication, type Db, makeAdmin } from './harness';

const SETTINGS: Record<string, number> = {
  admin_list_page_size: 50,
  dispute_window_hours: 72,
  makeup_choice_window_days: 7,
  makeup_counter_answer_hours: 72,
  first_session_lead_hours: 24,
  enrollment_restore_window_days: 14,
  ban_restore_window_days: 14,
  slot_release_buffer_weeks: 0,
  idempotency_key_ttl_hours: 24,
  repeated_absence_flag_count: 3,
};
const settings: SettingsReader = { read: async (key, schema) => schema.parse(SETTINGS[key]) };
const windowDays = windowDaysOf(settings);
const SILENT = { info: () => undefined, warn: () => undefined };
const log = createLogger({ level: 'fatal' });
const PARTY_REASON = 'تعذر استمرار الاشتراك';
const INTERNAL_NOTE = 'ملاحظة داخلية للإدارة فقط';
const FEMALE = 'female' as RequesterGender;
/** A Thursday well after any session these worlds hold, for `slotWeekTaken`. */
const LATER_THURSDAY = '2027-03-04';

let database: Database;
let db: Db;
let admin: string;
let standing: StandingService;

const enrollments = createEnrollmentSide({ settings });
const offers = createRemedyOffer({ enrollments, settings, log: SILENT });

beforeAll(async () => {
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 6,
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

function idempotency() {
  return new IdempotencyService({ store: new IdempotencyRepository(database), settings });
}

const ender = () => createEnrollmentEnd({ enrollments, idempotency: idempotency(), log: SILENT });

/** A four-session enrollment confirmed by the job, both parties' roles active. */
async function confirmedWorld(track: 'recitation' | 'ijazah_track' = 'recitation'): Promise<World> {
  const made = await world();
  await database.userRole.createMany({
    data: [
      { userId: made.studentId, role: 'student', status: 'active' },
      { userId: made.teacherId, role: 'teacher', status: 'active' },
    ],
  });
  if (track === 'ijazah_track') {
    await database.package.update({ where: { id: made.packageId }, data: { track } });
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

interface EndAsked {
  readonly slot?: 'hold' | 'release';
  readonly key?: string;
  readonly partyReason?: string;
  readonly internalNote?: string;
}

function end(enrollmentId: string, asked: EndAsked = {}) {
  return database.$transaction(
    (tx: Transaction) =>
      ender().endEnrollment(tx, admin, {
        enrollmentId,
        partyReason: asked.partyReason ?? PARTY_REASON,
        internalNote: asked.internalNote ?? INTERNAL_NOTE,
        slot: asked.slot ?? 'hold',
        idempotencyKey: asked.key ?? `end-${enrollmentId}`,
      }),
    { timeout: 30_000 },
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

/** What an end writes, read whole, so a refusal is seen to write nothing. */
async function stateOf(enrollmentId: string, key = `end-${enrollmentId}`) {
  const [enrollment, events, sessions, cases, keys] = await Promise.all([
    database.enrollment.findUnique({
      where: { id: enrollmentId },
      select: {
        status: true,
        cancellationReason: true,
        adminEndReason: true,
        slotReleasedAt: true,
      },
    }),
    database.enrollmentEvent.findMany({
      where: { enrollmentId },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      select: { kind: true, cancellationReason: true },
    }),
    database.session.findMany({
      where: { enrollmentId },
      orderBy: { sequenceNumber: 'asc' },
      select: { sequenceNumber: true, status: true },
    }),
    database.dispute.findMany({
      where: { enrollmentId },
      orderBy: { id: 'asc' },
      select: { id: true, kind: true, reason: true, status: true, coveredByCaseId: true },
    }),
    database.idempotencyKey.count({ where: { scope: 'sessions.endEnrollment', key } }),
  ]);
  return { enrollment, events, sessions, cases, keys };
}

const queue = () => createCaseQueue({ enrollments, settings, log: SILENT });

function coversOf(caseId: string) {
  return database.$transaction((tx: Transaction) => queue().get(tx, admin, { caseId }));
}

async function sessionNumbered(enrollmentId: string, sequenceNumber: number) {
  return database.session.findFirstOrThrow({
    where: { enrollmentId, sequenceNumber },
    select: { id: true },
  });
}

async function remedy(sessionId: string, status: 'awaiting_choice' | 'frozen'): Promise<string> {
  const { id } = await database.sessionRemedy.create({
    data: {
      sessionId,
      kind: 'makeup',
      status,
      offeredAt: new Date('2026-11-06T08:00:00Z'),
      choiceClosesAt: new Date('2026-11-13T08:00:00Z'),
      snapshotAnswerWindowHours: 72,
      snapshotFirstSessionLeadHours: 24,
      proposedDate: new Date('2026-12-03T00:00:00Z'),
    },
    select: { id: true },
  });
  return id;
}

async function person(gender: 'female' | 'male' = 'female'): Promise<string> {
  const { id } = await database.user.create({
    data: {
      email: `probe-${randomUUID()}@example.invalid`,
      gender,
      dateOfBirth: new Date('1990-01-01T00:00:00Z'),
      displayName: 'Probe person',
      preferredLanguage: 'ar',
      timezone: 'Africa/Cairo',
      accountStatus: 'active',
    },
    select: { id: true },
  });
  await database.userRole.create({ data: { userId: id, role: 'student', status: 'active' } });
  return id;
}

/** The slots `booking.slots` offers a fresh student for the world's package. */
async function offered(made: World): Promise<readonly string[]> {
  const studentId = await person();
  return database.$transaction(async (tx: Transaction) => {
    const { slots } = await bookingSlotsOf(
      tx,
      bookingSlotsStore,
      { userId: studentId, gender: FEMALE },
      { packageId: made.packageId },
      { now: new Date(), leadHours: 24, bufferWeeks: async () => 0, windowDays },
    );
    return slots.map(({ slotId }) => slotId);
  });
}

/** Whether the slot is taken on a later Thursday for another enrollment's make-up or restore. */
function weekTaken(made: World): Promise<boolean> {
  return database.$transaction((tx: Transaction) =>
    enrollments.slotWeekTaken(tx, made.slotId, LATER_THURSDAY, randomUUID()),
  );
}

/** A fresh student's hold on the world's slot: its id, or the refusal's code. */
async function holdOn(made: World): Promise<string> {
  const studentId = await person();
  return database.$transaction(async (tx: Transaction) => {
    try {
      const placed = await placeHold(
        tx,
        { userId: studentId, gender: FEMALE },
        { packageId: made.packageId, slotId: made.slotId },
        {
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
  });
}

function restorer() {
  return createRestore({
    enrollments,
    idempotency: idempotency(),
    offers,
    settings,
    log: SILENT,
    payments: { refundedOf },
  });
}

function restore(enrollmentId: string, key = `restore-${enrollmentId}`) {
  return database.$transaction(
    (tx: Transaction) =>
      restorer().restore(tx, admin, { enrollmentId, reason: 'خطأ', idempotencyKey: key }),
    { timeout: 30_000 },
  );
}

describe('sessions.endEnrollment refusals, each writing nothing (FR-513)', () => {
  it('an enrollment that does not exist: NOT_FOUND', async () => {
    const missing = randomUUID();
    expect(await refusalOf(end(missing))).toEqual(['NOT_FOUND', undefined]);
    expect((await stateOf(missing)).keys).toBe(0);
  });

  it('an enrollment awaiting payment: CONFLICT enrollment_not_confirmed', async () => {
    const made = await world();
    const before = await stateOf(made.enrollmentId);
    expect(await refusalOf(end(made.enrollmentId))).toEqual([
      'CONFLICT',
      [{ path: 'cause', code: 'enrollment_not_confirmed' }],
    ]);
    expect(await stateOf(made.enrollmentId)).toEqual(before);
  });

  it('a complaint of the teacher’s absence open on it: CONFLICT complaint_open naming the complaint', async () => {
    const made = await confirmedWorld();
    const { complaintId } = await createAbsenceComplaint({
      transactions: transactionsOver(database),
      enrollments,
    }).raise({ userId: made.studentId }, { enrollmentId: made.enrollmentId, reason: 'غاب' }, log);
    const before = await stateOf(made.enrollmentId);
    expect(await refusalOf(end(made.enrollmentId, { slot: 'release' }))).toEqual([
      'CONFLICT',
      [
        { path: 'cause', code: 'complaint_open' },
        { path: 'caseId', code: complaintId },
      ],
    ]);
    expect(await stateOf(made.enrollmentId)).toEqual(before);
  });
});

describe('the end on each track: every session owed in the admin_ended case’s covers (FR-513)', () => {
  it.each(['recitation', 'ijazah_track'] as const)(
    '%s: a session in its join period, an open and a frozen remedy and a session owed a remedy never offered',
    async (track) => {
      const made = await confirmedWorld(track);
      const [first, second, third, fourth] = await Promise.all(
        [1, 2, 3, 4].map((n) => sessionNumbered(made.enrollmentId, n)),
      );
      if (!first || !second || !third || !fourth) throw new Error('four sessions expected');
      await database.session.updateMany({
        where: { id: { in: [first.id, second.id] } },
        data: { status: 'teacher_no_show' },
      });
      const open = await remedy(first.id, 'awaiting_choice');
      const frozen = await remedy(second.id, 'frozen');
      // Session 3 in its join period: started five minutes ago by the database's clock.
      await database.$executeRaw`
        UPDATE sessions SET scheduled_start_at = clock_timestamp() - interval '5 minutes',
                            scheduled_end_at = clock_timestamp() + interval '55 minutes'
         WHERE id = ${third.id}::uuid`;
      // Session 4 cancelled by agreement with no remedy: owed one never offered.
      await database.session.update({
        where: { id: fourth.id },
        data: { status: 'cancelled_by_agreement' },
      });

      const { answer, replayed } = await end(made.enrollmentId);
      expect(replayed).toBe(false);
      expect(answer).toEqual({
        enrollmentId: made.enrollmentId,
        caseId: answer.caseId,
        slot: 'hold',
        cancelledSessions: 1,
      });
      const state = await stateOf(made.enrollmentId);
      expect(state.enrollment).toEqual({
        status: 'cancelled',
        cancellationReason: 'admin',
        adminEndReason: PARTY_REASON,
        slotReleasedAt: null,
      });
      expect(state.events.at(-1)).toEqual({ kind: 'cancelled', cancellationReason: 'admin' });
      expect(state.sessions.map(({ status }) => status)).toEqual([
        'teacher_no_show',
        'teacher_no_show',
        'cancelled_by_admin',
        'cancelled_by_agreement',
      ]);
      expect(state.cases).toEqual([
        {
          id: answer.caseId,
          kind: 'compensation_case',
          reason: 'admin_ended',
          status: 'open',
          coveredByCaseId: null,
        },
      ]);
      const handed = await database.sessionRemedy.findMany({
        where: { id: { in: [open, frozen] } },
        select: { status: true, caseId: true },
      });
      expect(handed).toEqual([
        { status: 'refund_case', caseId: answer.caseId },
        { status: 'refund_case', caseId: answer.caseId },
      ]);
      const { covers } = await coversOf(answer.caseId);
      expect(covers.map(({ sessionId }) => sessionId).sort()).toEqual(
        [first.id, second.id, third.id, fourth.id].sort(),
      );
    },
  );
});

describe('the slot: held through the window, or released at once (FR-503, FR-513)', () => {
  it('hold: taken to booking.slots and another enrollment’s week, the slot not released', async () => {
    const made = await confirmedWorld();
    await end(made.enrollmentId, { slot: 'hold' });
    expect(await offered(made)).toEqual([]);
    expect(await weekTaken(made)).toBe(true);
    expect((await stateOf(made.enrollmentId)).enrollment?.slotReleasedAt).toBeNull();
  });

  it('release: free at once, slot_released_at and one slot_released row', async () => {
    const made = await confirmedWorld();
    const { answer } = await end(made.enrollmentId, { slot: 'release' });
    expect(answer.slot).toBe('release');
    const state = await stateOf(made.enrollmentId);
    expect(state.enrollment?.slotReleasedAt).not.toBeNull();
    expect(state.events.filter(({ kind }) => kind === 'slot_released')).toHaveLength(1);
    expect(state.events.map(({ kind }) => kind).slice(-2)).toEqual(['cancelled', 'slot_released']);
    expect(await offered(made)).toEqual([made.slotId]);
    expect(await weekTaken(made)).toBe(false);
  });
});

describe('both parties’ reads (FR-513)', () => {
  it('answer the reason both parties are shown, never the internal note', async () => {
    const made = await confirmedWorld();
    await end(made.enrollmentId);
    const lists = createBookingServices({ database, settings });
    const asStudent = await lists.enrollment(made.studentId, { enrollmentId: made.enrollmentId });
    const asTeacher = await lists.student(made.teacherId, { enrollmentId: made.enrollmentId });
    expect(asStudent.endedByAdmin).toEqual({ reason: PARTY_REASON });
    expect(asTeacher.endedByAdmin).toEqual({ reason: PARTY_REASON });
    expect(asStudent.paused).toBe(false);
    expect(JSON.stringify([asStudent, asTeacher])).not.toContain(INTERNAL_NOTE);
  });
});

describe('a suspension open meanwhile (U2; T071’s widened U2)', () => {
  it('a student’s suspension case: its sessions join the admin_ended case once it is cleared', async () => {
    const made = await confirmedWorld();
    await database.$transaction((tx) => standing.suspendStudent(tx, admin, made.studentId));
    const suspension = await database.dispute.findFirstOrThrow({
      where: { enrollmentId: made.enrollmentId, reason: 'student_suspended' },
      select: { id: true },
    });
    const suspended = await database.session.findMany({
      where: { enrollmentId: made.enrollmentId, status: 'cancelled_by_admin' },
      select: { id: true },
    });
    expect(suspended.length).toBeGreaterThan(0);
    const { answer } = await end(made.enrollmentId);
    await database.$transaction((tx) => standing.reinstateStudent(tx, admin, made.studentId));
    await database.$transaction((tx: Transaction) =>
      createCaseClosing({
        log: SILENT,
        suspension: createSuspensionCase({ enrollments, offers, log: SILENT }),
      }).resolve(tx, admin, { caseId: suspension.id, note: 'بُرّئ الطالب' }),
    );
    const closed = await database.dispute.findUniqueOrThrow({
      where: { id: suspension.id },
      select: { status: true, coveredByCaseId: true },
    });
    expect(closed).toEqual({ status: 'resolved', coveredByCaseId: answer.caseId });
    const { covers } = await coversOf(answer.caseId);
    const covered = new Set(covers.map(({ sessionId }) => sessionId));
    expect(suspended.every(({ id }) => covered.has(id))).toBe(true);
  });

  it('a teacher’s suspension (the pause): its case closed, covered by the admin_ended case, its sessions in its covers', async () => {
    const made = await confirmedWorld();
    await database.$transaction((tx) => standing.suspend(tx, admin, made.teacherId));
    const paused = await database.dispute.findFirstOrThrow({
      where: { enrollmentId: made.enrollmentId, reason: 'teacher_suspended' },
      select: { id: true },
    });
    const pausedSessions = await database.session.findMany({
      where: { enrollmentId: made.enrollmentId, status: 'cancelled_by_admin' },
      select: { id: true },
    });
    expect(pausedSessions.length).toBeGreaterThan(0);
    const { answer } = await end(made.enrollmentId);
    const closed = await database.dispute.findUniqueOrThrow({
      where: { id: paused.id },
      select: { status: true, resolution: true, resolutionNotes: true, coveredByCaseId: true },
    });
    expect(closed).toEqual({
      status: 'resolved',
      resolution: 'compensation_ordered',
      resolutionNotes: 'ended_meanwhile',
      coveredByCaseId: answer.caseId,
    });
    const { covers } = await coversOf(answer.caseId);
    const covered = new Set(covers.map(({ sessionId }) => sessionId));
    expect(pausedSessions.every(({ id }) => covered.has(id))).toBe(true);
  });
});

describe('the key (FR-513)', () => {
  it('answers a replay the first result and writes nothing; the same key with another input CONFLICT', async () => {
    const made = await confirmedWorld();
    const first = await end(made.enrollmentId);
    const after = await stateOf(made.enrollmentId);
    expect(after.keys).toBe(1);
    expect(await end(made.enrollmentId)).toEqual({ answer: first.answer, replayed: true });
    expect(await stateOf(made.enrollmentId)).toEqual(after);
    expect((await refusalOf(end(made.enrollmentId, { partyReason: 'سبب آخر' })))[0]).toBe(
      'CONFLICT',
    );
    expect(await stateOf(made.enrollmentId)).toEqual(after);
  });
});

describe('the restore of a direct end, at any time (DEC-69)', () => {
  it('inside the hold: confirmed again, the reason cleared, the case dismissed', async () => {
    const made = await confirmedWorld();
    const { answer } = await end(made.enrollmentId);
    await restore(made.enrollmentId);
    const state = await stateOf(made.enrollmentId);
    expect(state.enrollment).toEqual({
      status: 'confirmed',
      cancellationReason: null,
      adminEndReason: null,
      slotReleasedAt: null,
    });
    expect(state.cases.find(({ id }) => id === answer.caseId)?.status).toBe('dismissed');
  });

  it('after the hold, the slot free: restored', async () => {
    const made = await confirmedWorld();
    const { answer } = await end(made.enrollmentId);
    await database.$executeRaw`
      UPDATE disputes SET created_at = clock_timestamp() - interval '15 days'
       WHERE id = ${answer.caseId}::uuid`;
    expect(await weekTaken(made)).toBe(false);
    await restore(made.enrollmentId);
    expect((await stateOf(made.enrollmentId)).enrollment?.status).toBe('confirmed');
  });

  it('after the hold, another student holding the slot: RESTORE_REFUSED slot_taken, nothing written', async () => {
    const made = await confirmedWorld();
    const { answer } = await end(made.enrollmentId);
    await database.$executeRaw`
      UPDATE disputes SET created_at = clock_timestamp() - interval '15 days'
       WHERE id = ${answer.caseId}::uuid`;
    expect(await holdOn(made)).not.toBe('SLOT_TAKEN');
    const before = await stateOf(made.enrollmentId);
    expect(await refusalOf(restore(made.enrollmentId))).toEqual([
      'RESTORE_REFUSED',
      [{ path: 'cause', code: 'slot_taken' }],
    ]);
    expect(await stateOf(made.enrollmentId)).toEqual(before);
  });
});

// Q-R2 (a), the integration's (B42c): «T080's deletion allowed after the end». T080's count (booking's
// `OngoingEnrollments`, the port the deletion asks on its own transaction) is read on T082's real end:
// an `admin_ended` closing is never counted (FR-511), so neither party is refused while its slot is held.
describe('T080’s deletion allowed after the end (Q-R2 (a); FR-511, FR-513)', () => {
  it('the count the deletion asks answers none for either party once an administrator ended the enrollment, its slot held', async () => {
    const made = await confirmedWorld();
    const count = createOngoingEnrollments({ settings });
    const ongoing = (userId: string) =>
      database.$transaction((tx: Transaction) => count.hasOngoing(tx, userId));
    expect(await ongoing(made.studentId)).toBe(true);
    expect(await ongoing(made.teacherId)).toBe(true);

    await end(made.enrollmentId);

    expect(await weekTaken(made)).toBe(true);
    expect(await ongoing(made.studentId)).toBe(false);
    expect(await ongoing(made.teacherId)).toBe(false);
  });
});

describe('races (kernel.md, the direct end’s row)', () => {
  // Q-E1 (a): the release path key-shares both accounts first, so a hold (accounts, then the slot)
  // waits on it instead of closing a cycle.
  it('an end with release against another student’s hold on the slot: the end kept, the hold placed only after it, never both held and placed', async () => {
    const made = await confirmedWorld();
    const [ended, placed] = await Promise.allSettled([
      end(made.enrollmentId, { slot: 'release' }),
      holdOn(made),
    ]);
    expect(ended.status).toBe('fulfilled');
    expect(placed.status).toBe('fulfilled');
    const outcome = placed.status === 'fulfilled' ? placed.value : undefined;
    const state = await stateOf(made.enrollmentId);
    expect(state.enrollment?.slotReleasedAt).not.toBeNull();
    const activeHolds = await database.slotHold.count({
      where: { slotId: made.slotId, releasedAt: null },
    });
    expect(activeHolds).toBe(outcome === 'SLOT_TAKEN' ? 0 : 1);
  });

  it('an end against a hold’s confirmation: confirmed then ended, or refused enrollment_not_confirmed and confirmed', async () => {
    const made = await world();
    await database.userRole.createMany({
      data: [
        { userId: made.studentId, role: 'student', status: 'active' },
        { userId: made.teacherId, role: 'teacher', status: 'active' },
      ],
    });
    const paymentId = await order(made.enrollmentId);
    const [confirmed, ended] = await Promise.allSettled([
      confirmEnrollment({ database, settings: worldSettings, clock: () => NOW }).handle({
        paymentId,
      }),
      end(made.enrollmentId),
    ]);
    expect(confirmed.status).toBe('fulfilled');
    const state = await stateOf(made.enrollmentId);
    if (ended.status === 'fulfilled') {
      expect(state.enrollment?.status).toBe('cancelled');
      expect(state.enrollment?.adminEndReason).toBe(PARTY_REASON);
      expect(state.cases.filter(({ reason }) => reason === 'admin_ended')).toHaveLength(1);
    } else {
      const reason: unknown = ended.reason;
      expect(reason).toBeInstanceOf(DomainError);
      expect((reason as DomainError).details).toEqual([
        { path: 'cause', code: 'enrollment_not_confirmed' },
      ]);
      expect(state.enrollment?.status).toBe('confirmed');
      expect(state.enrollment?.adminEndReason).toBeNull();
      expect(state.cases).toEqual([]);
    }
  });

  it('an end against sessions.restore on the same enrollment: one valid outcome, no deadlock, nothing half-written', async () => {
    const made = await confirmedWorld();
    await end(made.enrollmentId, { key: `end-a-${made.enrollmentId}` });
    const [restored, ended] = await Promise.allSettled([
      restore(made.enrollmentId),
      end(made.enrollmentId, { key: `end-b-${made.enrollmentId}` }),
    ]);
    expect(restored.status).toBe('fulfilled');
    const state = await stateOf(made.enrollmentId);
    const directEnds = state.cases.filter(({ reason }) => reason === 'admin_ended');
    if (ended.status === 'fulfilled') {
      // The restore first: confirmed again, then ended again.
      expect(state.enrollment).toEqual({
        status: 'cancelled',
        cancellationReason: 'admin',
        adminEndReason: PARTY_REASON,
        slotReleasedAt: null,
      });
      expect(directEnds.map(({ status }) => status).sort()).toEqual(['dismissed', 'open']);
    } else {
      // The second end first: refused, the enrollment still closed; then restored.
      const reason: unknown = ended.reason;
      expect((reason as DomainError).details).toEqual([
        { path: 'cause', code: 'enrollment_not_confirmed' },
      ]);
      expect(state.enrollment).toEqual({
        status: 'confirmed',
        cancellationReason: null,
        adminEndReason: null,
        slotReleasedAt: null,
      });
      expect(directEnds.map(({ status }) => status)).toEqual(['dismissed']);
    }
  });
});
