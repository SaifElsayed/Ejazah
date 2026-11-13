// T034 of specs/004-sessions/tasks.md — an administrator's ruling on a session dispute over the real
// tables as the application role (FR-421, FR-422, FR-476, FR-495; research R-308; contracts/kernel.md,
// «evaluation, a review or dispute resolution» and the `party_*` row; B39's notes under T034: Q2,
// Q3 (a), F1), `StandingService` and booking's subscriber bound as `main.ts` binds them.
//
//   - Each resolution writes R-308's final status, `outcome_under_dispute` NULL,
//     `settled_by_admin_id` and `admin_settled_at`, one `dispute_resolved` row, and the dispute
//     `resolved` with its resolution, the reason as its notes, the administrator and `resolved_at`;
//     `compensation_ordered` moves no money: no payment, case or remedy row is written (FR-476).
//   - `party_suspended` against the teacher suspends them, the subscriber ending their confirmed
//     enrollment on the ruling's transaction; `party_banned` against the student bans them.
//   - Refused, writing nothing: a closed dispute (`not_open`), a frozen outcome not yet written
//     (`not_evaluated`), and a standing move `StandingService` refuses (Q3 (a)).
//   - The two probes the task names, each in both orders and both stagings (the first path held
//     between its locks, then before its commit; B37's lesson, the follow-up under T021): a teacher's
//     `party_suspended` against a booking of that teacher's slot, and a teacher's `party_banned`
//     against a revocation or a ban of that teacher. No deadlock; one consistent outcome.
//
// Committed rows, each ruling and probe a world of its own, as `termination.spec.ts` keeps them.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
  type StandingStore,
  standingStoreOver,
} from '../../apps/api/src/modules/identity/index.js';
import { orderStandingsOf } from '../../apps/api/src/modules/payments/index.js';
import {
  createCompletion,
  createDisputeResolution,
  disputeResolutionStore,
} from '../../apps/api/src/modules/sessions/index.js';
import { isDeadlock } from '../../apps/api/src/platform/db/db-errors.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import { DomainError } from '../../apps/api/src/platform/errors/domain-error.js';
import type { RequesterGender } from '../../apps/api/src/platform/guards/requester-gender.js';
import type { Logger } from '../../apps/api/src/platform/logging/logger.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
import {
  connectAsApplication,
  type Db,
  enrollmentValues,
  insertRow,
  makeAdmin,
  makeOffer,
  makeUser,
} from './harness';

const SETTINGS: Readonly<Record<string, number>> = {
  dispute_window_hours: 72,
  admin_list_page_size: 50,
  slot_release_buffer_weeks: 0,
  first_session_lead_hours: 24,
};
const settings: SettingsReader = {
  read: async (key, schema) => {
    if (!(key in SETTINGS)) throw new Error(`unexpected setting ${key}`);
    return schema.parse(SETTINGS[key]);
  },
};
const SILENT = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as Logger;
const OPTIONS = { maxWait: 5_000, timeout: 30_000 };
const REASON = 'ثبت من السجل';

let db: Db;
let database: Database;

beforeAll(async () => {
  db = await connectAsApplication();
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 8,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
});

afterAll(async () => {
  if (database !== undefined) await closeDatabase(database);
  await db?.end();
});

// ---------------------------------------------------------------------------------------------
// The paths, as `main.ts` builds them, their first lock and their transaction wrapped only to stop.
// ---------------------------------------------------------------------------------------------

type Path = 'ruling' | 'hold' | 'standing';

interface Stops {
  began?: (pid: number) => void;
  locked?: () => Promise<void>;
  beforeCommit?: () => Promise<void>;
}

let stops: Record<Path, Stops> = { ruling: {}, hold: {}, standing: {} };
const deciding = new WeakSet<object>();

const pidOf = async (tx: Transaction): Promise<number> => {
  const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
  return row?.pid ?? 0;
};

/** The path's first lock: told, taken, then the stop the probe set after it. */
async function stoppingAt(path: Path, tx: Transaction, take: () => Promise<void>): Promise<void> {
  if (!deciding.has(tx)) {
    deciding.add(tx);
    stops[path].began?.(await pidOf(tx));
    await take();
    await stops[path].locked?.();
    return;
  }
  await take();
}

