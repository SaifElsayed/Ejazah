// T059 of specs/004-sessions/tasks.md — a ruling's revision and the correction of an outcome nobody
// disputed over the real tables as the application role (SRS FR-DISPUTE-7; FR-439, FR-472, FR-495;
// research R-308, «A ruling's revision», R-323 GAP-3; contracts/kernel.md, the revision's and the
// correction's rows; the notes under T059, Q1 (a) and F2), keyed through the kernel's
// `IdempotencyService.runOn` on the call's transaction, as the administrator kind runs it.
//
//   - A revision writes the session's `status`, `settled_by_admin_id` and `admin_settled_at` and one
//     `dispute_revised` row (the outcomes before and after, the dispute in `case_id`); the ruling's
//     `resolution`, `resolution_notes`, `resolved_by_admin_id` and `resolved_at` stay as ruled after
//     two revisions, whose rows are kept in order. `notUndone` names a suspension, a ban and an
//     ended enrollment. Refused, writing nothing: the window closed, a remedy existing, a dispute
//     open, a later ruling, an outage reclassification.
//   - A correction writes one `outcome_corrected` row; refused, writing nothing, in F2's cases; a
//     participant may dispute the corrected outcome inside the window.
//   - A repeated `idempotencyKey` answers the first result and writes no second event or status
//     change; the same key with another input is `CONFLICT`.
//   - No remedy is offered by either: the offer finds the session owed nothing until the window's
//     close, and offers it after.
//   - The probe: a revision and a second dispute raised on the same session at once, both orders,
//     the first held between its locks and before its commit; no deadlock, one consistent state.
//
// Committed rows, each case a world of its own; the session's window is read by the database's
// clock, the offer's by a stand-in.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createEnrollmentSide } from '../../apps/api/src/modules/booking/index.js';
import {
  createRemedyOffer,
  type EnrollmentSide,
  createRevisions,
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
import { DomainError } from '../../apps/api/src/platform/errors/domain-error.js';
import { IdempotencyRepository } from '../../apps/api/src/platform/idempotency/idempotency.repository.js';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service.js';
import type { Logger } from '../../apps/api/src/platform/logging/logger.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
import { addHours } from '../../packages/time/src/index.js';
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
  idempotency_key_ttl_hours: 24,
  makeup_choice_window_days: 7,
  makeup_counter_answer_hours: 72,
  first_session_lead_hours: 24,
  slot_release_buffer_weeks: 0,
  admin_list_page_size: 50,
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
  child: () => SILENT,
} as unknown as Logger;
const OPTIONS = { maxWait: 5_000, timeout: 30_000 };

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
// The paths, as `main.ts` builds them, their enrollment lock and their transaction wrapped to stop.
// ---------------------------------------------------------------------------------------------

type Path = 'revise' | 'raise';

interface Stops {
  began?: (pid: number) => void;
  locked?: () => Promise<void>;
  beforeCommit?: () => Promise<void>;
}

let stops: Record<Path, Stops> = { revise: {}, raise: {} };
const deciding = new WeakSet<object>();

const pidOf = async (tx: Transaction): Promise<number> => {
  const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
  return row?.pid ?? 0;
};

/** The path's `EnrollmentSide`, its enrollment lock told, taken, then stopped where asked. */
function sideFor(path: Path): EnrollmentSide {
  const side = createEnrollmentSide({ settings });
  return {
    ...side,
    lockEnrollments: async (tx, ids) => {
      deciding.add(tx);
      stops[path].began?.(await pidOf(tx));
      await side.lockEnrollments(tx, ids);
      await stops[path].locked?.();
    },
  };
}

/** The kernel's idempotency store, its transaction stopping before its commit for `path`. */
class StoppingKeys extends IdempotencyRepository {
  readonly #path: Path;
  constructor(path: Path) {
    super(database);
    this.#path = path;
  }
  override transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return database.$transaction(async (tx) => {
      const value = await work(tx);
      if (deciding.has(tx)) await stops[this.#path].beforeCommit?.();
      return value;
    }, OPTIONS);
  }
}

/** One administrator call's transaction, stopping before its commit where asked. */
function adminCall<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
  return database.$transaction(async (tx) => {
    const value = await work(tx);
    if (deciding.has(tx)) await stops.revise.beforeCommit?.();
    return value;
  }, OPTIONS);
}

let revisions: ReturnType<typeof createRevisions>;
/** The participant's raise, as `main.ts` builds the sessions services. */
let raising: ReturnType<typeof createSessionsServices>;

