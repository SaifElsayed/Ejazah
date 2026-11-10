// T025 of specs/004-sessions/tasks.md — the cancellation requests a user made, counted over the real
// `cancellation_requests` table as the application role (FR-459; SRS FR-CANCEL-5; R-DB-4).
//
// Both counts are read when asked and never stored: `total` is every request the user made,
// whatever its status, and `recent` those made within `cancellation_requests_recent_days` of the
// database's clock. Another person's requests are not the user's, a request outside the recent
// period counts in the total only, and a deleted user's requests are still counted (nothing reads
// `users`).
//
// The rows are written and committed by the harness, each probe with its own users and sessions.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createCancellationRequestCounts } from '../../apps/api/src/modules/sessions/index.js';
import { addHours } from '../../packages/time/src/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
import { connectAsApplication, type Db, insertRow, makeSession, makeUser } from './harness';

const RECENT_DAYS = 30;
/** Whole hours, as `packages/time` adds them (R-TIME-1). */
const HOUR = 1;
const DAY = 24;

let db: Db;
let database: Database;

const settings: SettingsReader = {
  read: async (key, schema) => {
    if (key !== 'cancellation_requests_recent_days') throw new Error(`unexpected setting ${key}`);
    return schema.parse(RECENT_DAYS);
  },
};
const counts = createCancellationRequestCounts({ settings });

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

type Status = 'pending' | 'accepted' | 'declined' | 'expired';

/** One request on `sessionId` by `userId`, made `ago` hours before now. */
function request(
  sessionId: string,
  userId: string,
  ago: number,
  status: Status = 'expired',
): Promise<string> {
  const answered = status === 'accepted' || status === 'declined';
  return insertRow(db, 'cancellation_requests', {
    session_id: sessionId,
    requested_by_user_id: userId,
    reason: 'Probe reason',
    status,
    ...(answered ? { responded_at: new Date(addHours(new Date(), HOUR - ago)) } : {}),
    created_at: new Date(addHours(new Date(), -ago)),
  });
}

const countsOf = (userId: string) =>
  database.$transaction((tx) => counts.cancellationRequestCountsOf(tx, userId));

describe('cancellationRequestCountsOf (T025, FR-459)', () => {
  it("counts every request the user made in total, and those of the recent period, whatever their status, and never the counterparty's", async () => {
    const { sessionId, studentId, teacherId } = await makeSession(db);
    const other = await makeSession(db);
    await request(sessionId, studentId, 1 * DAY, 'accepted');
    await request(sessionId, studentId, 10 * DAY, 'declined');
    await request(other.sessionId, other.studentId, 2 * DAY);
    await request(sessionId, studentId, 29 * DAY, 'expired');
    await request(sessionId, studentId, 45 * DAY);
    await request(sessionId, studentId, 400 * DAY);
    await request(sessionId, teacherId, 3 * DAY);
    await request(sessionId, studentId, HOUR, 'pending');

    expect(await countsOf(studentId)).toEqual({ total: 6, recent: 4 });
    expect(await countsOf(teacherId)).toEqual({ total: 1, recent: 1 });
  });

  it('counts a request made just outside the recent period in the total only, and one just inside in both', async () => {
    const { sessionId, studentId } = await makeSession(db);
    await request(sessionId, studentId, RECENT_DAYS * DAY + HOUR);
    expect(await countsOf(studentId)).toEqual({ total: 1, recent: 0 });

    await request(sessionId, studentId, RECENT_DAYS * DAY - HOUR);
    expect(await countsOf(studentId)).toEqual({ total: 2, recent: 1 });
  });

  it("still counts a deleted user's requests", async () => {
    const { sessionId, teacherId } = await makeSession(db);
    await request(sessionId, teacherId, 5 * DAY);
    await request(sessionId, teacherId, 50 * DAY);
    expect(await countsOf(teacherId)).toEqual({ total: 2, recent: 1 });

    await db.query('UPDATE users SET deleted_at = now(), updated_at = now() WHERE id = $1', [
      teacherId,
    ]);
    expect(await countsOf(teacherId)).toEqual({ total: 2, recent: 1 });
  });

  it('answers zero for a user who made none', async () => {
    expect(await countsOf(await makeUser(db))).toEqual({ total: 0, recent: 0 });
  });
});
