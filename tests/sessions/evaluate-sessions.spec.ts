// T014 — `evaluate-sessions` over the real tables, every event through T010's harness (FR-441,
// FR-446, FR-447, FR-450, FR-482, FR-495; R-SESS-2, R-SESS-3, R-SESS-6; research R-306, R-308, R-313,
// R-323 GAP-7; contracts/kernel.md, "Jobs"; SC-403, SC-404; the notes under T014, K5 and K6).
//
// Real HTTP to the real webhook route (`createVideoWebhookRoute`, mounted as the application mounts
// it), the only way a spec produces a video event, then the job as `worker.ts` builds it: the
// module's store, booking's `createEnrollmentSide`, T015's `createCompletion`, the video port's
// stand-in and a real logger whose lines are read back.
//
//   - Student-No-Show, Teacher-No-Show and Both-No-Show, Done, Under-Threshold, a reconnection and a
//     lost final leave, each reached from signed events alone (SC-404), with the simultaneous
//     seconds, `evaluated_at` and one `settled` row; Provider-Outage from an outage window recorded
//     over the session;
//   - R-SESS-2's CI test (SC-403): a session whose final webhook never arrives is settled by the
//     first run after its end plus the delay; R-SESS-3: never before;
//   - no automatic transition out of `under_threshold`, `provider_outage` or `disputed` (FR-446); a
//     session disputed before the evaluation keeps `disputed` and gets `outcome_under_dispute`;
//   - T015's completion on the settling transaction: an enrollment whose last session settles after
//     its dispute window closed is completed; no count ends one;
//   - a session whose evaluation fails: its transaction rolled back alone, one error line of its id,
//     and the other session still settled (the owner's decision of 2026-11-08);
//   - the double-run spec: one outcome, one event row, the enrollment not ended, the room ended once;
//   - K6: a later run with no `room_ended` recorded calls `endRoom` again and changes nothing; once
//     the provider's `room_ended` is recorded, no call; none once the join period has ended, or
//     before it opens; each call one `video room ended` line of exactly `{ sessionId }`;
//   - T067 (FR-501; SRS FR-SESS-21; the note under T067, Q5 to Q8): the room of a session someone
//     joined, with no `room_ended` at or after the latest join, ended at its scheduled end plus
//     `room_close_grace_minutes`, whatever its status (disputed, `under_threshold`, settled), and
//     asked again each run until `room_close_retry_minutes` more have passed; a room created again
//     after an earlier `room_ended` closed too (Q6); never for a session nobody joined, one whose
//     room ended after the latest join, one before its end plus the grace or one past the bound; the
//     grace's and the bound's boundaries to the second; a failed call retried by the next run; each
//     line's keys exactly; a missing setting leaving the settlement done (Q7 (a)).
//
// THE SWEEP IS GLOBAL, and this file runs beside other files' database specs (the `node` project):
// a run settles every due session of the database. So the job is given the module's store narrowed
// to this file's own sessions: the real queries run, and only what they answer of this file's rows
// is kept, so no other file's session is touched. Sessions are placed relative to the database's
// clock, in `Africa/Abidjan` (UTC all year), so their local fields resolve to their instants and
// `reresolve-session-instants` never moves them. The rows are committed through the integrity
// harness as the application role, each case with a world of its own.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomBytes, randomInt } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runOnceAndTwice } from '../../apps/api/src/jobs/double-run';
import { evaluateSessions } from '../../apps/api/src/jobs/evaluate-sessions';
import { createEnrollmentSide } from '../../apps/api/src/modules/booking/index';
import {
  createCompletion,
  createVideoWebhookRoute,
  type EvaluationStore,
  evaluationStore,
  VIDEO_WEBHOOK_PATH,
} from '../../apps/api/src/modules/sessions/index';
import {
  closeDatabase,
  openDatabase,
  type Database,
} from '../../apps/api/src/platform/db/prisma.repository';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures';
import { transactionsOver } from '../../apps/api/src/platform/db/transaction.repository';
import { createLogger } from '../../apps/api/src/platform/logging/logger';
import { createVideoPort, type VideoConfig } from '../../apps/api/src/platform/ports/video/index';
import type { VideoPort } from '../../apps/api/src/platform/ports/video/video.port';
import {
  SettingError,
  type SettingsReader,
} from '../../apps/api/src/platform/settings/settings-reader';
import { addMinutes, addSeconds } from '../../packages/time/src/index';
import {
  connectAsApplication,
  type Db,
  enrollmentValues,
  insertRow,
  makeAdmin,
  makeOffer,
  makeUser,
} from '../db-integrity/harness';
import { type VideoScenario, type VideoStandIn, videoStandIn } from '../support/video-stand-in';