/** One transaction of `path`, stopping before its commit where asked. */
function run<T>(path: Path, work: (tx: Transaction) => Promise<T>): Promise<T> {
  return database.$transaction(async (tx) => {
    const value = await work(tx);
    if (deciding.has(tx)) await stops[path].beforeCommit?.();
    return value;
  }, OPTIONS);
}

/** The one registry, booking's subscriber bound to it as `main.ts` binds it. */
const consequences = new AccountConsequences();
consequences.subscribe(terminationSubscriber({ orders: orderStandingsOf, log: SILENT }));

/** `StandingService` as `createAdminServices` builds it, its account lock stopping for `path`. */
function standingFor(path: Path | null): StandingService {
  const store = standingStoreOver(database);
  const stopping: StandingStore =
    path === null
      ? store
      : {
          ...store,
          lockAccount: (tx, id) => stoppingAt(path, tx, () => store.lockAccount(tx, id)),
        };
  return new StandingService({
    store: stopping,
    consequences,
    revokeSubjects,
    hasOpenIdentityRequest: async () => false,
  });
}

const enrollmentSide = createEnrollmentSide({ settings, now: () => new Date() });

/** The ruling as the admin module composes it; its first lock (the party's account) stopping. */
const ruling = createDisputeResolution({
  enrollments: enrollmentSide,
  standing: standingFor(null),
  lockActiveHolds: (tx, userId) => lockActiveHoldsOf(tx, userId),
  completion: createCompletion({ enrollments: enrollmentSide, settings }),
  log: SILENT,
  store: {
    ...disputeResolutionStore,
    lockAccount: (tx, id) =>
      stoppingAt('ruling', tx, () => disputeResolutionStore.lockAccount(tx, id)),
  },
});

// ---------------------------------------------------------------------------------------------
// The world.
// ---------------------------------------------------------------------------------------------

/**
 * An approved, visible teacher with a Sunday 09:00 Cairo slot (the enrollment's) and a Monday
 * 18:00 one, a student, their confirmed enrollment, its first session disputed (the frozen outcome
 * `frozen`, an open dispute the student raised) and its second session scheduled ahead.
 */
async function world(frozen: string | null = 'teacher_no_show') {
  const offer = await makeOffer(db);
  await insertRow(db, 'user_roles', {
    user_id: offer.teacherId,
    role: 'teacher',
    status: 'active',
  });
  await insertRow(db, 'teacher_profiles', {
    user_id: offer.teacherId,
    bio: 'Probe',
    qualification_summary: 'Probe',
    verification_status: 'approved',
    approved_at: '2026-10-01T00:00:00Z',
    application_status: 'approved',
    application_submitted_at: '2026-09-30T00:00:00Z',
    payout_verified_at: '2026-10-01T00:00:00Z',
  });
  const studentId = await makeUser(db);
  await insertRow(db, 'user_roles', { user_id: studentId, role: 'student', status: 'active' });
  const enrollmentId = await insertRow(db, 'enrollments', {
    ...enrollmentValues(offer, studentId),
    status: 'confirmed',
    confirmed_at: '2026-10-04T07:01:00Z',
  });
  const mondaySlotId = await insertRow(db, 'availability_slots', {
    teacher_user_id: offer.teacherId,
    day_of_week: 1,
    start_time_local: '18:00:00',
    duration_minutes: 60,
    timezone: 'Africa/Cairo',
    is_active: true,
  });
  const session = (sequence: number, date: string, values: Record<string, unknown>) =>
    insertRow(db, 'sessions', {
      enrollment_id: enrollmentId,
      teacher_user_id: offer.teacherId,
      student_user_id: studentId,
      sequence_number: sequence,
      scheduled_date_local: date,
      scheduled_start_time_local: '09:00:00',
      timezone: 'Africa/Cairo',
      scheduled_start_at: `${date}T07:00:00Z`,
      scheduled_end_at: `${date}T08:00:00Z`,
      ...values,
    });
  const sessionId = await session(1, '2026-10-11', {
    status: 'disputed',
    outcome_under_dispute: frozen,
    evaluated_at: frozen === null ? null : '2026-10-11T08:03:00Z',
  });
  const aheadId = await session(2, '2030-01-06', { status: 'scheduled' });
  const disputeId = await insertRow(db, 'disputes', {
    enrollment_id: enrollmentId,
    session_id: sessionId,
    kind: 'session_dispute',
    raised_by_user_id: studentId,
    reason: 'لم يحضر المعلم',
    status: 'open',
  });
  const adminId = await makeAdmin(db);
  return {
    offer,
    teacherId: offer.teacherId,
    studentId,
    enrollmentId,
    sessionId,
    aheadId,
    disputeId,
    adminId,
    mondaySlotId,
  };
}

