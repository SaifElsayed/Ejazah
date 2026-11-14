// T074 of specs/004-sessions/tasks.md — paused in the app, and the hold's end recorded (FR-505,
// FR-506; DEC-69, Q11 (a); the note under T074: Q-O1 (a), Q-R7 (a), N1 to N4, Q-R4 (a), Q-R5 (a),
// Q-R2; contracts/kernel.md, the sweep's row), over the real tables as the application role. Every
// world is committed: accounts, a Thursday Cairo slot per teacher and four-session enrollments
// confirmed by the job; identity's `StandingService` with booking's subscriber bound as `main.ts`
// binds it, and sessions' `createBanLift` over the one `createRestore`, as `ban-lift.spec.ts` builds
// them. The read's instant is the database's clock; a hold is ended by moving its closing case's
// opening long ago.
//
// - the lists: a student's ban held, paused to the teacher (the ended tab and the detail, no
//   session), then after the window not paused, then after a lift confirmed and not paused; a
//   teacher's ban the same to the student; a teacher's suspension paused to the student;
// - the sweep (`close-slot-holds`' booking sweep): run twice equal to once (`runOnceAndTwice`), one
//   row and one info line; nothing inside the window, nothing when the window was lengthened before
//   it ran; a restored and closed again enrollment gets its second row; a case closed, a release or
//   a deletion's closing writes nothing;
// - A1's decision (Q-R2): a `slot_hold_ended` row changes no answer of the hold, and a lengthened
//   window holds the slot again;
// - the race of the sweep against a lift on the same enrollment: the lift first, no row; the sweep
//   first, its row before the restore's `restored` row; at once, one of the two.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { confirmEnrollment } from '../../apps/api/src/jobs/confirm-enrollment';
import { runOnceAndTwice } from '../../apps/api/src/jobs/double-run';
import {
  createEnrollmentSide,
  createSlotHoldEndSweep,
  enrollmentListsStore,
  slotHoldEndStore,
  studentEnrollmentOf,
  studentEnrollmentsOf,
  teacherStudentOf,
  teacherStudentsOf,
  terminationSubscriber,
} from '../../apps/api/src/modules/booking/index.js';
import { revokeSubjects } from '../../apps/api/src/modules/catalog/index.js';
import {
  AccountConsequences,
  StandingService,
  standingStoreOver,
} from '../../apps/api/src/modules/identity/index.js';
import { closeCase } from '../../apps/api/src/modules/moderation/index.js';
import { orderStandingsOf, refundedOf } from '../../apps/api/src/modules/payments/index.js';
import {
  createBanLift,
  createRemedyOffer,
  createRestore,
  windowDaysOf,
} from '../../apps/api/src/modules/sessions/index.js';
import { openRequestOf } from '../../apps/api/src/modules/verification/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { clockTimestamp } from '../../apps/api/src/platform/db/db-clock.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import { transactionsOver } from '../../apps/api/src/platform/db/transaction.repository.js';
import { IdempotencyRepository } from '../../apps/api/src/platform/idempotency/idempotency.repository.js';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service.js';
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
  discovery_page_size: 20,
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
/** The windows as the seed holds them; a case sets a window and puts it back. */
const SEEDED_WINDOW = 14;
const settings: SettingsReader = { read: async (key, schema) => schema.parse(SETTINGS[key]) };
const SILENT = { info: () => undefined, warn: () => undefined };
/** Long before any run: a closing whose case opened then has its 14 days' hold over. */
const LONG_AGO = new Date('2026-10-01T08:00:00Z');
/** A Thursday long after the probes' sessions, for the hold's `slotWeekTaken`. */
const LATER_THURSDAY = '2027-03-04';
const OPTIONS = { maxWait: 5_000, timeout: 60_000 };

let database: Database;
let watcher: Db;
let db: Db;
let admin: string;
let standing: StandingService;

const enrollments = createEnrollmentSide({ settings, now: () => new Date() });

beforeAll(async () => {
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 6,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  [db, watcher] = await Promise.all([connectAsApplication(), connectAsApplication()]);
  admin = await makeAdmin(db);
  const idempotency = new IdempotencyService({
    store: new IdempotencyRepository(database),
    settings,
  });
  const restoreCore = createRestore({
    enrollments,
    idempotency,
    offers: createRemedyOffer({ enrollments, settings, log: SILENT }),
    settings,
    log: SILENT,
    payments: { refundedOf },
  });
  const banLift = createBanLift({ enrollments, restore: restoreCore, settings, log: SILENT });
  const consequences = new AccountConsequences();
  consequences.subscribe(
    terminationSubscriber({ orders: orderStandingsOf, now: () => NOW, log: SILENT }),
  );
  standing = new StandingService({
    store: standingStoreOver(database),
    consequences,
    revokeSubjects,
    hasOpenIdentityRequest: async (tx, userId) => (await openRequestOf(tx, userId)) !== null,
    lift: {
      counterpartiesOf: banLift.counterpartiesOf,
      restoreClosed: banLift.restoreClosed,
      grantApprovedSubjects: async () => undefined,
    },
    log: SILENT,
    idempotency,
  });
});