const CONFIG: VideoConfig = {
  VIDEO_PROVIDER: 'fake',
  ENCRYPTION_KEY: randomBytes(32).toString('base64'),
};
const ZONE = 'Africa/Abidjan';
const DELAY_MINUTES = 2;
const LEAD_MINUTES = 15;
/** Not the default 0, so a session inside its grace shows (T067). */
const GRACE_MINUTES = 1;
const RETRY_MINUTES = 10;
/** What pino writes on every line, beside a line's own fields. */
const PINO_FIELDS = ['hostname', 'level', 'msg', 'pid', 'time'];
const ROOM_TIMEOUTS = { emptyTimeoutSeconds: 300, departureTimeoutSeconds: 20 };

const SETTINGS: Readonly<Record<string, number>> = {
  session_evaluation_delay_minutes: DELAY_MINUTES,
  attendance_threshold_pct: 70,
  join_window_minutes: 10,
  minimum_connection_seconds: 60,
  early_join_lead_minutes: LEAD_MINUTES,
  room_close_grace_minutes: GRACE_MINUTES,
  room_close_retry_minutes: RETRY_MINUTES,
  dispute_window_hours: 72,
  slot_release_buffer_weeks: 0,
  first_session_lead_hours: 24,
};
const settings: SettingsReader = {
  read: async (key, schema) => {
    if (!(key in SETTINGS)) throw new Error(`unexpected setting ${key}`);
    return schema.parse(SETTINGS[key]);
  },
};
const SILENT = createLogger({ level: 'fatal', destination: { write: () => undefined } });

let db: Db;
let database: Database;
let server: Server;
let stand: VideoStandIn;
const lines: string[] = [];
const reported: Error[] = [];
/** This file's sessions: the only ones its runs see. */
const own = new Set<string>();

beforeAll(async () => {
  db = await connectAsApplication();
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 4,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 30_000,
  });
  const route = createVideoWebhookRoute({
    transactions: transactionsOver(database),
    video: createVideoPort(CONFIG),
    log: SILENT,
    maxBodyBytes: 1_048_576,
    report: () => undefined,
  });
  server = createServer((request, response) => {
    const url = request.url ?? '/';
    if (url !== VIDEO_WEBHOOK_PATH) {
      response.statusCode = 404;
      response.end();
      return;
    }
    request.url = '/';
    route(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  stand = videoStandIn({
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    config: CONFIG,
  });
}, 60_000);

afterAll(async () => {
  await new Promise((resolve) =>
    server === undefined ? resolve(undefined) : server.close(resolve),
  );
  if (database !== undefined) await closeDatabase(database);
  await db?.end();
});

beforeEach(() => {
  lines.length = 0;
  reported.length = 0;
});

/** The module's store, its two global reads narrowed to this file's sessions (the header). */
const ownStore: EvaluationStore = {
  ...evaluationStore,
  dueForEvaluation: async (tx, dueBy, after, limit) => {
    const mine = [];
    let cursor = after;
    for (;;) {
      const page = await evaluationStore.dueForEvaluation(tx, dueBy, cursor, 500);
      mine.push(...page.filter(({ id }) => own.has(id)));
      if (page.length < 500) break;
      cursor = page.at(-1)?.id;
    }
    return mine.slice(0, limit);
  },
  cancelledInJoinPeriod: async (tx, at, joinOpensBy) =>
    (await evaluationStore.cancelledInJoinPeriod(tx, at, joinOpensBy)).filter((id) => own.has(id)),
  dueRoomCloses: async (tx, endedBy, endedAfter, after, limit) => {
    const page = await evaluationStore.dueRoomCloses(tx, endedBy, endedAfter, after, limit);
    return { due: page.due.filter((id) => own.has(id)), next: page.next };
  },
};

/** The video port a world's job ends rooms through, with each `endRoom` call it was asked. */
interface Rooms {
  readonly port: VideoPort;
  readonly endCalls: string[];
}

/** `failOnce`: the sessions whose next `endRoom` call fails, once each (an unreachable provider). */
function roomsOf(failOnce: Set<string> = new Set()): Rooms {
  const port = createVideoPort(CONFIG);
  const endCalls: string[] = [];
  return {
    endCalls,
    port: {
      ...port,
      createRoom: (id, timeouts) => port.createRoom(id, timeouts),
      createSessionToken: (id, user, validity) => port.createSessionToken(id, user, validity),
      verifyAndParseParticipantEvent: (body, headers) =>
        port.verifyAndParseParticipantEvent(body, headers),
      endRoom: async (id) => {
        endCalls.push(id);
        if (failOnce.delete(id)) throw new Error('provider unreachable');
        await port.endRoom(id);
      },
    },
  };
}

/** One run of the job as `worker.ts` builds it, over `rooms`, reading `reader`'s settings. */
async function run(rooms: Rooms = roomsOf(), reader: SettingsReader = settings): Promise<void> {
  const enrollments = createEnrollmentSide({ settings });
  const completion = createCompletion({ enrollments, settings });
  await evaluateSessions({
    database,
    settings: reader,
    enrollments,
    completion,
    video: rooms.port,
    log: createLogger({ level: 'info', destination: { write: (line) => void lines.push(line) } }),
    report: (error) => void reported.push(error),
    store: ownStore,
  }).handle({});
}

const parsed = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);

