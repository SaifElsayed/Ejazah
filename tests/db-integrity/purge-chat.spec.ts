// T039 of specs/004-sessions/tasks.md — the chat purge over the real tables as the application role
// (FR-492; SRS FR-SESS-13; ERD §6 `chat_messages`, §15 rules 8 and 47; research R-314;
// contracts/kernel.md, the purge's row; the notes under T039, Q2 (a), F13 and F14).
//
// - An enrollment `completed`, `terminated_no_show` or `cancelled` whose last session's scheduled end
//   + `dispute_window_hours` + `chat_retention_days` has passed by the database's clock: each
//   message's body, attachment name and type NULL and `purged_at` set, in one update the two checks
//   accept, the attachment's key kept until its file is removed after the commit; a failed removal
//   leaves the key on the purged row, which the retry's read finds, and the conditional clearing
//   clears only the key it was given.
// - Nothing before that instant, nothing for a `confirmed` enrollment, nothing while a session
//   dispute, a compensation case or a complaint of the teacher's absence is open on it (each row
//   inserted directly, F14: independent of T060); a closed case holds nothing.
// - The lock (F13): a case opened by another transaction holding the enrollment's lock is seen by
//   the purge, which waits on that lock (seen waiting in `pg_stat_activity`, so the order is the
//   database's) and reads again after it: the chat is kept.
//
// Every row is written and committed by the harness, each probe with an enrollment of its own, and
// the purge is asked of that enrollment only (`purgeIfDue`), so nothing another spec committed is
// purged by this one.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type ChatPurgeStore,
  chatPurgeStore,
  createChatPurge,
} from '../../apps/api/src/modules/chat/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import { transactionsOver } from '../../apps/api/src/platform/db/transaction.repository.js';
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

type Status = 'confirmed' | 'completed' | 'terminated_no_show' | 'cancelled';

const PAST_END = '2026-10-01T07:00:00Z';
const FUTURE_END = '2099-10-01T07:00:00Z';

let db: Db;
let database: Database;

beforeAll(async () => {
  db = await connectAsApplication();
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 3,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
});

afterAll(async () => {
  await db?.end();
  if (database !== undefined) await closeDatabase(database);
});

/** The window and the retention the purge reads, as a settings store would hold them. */
function settingsOf(hours: number, days: number): SettingsReader {
  return {
    read: async (key, schema) => {
      if (key === 'dispute_window_hours') return schema.parse(hours);
      if (key === 'chat_retention_days') return schema.parse(days);
      throw new Error(`spec settings: no ${key}`);
    },
  };
}

interface Probe {
  readonly enrollmentId: string;
  readonly studentId: string;
  readonly teacherId: string;
  readonly sessionId: string;
  readonly textId: string;
  readonly fileId: string;
  readonly key: string;
}

/** A committed enrollment in `status`, one session ending at `endAt`, a text and a document. */
async function chatOf(
  status: Status,
  endAt: string = PAST_END,
  sessionStatus: string = 'scheduled',
): Promise<Probe> {
  const offer = await makeOffer(db);
  const studentId = await makeUser(db);
  const enrollmentId = await insertRow(db, 'enrollments', {
    ...enrollmentValues(offer, studentId),
    status,
    confirmed_at: '2026-09-01T07:00:00Z',
    ...(status === 'cancelled' ? { cancellation_reason: 'admin' } : {}),
  });
  const sessionId = await insertRow(db, 'sessions', {
    enrollment_id: enrollmentId,
    teacher_user_id: offer.teacherId,
    student_user_id: studentId,
    sequence_number: 1,
    scheduled_date_local: endAt.slice(0, 10),
    scheduled_start_time_local: '09:00:00',
    timezone: 'Africa/Cairo',
    scheduled_start_at: endAt.replace('07:00:00', '06:00:00'),
    scheduled_end_at: endAt,
    status: sessionStatus,
  });
  const textId = await insertRow(db, 'chat_messages', {
    enrollment_id: enrollmentId,
    sender_user_id: studentId,
    body: 'السلام عليكم',
    sent_at: '2026-09-02T07:00:00Z',
  });
  const key = `chat/${enrollmentId}/probe.pdf`;
  const fileId = await insertRow(db, 'chat_messages', {
    enrollment_id: enrollmentId,
    sender_user_id: offer.teacherId,
    attachment_key: key,
    attachment_filename: 'الدرس.pdf',
    attachment_mime: 'application/pdf',
    sent_at: '2026-09-02T07:01:00Z',
  });
  return { enrollmentId, studentId, teacherId: offer.teacherId, sessionId, textId, fileId, key };
}