afterAll(async () => {
  await Promise.all([db?.end(), watcher?.end()]);
  if (database !== undefined) await closeDatabase(database);
});

const { world, order } = confirmationWorld(() => database);

/** A confirmed four-session enrollment on Thursday 09:00 Cairo, both roles written. */
async function confirmedWorld(): Promise<World> {
  const made = await world();
  await database.userRole.createMany({
    data: [
      { userId: made.studentId, role: 'student', status: 'active' },
      { userId: made.teacherId, role: 'teacher', status: 'active' },
    ],
    skipDuplicates: true,
  });
  await confirmEnrollment({ database, settings: worldSettings, clock: () => NOW }).handle({
    paymentId: await order(made.enrollmentId),
  });
  return made;
}

const banStudent = (studentId: string) =>
  database.$transaction((tx: Transaction) => standing.banStudent(tx, admin, studentId));
const banTeacher = (teacherId: string) =>
  database.$transaction((tx: Transaction) => standing.ban(tx, admin, teacherId));
const suspendTeacher = (teacherId: string) =>
  database.$transaction((tx: Transaction) => standing.suspend(tx, admin, teacherId), OPTIONS);

let keys = 0;
const liftOf = (tx: Transaction, studentId: string) =>
  standing.keyedLift(tx, admin, {
    scope: 'students.liftBan',
    userId: studentId,
    reason: 'رفع',
    idempotencyKey: `t074-lift-${String(++keys).padStart(12, '0')}-${studentId.slice(-8)}`,
  });
const lift = (studentId: string) =>
  database.$transaction((tx: Transaction) => liftOf(tx, studentId), OPTIONS);

/** The enrollment's closing cases opened long ago: its hold over. */
const holdOver = (enrollmentId: string) =>
  database.dispute.updateMany({
    where: { enrollmentId, kind: 'compensation_case' },
    data: { createdAt: LONG_AGO },
  });

/** The enrollment's `enrollment_events` kinds, in the order they were written (by id). */
async function kindsOf(enrollmentId: string): Promise<string[]> {
  const rows = await database.enrollmentEvent.findMany({
    where: { enrollmentId },
    orderBy: { id: 'asc' },
    select: { kind: true },
  });
  return rows.map(({ kind }) => kind);
}

const holdEndsOf = async (enrollmentId: string): Promise<number> =>
  (await kindsOf(enrollmentId)).filter((kind) => kind === 'slot_hold_ended').length;

interface Line {
  readonly level: string;
  readonly fields: Record<string, unknown>;
}

/** The sweep as the job builds it, its lines kept; `transactions` and `store` narrowed by a race. */
function sweepOf(
  lines: Line[] = [],
  narrowed: {
    readonly transactions?: ReturnType<typeof transactionsOver>;
    readonly store?: typeof slotHoldEndStore;
  } = {},
) {
  return createSlotHoldEndSweep({
    transactions: narrowed.transactions ?? transactionsOver(database),
    settings,
    log: {
      info: (fields: Record<string, unknown>) => void lines.push({ level: 'info', fields }),
      error: (fields: Record<string, unknown>) => void lines.push({ level: 'error', fields }),
    } as never,
    pageSize: 200,
    ...(narrowed.store === undefined ? {} : { store: narrowed.store }),
  });
}

/** The lists as `createEnrollmentListServices` runs them: one read transaction, the database's clock. */
const windowDays = windowDaysOf(settings);
const read = <T>(work: (tx: Transaction, now: Date) => Promise<T>): Promise<T> =>
  database.$transaction(async (tx: Transaction) => work(tx, await clockTimestamp(tx)));
const page = (now: Date) => ({ now, pageSize: 20 });
const lists = {
  enrollments: (studentId: string, input: { readonly tab: 'active' | 'ended' }) =>
    read((tx, now) =>
      studentEnrollmentsOf(tx, enrollmentListsStore, studentId, input, page(now), windowDays),
    ),
  enrollment: (studentId: string, input: { readonly enrollmentId: string }) =>
    read((tx, now) =>
      studentEnrollmentOf(tx, enrollmentListsStore, studentId, input, now, windowDays),
    ),
  students: (teacherId: string, input: { readonly tab: 'active' | 'ended' }) =>
    read((tx, now) =>
      teacherStudentsOf(tx, enrollmentListsStore, teacherId, input, page(now), windowDays),
    ),
  student: (teacherId: string, input: { readonly enrollmentId: string }) =>
    read((tx, now) =>
      teacherStudentOf(tx, enrollmentListsStore, teacherId, input, now, windowDays),
    ),
};

