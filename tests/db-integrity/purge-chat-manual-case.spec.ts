// B40's cross-lane probe (specs/004-sessions/tasks.md, T039 and B39's T064; the notes under T039,
// F13; contracts/kernel.md, the purge's row and the two manual-case rows; `003:T005`'s rule 1, the
// header of `apps/api/src/platform/db/row-lock.ts`), over the real tables as the application role:
// T039's purge (`createChatPurge`, chat's entry) against T064's `cases.openManual` with no remedy
// (`createManualCase`, sessions' entry, keyed through `runOn`), on one ended enrollment due for
// purge, with a text and one attachment stored through the storage port's local driver.
//
// Both take the enrollment's row lock: the purge before it decides (`lockEnrollmentOf`), the
// opening before it reads the enrollment again and opens the case (`EnrollmentSide.lockEnrollments`,
// then moderation's `lockCasesOf` inside `openCompensationCase`). So one waits for the other:
//
//   - the case first: the purge waits, then reads the open case under the lock: nothing purged, no
//     line, the file kept;
//   - the purge first: the opening waits, then opens its case on the purged chat (the accepted
//     order): the messages purged, the file removed, one `info` line, the case open.
//
// Never half: a purge that saw no open case committed before the case did, and a purge that commits
// after an open case committed saw it. Each order runs in two stagings (B39's precedent,
// `b39-cross-lane-races.spec.ts`): the first path held just after its enrollment lock, and held
// before its commit; the second path is then seen waiting on a lock in `pg_stat_activity` before
// the first goes on, so the order is the database's. The stops wrap the purge's store and the
// opening's first call and lock only; nothing else differs from the composed services. Seen red
// first with the purge's lock removed (`lockEnrollmentOf` taking no lock).
//
// Every row is committed through the application role and removed after the file, by exact id, by a
// connection as the OWNER role, the only role that may delete a user, an enrollment or a session
// (T065; `hold-concurrency.spec.ts`'s precedent); the store's directory is removed by its path.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createEnrollmentSide } from '../../apps/api/src/modules/booking/index.js';
import {
  type ChatPurgeStore,
  chatPurgeStore,
  createChatPurge,
} from '../../apps/api/src/modules/chat/index.js';
import {
  createManualCase,
  type EnrollmentSide,
  type ManualCaseService,
} from '../../apps/api/src/modules/sessions/index.js';
import { isDeadlock } from '../../apps/api/src/platform/db/db-errors.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import type { Transactions } from '../../apps/api/src/platform/db/transaction.repository.js';
import { IdempotencyRepository } from '../../apps/api/src/platform/idempotency/idempotency.repository.js';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service.js';
import {
  createStoragePort,
  type StoragePort,
} from '../../apps/api/src/platform/ports/storage/index.js';
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

/** The last session's end: with 48 hours and 30 days, due since 2026-11-02. */
const PAST_END = '2026-10-01T07:00:00Z';
const OPTIONS = { maxWait: 5_000, timeout: 30_000 };
const SCOPE = 'cases.openManual';

const settings: SettingsReader = {
  read: async (key, schema) => {
    if (key === 'dispute_window_hours') return schema.parse(48);
    if (key === 'chat_retention_days') return schema.parse(30);
    // `EnrollmentSide`'s and the key's retention.
    return schema.parse(24);
  },
};

let db: Db;
let database: Database;
let storage: StoragePort;
let storeRoot: string | undefined;
let admin: string;

/** Every row this file commits, by id, for the owner's removal in `afterAll`. */
const created = {
  users: [] as string[],
  admins: [] as string[],
  subjects: [] as string[],
  packages: [] as string[],
  slots: [] as string[],
  enrollments: [] as string[],
  sessions: [] as string[],
  keys: [] as string[],
};