interface MessageRow {
  readonly id: string;
  readonly body: string | null;
  readonly attachment_key: string | null;
  readonly attachment_filename: string | null;
  readonly attachment_mime: string | null;
  readonly purged: boolean;
}

async function messagesOf(enrollmentId: string): Promise<MessageRow[]> {
  const { rows } = await db.query<MessageRow>(
    `SELECT id, body, attachment_key, attachment_filename, attachment_mime,
            purged_at IS NOT NULL AS purged
       FROM chat_messages WHERE enrollment_id = $1 ORDER BY id`,
    [enrollmentId],
  );
  return rows;
}

function storageOf(failing = false) {
  return {
    removed: [] as string[],
    async remove(key: string) {
      if (failing) throw new Error('spec storage: unreachable');
      this.removed.push(key);
    },
  };
}

const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };

function purgeOver(
  options: {
    readonly hours?: number;
    readonly days?: number;
    readonly failing?: boolean;
    readonly store?: ChatPurgeStore;
  } = {},
) {
  const storage = storageOf(options.failing);
  const purge = createChatPurge({
    transactions: transactionsOver(database),
    storage,
    settings: settingsOf(options.hours ?? 48, options.days ?? 30),
    log: quiet,
    pageSize: 100,
    ...(options.store === undefined ? {} : { store: options.store }),
  });
  return { purge, storage };
}

function openMatter(
  probe: Probe,
  kind: 'session_dispute' | 'compensation_case' | 'absence_complaint',
) {
  return insertRow(db, 'disputes', {
    enrollment_id: probe.enrollmentId,
    kind,
    status: 'open',
    ...(kind === 'compensation_case'
      ? { reason: 'teacher_ended' }
      : { raised_by_user_id: probe.studentId, reason: 'المعلم لم يحضر' }),
    ...(kind === 'session_dispute' ? { session_id: probe.sessionId } : {}),
  });
}

