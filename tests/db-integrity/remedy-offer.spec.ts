// T028 of specs/004-sessions/tasks.md (FR-462 to FR-464, FR-449; research R-311; decisions 5 and 9;
// the notes under T028, Q3, Q8; the conflict check's P1) — the offer over the real tables, each world
// committed with accounts, a slot and an enrollment of its own (four Thursdays from 2026-11-05, 09:00
// Cairo), the clock given:
//
//   - no remedy inside the dispute window, one at its close, with its row and one `remedy_offered`
//     row, and never a second for the session;
//   - none while a dispute holds the session, the remedy once it is resolved; none after a
//     Student-No-Show; none on an enrollment no longer confirmed; none to a suspended student;
//   - an accepted cancellation offers the make-up in its own transaction, after its own row;
//   - the sweep, narrowed to this file's rows, run twice: one remedy per session (the Cancelled-By-
//     Agreement backfill among them), a frozen remedy offered again once its student is reinstated,
//     and T015's completion held by an open `admin_cancellation` case (Q3 (a)) and done without one;
//   - P1: `checkout.hold` against the offer for the same teacher and student, each holding its first
//     path after its first lock until the other is seen waiting, in both orders: no deadlock, and the
//     hold's session and the proposal never on the same time.
//
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { confirmEnrollment } from '../../apps/api/src/jobs/confirm-enrollment';
import {
  createEnrollmentSide,
  holdsStore,
  placeHold,
} from '../../apps/api/src/modules/booking/index.js';
import { openCompensationCase } from '../../apps/api/src/modules/moderation/index.js';
import { orderStandingsOf } from '../../apps/api/src/modules/payments/index.js';
import {
  createCompletion,
  createRemedyAdvance,
  createRemedyOffer,
  remedyAdvanceStore,
  remedyOfferStore,
  createSessionsServices,
  sessionsStore,
} from '../../apps/api/src/modules/sessions/index.js';
import { isDeadlock } from '../../apps/api/src/platform/db/db-errors.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import { transactionsOver } from '../../apps/api/src/platform/db/transaction.repository.js';
import type { RequesterGender } from '../../apps/api/src/platform/guards/requester-gender.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
import {
  CAIRO,
  confirmationWorld,
  NOW,
  settings as worldSettings,
  type World,
} from './confirmation-world';
import { connectAsApplication, type Db } from './harness';

// 005:T016 (rule d): the payment and cancellation pushes' port, which records nothing here.
const NO_PUSH = { record: async () => undefined };

const FEMALE = 'female' as RequesterGender;
const SETTINGS: Record<string, number> = {
  dispute_window_hours: 72,
  makeup_choice_window_days: 7,
  makeup_counter_answer_hours: 72,
  first_session_lead_hours: 24,
  slot_release_buffer_weeks: 0,
  slot_hold_ttl_minutes: 10,
  slot_hold_grace_minutes: 5,
  admin_list_page_size: 50,
};
const settings: SettingsReader = { read: async (key, schema) => schema.parse(SETTINGS[key]) };
/** The fourth session ends 2026-11-26 08:00Z; its dispute window closes 72 hours later. */
const WINDOW_CLOSES = new Date('2026-11-29T08:00:00Z');
const SILENT = { info: () => undefined, error: () => undefined, warn: () => undefined } as never;

let database: Database;
let watcher: Db;

beforeAll(async () => {
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 6,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  watcher = await connectAsApplication();
});

afterAll(async () => {
  await watcher?.end();
  if (database !== undefined) await closeDatabase(database);
});

const { world, order, enrollmentOf } = confirmationWorld(() => database);

/** The offer and the enrollment side at the clock `at`. */
function offerAt(at: Date, store = remedyOfferStore) {
  const enrollments = createEnrollmentSide({ settings, now: () => at });
  return {
    enrollments,
    offer: createRemedyOffer({ enrollments, settings, clock: async () => at, store }),
  };
}

async function confirmedWorld(): Promise<World> {
  const confirmed = await world();
  await confirmEnrollment({ database, settings: worldSettings, notices: NO_PUSH, clock: () => NOW }).handle({
    paymentId: await order(confirmed.enrollmentId),
  });
  return confirmed;
}