// Built once the first `beforeAll` has opened `database` (hooks run in the order they are declared),
// never at module scope, where `database` is not assigned yet (the follow-up under T059).
beforeAll(() => {
  revisions = createRevisions({
    enrollments: sideFor('revise'),
    idempotency: new IdempotencyService<Transaction>({
      store: new IdempotencyRepository(database),
      settings,
    }),
    settings,
    log: SILENT,
  });
  raising = createSessionsServices({
    transactions: transactionsOver(database),
    settings,
    video: {} as never,
    enrollmentSide: sideFor('raise'),
    store: sessionsStore,
    idempotency: new IdempotencyService<Transaction>({ store: new StoppingKeys('raise'), settings }),
  });
});

const key = (): string => `probe-${randomUUID()}`;

// ---------------------------------------------------------------------------------------------
// The world.
// ---------------------------------------------------------------------------------------------

interface WorldOptions {
  /** Hours since the session's end, by the database's clock. */
  readonly endedHoursAgo?: number;
  readonly status?: string;
  /** The ruling; null for a session never disputed. */
  readonly resolution?: string | null;
  readonly enrollmentStatus?: 'confirmed' | 'cancelled';
}

/**
 * An approved teacher and a student, their enrollment, and one session of an hour that ended
 * `endedHoursAgo` hours ago in `status`, an administrator's ruling `resolution` on it (or none).
 */
async function world({
  endedHoursAgo = 2,
  status = 'teacher_no_show',
  resolution = 'upheld',
  enrollmentStatus = 'confirmed',
}: WorldOptions = {}) {
  const offer = await makeOffer(db);
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
  const adminId = await makeAdmin(db);
  const enrollmentId = await insertRow(db, 'enrollments', {
    ...enrollmentValues(offer, studentId),
    status: enrollmentStatus,
    confirmed_at: '2026-10-04T07:01:00Z',
    ...(enrollmentStatus === 'cancelled' ? { cancellation_reason: 'teacher_suspended' } : {}),
  });
  const endsAt = new Date(addHours(new Date(), -endedHoursAgo));
  const startsAt = new Date(addHours(endsAt, -1));
  const settled =
    resolution === null ? {} : { settled_by_admin_id: adminId, admin_settled_at: endsAt };
  const sessionId = await insertRow(db, 'sessions', {
    enrollment_id: enrollmentId,
    teacher_user_id: offer.teacherId,
    student_user_id: studentId,
    sequence_number: 1,
    scheduled_date_local: '2026-11-08',
    scheduled_start_time_local: '09:00:00',
    timezone: 'Africa/Cairo',
    scheduled_start_at: startsAt.toISOString(),
    scheduled_end_at: endsAt.toISOString(),
    status,
    evaluated_at: endsAt.toISOString(),
    ...settled,
  });
  const disputeId =
    resolution === null
      ? null
      : await insertRow(db, 'disputes', {
          enrollment_id: enrollmentId,
          session_id: sessionId,
          kind: 'session_dispute',
          raised_by_user_id: studentId,
          reason: 'لم يحضر المعلم',
          status: 'resolved',
          resolution,
          resolution_notes: 'الحكم الأول',
          resolved_by_admin_id: adminId,
          resolved_at: endsAt.toISOString(),
        });
  return {
    offer,
    teacherId: offer.teacherId,
    studentId,
    adminId,
    enrollmentId,
    sessionId,
    disputeId: disputeId ?? '',
    endsAt,
  };
}

type World = Awaited<ReturnType<typeof world>>;

/** What the calls left on the world's rows. */
async function left(w: World) {
  const { rows: sessions } = await db.query<{
    status: string;
    outcome: string | null;
    admin: string | null;
    settled: boolean;
  }>(
    `SELECT status::text, outcome_under_dispute::text AS outcome, settled_by_admin_id::text AS admin,
            admin_settled_at IS NOT NULL AS settled
       FROM sessions WHERE id = $1::uuid`,
    [w.sessionId],
  );
  const { rows: disputes } = await db.query<{
    status: string;
    resolution: string | null;
    notes: string | null;
    admin: string | null;
    resolved_at: Date | null;
  }>(
    `SELECT status::text, resolution::text, resolution_notes AS notes,
            resolved_by_admin_id::text AS admin, resolved_at
       FROM disputes WHERE session_id = $1::uuid ORDER BY id`,
    [w.sessionId],
  );
  const { rows: events } = await db.query<{
    kind: string;
    before: string | null;
    after: string | null;
    case_id: string | null;
  }>(
    `SELECT kind::text, outcome_before::text AS before, outcome_after::text AS after,
            case_id::text
       FROM session_events WHERE session_id = $1::uuid ORDER BY id`,
    [w.sessionId],
  );
  const { rows: remedies } = await db.query<{ n: string }>(
    'SELECT count(*)::text AS n FROM session_remedies WHERE session_id = $1::uuid',
    [w.sessionId],
  );
  return {
    session: sessions[0],
    disputes,
    events,
    remedies: Number(remedies[0]?.n ?? '0'),
  };
}