describe('the chat purge over the real tables (T039, FR-492, ERD §15 rules 8 and 47)', () => {
  it.each(['completed', 'terminated_no_show', 'cancelled'] as const)(
    'a %s enrollment past its instant: body, file name and type NULL, purged_at set, the file removed and its key cleared',
    async (status) => {
      const probe = await chatOf(status);
      const { purge, storage } = purgeOver();
      expect(await purge.purgeIfDue(probe.enrollmentId)).toEqual({ messages: 2, files: 1 });
      expect(storage.removed).toEqual([probe.key]);
      expect(await messagesOf(probe.enrollmentId)).toEqual([
        {
          id: probe.textId,
          body: null,
          attachment_key: null,
          attachment_filename: null,
          attachment_mime: null,
          purged: true,
        },
        {
          id: probe.fileId,
          body: null,
          attachment_key: null,
          attachment_filename: null,
          attachment_mime: null,
          purged: true,
        },
      ]);
      // Twice = once: nothing left to purge, nothing removed again.
      expect(await purge.purgeIfDue(probe.enrollmentId)).toBeNull();
      expect(storage.removed).toEqual([probe.key]);
    },
  );

  it('a removal that fails keeps the key on the purged row (rule 47 allows it); the retry finds it; the clearing is conditional on the key', async () => {
    const probe = await chatOf('completed');
    const { purge } = purgeOver({ failing: true });
    expect(await purge.purgeIfDue(probe.enrollmentId)).toEqual({ messages: 2, files: 0 });
    const [, held] = await messagesOf(probe.enrollmentId);
    expect(held).toEqual({
      id: probe.fileId,
      body: null,
      attachment_key: probe.key,
      attachment_filename: null,
      attachment_mime: null,
      purged: true,
    });

    const found = await database.$transaction((tx) =>
      chatPurgeStore.heldFilesAfter(tx, undefined, 1_000_000),
    );
    expect(found).toContainEqual({
      messageId: probe.fileId,
      enrollmentId: probe.enrollmentId,
      storageKey: probe.key,
    });
    const file = {
      messageId: probe.fileId,
      enrollmentId: probe.enrollmentId,
      storageKey: probe.key,
    };
    const resumed = { ...file, messageId: probe.textId };
    const after = await database.$transaction((tx) =>
      chatPurgeStore.heldFilesAfter(tx, file, 1_000_000),
    );
    expect(after.map(({ messageId }) => messageId)).not.toContain(probe.fileId);
    expect(
      (
        await database.$transaction((tx) => chatPurgeStore.heldFilesAfter(tx, resumed, 1_000_000))
      ).map(({ messageId }) => messageId),
    ).toContain(probe.fileId);

    expect(
      await database.$transaction((tx) =>
        chatPurgeStore.clearKey(tx, { ...file, storageKey: 'chat/another/key.pdf' }),
      ),
    ).toBe(false);
    expect((await messagesOf(probe.enrollmentId))[1]?.attachment_key).toBe(probe.key);
    expect(await database.$transaction((tx) => chatPurgeStore.clearKey(tx, file))).toBe(true);
    expect((await messagesOf(probe.enrollmentId))[1]?.attachment_key).toBeNull();
    expect(await database.$transaction((tx) => chatPurgeStore.clearKey(tx, file))).toBe(false);
  });

  it('the page of enrollments with an unpurged message names this one before the purge and not after', async () => {
    const probe = await chatOf('completed');
    const page = () =>
      database.$transaction((tx) =>
        chatPurgeStore.unpurgedEnrollmentsAfter(tx, undefined, 1_000_000),
      );
    expect(await page()).toContain(probe.enrollmentId);
    await purgeOver().purge.purgeIfDue(probe.enrollmentId);
    expect(await page()).not.toContain(probe.enrollmentId);
  });

  it('nothing before the instant, by the database’s clock: a session ending in the future, or a retention not yet run out', async () => {
    const future = await chatOf('completed', FUTURE_END);
    expect(await purgeOver().purge.purgeIfDue(future.enrollmentId)).toBeNull();
    expect((await messagesOf(future.enrollmentId)).every(({ purged }) => !purged)).toBe(true);

    const recent = await chatOf('completed');
    expect(await purgeOver({ days: 365_000 }).purge.purgeIfDue(recent.enrollmentId)).toBeNull();
    expect(await purgeOver({ hours: 1, days: 0 }).purge.purgeIfDue(recent.enrollmentId)).toEqual({
      messages: 2,
      files: 1,
    });
  });

  it('nothing for a confirmed enrollment', async () => {
    const probe = await chatOf('confirmed');
    expect(await purgeOver({ hours: 1, days: 0 }).purge.purgeIfDue(probe.enrollmentId)).toBeNull();
    expect((await messagesOf(probe.enrollmentId)).every(({ purged }) => !purged)).toBe(true);
  });

  it.each(['session_dispute', 'compensation_case', 'absence_complaint'] as const)(
    'nothing while a %s is open on it',
    async (kind) => {
      const probe = await chatOf('completed');
      await openMatter(probe, kind);
      const { purge, storage } = purgeOver();
      expect(await purge.purgeIfDue(probe.enrollmentId)).toBeNull();
      expect(storage.removed).toEqual([]);
      expect((await messagesOf(probe.enrollmentId)).map(({ body }) => body)).toEqual([
        'السلام عليكم',
        null,
      ]);
    },
  );

  it('a closed case holds nothing', async () => {
    const probe = await chatOf('cancelled');
    const caseId = await openMatter(probe, 'compensation_case');
    await db.query(
      `UPDATE disputes SET status = 'dismissed', resolution_notes = 'Probe decision',
              resolved_by_admin_id = $2, resolved_at = now(), updated_at = now() WHERE id = $1`,
      [caseId, await makeAdmin(db)],
    );
    expect(await purgeOver().purge.purgeIfDue(probe.enrollmentId)).toEqual({
      messages: 2,
      files: 1,
    });
  });
});