/** The database's clock now, to the second. */
async function databaseNow(): Promise<Date> {
  const { rows } = await db.query<{ at: Date }>('SELECT clock_timestamp() AS at');
  const at = rows[0]?.at;
  if (at === undefined) throw new Error('no clock');
  // `addSeconds` drops the fraction of a second.
  return new Date(addSeconds(at, 0));
}

interface World {
  readonly enrollmentId: string;
  readonly sessionId: string;
  readonly teacherUserId: string;
  readonly studentUserId: string;
  readonly startAt: Date;
  readonly endAt: Date;
}

/** A confirmed enrollment of a new teacher and student, and one 60-minute session at `startAt`. */
async function world(
  startAt: Date,
  values: Readonly<Record<string, unknown>> = {},
): Promise<World> {
  const offer = await makeOffer(db);
  const studentUserId = await makeUser(db);
  const enrollmentId = await insertRow(db, 'enrollments', {
    ...enrollmentValues(offer, studentUserId),
    status: 'confirmed',
    confirmed_at: new Date(addMinutes(startAt, -24 * 60 * 7)),
  });
  const endAt = new Date(addMinutes(startAt, 60));
  const iso = startAt.toISOString();
  const sessionId = await insertRow(db, 'sessions', {
    enrollment_id: enrollmentId,
    teacher_user_id: offer.teacherId,
    student_user_id: studentUserId,
    sequence_number: 1,
    scheduled_date_local: iso.slice(0, 10),
    scheduled_start_time_local: iso.slice(11, 19),
    timezone: ZONE,
    scheduled_start_at: startAt,
    scheduled_end_at: endAt,
    status: 'scheduled',
    ...values,
  });
  own.add(sessionId);
  return { enrollmentId, sessionId, teacherUserId: offer.teacherId, studentUserId, startAt, endAt };
}

/** A session that ended two hours ago, long past its end plus the delay. */
async function endedWorld(values: Readonly<Record<string, unknown>> = {}): Promise<World> {
  return world(new Date(addMinutes(await databaseNow(), -3 * 60)), values);
}

/** Delivers a scenario's events for `of` through the webhook, each answered 200. */
async function deliver(of: World, row: VideoScenario): Promise<void> {
  const events = stand.scenario(
    {
      id: of.sessionId,
      teacherUserId: of.teacherUserId,
      studentUserId: of.studentUserId,
      startAt: of.startAt,
      endAt: of.endAt,
    },
    row,
  );
  const statuses = await stand.deliverInOrder(events);
  expect(statuses.every((status) => status === 200)).toBe(true);
}

interface SessionRead {
  status: string;
  outcome_under_dispute: string | null;
  simultaneous_connected_seconds: number;
  evaluated: boolean;
  settled_rows: number;
  enrollment: string;
}

async function read(of: World): Promise<SessionRead> {
  const { rows } = await db.query<SessionRead>(
    `SELECT s.status::text, s.outcome_under_dispute::text, s.simultaneous_connected_seconds,
            s.evaluated_at IS NOT NULL AS evaluated,
            (SELECT count(*)::int FROM session_events e
              WHERE e.session_id = s.id AND e.kind = 'settled') AS settled_rows,
            (SELECT n.status::text FROM enrollments n WHERE n.id = s.enrollment_id) AS enrollment
       FROM sessions s WHERE s.id = $1::uuid`,
    [of.sessionId],
  );
  const [row] = rows;
  if (row === undefined) throw new Error('no session');
  return row;
}

const settled = (status: string, seconds: number): SessionRead => ({
  status,
  outcome_under_dispute: null,
  simultaneous_connected_seconds: seconds,
  evaluated: true,
  settled_rows: 1,
  enrollment: 'confirmed',
});

