// T004 of specs/004-sessions/tasks.md — a deleted person's files held while a matter is open (FR-487;
// SRS FR-AUTH-14 as amended; research R-327; the owner's decision of 2026-11-05).
//
// booking's `heldFileOwnersAmong` answers, of some users, the parties of an enrollment that
// moderation's `enrollmentsWithOpenMatterAmong` names: one with an open `disputes` row of any kind.
// Each module reads its own table and nothing else (R-API-6), with no lock. Over the real tables, as
// the application role: a deleted student with an open `refund_choice` case, a deleted teacher whose
// deletion opened a `teacher_ended` case, a session dispute and a complaint each hold the
// enrollment's parties; a closed case does not; a person with no enrollment is held by nothing.
// The rows are committed, each probe writing an enrollment of its own.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { heldFileOwnersAmong } from '../../apps/api/src/modules/booking/index.js';
import { enrollmentsWithOpenMatterAmong } from '../../apps/api/src/modules/moderation/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import {
  connectAsApplication,
  type Db,
  insertRow,
  makeAdmin,
  makeEnrollment,
  makeSession,
  makeUser,
} from './harness';

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

/** Soft-deletes the person, as a deletion leaves the row (the files' question is asked after it). */
async function deleted(userId: string): Promise<void> {
  await db.query('UPDATE users SET deleted_at = now(), updated_at = now() WHERE id = $1', [userId]);
}

function compensationCase(enrollmentId: string, reason: string): Promise<string> {
  return insertRow(db, 'disputes', {
    enrollment_id: enrollmentId,
    kind: 'compensation_case',
    reason,
    status: 'open',
  });
}

const held = async (userIds: readonly string[]) =>
  [...(await heldFileOwnersAmong(database, userIds))].sort();

describe("a deleted person's files held by an open matter (T004, FR-487, R-327)", () => {
  it('a deleted student with an open refund_choice case: the student and the teacher held', async () => {
    const { enrollmentId, studentId, teacherId } = await makeEnrollment(db);
    await compensationCase(enrollmentId, 'refund_choice');
    await deleted(studentId);
    expect(await held([studentId])).toEqual([studentId]);
    expect(await held([studentId, teacherId])).toEqual([studentId, teacherId].sort());
  });

  it('a deleted teacher whose deletion opened a teacher_ended case: held', async () => {
    const { enrollmentId, teacherId } = await makeEnrollment(db);
    await compensationCase(enrollmentId, 'teacher_ended');
    await deleted(teacherId);
    expect(await held([teacherId])).toEqual([teacherId]);
  });

  it('a session dispute open on one of the enrollment’s sessions: held', async () => {
    const { enrollmentId, sessionId, studentId } = await makeSession(db);
    await insertRow(db, 'disputes', {
      enrollment_id: enrollmentId,
      session_id: sessionId,
      kind: 'session_dispute',
      raised_by_user_id: studentId,
      reason: 'The teacher did not come',
      status: 'open',
    });
    expect(await held([studentId])).toEqual([studentId]);
  });

  it('a complaint of the teacher’s absence open: held', async () => {
    const { enrollmentId, studentId, teacherId } = await makeEnrollment(db);
    await insertRow(db, 'disputes', {
      enrollment_id: enrollmentId,
      kind: 'absence_complaint',
      raised_by_user_id: studentId,
      reason: 'The teacher keeps missing sessions',
      status: 'open',
    });
    await deleted(teacherId);
    expect(await held([teacherId])).toEqual([teacherId]);
  });

  it('a closed case holds nothing, and a person with no enrollment is held by nothing', async () => {
    const { enrollmentId, studentId } = await makeEnrollment(db);
    const caseId = await compensationCase(enrollmentId, 'teacher_ended');
    await db.query(
      `UPDATE disputes SET status = 'dismissed', resolution_notes = 'Probe decision',
              resolved_by_admin_id = $2, resolved_at = now(), updated_at = now() WHERE id = $1`,
      [caseId, await makeAdmin(db)],
    );
    await deleted(studentId);
    const nobody = await makeUser(db);
    expect(await held([studentId, nobody])).toEqual([]);
    expect(await held([])).toEqual([]);
  });

  it('moderation names the enrollments with an open matter of any kind, and only those', async () => {
    const open = await makeEnrollment(db);
    const closed = await makeEnrollment(db);
    const none = await makeEnrollment(db);
    await compensationCase(open.enrollmentId, 'student_banned');
    const caseId = await compensationCase(closed.enrollmentId, 'student_banned');
    await db.query(
      `UPDATE disputes SET status = 'resolved', resolution = 'compensation_ordered',
              resolution_notes = 'Probe decision', resolved_by_admin_id = $2,
              resolved_at = now(), updated_at = now() WHERE id = $1`,
      [caseId, await makeAdmin(db)],
    );
    const named = await enrollmentsWithOpenMatterAmong(database, [
      open.enrollmentId,
      closed.enrollmentId,
      none.enrollmentId,
    ]);
    expect([...named]).toEqual([open.enrollmentId]);
    expect((await enrollmentsWithOpenMatterAmong(database, [])).size).toBe(0);
  });
});