async function sessionNumbered(enrollmentId: string, sequenceNumber: number): Promise<string> {
  const { id } = await database.session.findFirstOrThrow({
    where: { enrollmentId, sequenceNumber },
    select: { id: true },
  });
  return id;
}

async function setSession(
  sessionId: string,
  status: 'teacher_no_show' | 'disputed' | 'student_no_show' | 'cancelled_by_agreement' | 'done',
): Promise<void> {
  await database.session.update({ where: { id: sessionId }, data: { status } });
}

async function remedyOf(sessionId: string) {
  return database.sessionRemedy.findUnique({
    where: { sessionId },
    select: {
      id: true,
      status: true,
      proposedDate: true,
      offeredAt: true,
      choiceClosesAt: true,
      snapshotAnswerWindowHours: true,
      snapshotFirstSessionLeadHours: true,
    },
  });
}

async function eventKinds(sessionId: string): Promise<string[]> {
  const rows = await database.sessionEvent.findMany({
    where: { sessionId },
    orderBy: { id: 'asc' },
    select: { kind: true },
  });
  return rows.map(({ kind }) => kind);
}

describe('the offer on Postgres (T028, FR-462, G1, C1, C3)', () => {
  it('offers nothing inside the dispute window, one remedy at its close with its row and event, and never a second', async () => {
    const confirmed = await confirmedWorld();
    const sessionId = await sessionNumbered(confirmed.enrollmentId, 4);
    await setSession(sessionId, 'teacher_no_show');

    const early = offerAt(new Date('2026-11-29T07:59:59Z'));
    expect(await database.$transaction((tx) => early.offer.offer(tx, sessionId))).toBeNull();
    expect(await remedyOf(sessionId)).toBeNull();

    const { offer } = offerAt(WINDOW_CLOSES);
    const offered = await database.$transaction((tx) => offer.offer(tx, sessionId));
    expect(offered).toMatchObject({ status: 'awaiting_choice', proposedDate: '2026-12-17' });
    expect(await remedyOf(sessionId)).toEqual({
      id: offered?.remedyId,
      status: 'awaiting_choice',
      proposedDate: new Date('2026-12-17T00:00:00Z'),
      offeredAt: WINDOW_CLOSES,
      choiceClosesAt: new Date('2026-12-06T08:00:00Z'),
      snapshotAnswerWindowHours: 72,
      snapshotFirstSessionLeadHours: 24,
    });
    expect(await eventKinds(sessionId)).toEqual(['remedy_offered']);

    expect(await database.$transaction((tx) => offer.offer(tx, sessionId))).toBeNull();
    expect(await eventKinds(sessionId)).toEqual(['remedy_offered']);
  });

  it('offers nothing while a dispute holds the session, and the remedy once it is resolved; none after a Student-No-Show', async () => {
    const confirmed = await confirmedWorld();
    const sessionId = await sessionNumbered(confirmed.enrollmentId, 4);
    const { offer } = offerAt(WINDOW_CLOSES);
    for (const status of ['disputed', 'student_no_show'] as const) {
      await setSession(sessionId, status);
      expect(await database.$transaction((tx) => offer.offer(tx, sessionId))).toBeNull();
    }
    await setSession(sessionId, 'teacher_no_show');
    expect(await database.$transaction((tx) => offer.offer(tx, sessionId))).not.toBeNull();
  });

  it('offers nothing on an enrollment no longer confirmed, nor to a suspended student', async () => {
    const confirmed = await confirmedWorld();
    const sessionId = await sessionNumbered(confirmed.enrollmentId, 4);
    await setSession(sessionId, 'teacher_no_show');
    const { offer } = offerAt(WINDOW_CLOSES);
    await database.user.update({
      where: { id: confirmed.studentId },
      data: { accountStatus: 'suspended' },
    });
    expect(await database.$transaction((tx) => offer.offer(tx, sessionId))).toBeNull();
    await database.user.update({
      where: { id: confirmed.studentId },
      data: { accountStatus: 'active' },
    });
    await database.enrollment.update({
      where: { id: confirmed.enrollmentId },
      data: { status: 'completed' },
    });
    expect(await database.$transaction((tx) => offer.offer(tx, sessionId))).toBeNull();
    expect(await remedyOf(sessionId)).toBeNull();
  });
});