describe(
  'each row of SRS §3.7.5’s table from signed events alone (SC-404, R-305)',
  { timeout: 60_000 },
  () => {
    it.each([
      ['done', 'done', 3600],
      ['student_no_show', 'student_no_show', 0],
      ['teacher_no_show', 'teacher_no_show', 0],
      ['both_no_show', 'both_no_show', 0],
      // The student left one second short of 70 % of the hour (2 520 s).
      ['under_threshold', 'under_threshold', 2519],
      // The student dropped a third in and rejoined a minute later: the sum of the overlaps (SC-402).
      ['reconnection', 'done', 3540],
    ] as const)('%s → %s', async (scenario, outcome, seconds) => {
      const session = await endedWorld();
      await deliver(session, scenario);

      await run();

      expect(await read(session)).toEqual(settled(outcome, seconds));
      expect(reported).toEqual([]);
      const line = parsed().find((one) => one.sessionId === session.sessionId);
      expect(line).toMatchObject({ level: 'info', msg: 'Session settled', outcome });
    });

    it('an outage window recorded over the session: provider_outage, whatever the events say', async () => {
      // A day of its own, years back, so no other run's sessions meet the window (the header).
      const day = new Date(
        addMinutes(new Date('2021-01-01T08:00:00Z'), randomInt(0, 1500) * 24 * 60),
      );
      const session = await world(day);
      await insertRow(db, 'provider_outages', {
        starts_at: new Date(addMinutes(day, 20)),
        ends_at: new Date(addMinutes(day, 40)),
        reason: 'probe outage',
        recorded_by_admin_id: await makeAdmin(db),
      });
      await deliver(session, 'done');

      await run();

      expect(await read(session)).toEqual(settled('provider_outage', 3600));
    });
  },
);

describe('the evaluation’s moment (R-SESS-2, R-SESS-3, SC-403)', { timeout: 60_000 }, () => {
  it('a session whose final webhook never arrives is settled by the first run after its end plus the delay', async () => {
    // Ended the delay and five seconds ago: the student's leave and the room's end never arrive.
    const now = await databaseNow();
    const session = await world(new Date(addSeconds(now, -(60 + DELAY_MINUTES) * 60 - 5)));
    await deliver(session, 'lost_final_leave');

    await run();

    expect(await read(session)).toEqual(settled('done', 3600));
  });

  it('never before its end plus the delay: left scheduled, then settled once it is due', async () => {
    // Due ten seconds from now by the database's clock: its end is the delay less ten seconds ago.
    const now = await databaseNow();
    const dueAt = new Date(addSeconds(now, 10));
    const session = await world(new Date(addSeconds(now, -(60 + DELAY_MINUTES) * 60 + 10)));
    await deliver(session, 'done');

    await run();
    const early = await read(session);
    expect((await databaseNow()).getTime()).toBeLessThan(dueAt.getTime());
    while ((await databaseNow()).getTime() <= dueAt.getTime()) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await run();

    expect(early).toEqual({
      status: 'scheduled',
      outcome_under_dispute: null,
      simultaneous_connected_seconds: 0,
      evaluated: false,
      settled_rows: 0,
      enrollment: 'confirmed',
    });
    expect(await read(session)).toEqual(settled('done', 3600));
  });
});

describe(
  'no automatic transition out of review or a dispute (FR-446, R-SESS-6, R-308)',
  { timeout: 60_000 },
  () => {
    it.each([
      ['under_threshold', null],
      ['provider_outage', null],
      ['disputed', 'done'],
    ] as const)('%s, already evaluated, is left as it is', async (status, frozen) => {
      const session = await endedWorld({
        status,
        outcome_under_dispute: frozen,
        evaluated_at: new Date(),
        simultaneous_connected_seconds: 1800,
      });
      await deliver(session, 'done');
      const { rows: before } = await db.query('SELECT * FROM sessions WHERE id = $1::uuid', [
        session.sessionId,
      ]);

      await run();

      const { rows: after } = await db.query('SELECT * FROM sessions WHERE id = $1::uuid', [
        session.sessionId,
      ]);
      expect(after).toEqual(before);
      expect((await read(session)).settled_rows).toBe(0);
    });

    it('disputed before the evaluation: the outcome is written to outcome_under_dispute, the status stays disputed', async () => {
      const session = await endedWorld({ status: 'disputed' });
      await deliver(session, 'student_no_show');

      await run();

      expect(await read(session)).toEqual({
        ...settled('disputed', 0),
        outcome_under_dispute: 'student_no_show',
      });
      const line = parsed().find((one) => one.sessionId === session.sessionId);
      expect(line).toMatchObject({
        msg: 'Session evaluated under dispute',
        outcome: 'student_no_show',
      });
    });
  },
);

