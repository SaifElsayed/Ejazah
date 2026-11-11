// B39's cross-lane probes (specs/004-sessions/tasks.md, T034, T036 and T064; contracts/kernel.md,
// the rows «a dispute resolved `party_suspended` or `party_banned`», «a `student_suspended` case
// closed» and the two manual-case rows; `003:T005`'s rules, the header of
// `apps/api/src/platform/db/row-lock.ts`), over the real tables as the application role, each path
// built as `createAdminServices` builds it:
//
//   - P1: T036's `cases.dismiss` of a `student_suspended` case (the fault confirmed) against T064's
//     `cases.openManual` handing the same frozen remedy to the student's manual case. One wins: the
//     remedy is the new fault case's, or the manual case's; the other hands nothing
//     (`REMEDY_NOT_OPEN`, or the dismissal finding no open remedy).
//   - P2: T034's `party_suspended` ruling against a student against T036's `cases.resolve` of that
//     student's open `student_suspended` case, the student active again. The resolve commits first,
//     or waits and is refused `STUDENT_SUSPENDED`, writing nothing.
//   - P3: T064's `cases.openManual` with no remedy against T036's cleared `cases.resolve` on the
//     same enrollment. Both commit.
//
// Each probe runs in both orders and in two stagings (B37's lesson, the follow-up under T021): the
// first path held between two of its locks, just after the row the other path needs, and held
// before its commit. The second path is then seen waiting on a lock before the first goes on. Each
// asserts no deadlock (`isDeadlock` false), one winner, and the other refused or changing nothing.
// The stops wrap only a path's first call (its backend's pid) and one lock; nothing else differs
// from the composed services. Seen red first, each with one lock-order mutant, a deadlock: P1 with
// `handOff` locking the session and the remedy before the enrollment, P2 with the clearing locking
// the enrollment before the accounts, P3 with the manual case locking the student's account after
// the enrollment.
//
// Every world is committed, as `suspension-case.spec.ts` builds it: accounts, a Thursday 09:00 Cairo
// slot and a four-session enrollment confirmed by the job; the student suspended and reinstated
// through identity's `StandingService`, booking's subscriber bound to its registry as `main.ts`
// binds it.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

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
import { caseRecordOf, closeCase } from '../../apps/api/src/modules/moderation/index.js';
import { orderStandingsOf } from '../../apps/api/src/modules/payments/index.js';
import {
  type CaseClosingService,
  createCaseClosing,
  createCompletion,
  createDisputeResolution,
  createManualCase,
  createRemedyCase,
  createRemedyOffer,
  createSuspensionCase,
  disputeResolutionStore,
  type EnrollmentSide,
  type ManualCaseService,
  remedyCaseStore,
} from '../../apps/api/src/modules/sessions/index.js';
import { openRequestOf } from '../../apps/api/src/modules/verification/index.js';
import { isDeadlock } from '../../apps/api/src/platform/db/db-errors.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import { DomainError } from '../../apps/api/src/platform/errors/domain-error.js';
import { IdempotencyRepository } from '../../apps/api/src/platform/idempotency/idempotency.repository.js';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
import {
  confirmationWorld,
  NOW,
  settings as worldSettings,
  type World,
} from './confirmation-world';
import { connectAsApplication, type Db, insertRow, makeAdmin } from './harness';

const SETTINGS: Readonly<Record<string, number>> = {
  dispute_window_hours: 72,
  makeup_choice_window_days: 7,
  makeup_counter_answer_hours: 72,
  first_session_lead_hours: 24,
  slot_release_buffer_weeks: 0,
  slot_hold_ttl_minutes: 10,
  slot_hold_grace_minutes: 5,
  admin_list_page_size: 50,
  repeated_absence_flag_count: 5,
  idempotency_key_ttl_hours: 24,
};
const settings: SettingsReader = {
  read: async (key, schema) => {
    if (!(key in SETTINGS)) throw new Error(`unexpected setting ${key}`);
    return schema.parse(SETTINGS[key]);
  },
};
/** The closings' clock: after the reinstatement, before the sessions' Thursdays. */
const AT = new Date('2026-11-04T08:00:00Z');
const SILENT = { info: () => undefined, warn: () => undefined };
const OPTIONS = { maxWait: 5_000, timeout: 30_000 };

let database: Database;
let db: Db;
let admin: string;
let standing: StandingService;

