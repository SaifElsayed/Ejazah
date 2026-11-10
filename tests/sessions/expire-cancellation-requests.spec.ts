// T022 — `expire-cancellation-requests` over the real tables (FR-458; SC-411; research R-310;
// contracts/kernel.md, "Jobs" and its row): the job as `worker.ts` builds it, over the module's
// store and booking's `createEnrollmentSide`, with a real logger whose lines are read back.
//
//   - SC-411: after a run, no request of this file is pending whose session has started: a pending
//     request on a started session is `expired` with one `cancellation_expired` row and no
//     `responded_at`, a pending one on a cancelled session that has started too; a request whose
//     session has not started stays pending; an answered one stays as it was;
//   - the double-run spec (R-API-14): twice leaves what once leaves, one expiry and one row;
//   - each expiry one info line of exactly `{ requestId, sessionId }`.
//
// THE SWEEP IS GLOBAL, and this file runs beside other files' database specs: a run expires every
// due request of the database. So the job is given the module's store narrowed to this file's own
// requests, as tests/sessions/evaluate-sessions.spec.ts narrows the evaluation's: the real query
// runs, and only what it answers of this file's rows is kept. The rows are committed through the
// integrity harness as the application role, each case with a world of its own.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runOnceAndTwice } from '../../apps/api/src/jobs/double-run';
import { expireCancellationRequests } from '../../apps/api/src/jobs/expire-cancellation-requests';
import { createEnrollmentSide } from '../../apps/api/src/modules/booking/index';
import {
  type CancellationExpiryStore,
  cancellationExpiryStore,
} from '../../apps/api/src/modules/sessions/index';
import {
  closeDatabase,
  type Database,
  openDatabase,
} from '../../apps/api/src/platform/db/prisma.repository';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures';
import { createLogger } from '../../apps/api/src/platform/logging/logger';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader';
import { addMinutes } from '../../packages/time/src/index';
import {
  connectAsApplication,
  type Db,
  enrollmentValues,
  insertRow,
  makeOffer,
  makeUser,
} from '../db-integrity/harness';

let db: Db;
let database: Database;
/** This file's requests: the only ones its runs may expire (the header). */
const own = new Set<string>();
let lines: Record<string, unknown>[] = [];

const settings: SettingsReader = {
  read: async (key, schema) => schema.parse({ first_session_lead_hours: 24 }[key]),
};

/** The module's store, its global read narrowed to this file's requests (the header). */
const ownStore: CancellationExpiryStore = {
  ...cancellationExpiryStore,
  dueForExpiry: async (tx, at, after, limit) => {
    const mine = [];
    let cursor = after;
    for (;;) {
      const page = await cancellationExpiryStore.dueForExpiry(tx, at, cursor, 500);
      mine.push(...page.filter(({ id }) => own.has(id)));
      if (page.length < 500) break;
      cursor = page.at(-1)?.id;
    }
    return mine.slice(0, limit);
  },
};

beforeAll(async () => {
  db = await connectAsApplication();
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 4,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
});

afterAll(async () => {
  await db?.end();
  if (database !== undefined) await closeDatabase(database);
});

function job() {
  return expireCancellationRequests({
    database,
    enrollments: createEnrollmentSide({ settings }),
    log: createLogger({
      level: 'info',
      destination: {
        write: (line: string) => {
          lines.push(JSON.parse(line) as Record<string, unknown>);
        },
      },
    }),
    report: (error) => {
      throw error;
    },
    store: ownStore,
  });
}

type RequestStatus = 'pending' | 'accepted' | 'declined' | 'expired';

/**
 * A confirmed enrollment and one session starting `startsInMinutes` from now (negative: started),
 * in `status`, with one request of the student's in `request`.
 */