beforeAll(async () => {
  const owner = process.env['DATABASE_URL_OWNER'];
  if (owner === undefined || owner === '') {
    throw new Error(
      'DATABASE_URL_OWNER is not set: these probes commit rows, and only the owner role can remove them',
    );
  }
  db = await connectAsApplication();
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 4,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  storeRoot = await mkdtemp(join(tmpdir(), 'ijazah-b40-purge-race-'));
  // The local driver, as development configures it, over a directory of this file's own.
  storage = createStoragePort({
    STORAGE_DRIVER: 'local',
    STORAGE_LOCAL_ROOT: storeRoot,
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  });
  admin = await makeAdmin(db);
  created.admins.push(admin);
});

afterAll(async () => {
  await db?.end();
  if (database !== undefined) await closeDatabase(database);
  if (storeRoot !== undefined) await rm(storeRoot, { recursive: true, force: true });
  if (Object.values(created).every((ids) => ids.length === 0)) return;
  const owner = new pg.Client({
    connectionString: specDatabaseUrl('DATABASE_URL_OWNER'),
    connectionTimeoutMillis: 5_000,
  });
  await owner.connect();
  try {
    await owner.query('BEGIN');
    await owner.query('DELETE FROM "idempotency_keys" WHERE scope = $1 AND key = ANY($2)', [
      SCOPE,
      created.keys,
    ]);
    await owner.query('DELETE FROM "disputes" WHERE enrollment_id = ANY($1)', [
      created.enrollments,
    ]);
    await owner.query('DELETE FROM "chat_messages" WHERE enrollment_id = ANY($1)', [
      created.enrollments,
    ]);
    await owner.query('DELETE FROM "sessions" WHERE id = ANY($1)', [created.sessions]);
    await owner.query('DELETE FROM "enrollments" WHERE id = ANY($1)', [created.enrollments]);
    await owner.query('DELETE FROM "availability_slots" WHERE id = ANY($1)', [created.slots]);
    await owner.query('DELETE FROM "packages" WHERE id = ANY($1)', [created.packages]);
    await owner.query('DELETE FROM "subjects" WHERE id = ANY($1)', [created.subjects]);
    await owner.query('DELETE FROM "users" WHERE id = ANY($1)', [created.users]);
    await owner.query('DELETE FROM "admin_users" WHERE id = ANY($1)', [created.admins]);
    await owner.query('COMMIT');
    // Nothing of this file is left (the shared database as it was found).
    const { rows } = await owner.query<{ left: string }>(
      `SELECT ((SELECT count(*) FROM "idempotency_keys" WHERE scope = $1 AND key = ANY($2))
             + (SELECT count(*) FROM "disputes" WHERE enrollment_id = ANY($3))
             + (SELECT count(*) FROM "chat_messages" WHERE enrollment_id = ANY($3))
             + (SELECT count(*) FROM "sessions" WHERE id = ANY($4))
             + (SELECT count(*) FROM "enrollments" WHERE id = ANY($3))
             + (SELECT count(*) FROM "users" WHERE id = ANY($5))
             + (SELECT count(*) FROM "admin_users" WHERE id = ANY($6)))::text AS left`,
      [SCOPE, created.keys, created.enrollments, created.sessions, created.users, created.admins],
    );
    if (rows[0]?.left !== '0') throw new Error(`cleanup left ${String(rows[0]?.left)} rows`);
  } catch (error: unknown) {
    await owner.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await owner.end();
  }
});

// ---------------------------------------------------------------------------------------------
// The world: a completed enrollment due for purge, a text and a stored attachment.
// ---------------------------------------------------------------------------------------------

interface Chat {
  readonly enrollmentId: string;
  readonly textId: string;
  readonly fileId: string;
  readonly key: string;
}