/** Whether another student finds the enrollment's slot taken on a later Thursday. */
const slotTaken = (w: World) =>
  database.$transaction((tx: Transaction) =>
    enrollments.slotWeekTaken(tx, w.slotId, LATER_THURSDAY, '0199d0a0-0000-7000-8000-000000000000'),
  );

/** Resolves once backend `pid` waits on a lock; fails after about four seconds. */
async function seenWaiting(pid: number): Promise<void> {
  for (let look = 0; look < 200; look += 1) {
    const { rows } = await watcher.query<{ waiting: boolean }>(
      `SELECT wait_event_type IN ('Lock', 'LWLock') AS waiting FROM pg_stat_activity WHERE pid = $1`,
      [pid],
    );
    if (rows[0]?.waiting === true) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`backend ${String(pid)} never waited on a lock`);
}

const pidOf = async (tx: Transaction): Promise<number> => {
  const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
  return row?.pid ?? 0;
};

describe('the lists answer paused (FR-506), both roles', () => {
  it('a student’s ban held: paused to the teacher (ended tab and detail, no session); after the window not paused; after a lift confirmed and not paused', async () => {
    const w = await confirmedWorld();
    await banStudent(w.studentId);
    const held = await lists.students(w.teacherId, { tab: 'ended' });
    const item = held.items.find(({ enrollmentId }) => enrollmentId === w.enrollmentId);
    expect(item).toMatchObject({ status: 'cancelled', paused: true });
    expect(item).not.toHaveProperty('next');
    expect(item).not.toHaveProperty('last');
    const detail = await lists.student(w.teacherId, { enrollmentId: w.enrollmentId });
    expect(detail).toMatchObject({ paused: true, sessions: [] });

    await holdOver(w.enrollmentId);
    const over = await lists.students(w.teacherId, { tab: 'ended' });
    expect(over.items.find(({ enrollmentId }) => enrollmentId === w.enrollmentId)).toMatchObject({
      paused: false,
      last: { sequenceNumber: 4 },
    });
    expect(
      (await lists.student(w.teacherId, { enrollmentId: w.enrollmentId })).sessions,
    ).toHaveLength(4);

    const { move } = await lift(w.studentId);
    expect(move.enrollments).toEqual([{ enrollmentId: w.enrollmentId, restored: true }]);
    const active = await lists.students(w.teacherId, { tab: 'active' });
    expect(active.items.find(({ enrollmentId }) => enrollmentId === w.enrollmentId)).toMatchObject({
      status: 'confirmed',
      paused: false,
      next: { status: 'scheduled' },
    });
  });

  it('a teacher’s ban held: paused to the student (ended tab and detail, no session); after the window not paused', async () => {
    const w = await confirmedWorld();
    await banTeacher(w.teacherId);
    const held = await lists.enrollments(w.studentId, { tab: 'ended' });
    expect(held.items).toHaveLength(1);
    expect(held.items[0]).toMatchObject({ enrollmentId: w.enrollmentId, paused: true });
    expect(held.items[0]).not.toHaveProperty('last');
    expect(await lists.enrollment(w.studentId, { enrollmentId: w.enrollmentId })).toMatchObject({
      paused: true,
      sessions: [],
    });

    await holdOver(w.enrollmentId);
    const [over] = (await lists.enrollments(w.studentId, { tab: 'ended' })).items;
    expect(over).toMatchObject({ paused: false, last: { sequenceNumber: 4 } });
  });

  it('a teacher’s suspension: the enrollment confirmed and paused to the student, on the active tab, with no session', async () => {
    const w = await confirmedWorld();
    await suspendTeacher(w.teacherId);
    const [item] = (await lists.enrollments(w.studentId, { tab: 'active' })).items;
    expect(item).toMatchObject({ status: 'confirmed', paused: true });
    expect(item).not.toHaveProperty('next');
    expect(
      (await lists.enrollment(w.studentId, { enrollmentId: w.enrollmentId })).sessions,
    ).toEqual([]);
  });
});