async function world(
  startsInMinutes: number,
  request: RequestStatus = 'pending',
  status: 'scheduled' | 'cancelled_by_admin' = 'scheduled',
) {
  const offer = await makeOffer(db);
  const studentId = await makeUser(db, { gender: 'male' });
  const enrollmentId = await insertRow(db, 'enrollments', {
    ...enrollmentValues(offer, studentId),
    status: 'confirmed',
    confirmed_at: '2026-10-04T07:05:00Z',
  });
  const startsAt = new Date(addMinutes(new Date(), startsInMinutes));
  const sessionId = await insertRow(db, 'sessions', {
    enrollment_id: enrollmentId,
    teacher_user_id: offer.teacherId,
    student_user_id: studentId,
    sequence_number: 1,
    scheduled_date_local: '2026-11-10',
    scheduled_start_time_local: '09:00:00',
    timezone: 'Africa/Cairo',
    scheduled_start_at: startsAt.toISOString(),
    scheduled_end_at: new Date(addMinutes(startsAt, 60)).toISOString(),
    status,
  });
  const requestId = await insertRow(db, 'cancellation_requests', {
    session_id: sessionId,
    requested_by_user_id: studentId,
    reason: 'سفر طارئ',
    status: request,
    ...(request === 'accepted' || request === 'declined'
      ? { responded_at: new Date().toISOString() }
      : {}),
  });
  own.add(requestId);
  return { requestId, sessionId, enrollmentId };
}

/** The request's row and the session's `cancellation_expired` rows. */
async function stateOf(requestId: string, sessionId: string) {
  const request = await db.query<{ status: string; responded: boolean }>(
    `SELECT status::text, responded_at IS NOT NULL AS responded
       FROM cancellation_requests WHERE id = $1`,
    [requestId],
  );
  const events = await db.query<{ kind: string; enrollment_id: string }>(
    `SELECT kind::text, enrollment_id::text FROM session_events
      WHERE session_id = $1 ORDER BY id`,
    [sessionId],
  );
  return { request: request.rows[0], events: events.rows };
}

describe('expire-cancellation-requests over the real tables (T022, FR-458, SC-411)', () => {
  it('leaves no request pending after its session’s start, and every other request as it was', async () => {
    const started = await world(-5);
    const cancelled = await world(-5, 'pending', 'cancelled_by_admin');
    const later = await world(60);
    const declined = await world(-5, 'declined');
    lines = [];

    await job().handle({});

    for (const { requestId, sessionId, enrollmentId } of [started, cancelled]) {
      expect(await stateOf(requestId, sessionId)).toEqual({
        request: { status: 'expired', responded: false },
        events: [{ kind: 'cancellation_expired', enrollment_id: enrollmentId }],
      });
    }
    expect(await stateOf(later.requestId, later.sessionId)).toEqual({
      request: { status: 'pending', responded: false },
      events: [],
    });
    expect(await stateOf(declined.requestId, declined.sessionId)).toEqual({
      request: { status: 'declined', responded: true },
      events: [],
    });
    const { rows } = await db.query<{ pending: string }>(
      `SELECT count(*) AS pending FROM cancellation_requests r JOIN sessions s ON s.id = r.session_id
        WHERE r.id = ANY($1::uuid[]) AND r.status = 'pending'
          AND s.scheduled_start_at <= clock_timestamp()`,
      [[...own]],
    );
    expect(rows[0]?.pending).toBe('0');
    expect(lines.map(({ msg, requestId, sessionId }) => ({ msg, requestId, sessionId }))).toEqual(
      [started, cancelled]
        .sort((a, b) => a.requestId.localeCompare(b.requestId))
        .map(({ requestId, sessionId }) => ({
          msg: 'Cancellation request expired',
          requestId,
          sessionId,
        })),
    );
    for (const line of lines) {
      expect(
        Object.keys(line)
          .filter((name) => !['level', 'time', 'pid', 'hostname', 'msg'].includes(name))
          .sort(),
      ).toEqual(['requestId', 'sessionId']);
    }
  });

  it('run twice, leaves what one run leaves: one expiry, one row (R-API-14)', async () => {
    const reading = await runOnceAndTwice({
      world: () => world(-5),
      run: async () => {
        await job().handle({});
      },
      observe: async ({ requestId, sessionId }) => {
        const { request, events } = await stateOf(requestId, sessionId);
        return { request, events: events.map(({ kind }) => kind) };
      },
    });

    expect(reading.twice).toEqual(reading.once);
    expect(reading.once).toEqual({
      request: { status: 'expired', responded: false },
      events: ['cancellation_expired'],
    });
  });
});