describe(
  'T015’s completion on the settling transaction, the only check (FR-449, R-322)',
  { timeout: 60_000 },
  () => {
    it('the last session settled after its dispute window closed: the enrollment is completed, with its row', async () => {
      // Ended four days ago: the 72-hour window has closed.
      const session = await world(new Date(addMinutes(await databaseNow(), -4 * 24 * 60)));
      await deliver(session, 'done');

      await run();

      expect(await read(session)).toEqual({ ...settled('done', 3600), enrollment: 'completed' });
      const { rows } = await db.query<{ kind: string }>(
        'SELECT kind::text FROM enrollment_events WHERE enrollment_id = $1::uuid',
        [session.enrollmentId],
      );
      expect(rows).toEqual([{ kind: 'completed' }]);
    });

    it('a Teacher-No-Show inside its dispute window: settled, the enrollment left confirmed', async () => {
      const session = await endedWorld();
      await deliver(session, 'teacher_no_show');

      await run();

      expect(await read(session)).toEqual(settled('teacher_no_show', 0));
    });
  },
);

/** A cancelled session of a confirmed enrollment whose join period holds now, its room open. */
async function cancelledInItsJoinPeriod(rooms: Rooms): Promise<World> {
  const now = await databaseNow();
  const session = await world(new Date(addMinutes(now, -10)), { status: 'cancelled_by_admin' });
  await rooms.port.createRoom(session.sessionId, ROOM_TIMEOUTS);
  return session;
}

/** Whether the stand-in's room of `session` has ended: an ended room admits nobody. */
async function roomOf(rooms: Rooms, session: World): Promise<'open' | 'ended'> {
  try {
    await rooms.port.createSessionToken(session.sessionId, session.studentUserId, {
      validUntil: session.endAt,
    });
    return 'open';
  } catch {
    return 'ended';
  }
}

/**
 * The `endRoom` calls of `rooms` for `session`: a run also ends the rooms of the cancelled sessions
 * the file's earlier cases left inside their join period, which are its own too.
 */
function callsOf(rooms: Rooms, session: World): string[] {
  return rooms.endCalls.filter((id) => id === session.sessionId);
}

describe(
  'a session whose evaluation fails is rolled back alone (each session its own transaction; the owner’s decision of 2026-11-08)',
  { timeout: 60_000 },
  () => {
    it('its settle and its row are undone, one error line of its id alone, and the other session is still settled', async () => {
      const failing = await endedWorld();
      const other = await endedWorld();
      await deliver(failing, 'done');
      await deliver(other, 'done');
      const enrollments = createEnrollmentSide({ settings });
      const completion = createCompletion({ enrollments, settings });
      // The completion check is the last write of a session's transaction, after its settle and its
      // `settled` row: failing there shows those two undone with it.
      const failingCompletion: typeof completion = {
        completeIfDue: async (tx, enrollmentId) => {
          if (enrollmentId === failing.enrollmentId) throw new Error('completion failed');
          return completion.completeIfDue(tx, enrollmentId);
        },
      };

      await evaluateSessions({
        database,
        settings,
        enrollments,
        completion: failingCompletion,
        video: roomsOf().port,
        log: createLogger({ level: 'info', destination: { write: (line) => void lines.push(line) } }),
        report: (error) => void reported.push(error),
        store: ownStore,
      }).handle({});

      expect(await read(failing)).toEqual({
        status: 'scheduled',
        outcome_under_dispute: null,
        simultaneous_connected_seconds: 0,
        evaluated: false,
        settled_rows: 0,
        enrollment: 'confirmed',
      });
      expect(await read(other)).toEqual(settled('done', 3600));
      const errors = parsed().filter(({ msg }) => msg === 'Session evaluation failed');
      expect(errors.map(({ sessionId }) => sessionId)).toEqual([failing.sessionId]);
      expect(Object.keys(errors[0] ?? {}).sort()).toEqual([...PINO_FIELDS, 'sessionId'].sort());
      expect(reported.map(({ message }) => message)).toEqual(['completion failed']);
    });
  },
);