describe('an accepted cancellation offers its make-up in its transaction (T028, decision 5)', () => {
  it('writes the remedy, proposed, after the acceptance’s row, in one commit', async () => {
    const confirmed = await confirmedWorld();
    const sessionId = await sessionNumbered(confirmed.enrollmentId, 4);
    const { id: requestId } = await database.cancellationRequest.create({
      data: {
        sessionId,
        requestedByUserId: confirmed.studentId,
        reason: 'probe',
        status: 'pending',
      },
      select: { id: true },
    });
    const at = new Date('2026-11-10T12:00:00Z');
    const { enrollments, offer } = offerAt(at);
    const services = createSessionsServices({
      notifications: NO_PUSH,
      transactions: transactionsOver(database),
      settings,
      video: {} as never,
      enrollmentSide: enrollments,
      store: sessionsStore,
      idempotency: { run: () => Promise.reject(new Error('probe: nothing keyed')) },
      remedyOffer: offer,
      clock: async () => at,
    });
    expect(
      await services.cancellation.answer(
        { userId: confirmed.teacherId },
        { requestId, accept: true },
        SILENT,
        { afterCommit: () => undefined },
      ),
    ).toMatchObject({ status: 'accepted', sessionStatus: 'cancelled_by_agreement' });
    expect(await remedyOf(sessionId)).toMatchObject({
      status: 'proposed',
      proposedDate: new Date('2026-12-03T00:00:00Z'),
      offeredAt: at,
    });
    expect(await eventKinds(sessionId)).toEqual(['cancellation_accepted', 'remedy_offered']);
  });
});

describe('advance-remedies over this file’s rows, run twice (T028, R-API-14, Q3 (a))', () => {
  it('offers one remedy per session, the Cancelled-By-Agreement backfill among them, re-offers a frozen one once reinstated, and holds completion for an open admin_cancellation case', async () => {
    const one = await confirmedWorld();
    const owed = await sessionNumbered(one.enrollmentId, 4);
    const agreed = await sessionNumbered(one.enrollmentId, 3);
    await setSession(owed, 'teacher_no_show');
    await setSession(agreed, 'cancelled_by_agreement');
    const two = await confirmedWorld();
    const frozenSession = await sessionNumbered(two.enrollmentId, 4);
    await setSession(frozenSession, 'teacher_no_show');
    const { id: frozenId } = await database.sessionRemedy.create({
      data: {
        sessionId: frozenSession,
        kind: 'makeup',
        status: 'frozen',
        proposedDate: new Date('2026-12-03T00:00:00Z'),
        offeredAt: new Date('2026-11-29T08:00:00Z'),
        choiceClosesAt: new Date('2026-12-06T08:00:00Z'),
        snapshotAnswerWindowHours: 72,
        snapshotFirstSessionLeadHours: 24,
      },
      select: { id: true },
    });
    const three = await confirmedWorld();
    for (const n of [1, 2, 3, 4]) {
      await setSession(await sessionNumbered(three.enrollmentId, n), 'done');
    }
    const four = await confirmedWorld();
    for (const n of [1, 2, 3, 4]) {
      await setSession(await sessionNumbered(four.enrollmentId, n), 'done');
    }
    await database.$transaction((tx) =>
      openCompensationCase(tx, four.enrollmentId, 'admin_cancellation'),
    );

    const at = new Date('2026-12-20T10:00:00Z');
    const { enrollments, offer } = offerAt(at);
    const mine = new Set([owed, agreed, frozenSession]);
    const myEnrollments = [one, two, three, four].map(({ enrollmentId }) => enrollmentId);
    const sweep = createRemedyAdvance({
      transactions: transactionsOver(database),
      offer,
      // T032's windows' ends are `remedy-windows.spec.ts`'; this file's run reads none (below).
      windows: {
        endAnswerWindow: async () => 'not_due',
        bookAtChoiceEnd: async () => 'not_due',
      },
      completion: createCompletion({ enrollments, settings, clock: async () => at }),
      enrollments: {
        lockEnrollments: enrollments.lockEnrollments,
        enrollmentPage: (tx, filter, cursor, size) =>
          enrollments.enrollmentPage(tx, { ...filter, enrollmentIds: myEnrollments }, cursor, size),
      },
      settings,
      log: SILENT,
      pageSize: 2,
      clock: async () => at,
      store: {
        ...remedyAdvanceStore,
        dueForOffer: async (tx, endedBy, after, limit) =>
          (await remedyAdvanceStore.dueForOffer(tx, endedBy, after, 10_000))
            .filter(({ sessionId }) => mine.has(sessionId))
            .slice(0, limit),
        frozenRemedies: async (tx, after, limit) =>
          (await remedyAdvanceStore.frozenRemedies(tx, after, 10_000))
            .filter(({ remedyId }) => remedyId === frozenId)
            .slice(0, limit),
        pendingCounters: async () => [],
        choiceWindowsEnded: async () => [],
      },
    });

    await database.user.update({
      where: { id: two.studentId },
      data: { accountStatus: 'suspended' },
    });
    const first = await sweep.run();
    expect(first.reoffered).toEqual([]);
    await database.user.update({ where: { id: two.studentId }, data: { accountStatus: 'active' } });
    const second = await sweep.run();
    const third = await sweep.run();

    expect(first.offered).toHaveLength(2);
    expect(second.offered).toEqual([]);
    expect(second.reoffered).toEqual([frozenId]);
    expect(third.reoffered).toEqual([]);
    expect(await eventKinds(owed)).toEqual(['remedy_offered']);
    expect(await eventKinds(agreed)).toEqual(['remedy_offered']);
    expect(await remedyOf(frozenSession)).toMatchObject({
      status: 'awaiting_choice',
      offeredAt: at,
      choiceClosesAt: new Date('2026-12-27T10:00:00Z'),
    });
    expect(first.completed).toEqual([three.enrollmentId]);
    expect((await enrollmentOf(three.enrollmentId)).status).toBe('completed');
    expect((await enrollmentOf(four.enrollmentId)).status).toBe('confirmed');
    expect([...first.failed, ...second.failed, ...third.failed]).toEqual([]);
  });
});