async function chatDue(): Promise<Chat> {
  const offer = await makeOffer(db);
  const studentId = await makeUser(db);
  created.users.push(offer.teacherId, studentId);
  created.subjects.push(offer.subjectId);
  created.packages.push(offer.packageId);
  created.slots.push(offer.slotId);
  const enrollmentId = await insertRow(db, 'enrollments', {
    ...enrollmentValues(offer, studentId),
    status: 'completed',
    confirmed_at: '2026-09-01T07:00:00Z',
  });
  created.enrollments.push(enrollmentId);
  const sessionId = await insertRow(db, 'sessions', {
    enrollment_id: enrollmentId,
    teacher_user_id: offer.teacherId,
    student_user_id: studentId,
    sequence_number: 1,
    scheduled_date_local: '2026-10-01',
    scheduled_start_time_local: '09:00:00',
    timezone: 'Africa/Cairo',
    scheduled_start_at: '2026-10-01T06:00:00Z',
    scheduled_end_at: PAST_END,
    status: 'done',
  });
  created.sessions.push(sessionId);
  const textId = await insertRow(db, 'chat_messages', {
    enrollment_id: enrollmentId,
    sender_user_id: studentId,
    body: 'السلام عليكم',
    sent_at: '2026-09-02T07:00:00Z',
  });
  const key = `chat/${enrollmentId}/race.pdf`;
  await storage.put(key, Buffer.from('%PDF-1.7 race probe'), 'application/pdf');
  const fileId = await insertRow(db, 'chat_messages', {
    enrollment_id: enrollmentId,
    sender_user_id: offer.teacherId,
    attachment_key: key,
    attachment_filename: 'الدرس.pdf',
    attachment_mime: 'application/pdf',
    sent_at: '2026-09-02T07:01:00Z',
  });
  return { enrollmentId, textId, fileId, key };
}

async function purgedOf(enrollmentId: string): Promise<boolean[]> {
  const { rows } = await db.query<{ purged: boolean }>(
    `SELECT purged_at IS NOT NULL AS purged FROM chat_messages WHERE enrollment_id = $1 ORDER BY id`,
    [enrollmentId],
  );
  return rows.map(({ purged }) => purged);
}

async function casesOf(enrollmentId: string) {
  const { rows } = await db.query<{ id: string; kind: string; reason: string; status: string }>(
    `SELECT id, kind::text, reason::text, status::text FROM disputes WHERE enrollment_id = $1`,
    [enrollmentId],
  );
  return rows;
}

// ---------------------------------------------------------------------------------------------
// The two paths, their first call and one lock wrapped to stop.
// ---------------------------------------------------------------------------------------------

type Path = 'purge' | 'manual';
type Stop = 'locked' | 'beforeCommit';

interface Stops {
  began?: (pid: number) => void;
  locked?: () => Promise<void>;
  beforeCommit?: () => Promise<void>;
}

interface Line {
  readonly level: 'info' | 'warn' | 'error';
  readonly fields: unknown;
}

/** One probe's record: its stops, the purge's lines, what the purge saw, the commits in order. */
interface Probe {
  stops: Record<Path, Stops>;
  readonly lines: Line[];
  /** Whether the purge's decision read an open matter on the enrollment, under its lock. */
  sawOpenMatter?: boolean;
  readonly commits: Path[];
}

const pidOf = async (tx: Transaction): Promise<number> => {
  const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
  return row?.pid ?? -1;
};

/** The purge as `jobs/purge-chat.ts` builds it, over a store whose lock and update can stop. */
function purgeFor(probe: Probe) {
  const deciding = new WeakSet<Transaction>();
  const store: ChatPurgeStore = {
    ...chatPurgeStore,
    lockEnrollment: async (tx, enrollmentId) => {
      deciding.add(tx);
      probe.stops.purge.began?.(await pidOf(tx));
      await chatPurgeStore.lockEnrollment(tx, enrollmentId);
      await probe.stops.purge.locked?.();
    },
    openMattersAmong: async (tx, enrollmentIds) => {
      const open = await chatPurgeStore.openMattersAmong(tx, enrollmentIds);
      probe.sawOpenMatter = enrollmentIds.some((id) => open.has(id));
      return open;
    },
    purgeMessagesOf: async (tx, enrollmentId, at) => {
      const purged = await chatPurgeStore.purgeMessagesOf(tx, enrollmentId, at);
      await probe.stops.purge.beforeCommit?.();
      return purged;
    },
  };
  /** The process's transactions, the decision's commit recorded. */
  const transactions: Transactions = {
    run: async (work) => {
      let decided = false;
      const value = await database.$transaction(async (tx) => {
        const result = await work(tx);
        decided = deciding.has(tx);
        return result;
      }, OPTIONS);
      if (decided) probe.commits.push('purge');
      return value;
    },
  };
  const writer =
    (level: Line['level']) =>
    (fields: unknown): void =>
      void probe.lines.push({ level, fields });
  return createChatPurge({
    transactions,
    storage,
    settings,
    log: { info: writer('info'), warn: writer('warn'), error: writer('error') },
    pageSize: 100,
    store,
  });
}

