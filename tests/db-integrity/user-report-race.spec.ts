// T011 of specs/005-certification (FR-611; research R-408; the note under T011, Q-R2 (a) as amended
// by the review, `b47\reviewer-verification.md`; specs/004-sessions/contracts/kernel.md, the rows
// «a report raised», «`chat.send`» and `keyShareRows`, H1) — a chat report against `chat.send` on
// one enrollment, over the real tables as the application role.
//
// `chat.send` locks the sender's `users` row FOR UPDATE, then the enrollment (kernel.md:60). The
// report's insert key-shares, by its foreign keys, both accounts and the enrollment. If the report
// held the enrollment first and then waited on the sender's account inside its insert, while the
// send held the account and waited on the enrollment, the database would refuse one of them 40P01:
// the foreign-key deadlock class. So the report takes both accounts by key share in one call first,
// then the enrollment (`lockCasesOf`), then inserts. Each order is staged with the first path held
// (the send just before its enrollment lock, its sender's account held; the report just after its
// first lock); the second is then seen waiting on a lock in `pg_stat_activity` before the first goes
// on, so the order is the database's:
//
//   - the send first: the report waits on its key share, holding nothing; the send locks the
//     enrollment, commits; the report goes on;
//   - the report first: the send waits on the sender's account, which the report key-shares; the
//     report inserts and commits; the send goes on.
//
// Both commit, neither is refused 40P01. Seen red first under the mutant «no key share first»
// (lane A's `mutants\`): both orders end in a deadlock.
//
// Every row is committed through the application role and removed after the file, by exact id, by a
// connection as the OWNER role (`purge-chat-manual-case.spec.ts`'s precedent).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createEnrollmentSide,
  paired,
  partyOfEnrollment,
} from '../../apps/api/src/modules/booking/index.js';
import { createChatServices } from '../../apps/api/src/modules/chat/index.js';
import {
  createUserReports,
  type UserReportStore,
  userReportStore,
} from '../../apps/api/src/modules/moderation/index.js';
import { partyOfSession } from '../../apps/api/src/modules/sessions/index.js';
import { isDeadlock } from '../../apps/api/src/platform/db/db-errors.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import type { RequesterGender } from '../../apps/api/src/platform/guards/requester-gender.js';
import { IdempotencyRepository } from '../../apps/api/src/platform/idempotency/idempotency.repository.js';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service.js';
import type { LivePublisher } from '../../apps/api/src/platform/live/live-publisher.js';
import type { Logger } from '../../apps/api/src/platform/logging/logger.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
import {
  connectAsApplication,
  type Db,
  enrollmentValues,
  insertRow,
  makeOffer,
  makeUser,
} from './harness';

const settings: SettingsReader = {
  // The key's retention, and `EnrollmentSide`'s windows: 24 is a whole number each accepts.
  read: async (key, schema) => schema.parse(24),
};

let db: Db;
let database: Database;
let idempotency: IdempotencyService<Transaction>;

/** Every row this file commits, by id, for the owner's removal in `afterAll`. */
const created = {
  users: [] as string[],
  subjects: [] as string[],
  packages: [] as string[],
  slots: [] as string[],
  enrollments: [] as string[],
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
  idempotency = new IdempotencyService({ store: new IdempotencyRepository(database), settings });
});