/** The backend's id of the connection a transaction runs on. */
async function pidOf(tx: Transaction): Promise<number> {
  const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
  if (row === undefined) throw new Error('no backend pid');
  return row.pid;
}

/** Waits until the backend `pid` is seen waiting on a lock (`pg_stat_activity`). */
async function seenWaiting(pid: number): Promise<void> {
  for (let tries = 0; tries < 300; tries += 1) {
    const { rows } = await watcher.query<{ waiting: boolean }>(
      `SELECT wait_event_type = 'Lock' AS waiting FROM pg_stat_activity WHERE pid = $1`,
      [pid],
    );
    if (rows[0]?.waiting === true) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('probe: the second path was never seen waiting');
}

describe('P1: checkout.hold against the offer for the same teacher and student (T027, T028)', () => {
  /**
   * The world's last session owed; a second slot of the teacher, Thursday 09:30, with a
   * one-session package, whose hold placed at 2026-12-14 would fall on Thursday 12-17 09:30, over
   * the proposal the offer at the window's close places on 12-17 09:00.
   */
  async function racing() {
    const confirmed = await confirmedWorld();
    const sessionId = await sessionNumbered(confirmed.enrollmentId, 4);
    await setSession(sessionId, 'teacher_no_show');
    const { id: slotId } = await database.availabilitySlot.create({
      data: {
        teacherUserId: confirmed.teacherId,
        dayOfWeek: 4,
        startTimeLocal: new Date('1970-01-01T09:30:00Z'),
        durationMinutes: 60,
        timezone: CAIRO,
        isActive: true,
      },
      select: { id: true },
    });
    const { id: packageId } = await database.package.create({
      data: {
        teacherUserId: confirmed.teacherId,
        subjectId: confirmed.subjectId,
        sessionCount: 1,
        sessionDurationMinutes: 60,
        pricePiasters: 100_000n,
        isActive: true,
      },
      select: { id: true },
    });
    await database.teacherProfile.update({
      where: { userId: confirmed.teacherId },
      data: { applicationStatus: 'approved' },
    });
    return { confirmed, sessionId, slotId, packageId };
  }

  /** Where the first path is held: between its locks, or after all its work, before its commit. */
  type Stop = 'between its locks' | 'before its commit';

  async function race(first: 'hold' | 'offer', stop: Stop) {
    const { confirmed, sessionId, slotId, packageId } = await racing();
    const holdAt = new Date('2026-12-14T08:00:00Z');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let secondPid!: (pid: number) => void;
    const second = new Promise<number>((resolve) => {
      secondPid = resolve;
    });
    /** The first path, held where `stop` says, waits for the second to be seen waiting. */
    const held = async (tx: Transaction, isFirst: boolean) => {
      if (isFirst) {
        release();
        await seenWaiting(await second);
      } else {
        secondPid(await pidOf(tx));
      }
    };
    const offerStore = {
      ...remedyOfferStore,
      lockAccounts: async (tx: Transaction, ids: readonly string[]) => {
        if (first === 'hold') await gate;
        if (first === 'hold') await held(tx, false);
        await remedyOfferStore.lockAccounts(tx, ids);
        if (first === 'offer' && stop === 'between its locks') await held(tx, true);
      },
    };
    const placing = {
      ...holdsStore,
      lockRows: async (
        tx: Transaction,
        table: Parameters<typeof holdsStore.lockRows>[1],
        ids: readonly string[],
      ) => {
        if (table === 'users' && first === 'offer') {
          await gate;
          await held(tx, false);
        }
        await holdsStore.lockRows(tx, table, ids);
        if (table === 'users' && first === 'hold' && stop === 'between its locks') {
          await held(tx, true);
        }
      },
    };
    const enrollmentsAtHold = createEnrollmentSide({ settings, now: () => holdAt });
    /** After all of `path`'s work, before its commit, when it is first and `stop` says so. */
    const beforeCommit = async <T>(tx: Transaction, path: 'hold' | 'offer', done: T) => {
      if (first === path && stop === 'before its commit') await held(tx, true);
      return done;
    };
    const offering = database.$transaction(
      async (tx) =>
        beforeCommit(
          tx,
          'offer',
          await createRemedyOffer({
            enrollments: enrollmentsAtHold,
            settings,
            clock: async () => WINDOW_CLOSES,
            store: offerStore,
          }).offer(tx, sessionId),
        ),
      { timeout: 30_000 },
    );
    const holding = database.$transaction(
      async (tx) =>
        beforeCommit(
          tx,
          'hold',
          await placeHold(
            tx,
            { userId: confirmed.studentId, gender: FEMALE },
            { packageId, slotId },
            {
              notices: NO_PUSH,
              terms: {
                now: holdAt,
                ttlMinutes: 10,
                graceMinutes: 5,
                leadHours: 24,
                bufferWeeks: async () => 0,
                windowDays: async () => 14, // T070 (rule d)
              },
              orders: orderStandingsOf,
              store: placing,
            },
          ),
        ),
      { timeout: 30_000 },
    );
    const [offered, placed] = await Promise.allSettled([offering, holding]);
    for (const outcome of [offered, placed]) {
      if (outcome.status === 'rejected') expect(isDeadlock(outcome.reason)).toBe(false);
    }
    return { offered, placed, sessionId, slotId };
  }

  // Each order held between its locks and, apart, before its commit (PR #132's review, round 1,
  // Minor 1), as P4, P5 and P7 are.
  it.each([
    ['hold', 'between its locks'],
    ['hold', 'before its commit'],
    ['offer', 'between its locks'],
    ['offer', 'before its commit'],
  ] as const)(
    'the %s first, held %s: both end, no deadlock, and the hold’s session and the proposal never on the same time',
    async (first, stop) => {
      const { offered, placed, sessionId } = await race(first, stop);
      expect(offered.status).toBe('fulfilled');
      const remedy = await remedyOf(sessionId);
      if (first === 'hold') {
        expect(placed.status).toBe('fulfilled');
        // The hold's Thursday 12-17 09:30 is an open hold: the proposal moves to 12-24.
        expect(remedy?.proposedDate).toEqual(new Date('2026-12-24T00:00:00Z'));
      } else {
        // The proposal reserves 12-17 09:00 to 10:00: the hold's 09:30 is refused.
        expect(remedy?.proposedDate).toEqual(new Date('2026-12-17T00:00:00Z'));
        expect(placed.status).toBe('rejected');
        expect(placed.status === 'rejected' ? (placed.reason as { code?: string }).code : '').toBe(
          'SLOT_TAKEN',
        );
      }
    },
  );
});