describe('the hold’s end recorded (FR-505; the sweep close-slot-holds runs)', () => {
  it('run twice equals run once: one slot_hold_ended row and one info line { enrollmentId, kind }', async () => {
    const lines: Line[] = [];
    const { once, twice } = await runOnceAndTwice({
      world: async () => {
        const w = await confirmedWorld();
        await banStudent(w.studentId);
        await holdOver(w.enrollmentId);
        return w;
      },
      run: async () => {
        await sweepOf(lines).run();
      },
      observe: async (w) => ({
        kinds: (await kindsOf(w.enrollmentId)).filter((kind) => kind !== 'confirmed'),
        lines: lines
          .filter(({ fields }) => fields['enrollmentId'] === w.enrollmentId)
          .map(({ level, fields }) => ({ level, kind: fields['kind'], keys: Object.keys(fields) })),
        status: await database.enrollment.findUniqueOrThrow({
          where: { id: w.enrollmentId },
          select: { status: true, slotReleasedAt: true },
        }),
      }),
    });
    expect(once).toMatchObject({
      kinds: ['cancelled', 'slot_hold_ended'],
      status: { status: 'cancelled', slotReleasedAt: null },
    });
    expect((once as { lines: unknown[] }).lines).toEqual([
      { level: 'info', kind: 'student_banned', keys: ['enrollmentId', 'kind'] },
    ]);
    expect(twice).toEqual(once);
  });

  it('writes nothing inside the window', async () => {
    const w = await confirmedWorld();
    await banTeacher(w.teacherId);
    await sweepOf().run();
    expect(await holdEndsOf(w.enrollmentId)).toBe(0);
  });

  it('writes nothing when the window was lengthened by a setting change before the job ran; writes once it ends', async () => {
    const w = await confirmedWorld();
    await banStudent(w.studentId);
    await holdOver(w.enrollmentId);
    SETTINGS['ban_restore_window_days'] = 365;
    try {
      await sweepOf().run();
      expect(await holdEndsOf(w.enrollmentId)).toBe(0);
    } finally {
      SETTINGS['ban_restore_window_days'] = SEEDED_WINDOW;
    }
    await sweepOf().run();
    expect(await holdEndsOf(w.enrollmentId)).toBe(1);
  });

  it('a restored and closed again enrollment gets its second row, once', async () => {
    const w = await confirmedWorld();
    await banStudent(w.studentId);
    await holdOver(w.enrollmentId);
    await sweepOf().run();
    expect(await holdEndsOf(w.enrollmentId)).toBe(1);
    await lift(w.studentId);
    await banStudent(w.studentId);
    await sweepOf().run();
    expect(await holdEndsOf(w.enrollmentId)).toBe(1);
    await holdOver(w.enrollmentId);
    await sweepOf().run();
    await sweepOf().run();
    const kinds = (await kindsOf(w.enrollmentId)).filter((kind) => kind !== 'confirmed');
    expect(kinds).toEqual([
      'cancelled',
      'slot_hold_ended',
      'restored',
      'cancelled',
      'slot_hold_ended',
    ]);
  });

  it('writes nothing for a case closed, a slot released, or a deletion’s closing', async () => {
    const closed = await confirmedWorld();
    await banStudent(closed.studentId);
    await holdOver(closed.enrollmentId);
    const [closing] = await database.dispute.findMany({
      where: { enrollmentId: closed.enrollmentId, kind: 'compensation_case' },
      select: { id: true },
    });
    await database.$transaction((tx: Transaction) =>
      closeCase(tx, closing?.id ?? '', {
        status: 'dismissed',
        resolution: null,
        note: 'probe',
        adminId: admin,
      }),
    );

    const released = await confirmedWorld();
    await banStudent(released.studentId);
    // An administrator's release (T070), as `enrollments.releaseSlot` writes it.
    await database.enrollment.update({
      where: { id: released.enrollmentId },
      data: { slotReleasedAt: new Date() },
    });
    await database.enrollmentEvent.create({
      data: { enrollmentId: released.enrollmentId, kind: 'slot_released', occurredAt: new Date() },
    });
    await holdOver(released.enrollmentId);

    // A teacher's deletion closes `cancelled` `account_deleted` with a `teacher_ended` case (T004);
    // written here over a teacher's ban's rows, as the subscriber writes the deletion's.
    const deleted = await confirmedWorld();
    await banTeacher(deleted.teacherId);
    await database.enrollment.update({
      where: { id: deleted.enrollmentId },
      data: { cancellationReason: 'account_deleted' },
    });
    await holdOver(deleted.enrollmentId);

    await sweepOf().run();
    expect(
      await Promise.all(
        [closed, released, deleted].map(({ enrollmentId }) => holdEndsOf(enrollmentId)),
      ),
    ).toEqual([0, 0, 0]);
  });

  it('A1 (Q-R2): the row changes no answer of the hold, and a lengthened window holds the slot again', async () => {
    const w = await confirmedWorld();
    await banStudent(w.studentId);
    expect(await slotTaken(w)).toBe(true);
    await holdOver(w.enrollmentId);
    expect(await slotTaken(w)).toBe(false);
    await sweepOf().run();
    expect(await holdEndsOf(w.enrollmentId)).toBe(1);
    expect(await slotTaken(w)).toBe(false);
    SETTINGS['ban_restore_window_days'] = 365;
    try {
      expect(await slotTaken(w)).toBe(true);
    } finally {
      SETTINGS['ban_restore_window_days'] = SEEDED_WINDOW;
    }
  });
});