afterAll(async () => {
  await db?.end();
  if (database !== undefined) await closeDatabase(database);
  if (Object.values(created).every((ids) => ids.length === 0)) return;
  const owner = new pg.Client({
    connectionString: specDatabaseUrl('DATABASE_URL_OWNER'),
    connectionTimeoutMillis: 5_000,
  });
  await owner.connect();
  try {
    await owner.query('BEGIN');
    await owner.query(
      `DELETE FROM "idempotency_keys" WHERE scope IN ('chat.send', 'reports.create') AND key = ANY($1)`,
      [created.keys],
    );
    await owner.query('DELETE FROM "user_reports" WHERE enrollment_id = ANY($1)', [
      created.enrollments,
    ]);
    await owner.query('DELETE FROM "chat_messages" WHERE enrollment_id = ANY($1)', [
      created.enrollments,
    ]);
    await owner.query('DELETE FROM "enrollments" WHERE id = ANY($1)', [created.enrollments]);
    await owner.query('DELETE FROM "availability_slots" WHERE id = ANY($1)', [created.slots]);
    await owner.query('DELETE FROM "packages" WHERE id = ANY($1)', [created.packages]);
    await owner.query('DELETE FROM "subjects" WHERE id = ANY($1)', [created.subjects]);
    await owner.query('DELETE FROM "users" WHERE id = ANY($1)', [created.users]);
    await owner.query('COMMIT');
    // Nothing of this file is left (the shared database as it was found).
    const { rows } = await owner.query<{ left: string }>(
      `SELECT ((SELECT count(*) FROM "idempotency_keys"
                 WHERE scope IN ('chat.send', 'reports.create') AND key = ANY($1))
             + (SELECT count(*) FROM "user_reports" WHERE enrollment_id = ANY($2))
             + (SELECT count(*) FROM "chat_messages" WHERE enrollment_id = ANY($2))
             + (SELECT count(*) FROM "enrollments" WHERE id = ANY($2))
             + (SELECT count(*) FROM "users" WHERE id = ANY($3)))::text AS left`,
      [created.keys, created.enrollments, created.users],
    );
    if (rows[0]?.left !== '0') throw new Error(`cleanup left ${String(rows[0]?.left)} rows`);
  } catch (error: unknown) {
    await owner.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await owner.end();
  }
});

/** A confirmed enrollment between a student and a teacher of one gender. */
async function confirmed(): Promise<{
  enrollmentId: string;
  studentId: string;
  teacherId: string;
}> {
  const offer = await makeOffer(db);
  const studentId = await makeUser(db);
  created.users.push(offer.teacherId, studentId);
  created.subjects.push(offer.subjectId);
  created.packages.push(offer.packageId);
  created.slots.push(offer.slotId);
  const enrollmentId = await insertRow(db, 'enrollments', {
    ...enrollmentValues(offer, studentId),
    status: 'confirmed',
    confirmed_at: '2026-10-04T07:05:00Z',
  });
  created.enrollments.push(enrollmentId);
  return { enrollmentId, studentId, teacherId: offer.teacherId };
}

// ---------------------------------------------------------------------------------------------
// The two paths, each with its first lock wrapped to stop and its backend's pid told.
// ---------------------------------------------------------------------------------------------

type Path = 'send' | 'report';

interface Stops {
  began?: (pid: number) => void;
  locked?: () => Promise<void>;
}

let stops: Record<Path, Stops> = { send: {}, report: {} };

const pidOf = async (tx: Transaction): Promise<number> => {
  const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
  return row?.pid ?? -1;
};

const quiet = { info: () => undefined } as unknown as Logger;
const noLive = { afterCommit: () => undefined } as unknown as LivePublisher;

/**
 * `chat.send` as `main.ts` composes it, over booking's `EnrollmentSide`: it stops just before its
 * enrollment lock, the sender's account already locked (`chat.service.ts`: the sender, then the
 * enrollment), and tells its backend at its first read.
 */
function sending(enrollmentId: string, senderId: string): () => Promise<unknown> {
  const side = createEnrollmentSide({ settings });
  const chat = createChatServices({
    transactions: { run: (work) => database.$transaction(work) },
    idempotency,
    settings,
    enrollments: {
      enrollmentFor: async (tx, id) => {
        stops.send.began?.(await pidOf(tx));
        return side.enrollmentFor(tx, id);
      },
      lockEnrollments: async (tx, ids) => {
        await stops.send.locked?.();
        await side.lockEnrollments(tx, ids);
      },
    },
    storage: { temporaryLink: async () => 'https://storage.example.invalid/x' },
  });
  const idempotencyKey = `report-race-send-${randomUUID()}`;
  created.keys.push(idempotencyKey);
  return () =>
    chat.send(
      { userId: senderId },
      { enrollmentId, body: 'السلام عليكم', idempotencyKey },
      quiet,
      noLive,
    );
}