const enrollments = createEnrollmentSide({ settings });

/** T064's manual case as `createAdminServices` composes it: its first call the key's claim, its stop the enrollment's lock. */
function openingFor(
  probe: Probe,
  enrollmentId: string,
): () => ReturnType<ManualCaseService['openManual']> {
  const side: EnrollmentSide = {
    ...enrollments,
    lockEnrollments: async (tx, ids) => {
      await enrollments.lockEnrollments(tx, ids);
      await probe.stops.manual.locked?.();
    },
  };
  const idempotency = new IdempotencyService({
    store: new IdempotencyRepository(database),
    settings,
  });
  const service = createManualCase({
    enrollments: side,
    idempotency: {
      runOn: async (tx, request, effect) => {
        probe.stops.manual.began?.(await pidOf(tx));
        return idempotency.runOn(tx, request, effect);
      },
    },
    log: { info: () => undefined },
  });
  const idempotencyKey = `purge-race-${randomUUID()}`;
  created.keys.push(idempotencyKey);
  return async () => {
    const outcome = await database.$transaction(async (tx) => {
      const opened = await service.openManual(tx, admin, {
        enrollmentId,
        party: 'student',
        reason: 'شكوى عبر الهاتف',
        idempotencyKey,
      });
      await probe.stops.manual.beforeCommit?.();
      return opened;
    }, OPTIONS);
    probe.commits.push('manual');
    return outcome;
  };
}

// ---------------------------------------------------------------------------------------------
// The race.
// ---------------------------------------------------------------------------------------------

function signal<T>(): { readonly give: (value: T) => void; readonly given: Promise<T> } {
  let give = (_value: T): void => undefined;
  const given = new Promise<T>((resolve) => {
    give = resolve;
  });
  return { give, given };
}

/** Whether the backend was seen waiting on a lock, or its path ended first ('ended'). */
async function waitingOrEnded(
  pid: number,
  running: Promise<unknown>,
): Promise<'waiting' | 'ended'> {
  let ended = false;
  void running.then(
    () => (ended = true),
    () => (ended = true),
  );
  for (let look = 0; look < 200; look += 1) {
    if (ended) return 'ended';
    const { rows } = await db.query<{ waiting: boolean }>(
      `SELECT wait_event_type = 'Lock' AS waiting FROM pg_stat_activity WHERE pid = $1`,
      [pid],
    );
    if (rows[0]?.waiting === true) return 'waiting';
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`backend ${String(pid)} neither waited on a lock nor ended`);
}

interface Raced<F, S> {
  readonly first: PromiseSettledResult<F>;
  readonly second: PromiseSettledResult<S>;
  /** How the second path was found while the first was held. */
  readonly secondFound: 'waiting' | 'ended';
}

/** Runs `first` to its stop, then `second` until it is seen waiting (or ends), then lets both end. */
async function race<F, S>(
  probe: Probe,
  stop: Stop,
  first: { readonly path: Path; readonly go: () => Promise<F> },
  second: { readonly path: Path; readonly go: () => Promise<S> },
): Promise<Raced<F, S>> {
  const held = signal<void>();
  const opened = signal<void>();
  probe.stops[first.path] = {
    [stop]: async () => {
      held.give();
      await opened.given;
    },
  };
  const firstRun = first.go();
  let secondRun: Promise<S> | undefined;
  let found: 'waiting' | 'ended' = 'ended';
  try {
    await Promise.race([held.given, firstRun]);
    const began = signal<number>();
    probe.stops[second.path] = { began: began.give };
    secondRun = second.go();
    const pid = await Promise.race([
      began.given,
      secondRun.then(
        () => -1,
        () => -1,
      ),
    ]);
    found = pid === -1 ? 'ended' : await waitingOrEnded(pid, secondRun);
  } finally {
    opened.give();
  }
  const [firstSettled, secondSettled] = await Promise.allSettled([firstRun, secondRun]);
  probe.stops = { purge: {}, manual: {} };
  for (const outcome of [firstSettled, secondSettled]) {
    if (outcome.status === 'rejected') expect(isDeadlock(outcome.reason)).toBe(false);
  }
  return {
    first: firstSettled as PromiseSettledResult<F>,
    second: secondSettled as PromiseSettledResult<S>,
    secondFound: found,
  };
}