type World = Awaited<ReturnType<typeof world>>;

/** What the ruling left on the world's rows. */
async function left(w: World) {
  const one = async <T>(sql: string, id: string): Promise<T> => {
    const { rows } = await db.query<T & object>(sql, [id]);
    return rows[0] as T;
  };
  return {
    session: await one<{
      status: string;
      outcome: string | null;
      admin: string | null;
      settled: boolean;
    }>(
      `SELECT status::text, outcome_under_dispute::text AS outcome, settled_by_admin_id::text AS admin,
              admin_settled_at IS NOT NULL AS settled
         FROM sessions WHERE id = $1::uuid`,
      w.sessionId,
    ),
    dispute: await one<{
      status: string;
      resolution: string | null;
      notes: string | null;
      admin: string | null;
      closed: boolean;
    }>(
      `SELECT status::text, resolution::text, resolution_notes AS notes,
              resolved_by_admin_id::text AS admin, resolved_at IS NOT NULL AS closed
         FROM disputes WHERE id = $1::uuid`,
      w.disputeId,
    ),
    events: (
      await db.query<{ kind: string }>(
        'SELECT kind::text FROM session_events WHERE session_id = $1::uuid ORDER BY id',
        [w.sessionId],
      )
    ).rows.map(({ kind }) => kind),
    enrollment: (
      await one<{ status: string }>(
        'SELECT status::text FROM enrollments WHERE id = $1::uuid',
        w.enrollmentId,
      )
    ).status,
    ahead: (
      await one<{ status: string }>(
        'SELECT status::text FROM sessions WHERE id = $1::uuid',
        w.aheadId,
      )
    ).status,
    teacher: (
      await one<{ s: string }>(
        'SELECT account_status::text AS s FROM users WHERE id = $1::uuid',
        w.teacherId,
      )
    ).s,
    student: (
      await one<{ s: string }>(
        'SELECT account_status::text AS s FROM users WHERE id = $1::uuid',
        w.studentId,
      )
    ).s,
    cases: (
      await db.query<{ reason: string }>(
        `SELECT reason FROM disputes WHERE enrollment_id = $1::uuid AND kind = 'compensation_case' ORDER BY id`,
        [w.enrollmentId],
      )
    ).rows.map(({ reason }) => reason),
    remedies: Number(
      (
        await one<{ n: string }>(
          'SELECT count(*)::text AS n FROM session_remedies WHERE session_id = $1::uuid',
          w.sessionId,
        )
      ).n,
    ),
    payments: Number(
      (
        await one<{ n: string }>(
          'SELECT count(*)::text AS n FROM payments WHERE enrollment_id = $1::uuid',
          w.enrollmentId,
        )
      ).n,
    ),
  };
}

const resolve = (w: World, fields: Record<string, unknown>) => (tx: Transaction) =>
  ruling.resolve(tx, w.adminId, {
    disputeId: w.disputeId,
    reason: REASON,
    ...fields,
  } as Parameters<typeof ruling.resolve>[2]);

async function refusalOf(call: Promise<unknown>): Promise<DomainError> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(thrown instanceof DomainError))
    throw thrown instanceof Error ? thrown : new Error('expected a DomainError');
  return thrown;
}

// ---------------------------------------------------------------------------------------------
// The mapping and the refusals.
// ---------------------------------------------------------------------------------------------