beforeAll(async () => {
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 8,
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

// ---------------------------------------------------------------------------------------------
// The paths, as `createAdminServices` composes them, their first call and one lock wrapped to stop.
// ---------------------------------------------------------------------------------------------

type Path = 'closing' | 'manual' | 'ruling';

interface Stops {
  began?: (pid: number) => void;
  locked?: () => Promise<void>;
  beforeCommit?: () => Promise<void>;
}

let stops: Record<Path, Stops> = { closing: {}, manual: {}, ruling: {} };
const deciding = new WeakSet<object>();
const stopped = new WeakSet<object>();

const pidOf = async (tx: Transaction): Promise<number> => {
  const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
  return row?.pid ?? 0;
};

/** The path's first call on `tx`: its backend's pid told, before any lock. */
async function begin(path: Path, tx: Transaction): Promise<void> {
  if (deciding.has(tx)) return;
  deciding.add(tx);
  stops[path].began?.(await pidOf(tx));
}

/** The path's stopping lock: taken, then the stop the probe set after it, once per transaction. */
async function lockedAt(path: Path, tx: Transaction, take: () => Promise<void>): Promise<void> {
  await begin(path, tx);
  await take();
  if (stopped.has(tx)) return;
  stopped.add(tx);
  await stops[path].locked?.();
}

/** One transaction of `path`, stopping before its commit where asked. */
function run<T>(path: Path, work: (tx: Transaction) => Promise<T>): Promise<T> {
  return database.$transaction(async (tx) => {
    const value = await work(tx);
    if (deciding.has(tx)) await stops[path].beforeCommit?.();
    return value;
  }, OPTIONS);
}

const enrollments = createEnrollmentSide({ settings, now: () => AT });

/** Booking's `EnrollmentSide`, its enrollment lock the path's stop. */
function sideFor(path: Path): EnrollmentSide {
  return {
    ...enrollments,
    lockEnrollments: (tx, ids) => lockedAt(path, tx, () => enrollments.lockEnrollments(tx, ids)),
  };
}

/**
 * T035's closing over T036's suspension service: its first call the case read, its stop the
 * enrollment's lock (the fault confirmed: its first lock; cleared: after both accounts and the
 * teacher's slots key, before the sessions).
 */
const closing: CaseClosingService = createCaseClosing({
  log: SILENT,
  suspension: createSuspensionCase({
    enrollments: sideFor('closing'),
    offers: createRemedyOffer({ enrollments, settings, clock: async () => AT, log: SILENT }),
    log: SILENT,
    clock: async () => AT,
  }),
  store: {
    caseRecordOf: async (tx, caseId) => {
      await begin('closing', tx);
      return caseRecordOf(tx, caseId);
    },
    closeCase,
  },
});

/**
 * T064's manual case: its first call the key's claim, its stop the enrollment's lock (no remedy:
 * its first lock; with a remedy: `handOff`'s, after both accounts and the teacher's slots key,
 * before the session and the remedy). Built per call, over the client `beforeAll` opens.
 */
function manualFor(): ManualCaseService {
  const idempotency = new IdempotencyService({
    store: new IdempotencyRepository(database),
    settings,
  });
  return createManualCase({
    enrollments: sideFor('manual'),
    idempotency: {
      runOn: async (tx, request, effect) => {
        await begin('manual', tx);
        return idempotency.runOn(tx, request, effect);
      },
    },
    log: SILENT,
    remedyCase: createRemedyCase({
      log: SILENT,
      store: {
        ...remedyCaseStore,
        lockEnrollments: (tx, ids) =>
          lockedAt('manual', tx, () => remedyCaseStore.lockEnrollments(tx, ids)),
      },
    }),
  });
}

/** T034's ruling, over the `StandingService` `beforeAll` builds: its first lock (the party's account) its stop. */
function rulingFor() {
  return createDisputeResolution({
    enrollments,
    standing,
    lockActiveHolds: (tx, userId) => lockActiveHoldsOf(tx, userId),
    completion: createCompletion({ enrollments, settings }),
    log: SILENT,
    store: {
      ...disputeResolutionStore,
      lockAccount: (tx, id) =>
        lockedAt('ruling', tx, () => disputeResolutionStore.lockAccount(tx, id)),
    },
  });
}

// ---------------------------------------------------------------------------------------------
// The world.
// ---------------------------------------------------------------------------------------------

const { world, order } = confirmationWorld(() => database);

/** A confirmed four-session recitation enrollment, the roles onboarding writes. */
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

async function sessionNumbered(enrollmentId: string, sequenceNumber: number): Promise<string> {
  const { id } = await database.session.findFirstOrThrow({
    where: { enrollmentId, sequenceNumber },
    select: { id: true },
  });
  return id;
}

/** The student suspended (the case opened, the scheduled sessions cancelled), then reinstated. */
async function suspendedAndReinstated(on: World): Promise<string> {
  await database.$transaction((tx) => standing.suspendStudent(tx, admin, on.studentId));
  const { id } = await database.dispute.findFirstOrThrow({
    where: { enrollmentId: on.enrollmentId, reason: 'student_suspended', status: 'open' },
    select: { id: true },
  });
  await database.$transaction((tx) => standing.reinstateStudent(tx, admin, on.studentId));
  return id;
}

async function caseRow(caseId: string) {
  return database.dispute.findUniqueOrThrow({
    where: { id: caseId },
    select: { status: true, reason: true },
  });
}

async function accountOf(userId: string): Promise<string> {
  return (await database.user.findUniqueOrThrow({ where: { id: userId } })).accountStatus;
}

const dismissing = (caseId: string) => () =>
  run('closing', (tx) => closing.dismiss(tx, admin, { caseId, note: 'ثبت الخطأ' }));

const resolving = (caseId: string) => () =>
  run('closing', (tx) => closing.resolve(tx, admin, { caseId, note: 'بُرّئ الطالب' }));

function openingManual(enrollmentId: string, remedyId?: string) {
  return () =>
    run('manual', (tx) =>
      manualFor().openManual(tx, admin, {
        enrollmentId,
        party: 'student',
        reason: 'شكوى عبر الهاتف',
        idempotencyKey: `cross-lane-${randomUUID()}`,
        ...(remedyId === undefined ? {} : { remedyId }),
      }),
    );
}

// ---------------------------------------------------------------------------------------------
// The race.
// ---------------------------------------------------------------------------------------------

async function seenWaiting(pid: number): Promise<void> {
  for (let look = 0; look < 200; look += 1) {
    const { rows } = await db.query<{ waiting: boolean }>(
      `SELECT wait_event_type = 'Lock' AS waiting FROM pg_stat_activity WHERE pid = $1`,
      [pid],
    );
    if (rows[0]?.waiting === true) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`backend ${String(pid)} never waited on a lock`);
}

function signal<T>(): { readonly give: (value: T) => void; readonly given: Promise<T> } {
  let give = (_value: T): void => undefined;
  const given = new Promise<T>((resolve) => {
    give = resolve;
  });
  return { give, given };
}

interface Staging {
  readonly name: string;
  readonly stop: 'locked' | 'beforeCommit';
}

const STAGINGS: readonly Staging[] = [
  { name: 'between its locks', stop: 'locked' },
  { name: 'before its commit', stop: 'beforeCommit' },
];

/** Runs `first` to its stop, then `second` until it is seen waiting, then lets both end. */
async function race(
  staging: Staging,
  first: { readonly path: Path; readonly go: () => Promise<unknown> },
  second: { readonly path: Path; readonly go: () => Promise<unknown> },
): Promise<[PromiseSettledResult<unknown>, PromiseSettledResult<unknown>]> {
  const held = signal<void>();
  const opened = signal<void>();
  stops[first.path] = {
    [staging.stop]: async () => {
      held.give();
      await opened.given;
    },
  };
  const firstRun = first.go();
  let secondRun: Promise<unknown> | undefined;
  try {
    await Promise.race([held.given, firstRun]);
    const began = signal<number>();
    stops[second.path] = { began: began.give };
    secondRun = second.go();
    await seenWaiting(
      await Promise.race([
        began.given,
        secondRun.then(
          () => -1,
          () => -1,
        ),
      ]),
    );
  } finally {
    opened.give();
  }
  const settled = await Promise.allSettled([firstRun, secondRun]);
  stops = { closing: {}, manual: {}, ruling: {} };
  for (const outcome of settled) {
    if (outcome.status === 'rejected') expect(isDeadlock(outcome.reason)).toBe(false);
  }
  return settled as [PromiseSettledResult<unknown>, PromiseSettledResult<unknown>];
}

function codeOf(result: PromiseSettledResult<unknown>): string {
  if (result.status === 'fulfilled') return 'answered';
  if (result.reason instanceof DomainError) return result.reason.code;
  throw result.reason;
}

// ---------------------------------------------------------------------------------------------
// P1: the fault confirmed against a hand-off of the same remedy to the student's manual case.
// ---------------------------------------------------------------------------------------------

describe.each(STAGINGS)(
  'P1: a suspension case dismissed against the same frozen remedy handed to a manual case, the first held $name',
  (staging) => {
    async function racing() {
      const on = await confirmedWorld();
      const s1 = await sessionNumbered(on.enrollmentId, 1);
      await database.session.update({ where: { id: s1 }, data: { status: 'teacher_no_show' } });
      const { id: remedyId } = await database.sessionRemedy.create({
        data: {
          sessionId: s1,
          kind: 'makeup',
          status: 'awaiting_choice',
          offeredAt: new Date('2026-11-02T08:00:00Z'),
          choiceClosesAt: new Date('2026-11-09T08:00:00Z'),
          snapshotAnswerWindowHours: 72,
          snapshotFirstSessionLeadHours: 24,
          proposedDate: new Date('2026-12-10T00:00:00Z'),
        },
        select: { id: true },
      });
      const caseId = await suspendedAndReinstated(on);
      // The suspension froze the open remedy; a hand-off takes a frozen one too (F6).
      expect(
        (await database.sessionRemedy.findUniqueOrThrow({ where: { id: remedyId } })).status,
      ).toBe('frozen');
      const remedy = () =>
        database.sessionRemedy.findUniqueOrThrow({
          where: { id: remedyId },
          select: { status: true, caseId: true },
        });
      const casesOf = (reason: string) =>
        database.dispute.findMany({
          where: { enrollmentId: on.enrollmentId, reason },
          select: { id: true },
        });
      return { on, caseId, remedyId, remedy, casesOf };
    }

    it('the dismissal first: no deadlock, the remedy the fault case’s, the hand-off refused REMEDY_NOT_OPEN', async () => {
      const { on, caseId, remedyId, remedy, casesOf } = await racing();
      const [dismissed, handed] = await race(
        staging,
        { path: 'closing', go: dismissing(caseId) },
        { path: 'manual', go: openingManual(on.enrollmentId, remedyId) },
      );
      expect(codeOf(dismissed)).toBe('answered');
      expect(codeOf(handed)).toBe('REMEDY_NOT_OPEN');
      const [fault] = await casesOf('student_fault_confirmed');
      expect(await remedy()).toEqual({ status: 'refund_case', caseId: fault?.id });
      expect(await casesOf('admin_opened_for_student')).toEqual([]);
      expect((await caseRow(caseId)).status).toBe('dismissed');
    });

    it('the hand-off first: no deadlock, the remedy the manual case’s, the dismissal handing nothing', async () => {
      const { on, caseId, remedyId, remedy, casesOf } = await racing();
      const [handed, dismissed] = await race(
        staging,
        { path: 'manual', go: openingManual(on.enrollmentId, remedyId) },
        { path: 'closing', go: dismissing(caseId) },
      );
      expect(codeOf(handed)).toBe('answered');
      expect(codeOf(dismissed)).toBe('answered');
      const [manualCase] = await casesOf('admin_opened_for_student');
      expect(manualCase).toBeDefined();
      expect(await remedy()).toEqual({ status: 'refund_case', caseId: manualCase?.id });
      expect((await caseRow(caseId)).status).toBe('dismissed');
      expect(
        (await database.enrollment.findUniqueOrThrow({ where: { id: on.enrollmentId } })).status,
      ).toBe('cancelled');
    });
  },
);

// ---------------------------------------------------------------------------------------------
// P2: a ruling's suspension of the student against the clearing of their suspension case.
// ---------------------------------------------------------------------------------------------

describe.each(STAGINGS)(
  'P2: a party_suspended ruling against the student against the clearing of their suspension case, the first held $name',
  (staging) => {
    async function racing() {
      const on = await confirmedWorld();
      // The first session disputed before the suspension, its outcome frozen.
      const s1 = await sessionNumbered(on.enrollmentId, 1);
      await database.session.update({
        where: { id: s1 },
        data: {
          status: 'disputed',
          outcomeUnderDispute: 'student_no_show',
          evaluatedAt: new Date('2026-11-05T08:03:00Z'),
        },
      });
      const disputeId = await insertRow(db, 'disputes', {
        enrollment_id: on.enrollmentId,
        session_id: s1,
        kind: 'session_dispute',
        raised_by_user_id: on.studentId,
        reason: 'لم يتغيب الطالب',
        status: 'open',
      });
      const caseId = await suspendedAndReinstated(on);
      expect(await accountOf(on.studentId)).toBe('active');
      const suspending = () =>
        run('ruling', (tx) =>
          rulingFor().resolve(tx, admin, {
            disputeId,
            reason: 'ثبت من السجل',
            resolution: 'party_suspended',
            party: 'student',
          }),
        );
      const remedies = () =>
        database.sessionRemedy.count({ where: { session: { enrollmentId: on.enrollmentId } } });
      const disputeStatus = async () =>
        (await database.dispute.findUniqueOrThrow({ where: { id: disputeId } })).status;
      return { on, caseId, suspending, remedies, disputeStatus };
    }

    it('the ruling first: no deadlock, the student suspended, the clearing refused STUDENT_SUSPENDED writing nothing', async () => {
      const { on, caseId, suspending, remedies, disputeStatus } = await racing();
      const [ruled, cleared] = await race(
        staging,
        { path: 'ruling', go: suspending },
        { path: 'closing', go: resolving(caseId) },
      );
      expect(codeOf(ruled)).toBe('answered');
      expect(codeOf(cleared)).toBe('STUDENT_SUSPENDED');
      expect(await accountOf(on.studentId)).toBe('suspended');
      expect(await disputeStatus()).toBe('resolved');
      expect((await caseRow(caseId)).status).toBe('open');
      expect(await remedies()).toBe(0);
    });

    it('the clearing first: no deadlock, the case resolved with its sessions offered, then the student suspended', async () => {
      const { on, caseId, suspending, remedies, disputeStatus } = await racing();
      const [cleared, ruled] = await race(
        staging,
        { path: 'closing', go: resolving(caseId) },
        { path: 'ruling', go: suspending },
      );
      expect(codeOf(cleared)).toBe('answered');
      expect(codeOf(ruled)).toBe('answered');
      expect((await caseRow(caseId)).status).toBe('resolved');
      expect(await remedies()).toBe(3);
      expect(await accountOf(on.studentId)).toBe('suspended');
      expect(await disputeStatus()).toBe('resolved');
    });
  },
);

// ---------------------------------------------------------------------------------------------
// P3: a manual case with no remedy against the clearing on the same enrollment.
// ---------------------------------------------------------------------------------------------

describe.each(STAGINGS)(
  'P3: a manual case with no remedy against the clearing of a suspension case on the same enrollment, the first held $name',
  (staging) => {
    async function racing() {
      const on = await confirmedWorld();
      const caseId = await suspendedAndReinstated(on);
      const check = async () => {
        expect((await caseRow(caseId)).status).toBe('resolved');
        expect(
          await database.sessionRemedy.count({
            where: { session: { enrollmentId: on.enrollmentId } },
          }),
        ).toBe(4);
        expect(
          await database.dispute.count({
            where: {
              enrollmentId: on.enrollmentId,
              reason: 'admin_opened_for_student',
              status: 'open',
            },
          }),
        ).toBe(1);
      };
      return { on, caseId, check };
    }

    it('the manual case first: no deadlock, both commit', async () => {
      const { on, caseId, check } = await racing();
      const [opened, cleared] = await race(
        staging,
        { path: 'manual', go: openingManual(on.enrollmentId) },
        { path: 'closing', go: resolving(caseId) },
      );
      expect(codeOf(opened)).toBe('answered');
      expect(codeOf(cleared)).toBe('answered');
      await check();
    });

    it('the clearing first: no deadlock, both commit', async () => {
      const { on, caseId, check } = await racing();
      const [cleared, opened] = await race(
        staging,
        { path: 'closing', go: resolving(caseId) },
        { path: 'manual', go: openingManual(on.enrollmentId) },
      );
      expect(codeOf(cleared)).toBe('answered');
      expect(codeOf(opened)).toBe('answered');
      await check();
    });
  },
);