describe(
  'evaluate-sessions run twice leaves what one run leaves (R-API-14; kernel.md, "Jobs")',
  { timeout: 60_000 },
  () => {
    it('one outcome, one event row, no enrollment ended, the room ended once; the room due a close ended, nothing written (T067)', async () => {
      const reading = await runOnceAndTwice({
        world: async () => {
          const rooms = roomsOf();
          const due = await endedWorld();
          await deliver(due, 'teacher_no_show');
          const closing = await joinedWorld(rooms, DUE_A_CLOSE_SECONDS, SETTLED_DONE);
          return { rooms, due, cancelled: await cancelledInItsJoinPeriod(rooms), closing };
        },
        run: async ({ rooms }) => run(rooms),
        observe: async ({ rooms, due, cancelled, closing }) => ({
          due: await read(due),
          cancelled: { ...(await read(cancelled)), room: await roomOf(rooms, cancelled) },
          closing: {
            ...(await read(closing)),
            room: await roomOf(rooms, closing),
            participantEvents: await participantEventsOf(closing),
          },
        }),
      });

      expect(reading.twice).toEqual(reading.once);
      expect(reading.once).toEqual({
        due: settled('teacher_no_show', 0),
        cancelled: {
          status: 'cancelled_by_admin',
          outcome_under_dispute: null,
          simultaneous_connected_seconds: 0,
          evaluated: false,
          settled_rows: 0,
          enrollment: 'confirmed',
          room: 'ended',
        },
        closing: {
          status: 'done',
          outcome_under_dispute: null,
          simultaneous_connected_seconds: 3600,
          evaluated: true,
          settled_rows: 0,
          enrollment: 'confirmed',
          room: 'ended',
          // The two joins delivered; the close writes no row (the provider's `room_ended` is).
          participantEvents: 2,
        },
      });
    });
  },
);

describe(
  'a cancelled session’s room ended in its join period, through endRoom alone (FR-482, R-313, K5, K6)',
  { timeout: 60_000 },
  () => {
    it('each call one info line, video room ended, of exactly its session’s id (R-323, GAP-7)', async () => {
      const rooms = roomsOf();
      const session = await cancelledInItsJoinPeriod(rooms);

      await run(rooms);

      expect(callsOf(rooms, session)).toEqual([session.sessionId]);
      expect(await roomOf(rooms, session)).toBe('ended');
      const ended = parsed().filter(
        (line) => line.msg === 'video room ended' && line.sessionId === session.sessionId,
      );
      expect(ended).toHaveLength(1);
      expect(
        Object.keys(ended[0] ?? {})
          .filter((key) => !PINO_FIELDS.includes(key))
          .sort(),
      ).toEqual(['sessionId']);
      expect(ended[0]).toMatchObject({ level: 'info', sessionId: session.sessionId });
    });

    it('a later run with no room_ended recorded calls endRoom again, and that changes nothing', async () => {
      const rooms = roomsOf();
      const session = await cancelledInItsJoinPeriod(rooms);
      await run(rooms);
      const { rows: before } = await db.query('SELECT * FROM sessions WHERE id = $1::uuid', [
        session.sessionId,
      ]);

      await run(rooms);

      expect(callsOf(rooms, session)).toEqual([session.sessionId, session.sessionId]);
      expect(await roomOf(rooms, session)).toBe('ended');
      const { rows: after } = await db.query('SELECT * FROM sessions WHERE id = $1::uuid', [
        session.sessionId,
      ]);
      expect(after).toEqual(before);
    });

    it('once the provider’s room_ended is recorded, no call', async () => {
      const rooms = roomsOf();
      const session = await cancelledInItsJoinPeriod(rooms);
      expect(
        await stand.deliver(stand.roomEnded(session.sessionId, { at: await databaseNow() })),
      ).toBe(200);

      await run(rooms);

      expect(callsOf(rooms, session)).toEqual([]);
      expect(parsed().filter((line) => line.sessionId === session.sessionId)).toEqual([]);
    });

    it.each([
      ['once its join period has ended', -90],
      ['before its join period opens', LEAD_MINUTES + 5],
    ])('no call %s', async (_case, startsInMinutes) => {
      const rooms = roomsOf();
      const now = await databaseNow();
      const session = await world(new Date(addMinutes(now, startsInMinutes)), {
        status: 'cancelled_by_agreement',
      });
      await rooms.port.createRoom(session.sessionId, ROOM_TIMEOUTS);

      await run(rooms);

      expect(callsOf(rooms, session)).toEqual([]);
      expect(await roomOf(rooms, session)).toBe('open');
    });
  },
);

/** A scheduled end whose end plus the grace passed two minutes ago: due a close (T067). */
const DUE_A_CLOSE_SECONDS = -(GRACE_MINUTES + 2) * 60;

/** A session already settled `done` (T067: a settled session's room is closed too). */
const SETTLED_DONE = {
  status: 'done',
  evaluated_at: new Date(),
  simultaneous_connected_seconds: 3600,
} as const;

/**
 * A session whose scheduled end is `endsInSeconds` from the database's clock (before it when
 * negative), its room open, both parties joined at its start through the webhook.
 */