describe('disputes.resolve over the real tables (R-308, FR-422)', () => {
  it.each([
    ['upheld', { resolution: 'upheld' }, 'teacher_no_show'],
    ['re_marked, consumed', { resolution: 're_marked', consumed: true }, 'done'],
    ['re_marked, not consumed', { resolution: 're_marked', consumed: false }, 'both_no_show'],
    [
      'no_show_recorded against the student',
      { resolution: 'no_show_recorded', against: 'student' },
      'student_no_show',
    ],
    ['compensation_ordered', { resolution: 'compensation_ordered' }, 'teacher_no_show'],
  ])(
    '%s: the final status, the ruling and one dispute_resolved row; no money, case or remedy',
    async (_name, fields, status) => {
      const w = await world();
      expect(await run('ruling', resolve(w, fields))).toEqual({
        disputeId: w.disputeId,
        sessionStatus: status,
      });
      expect(await left(w)).toEqual({
        session: { status, outcome: null, admin: w.adminId, settled: true },
        dispute: {
          status: 'resolved',
          resolution: (fields as { resolution: string }).resolution,
          notes: REASON,
          admin: w.adminId,
          closed: true,
        },
        events: ['dispute_resolved'],
        enrollment: 'confirmed',
        ahead: 'scheduled',
        teacher: 'active',
        student: 'active',
        cases: [],
        remedies: 0,
        payments: 0,
      });
    },
  );

  it('party_suspended against the teacher: the teacher suspended, their enrollment ended on the same transaction', async () => {
    const w = await world();
    await run('ruling', resolve(w, { resolution: 'party_suspended', party: 'teacher' }));
    expect(await left(w)).toMatchObject({
      session: { status: 'teacher_no_show', outcome: null, admin: w.adminId },
      dispute: { status: 'resolved', resolution: 'party_suspended' },
      events: ['dispute_resolved'],
      enrollment: 'cancelled',
      ahead: 'cancelled_by_admin',
      teacher: 'suspended',
      cases: ['teacher_ended'],
    });
  });

  it('party_banned against the student: the student banned, their enrollment cancelled with its case', async () => {
    const w = await world('student_no_show');
    await run('ruling', resolve(w, { resolution: 'party_banned', party: 'student' }));
    expect(await left(w)).toMatchObject({
      session: { status: 'student_no_show' },
      dispute: { status: 'resolved', resolution: 'party_banned' },
      enrollment: 'cancelled',
      ahead: 'cancelled_by_admin',
      student: 'banned',
      cases: ['student_banned'],
    });
  });

  it('refuses a dispute already resolved CONFLICT not_open, writing nothing', async () => {
    const w = await world();
    await run('ruling', resolve(w, { resolution: 'upheld' }));
    const before = await left(w);
    const refused = await refusalOf(
      run('ruling', resolve(w, { resolution: 're_marked', consumed: true })),
    );
    expect(refused.code).toBe('CONFLICT');
    expect(refused.details).toEqual([{ path: 'cause', code: 'not_open' }]);
    expect(await left(w)).toEqual(before);
  });

  it('refuses upheld before the evaluation CONFLICT not_evaluated, and admits re_marked then', async () => {
    const w = await world(null);
    const refused = await refusalOf(run('ruling', resolve(w, { resolution: 'upheld' })));
    expect(refused.details).toEqual([{ path: 'cause', code: 'not_evaluated' }]);
    expect((await left(w)).dispute.status).toBe('open');
    expect(await run('ruling', resolve(w, { resolution: 're_marked', consumed: false }))).toEqual({
      disputeId: w.disputeId,
      sessionStatus: 'both_no_show',
    });
  });

  it('a standing move refused refuses the whole ruling, writing nothing (Q3 (a))', async () => {
    const w = await world();
    await db.query(`UPDATE users SET account_status = 'suspended' WHERE id = $1::uuid`, [
      w.teacherId,
    ]);
    const refused = await refusalOf(
      run('ruling', resolve(w, { resolution: 'party_suspended', party: 'teacher' })),
    );
    expect(refused.code).toBe('CONFLICT');
    expect(await left(w)).toMatchObject({
      session: { status: 'disputed', outcome: 'teacher_no_show', admin: null },
      dispute: { status: 'open', resolution: null },
      events: [],
      enrollment: 'confirmed',
      ahead: 'scheduled',
    });
  });
});

// ---------------------------------------------------------------------------------------------
// The two probes.
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
  stops = { ruling: {}, hold: {}, standing: {} };
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