describe('the sweep against a lift on the same enrollment (kernel.md, the sweep’s row; Q-R5 (a))', () => {
  /** A held closing whose hold ended, ready for the sweep and for a lift. */
  async function ended(): Promise<World> {
    const w = await confirmedWorld();
    await banStudent(w.studentId);
    await holdOver(w.enrollmentId);
    return w;
  }

  it('the lift first: the sweep waits on the enrollment, reads it again restored, and writes no row', async () => {
    const w = await ended();
    let release = (): void => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let lifted = (): void => undefined;
    const liftHolds = new Promise<void>((resolve) => {
      lifted = resolve;
    });
    const liftDone = database.$transaction(async (tx) => {
      await liftOf(tx, w.studentId);
      lifted();
      await released;
    }, OPTIONS);
    await Promise.race([liftHolds, liftDone]);
    let pidOfSweep = (_pid: number): void => undefined;
    const sweepPid = new Promise<number>((resolve) => {
      pidOfSweep = resolve;
    });
    const sweep = sweepOf([], {
      store: {
        ...slotHoldEndStore,
        lockEnrollment: async (tx, enrollmentId) => {
          if (enrollmentId === w.enrollmentId) pidOfSweep(await pidOf(tx));
          await slotHoldEndStore.lockEnrollment(tx, enrollmentId);
        },
      },
    });
    const run = sweep.run();
    try {
      await seenWaiting(await sweepPid);
    } finally {
      release();
      await liftDone;
    }
    expect((await run).recorded).not.toContain(w.enrollmentId);
    expect(await holdEndsOf(w.enrollmentId)).toBe(0);
    expect(
      (await database.enrollment.findUniqueOrThrow({ where: { id: w.enrollmentId } })).status,
    ).toBe('confirmed');
  });

  it('the sweep first: the lift waits on the enrollment, then restores; the row stands before the restore’s', async () => {
    const w = await ended();
    let release = (): void => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let wrote = (): void => undefined;
    const sweepWrote = new Promise<void>((resolve) => {
      wrote = resolve;
    });
    const held = new WeakSet<object>();
    const sweep = sweepOf([], {
      transactions: {
        run: (work) =>
          database.$transaction(async (tx) => {
            const answer = await work(tx);
            if (held.has(tx)) {
              wrote();
              await released;
            }
            return answer;
          }, OPTIONS),
      },
      store: {
        ...slotHoldEndStore,
        lockEnrollment: async (tx, enrollmentId) => {
          if (enrollmentId === w.enrollmentId) held.add(tx);
          await slotHoldEndStore.lockEnrollment(tx, enrollmentId);
        },
      },
    });
    const run = sweep.run();
    await sweepWrote;
    let pidOfLift = (_pid: number): void => undefined;
    const liftPid = new Promise<number>((resolve) => {
      pidOfLift = resolve;
    });
    const liftDone = database.$transaction(async (tx) => {
      pidOfLift(await pidOf(tx));
      return liftOf(tx, w.studentId);
    }, OPTIONS);
    try {
      await seenWaiting(await liftPid);
    } finally {
      release();
      await run;
    }
    const { move } = await liftDone;
    expect(move.enrollments).toEqual([{ enrollmentId: w.enrollmentId, restored: true }]);
    const kinds = (await kindsOf(w.enrollmentId)).filter((kind) => kind !== 'confirmed');
    expect(kinds).toEqual(['cancelled', 'slot_hold_ended', 'restored']);
  });

  it('at once: one of the two orders, never a row after the restore', async () => {
    const w = await ended();
    await Promise.all([sweepOf().run(), lift(w.studentId)]);
    const kinds = (await kindsOf(w.enrollmentId)).filter((kind) => kind !== 'confirmed');
    expect([
      ['cancelled', 'restored'],
      ['cancelled', 'slot_hold_ended', 'restored'],
    ]).toContainEqual(kinds);
  });
});