/** The report service as `main.ts` composes it, over the real port bodies, its first lock able to stop. */
function reporting(
  enrollmentId: string,
  reporterId: string,
  reportedId: string,
): () => Promise<unknown> {
  const store: UserReportStore = {
    ...userReportStore,
    keyShareAccounts: async (tx, userIds) => {
      await userReportStore.keyShareAccounts(tx, userIds);
      await stops.report.locked?.();
    },
    lockEnrollment: async (tx, id) => {
      await userReportStore.lockEnrollment(tx, id);
      // Under «no key share first» the enrollment is the report's first lock.
      await stops.report.locked?.();
    },
  };
  const reports = createUserReports({
    idempotency,
    pairings: {
      partyOfSession,
      paired,
      partyOfEnrollment: async (tx, id, userId) => {
        stops.report.began?.(await pidOf(tx));
        return partyOfEnrollment(tx, id, userId);
      },
    },
    settings,
    store,
  });
  const idempotencyKey = `report-race-report-${randomUUID()}`;
  created.keys.push(idempotencyKey);
  return () =>
    reports.create(
      { userId: reporterId, role: 'student', gender: 'male' as RequesterGender },
      {
        reportedUserId: reportedId,
        context: 'chat',
        enrollmentId,
        reason: 'كلام غير لائق في المحادثة',
        idempotencyKey,
      },
      quiet,
    );
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

/** Runs `first` to its first lock, then `second` until it is seen waiting (or ends), then both. */
async function race(
  first: { readonly path: Path; readonly go: () => Promise<unknown> },
  second: { readonly path: Path; readonly go: () => Promise<unknown> },
) {
  const held = signal<void>();
  const opened = signal<void>();
  stops[first.path] = {
    locked: async () => {
      stops[first.path] = {};
      held.give();
      await opened.given;
    },
  };
  const firstRun = first.go();
  let secondRun: Promise<unknown> | undefined;
  let found: 'waiting' | 'ended' = 'ended';
  try {
    await Promise.race([held.given, firstRun]);
    const began = signal<number>();
    stops[second.path] = { began: began.give };
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
  const settled = await Promise.allSettled([firstRun, secondRun]);
  stops = { send: {}, report: {} };
  return { settled, found };
}

async function rowsOf(enrollmentId: string) {
  const reports = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM user_reports WHERE enrollment_id = $1 AND status = 'open'`,
    [enrollmentId],
  );
  const messages = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM chat_messages WHERE enrollment_id = $1`,
    [enrollmentId],
  );
  return { reports: reports.rows[0]?.n, messages: messages.rows[0]?.n };
}

describe('a chat report and chat.send at once on one enrollment (Q-R2 (a), kernel.md H1)', () => {
  it('the send first: the report waits on its key share, both commit, no deadlock', async () => {
    const pair = await confirmed();
    const { settled, found } = await race(
      { path: 'send', go: sending(pair.enrollmentId, pair.studentId) },
      { path: 'report', go: reporting(pair.enrollmentId, pair.studentId, pair.teacherId) },
    );
    const deadlocked = settled.filter(
      (outcome) => outcome.status === 'rejected' && isDeadlock(outcome.reason),
    );
    expect(deadlocked).toEqual([]);
    expect(settled.map(({ status }) => status)).toEqual(['fulfilled', 'fulfilled']);
    expect(found).toBe('waiting');
    expect(await rowsOf(pair.enrollmentId)).toEqual({ reports: '1', messages: '1' });
  });

  it('the report first: the send waits on the sender’s account, both commit, no deadlock', async () => {
    const pair = await confirmed();
    const { settled, found } = await race(
      { path: 'report', go: reporting(pair.enrollmentId, pair.studentId, pair.teacherId) },
      { path: 'send', go: sending(pair.enrollmentId, pair.studentId) },
    );
    const deadlocked = settled.filter(
      (outcome) => outcome.status === 'rejected' && isDeadlock(outcome.reason),
    );
    expect(deadlocked).toEqual([]);
    expect(settled.map(({ status }) => status)).toEqual(['fulfilled', 'fulfilled']);
    expect(found).toBe('waiting');
    expect(await rowsOf(pair.enrollmentId)).toEqual({ reports: '1', messages: '1' });
  });
});