describe.each(STAGINGS)(
  "a teacher's party_suspended against a booking of that teacher's slot, the first held $name",
  (staging) => {
    async function racing() {
      const w = await world();
      const other = await makeUser(db);
      await insertRow(db, 'user_roles', { user_id: other, role: 'student', status: 'active' });
      const placing = {
        ...holdsStore,
        lockRows: async (
          tx: Transaction,
          table: Parameters<typeof holdsStore.lockRows>[1],
          ids: readonly string[],
        ) =>
          table === 'users'
            ? stoppingAt('hold', tx, () => holdsStore.lockRows(tx, table, ids))
            : holdsStore.lockRows(tx, table, ids),
      };
      const hold = () =>
        run('hold', (tx) =>
          placeHold(
            tx,
            { userId: other, gender: 'male' as RequesterGender },
            { packageId: w.offer.packageId, slotId: w.mondaySlotId },
            {
              terms: {
                now: new Date(),
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
        );
      const suspend = () =>
        run('ruling', resolve(w, { resolution: 'party_suspended', party: 'teacher' }));
      const activeHolds = async () =>
        (
          await db.query<{ id: string }>(
            'SELECT id FROM slot_holds WHERE student_user_id = $1::uuid AND released_at IS NULL',
            [other],
          )
        ).rows.length;
      return { w, hold, suspend, activeHolds };
    }

    it('the ruling first: no deadlock, the teacher suspended and the hold refused', async () => {
      const { w, hold, suspend, activeHolds } = await racing();
      const [ruled, held] = await race(
        staging,
        { path: 'ruling', go: suspend },
        { path: 'hold', go: hold },
      );
      expect(codeOf(ruled)).toBe('answered');
      expect(codeOf(held)).not.toBe('answered');
      expect(await activeHolds()).toBe(0);
      expect(await left(w)).toMatchObject({
        teacher: 'suspended',
        dispute: { status: 'resolved' },
      });
    });

    it('the hold first: no deadlock, the hold placed, then released by the suspension', async () => {
      const { w, hold, suspend, activeHolds } = await racing();
      const [held, ruled] = await race(
        staging,
        { path: 'hold', go: hold },
        { path: 'ruling', go: suspend },
      );
      expect(codeOf(held)).toBe('answered');
      expect(codeOf(ruled)).toBe('answered');
      expect(await activeHolds()).toBe(0);
      expect(await left(w)).toMatchObject({
        teacher: 'suspended',
        dispute: { status: 'resolved' },
      });
    });
  },
);

describe.each(STAGINGS)(
  "a teacher's party_banned against a revocation or a ban of that teacher, the first held $name",
  (staging) => {
    const other = standingFor('standing');
    const moves = {
      revocation: (w: World) => () =>
        run('standing', (tx) => other.revokeApproval(tx, w.adminId, w.teacherId, 'Probe')),
      ban: (w: World) => () => run('standing', (tx) => other.ban(tx, w.adminId, w.teacherId)),
    } as const;
    const ban = (w: World) => () =>
      run('ruling', resolve(w, { resolution: 'party_banned', party: 'teacher' }));

    it.each(['revocation', 'ban'] as const)(
      'the ruling first, then the %s: no deadlock, the teacher banned and the other refused',
      async (which) => {
        const w = await world();
        const [ruled, moved] = await race(
          staging,
          { path: 'ruling', go: ban(w) },
          { path: 'standing', go: moves[which](w) },
        );
        expect(codeOf(ruled)).toBe('answered');
        expect(codeOf(moved)).toBe('CONFLICT');
        expect(await left(w)).toMatchObject({ teacher: 'banned', dispute: { status: 'resolved' } });
      },
    );

    it('the revocation first: no deadlock, the revoked teacher then banned by the ruling', async () => {
      const w = await world();
      const [moved, ruled] = await race(
        staging,
        { path: 'standing', go: moves.revocation(w) },
        { path: 'ruling', go: ban(w) },
      );
      expect(codeOf(moved)).toBe('answered');
      expect(codeOf(ruled)).toBe('answered');
      expect(await left(w)).toMatchObject({
        teacher: 'banned',
        dispute: { status: 'resolved', resolution: 'party_banned' },
      });
    });

    it('the ban first: no deadlock, the ruling refused with the standing’s conflict, writing nothing', async () => {
      const w = await world();
      const [moved, ruled] = await race(
        staging,
        { path: 'standing', go: moves.ban(w) },
        { path: 'ruling', go: ban(w) },
      );
      expect(codeOf(moved)).toBe('answered');
      expect(codeOf(ruled)).toBe('CONFLICT');
      expect(await left(w)).toMatchObject({
        teacher: 'banned',
        session: { status: 'disputed', admin: null },
        dispute: { status: 'open', resolution: null },
      });
    });
  },
);