function valueOf<T>(result: PromiseSettledResult<T>): T {
  if (result.status === 'rejected') throw result.reason;
  return result.value;
}

function newProbe(): Probe {
  return { stops: { purge: {}, manual: {} }, lines: [], commits: [] };
}

const STAGINGS: readonly { readonly name: string; readonly stop: Stop }[] = [
  { name: 'just after its enrollment lock', stop: 'locked' },
  { name: 'before its commit', stop: 'beforeCommit' },
];

describe.each(STAGINGS)(
  'the purge and a manual case opened at once on one enrollment, the first held $name (T039 F13, T064)',
  ({ stop }) => {
    it('the case first: the purge waits, reads the open case under the lock, purges nothing, writes no line, keeps the file', async () => {
      const chat = await chatDue();
      const probe = newProbe();
      const raced = await race(
        probe,
        stop,
        { path: 'manual', go: openingFor(probe, chat.enrollmentId) },
        { path: 'purge', go: () => purgeFor(probe).purgeIfDue(chat.enrollmentId) },
      );
      const opened = valueOf(raced.first);
      const purged = valueOf(raced.second);
      expect(opened.answer).toMatchObject({ party: 'student', status: 'open', joined: false });
      expect(await casesOf(chat.enrollmentId)).toEqual([
        {
          id: opened.answer.caseId,
          kind: 'compensation_case',
          reason: 'admin_opened_for_student',
          status: 'open',
        },
      ]);
      // Never half: the case was open when the purge decided, so nothing is purged.
      expect(purged).toBeNull();
      expect(await purgedOf(chat.enrollmentId)).toEqual([false, false]);
      expect(await storage.exists(chat.key)).toBe(true);
      expect(probe.lines).toEqual([]);
      expect(probe.sawOpenMatter).toBe(true);
      expect(probe.commits).toEqual(['manual', 'purge']);
      // The order was the database's: the purge waited on the lock the opening held.
      expect(raced.secondFound).toBe('waiting');
    });

    it('the purge first: the opening waits, the chat is purged and its file removed, then the case opens on the purged chat', async () => {
      const chat = await chatDue();
      const probe = newProbe();
      const raced = await race(
        probe,
        stop,
        { path: 'purge', go: () => purgeFor(probe).purgeIfDue(chat.enrollmentId) },
        { path: 'manual', go: openingFor(probe, chat.enrollmentId) },
      );
      const purged = valueOf(raced.first);
      const opened = valueOf(raced.second);
      expect(purged).toEqual({ messages: 2, files: 1 });
      expect(probe.sawOpenMatter).toBe(false);
      expect(await purgedOf(chat.enrollmentId)).toEqual([true, true]);
      expect(await storage.exists(chat.key)).toBe(false);
      expect(probe.lines).toEqual([
        { level: 'info', fields: { enrollmentId: chat.enrollmentId, messages: 2, files: 1 } },
      ]);
      expect(opened.answer).toMatchObject({ party: 'student', status: 'open', joined: false });
      expect((await casesOf(chat.enrollmentId)).map(({ status }) => status)).toEqual(['open']);
      // Never half: a purge that saw no open case committed before the case did.
      expect(probe.commits).toEqual(['purge', 'manual']);
      // The order was the database's: the opening waited on the lock the purge held.
      expect(raced.secondFound).toBe('waiting');
    });
  },
);