async function joinedWorld(
  rooms: Rooms,
  endsInSeconds: number,
  values: Readonly<Record<string, unknown>> = {},
): Promise<World> {
  const now = await databaseNow();
  const session = await world(new Date(addSeconds(now, endsInSeconds - 60 * 60)), values);
  await rooms.port.createRoom(session.sessionId, ROOM_TIMEOUTS);
  expect(
    await stand.deliverInOrder([
      stand.joined(session.sessionId, session.teacherUserId, { at: session.startAt }),
      stand.joined(session.sessionId, session.studentUserId, { at: session.startAt }),
    ]),
  ).toEqual([200, 200]);
  return session;
}

/** How many `session_participant_events` rows the session has. */
async function participantEventsOf(of: World): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM session_participant_events WHERE session_id = $1::uuid',
    [of.sessionId],
  );
  return rows[0]?.count ?? -1;
}

/** The lines of `msg` written for `session`. */
function linesOf(session: World, msg: string): Record<string, unknown>[] {
  return parsed().filter((line) => line.msg === msg && line.sessionId === session.sessionId);
}

/** A line's own keys, without pino's. */
function ownKeys(line: Record<string, unknown> | undefined): string[] {
  return Object.keys(line ?? {})
    .filter((key) => !PINO_FIELDS.includes(key))
    .sort();
}

/** Every session the module's read answers due a close for the two instants, a page at a time. */
async function dueCloseIds(endedBy: Date, endedAfter: Date): Promise<string[]> {
  const transactions = transactionsOver(database);
  const ids: string[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await transactions.run((tx) =>
      evaluationStore.dueRoomCloses(tx, endedBy, endedAfter, after, 500),
    );
    ids.push(...page.due);
    if (page.next === undefined) return ids;
    after = page.next;
  }
}

