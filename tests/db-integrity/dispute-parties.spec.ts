// B42, T049 of specs/004-sessions/tasks.md (the note under T049, Q5 (b); FR-426, FR-475;
// contracts/admin-surface.md, `disputes.get`) — `disputes.get` answers the session's two parties as
// `cases.get` names them, read through identity's entry (`displayNamesOf`) over the real tables as
// the application role: a deleted party answered `deleted: true` with no name, the live one named.
// The panel draws the «held files» section only from this answer. The telemetry and the ruling's
// revisions are `dispute-resolution.spec.ts`' and `ruling-revision.spec.ts`'; here they are stubs.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDisputeQueue } from '../../apps/api/src/modules/sessions/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
import type { Telemetry } from '../../packages/contracts/src/admin/index.js';
import { connectAsApplication, type Db, insertRow, makeAdmin, makeSession } from './harness';

const settings: SettingsReader = {
  read: async (key) => {
    throw new Error(`unexpected setting ${key}`);
  },
};

const queue = createDisputeQueue({
  telemetry: { of: async (_tx, session) => ({ sessionId: session.id }) as Telemetry },
  revisions: { revisionView: async () => ({ revisable: false, revisions: [] }) },
  settings,
  log: { info: () => undefined },
});

let db: Db;
let database: Database;

beforeAll(async () => {
  db = await connectAsApplication();
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 2,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
});

afterAll(async () => {
  await db?.end();
  if (database !== undefined) await closeDatabase(database);
});

/** A disputed session of a fresh enrollment, and an open session dispute raised by its student. */
async function disputed(): Promise<{ disputeId: string; studentId: string; teacherId: string }> {
  const { sessionId, enrollmentId, studentId, teacherId } = await makeSession(db);
  await db.query(
    `UPDATE sessions SET status = 'disputed', outcome_under_dispute = 'teacher_no_show',
            evaluated_at = '2026-10-04T07:03:00Z', updated_at = now()
      WHERE id = $1`,
    [sessionId],
  );
  const disputeId = await insertRow(db, 'disputes', {
    enrollment_id: enrollmentId,
    session_id: sessionId,
    kind: 'session_dispute',
    raised_by_user_id: studentId,
    reason: 'لم يحضر المعلم',
    status: 'open',
  });
  return { disputeId, studentId, teacherId };
}

/**
 * The account deleted as the deletion leaves it: soft-deleted, its name erased. T081 of
 * specs/004-sessions (Q-R12 (a)): a party of an ongoing enrollment is deleted only by an
 * administrator at the owner's request (`users.delete`), since T080 refuses the person's own; the
 * rows are written here as that deletion leaves the party's account.
 */
async function deleteAccount(userId: string): Promise<void> {
  await db.query(
    `UPDATE users SET deleted_at = now(), display_name = NULL, updated_at = now() WHERE id = $1`,
    [userId],
  );
}

describe('disputes.get: the parties (B42, T049, Q5 (b); FR-426)', () => {
  it('answers a deleted student deleted with no name, and the live teacher named', async () => {
    const { disputeId, studentId, teacherId } = await disputed();
    await deleteAccount(studentId);
    const admin = await makeAdmin(db);
    const answer = await database.$transaction((tx) => queue.get(tx, admin, { disputeId }));
    expect(answer.parties).toEqual({
      student: { userId: studentId, displayName: null, deleted: true },
      teacher: { userId: teacherId, displayName: 'Probe user', deleted: false },
    });
  });

  it('answers a deleted teacher deleted with no name, and both named while neither is deleted', async () => {
    const { disputeId, studentId, teacherId } = await disputed();
    const admin = await makeAdmin(db);
    const live = await database.$transaction((tx) => queue.get(tx, admin, { disputeId }));
    expect(live.parties).toEqual({
      student: { userId: studentId, displayName: 'Probe user', deleted: false },
      teacher: { userId: teacherId, displayName: 'Probe user', deleted: false },
    });
    await deleteAccount(teacherId);
    const answer = await database.$transaction((tx) => queue.get(tx, admin, { disputeId }));
    expect(answer.parties).toEqual({
      student: { userId: studentId, displayName: 'Probe user', deleted: false },
      teacher: { userId: teacherId, displayName: null, deleted: true },
    });
  });
});