async function refusalOf(call: Promise<unknown>): Promise<DomainError> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(thrown instanceof DomainError)) {
    throw thrown instanceof Error ? thrown : new Error('expected a DomainError');
  }
  return thrown;
}

const revise = (w: World, outcome: string, idempotencyKey = key()) =>
  adminCall((tx) =>
    revisions.reviseRuling(tx, w.adminId, {
      disputeId: w.disputeId,
      outcome: outcome as 'done',
      reason: 'مراجعة الحكم',
      idempotencyKey,
    }),
  );

const correct = (w: World, outcome: string, idempotencyKey = key()) =>
  adminCall((tx) =>
    revisions.correctOutcome(tx, w.adminId, {
      sessionId: w.sessionId,
      outcome: outcome as 'done',
      reason: 'تصحيح النتيجة',
      idempotencyKey,
    }),
  );

// ---------------------------------------------------------------------------------------------
// The revision.
// ---------------------------------------------------------------------------------------------

describe('disputes.revise over the real tables (FR-472)', () => {
  it('writes the session’s outcome and one dispute_revised row twice, the ruling unchanged, the rows in order', async () => {
    const w = await world();
    const before = await left(w);
    expect(await revise(w, 'done')).toEqual({
      outcome: {
        disputeId: w.disputeId,
        sessionStatus: 'done',
        previousStatus: 'teacher_no_show',
        notUndone: [],
      },
      replayed: false,
    });
    await revise(w, 'both_no_show');
    const after = await left(w);
    expect(after.session).toEqual({
      status: 'both_no_show',
      outcome: null,
      admin: w.adminId,
      settled: true,
    });
    expect(after.disputes).toEqual(before.disputes);
    expect(after.events).toEqual([
      { kind: 'dispute_revised', before: 'teacher_no_show', after: 'done', case_id: w.disputeId },
      { kind: 'dispute_revised', before: 'done', after: 'both_no_show', case_id: w.disputeId },
    ]);
    expect(after.remedies).toBe(0);
  });

  it.each([
    ['a suspension', { resolution: 'party_suspended' }, ['party_suspended']],
    ['a ban', { resolution: 'party_banned' }, ['party_banned']],
    ['an ended enrollment', { enrollmentStatus: 'cancelled' as const }, ['enrollment_ended']],
  ] as const)(
    'names %s in notUndone and changes nothing of it',
    async (_name, options, notUndone) => {
      const w = await world(options);
      const { outcome } = await revise(w, 'done');
      expect(outcome.notUndone).toEqual(notUndone);
      const { rows } = await db.query<{ status: string }>(
        'SELECT status::text FROM enrollments WHERE id = $1::uuid',
        [w.enrollmentId],
      );
      expect(rows[0]?.status).toBe(
        'enrollmentStatus' in options ? options.enrollmentStatus : 'confirmed',
      );
    },
  );

  it('answers a repeated key with the first result, writing no second event or status change; another input is CONFLICT', async () => {
    const w = await world();
    const sent = key();
    const first = await revise(w, 'done', sent);
    const again = await revise(w, 'done', sent);
    expect(again).toEqual({ outcome: first.outcome, replayed: true });
    const refused = await refusalOf(revise(w, 'both_no_show', sent));
    expect(refused.code).toBe('CONFLICT');
    const after = await left(w);
    expect(after.session?.status).toBe('done');
    expect(after.events.map(({ kind }) => kind)).toEqual(['dispute_revised']);
  });

  it.each<[string, WorldOptions, (w: World) => Promise<void>, string, string | undefined]>([
    [
      'the window closed',
      { endedHoursAgo: 73 },
      async () => undefined,
      'RULING_FINAL',
      'window_closed',
    ],
    [
      'a remedy existing',
      {},
      async (w) => {
        await insertRow(db, 'session_remedies', {
          session_id: w.sessionId,
          kind: 'makeup',
          status: 'proposed',
          offered_at: new Date().toISOString(),
          choice_closes_at: new Date(addHours(new Date(), 168)).toISOString(),
          snapshot_answer_window_hours: 72,
          snapshot_first_session_lead_hours: 24,
          proposed_date: '2040-01-01',
        });
      },
      'RULING_FINAL',
      'remedy_offered',
    ],
    [
      'a second dispute open',
      {},
      async (w) => {
        await db.query(
          `UPDATE sessions SET status = 'disputed', outcome_under_dispute = status WHERE id = $1::uuid`,
          [w.sessionId],
        );
        await insertRow(db, 'disputes', {
          enrollment_id: w.enrollmentId,
          session_id: w.sessionId,
          kind: 'session_dispute',
          raised_by_user_id: w.teacherId,
          reason: 'نزاع ثان',
          status: 'open',
        });
      },
      'DISPUTE_OPEN',
      undefined,
    ],
    [
      'a later ruling',
      {},
      async (w) => {
        await insertRow(db, 'disputes', {
          enrollment_id: w.enrollmentId,
          session_id: w.sessionId,
          kind: 'session_dispute',
          raised_by_user_id: w.teacherId,
          reason: 'نزاع ثان',
          status: 'resolved',
          resolution: 'upheld',
          resolution_notes: 'الحكم الثاني',
          resolved_by_admin_id: w.adminId,
          resolved_at: new Date().toISOString(),
        });
      },
      'RULING_SUPERSEDED',
      undefined,
    ],
    [
      'an outage reclassification',
      {},
      async (w) => {
        await db.query(`UPDATE sessions SET status = 'provider_outage' WHERE id = $1::uuid`, [
          w.sessionId,
        ]);
      },
      'SESSION_UNDER_REVIEW',
      undefined,
    ],
  ])('refuses %s, writing nothing', async (_name, options, arrange, code, cause) => {
    const w = await world(options);
    await arrange(w);
    const before = await left(w);
    const refused = await refusalOf(revise(w, 'done'));
    expect(refused.code).toBe(code);
    expect(refused.details).toEqual(
      cause === undefined ? undefined : [{ path: 'cause', code: cause }],
    );
    expect(await left(w)).toEqual(before);
  });

  it('offers no remedy before the window’s close after a revision, and offers it after', async () => {
    const w = await world({ status: 'done' });
    await revise(w, 'teacher_no_show');
    const enrollments = createEnrollmentSide({ settings });
    const offerAt = (at: Date) =>
      database.$transaction((tx) =>
        createRemedyOffer({ enrollments, settings, clock: async () => at }).offer(tx, w.sessionId),
      );
    expect(await offerAt(new Date(addHours(w.endsAt, 71)))).toBeNull();
    expect((await left(w)).remedies).toBe(0);
    expect(await offerAt(new Date(addHours(w.endsAt, 73)))).not.toBeNull();
    expect((await left(w)).remedies).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// The correction.
// ---------------------------------------------------------------------------------------------

describe('sessions.review.revise over the real tables (FR-439)', () => {
  it('writes the outcome and one outcome_corrected row; a participant then disputes it inside the window', async () => {
    const w = await world({ resolution: null, status: 'done' });
    expect(await correct(w, 'teacher_no_show')).toEqual({
      outcome: { sessionId: w.sessionId, sessionStatus: 'teacher_no_show', previousStatus: 'done' },
      replayed: false,
    });
    expect(await left(w)).toEqual({
      session: { status: 'teacher_no_show', outcome: null, admin: w.adminId, settled: true },
      disputes: [],
      events: [
        { kind: 'outcome_corrected', before: 'done', after: 'teacher_no_show', case_id: null },
      ],
      remedies: 0,
    });
    const raised = await raising.raiseDispute(
      { userId: w.studentId },
      { sessionId: w.sessionId, reason: 'النتيجة خاطئة', idempotencyKey: key() },
      SILENT,
    );
    expect(raised.status).toBe('open');
    expect((await left(w)).session).toMatchObject({
      status: 'disputed',
      outcome: 'teacher_no_show',
    });
  });

  it('answers a repeated key with the first result, writing nothing; another input is CONFLICT', async () => {
    const w = await world({ resolution: null, status: 'done' });
    const sent = key();
    const first = await correct(w, 'both_no_show', sent);
    expect(await correct(w, 'both_no_show', sent)).toEqual({
      outcome: first.outcome,
      replayed: true,
    });
    expect((await refusalOf(correct(w, 'student_no_show', sent))).code).toBe('CONFLICT');
    expect((await left(w)).events.map(({ kind }) => kind)).toEqual(['outcome_corrected']);
  });

  it.each<[string, WorldOptions, string, string | undefined]>([
    ['a scheduled session', { resolution: null, status: 'scheduled' }, 'CONFLICT', 'not_settled'],
    [
      'a session under review',
      { resolution: null, status: 'under_threshold' },
      'SESSION_UNDER_REVIEW',
      undefined,
    ],
    [
      'the window closed',
      { resolution: null, status: 'done', endedHoursAgo: 73 },
      'RULING_FINAL',
      'window_closed',
    ],
    ['a ruled session', { status: 'done' }, 'CONFLICT', 'ruled'],
  ])('refuses %s, writing nothing', async (_name, options, code, cause) => {
    const w = await world(options);
    const before = await left(w);
    const refused = await refusalOf(correct(w, 'both_no_show'));
    expect(refused.code).toBe(code);
    expect(refused.details?.[0]).toEqual(
      cause === undefined ? undefined : { path: 'cause', code: cause },
    );
    if (cause === 'ruled')
      expect(refused.details?.[1]).toEqual({ path: 'disputeId', code: w.disputeId });
    expect(await left(w)).toEqual(before);
  });

  it('offers no remedy before the window’s close after a correction, and offers it after', async () => {
    const w = await world({ resolution: null, status: 'done' });
    await correct(w, 'teacher_no_show');
    const enrollments = createEnrollmentSide({ settings });
    const offerAt = (at: Date) =>
      database.$transaction((tx) =>
        createRemedyOffer({ enrollments, settings, clock: async () => at }).offer(tx, w.sessionId),
      );
    expect(await offerAt(new Date(addHours(w.endsAt, 71)))).toBeNull();
    expect(await offerAt(new Date(addHours(w.endsAt, 73)))).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// The probe: a revision and a second dispute raised at once.
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

const STAGINGS = [
  { name: 'between its locks', stop: 'locked' as const },
  { name: 'before its commit', stop: 'beforeCommit' as const },
];

/** Runs `first` to its stop, then `second` until it is seen waiting, then lets both end. */
async function race(
  stop: 'locked' | 'beforeCommit',
  first: { readonly path: Path; readonly go: () => Promise<unknown> },
  second: { readonly path: Path; readonly go: () => Promise<unknown> },
): Promise<[PromiseSettledResult<unknown>, PromiseSettledResult<unknown>]> {
  const held = signal<void>();
  const opened = signal<void>();
  stops[first.path] = {
    [stop]: async () => {
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
  stops = { revise: {}, raise: {} };
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
  'a revision and a second dispute raised on the same session at once, the first held $name',
  ({ stop }) => {
    const raise = (w: World) => () =>
      raising.raiseDispute(
        { userId: w.studentId },
        { sessionId: w.sessionId, reason: 'نزاع ثان', idempotencyKey: key() },
        SILENT,
      );

    it('the revision first: no deadlock, the revised outcome then disputed', async () => {
      const w = await world();
      const [revised, raised] = await race(
        stop,
        { path: 'revise', go: () => revise(w, 'done') },
        { path: 'raise', go: raise(w) },
      );
      expect(codeOf(revised)).toBe('answered');
      expect(codeOf(raised)).toBe('answered');
      const after = await left(w);
      expect(after.session).toMatchObject({ status: 'disputed', outcome: 'done' });
      expect(after.events.map(({ kind }) => kind)).toEqual(['dispute_revised', 'dispute_raised']);
      expect(after.disputes.map(({ status }) => status)).toEqual(['resolved', 'open']);
    });

    it('the raise first: no deadlock, the revision refused DISPUTE_OPEN, writing nothing', async () => {
      const w = await world();
      const [raised, revised] = await race(
        stop,
        { path: 'raise', go: raise(w) },
        { path: 'revise', go: () => revise(w, 'done') },
      );
      expect(codeOf(raised)).toBe('answered');
      expect(codeOf(revised)).toBe('DISPUTE_OPEN');
      const after = await left(w);
      expect(after.session).toMatchObject({ status: 'disputed', outcome: 'teacher_no_show' });
      expect(after.events.map(({ kind }) => kind)).toEqual(['dispute_raised']);
    });
  },
);