describe(
  'T067: the room ended at the session’s scheduled end plus the grace (FR-501, SRS FR-SESS-21, DEC-64, DEC-65)',
  { timeout: 60_000 },
  () => {
    it.each([
      ['disputed from its end, before the evaluation', { status: 'disputed' }],
      [
        'under_threshold',
        {
          status: 'under_threshold',
          evaluated_at: new Date(),
          simultaneous_connected_seconds: 600,
        },
      ],
      ['settled', SETTLED_DONE],
    ] as const)(
      'a session %s: closed, one info line of exactly its id and reason',
      async (_case, values) => {
        const rooms = roomsOf();
        const session = await joinedWorld(rooms, DUE_A_CLOSE_SECONDS, values);

        await run(rooms);

        expect(callsOf(rooms, session)).toEqual([session.sessionId]);
        expect(await roomOf(rooms, session)).toBe('ended');
        const ended = linesOf(session, 'video room ended');
        expect(ended).toHaveLength(1);
        expect(ownKeys(ended[0])).toEqual(['reason', 'sessionId']);
        expect(ended[0]).toMatchObject({ level: 'info', reason: 'scheduled_end' });
        expect(reported).toEqual([]);
      },
    );

    it('a room created again after an earlier room_ended, someone joining after it: closed (Q6)', async () => {
      const rooms = roomsOf();
      const session = await joinedWorld(rooms, DUE_A_CLOSE_SECONDS);
      expect(
        await stand.deliverInOrder([
          stand.roomEnded(session.sessionId, { at: new Date(addMinutes(session.startAt, 10)) }),
          stand.joined(session.sessionId, session.studentUserId, {
            at: new Date(addMinutes(session.startAt, 11)),
            connection: 'second',
          }),
        ]),
      ).toEqual([200, 200]);

      await run(rooms);

      expect(callsOf(rooms, session)).toEqual([session.sessionId]);
      expect(await roomOf(rooms, session)).toBe('ended');
    });

    it.each([
      ['a session nobody joined', 'nobody'],
      ['a room the provider reported ended after the latest join', 'ended_after'],
      ['a room the provider reported ended at the latest join’s instant', 'ended_at_join'],
      ['a session before its end plus the grace', 'inside_grace'],
      ['a session past its end plus the grace and the retries', 'past_bound'],
    ] as const)('never called: %s', async (_case, kind) => {
      const rooms = roomsOf();
      const session = await (async () => {
        if (kind === 'nobody') {
          const now = await databaseNow();
          const alone = await world(new Date(addSeconds(now, DUE_A_CLOSE_SECONDS - 60 * 60)));
          await rooms.port.createRoom(alone.sessionId, ROOM_TIMEOUTS);
          return alone;
        }
        if (kind === 'inside_grace') return joinedWorld(rooms, -30);
        if (kind === 'past_bound') {
          return joinedWorld(rooms, -(GRACE_MINUTES + RETRY_MINUTES + 1) * 60);
        }
        const joined = await joinedWorld(rooms, DUE_A_CLOSE_SECONDS);
        const at = kind === 'ended_at_join' ? joined.startAt : addMinutes(joined.startAt, 30);
        expect(await stand.deliver(stand.roomEnded(joined.sessionId, { at: new Date(at) }))).toBe(
          200,
        );
        return joined;
      })();

      await run(rooms);

      expect(callsOf(rooms, session)).toEqual([]);
      expect(await roomOf(rooms, session)).toBe('open');
      expect(linesOf(session, 'video room ended')).toEqual([]);
    });

    it('the grace’s boundary to the second: not called while the end plus the grace is ahead, called by the first run at it', async () => {
      const rooms = roomsOf();
      // The end plus the grace ten seconds from now by the database's clock.
      const session = await joinedWorld(rooms, 10 - GRACE_MINUTES * 60);
      const closesAt = new Date(addMinutes(session.endAt, GRACE_MINUTES));

      await run(rooms);
      const early = [...callsOf(rooms, session)];
      expect((await databaseNow()).getTime()).toBeLessThan(closesAt.getTime());
      while ((await databaseNow()).getTime() <= closesAt.getTime()) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      await run(rooms);

      expect(early).toEqual([]);
      expect(callsOf(rooms, session)).toEqual([session.sessionId]);
    });

    it('the read’s two boundaries to the second: the end plus the grace at the instant is due, a second later is not; the bound reached is not due, a second short of it is', async () => {
      const rooms = roomsOf();
      const session = await joinedWorld(rooms, DUE_A_CLOSE_SECONDS);
      const end = session.endAt;
      const second = (seconds: number) => new Date(addSeconds(end, seconds));
      const retry = RETRY_MINUTES * 60;

      // `endedBy` is the run's instant less the grace; `endedAfter` that less the retries.
      expect(await dueCloseIds(end, second(-retry))).toContain(session.sessionId);
      expect(await dueCloseIds(second(-1), second(-retry - 1))).not.toContain(session.sessionId);
      expect(await dueCloseIds(second(retry), end)).not.toContain(session.sessionId);
      expect(await dueCloseIds(second(retry - 1), second(-1))).toContain(session.sessionId);
    });

    it('a failed call: one warn line of exactly its id and reason, reported, the run going on; the next run calls again and closes it (Q7, Q8)', async () => {
      const failOnce = new Set<string>();
      const rooms = roomsOf(failOnce);
      const session = await joinedWorld(rooms, DUE_A_CLOSE_SECONDS);
      const other = await joinedWorld(rooms, DUE_A_CLOSE_SECONDS);
      failOnce.add(session.sessionId);

      await run(rooms);
      const warned = linesOf(session, 'video room not ended');
      const firstReports = reported.map(({ message }) => message);
      const firstRoom = await roomOf(rooms, session);
      const otherRoom = await roomOf(rooms, other);
      await run(rooms);

      expect(warned).toHaveLength(1);
      expect(ownKeys(warned[0])).toEqual(['reason', 'sessionId']);
      expect(warned[0]).toMatchObject({ level: 'warn', reason: 'end_room_failed' });
      expect(firstReports).toEqual(['provider unreachable']);
      expect(firstRoom).toBe('open');
      expect(otherRoom).toBe('ended');
      expect(callsOf(rooms, session)).toEqual([session.sessionId, session.sessionId]);
      expect(await roomOf(rooms, session)).toBe('ended');
      expect(linesOf(session, 'video room ended')).toHaveLength(1);
    });

    it('a setting missing: the settlement done, no call, one error line with no id and one report (Q7 (a), SC-403)', async () => {
      const rooms = roomsOf();
      const due = await endedWorld();
      await deliver(due, 'done');
      const closing = await joinedWorld(rooms, DUE_A_CLOSE_SECONDS);
      const missing: SettingsReader = {
        read: async (key, schema) => {
          if (key === 'room_close_retry_minutes') throw new SettingError(key, 'missing');
          return settings.read(key, schema);
        },
      };

      await run(rooms, missing);

      expect(await read(due)).toEqual(settled('done', 3600));
      expect(callsOf(rooms, closing)).toEqual([]);
      const failed = parsed().filter(({ msg }) => msg === 'video room close failed');
      expect(failed).toHaveLength(1);
      expect(ownKeys(failed[0])).toEqual([]);
      expect(failed[0]).toMatchObject({ level: 'error' });
      expect(reported.map(({ name }) => name)).toEqual(['SettingError']);
    });
  },
);