describe('the last session is the last disputable one (Q-B1 (b), the owner’s decision of 2026-11-11; FR-473)', () => {
  /** A further committed session of the probe's enrollment, ending at `endAt`, in `status`. */
  function sessionOf(probe: Probe, sequence: number, endAt: string, status: string) {
    return insertRow(db, 'sessions', {
      enrollment_id: probe.enrollmentId,
      teacher_user_id: probe.teacherId,
      student_user_id: probe.studentId,
      sequence_number: sequence,
      scheduled_date_local: endAt.slice(0, 10),
      scheduled_start_time_local: '09:00:00',
      timezone: 'Africa/Cairo',
      scheduled_start_at: endAt.replace('07:00:00', '06:00:00'),
      scheduled_end_at: endAt,
      status,
    });
  }

  it('a cancelled enrollment whose remaining sessions were cancelled is purged by its last disputable end', async () => {
    const probe = await chatOf('cancelled');
    await sessionOf(probe, 2, FUTURE_END, 'cancelled_by_admin');
    await sessionOf(probe, 3, '2099-10-08T07:00:00Z', 'cancelled_by_agreement');
    expect(await purgeOver().purge.purgeIfDue(probe.enrollmentId)).toEqual({
      messages: 2,
      files: 1,
    });
  });

  it('an enrollment whose sessions were all cancelled falls back to the latest end of any session', async () => {
    const past = await chatOf('cancelled', PAST_END, 'cancelled_by_admin');
    await sessionOf(past, 2, '2026-09-24T07:00:00Z', 'cancelled_by_agreement');
    expect(await purgeOver().purge.purgeIfDue(past.enrollmentId)).toEqual({
      messages: 2,
      files: 1,
    });

    const future = await chatOf('cancelled', PAST_END, 'cancelled_by_admin');
    await sessionOf(future, 2, FUTURE_END, 'cancelled_by_agreement');
    expect(await purgeOver().purge.purgeIfDue(future.enrollmentId)).toBeNull();
    expect((await messagesOf(future.enrollmentId)).every(({ purged }) => !purged)).toBe(true);
  });
});

describe('the purge waits on the enrollment’s lock and reads again under it (F13, T005 rule 1)', () => {
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

  it('a case opened under the enrollment’s lock, committed while the purge waits, is seen: the chat is kept', async () => {
    const probe = await chatOf('completed');
    const opener = await connectAsApplication();
    let pid: (value: number) => void = () => undefined;
    const began = new Promise<number>((resolve) => {
      pid = resolve;
    });
    const store: ChatPurgeStore = {
      ...chatPurgeStore,
      lockEnrollment: async (tx, enrollmentId) => {
        const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        pid(row?.pid ?? -1);
        await chatPurgeStore.lockEnrollment(tx, enrollmentId);
      },
    };
    try {
      await opener.query('BEGIN');
      await opener.query('SELECT 1 FROM enrollments WHERE id = $1 FOR UPDATE', [
        probe.enrollmentId,
      ]);
      await opener.query(
        `INSERT INTO disputes (enrollment_id, kind, reason, status, updated_at)
         VALUES ($1, 'compensation_case', 'teacher_ended', 'open', now())`,
        [probe.enrollmentId],
      );
      const { purge, storage } = purgeOver({ store });
      const purging = purge.purgeIfDue(probe.enrollmentId);
      await seenWaiting(await began);
      await opener.query('COMMIT');
      expect(await purging).toBeNull();
      expect(storage.removed).toEqual([]);
      expect((await messagesOf(probe.enrollmentId)).every(({ purged }) => !purged)).toBe(true);
    } finally {
      await opener.query('ROLLBACK').catch(() => undefined);
      await opener.end();
    }
  });
});
