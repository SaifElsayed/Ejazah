// T012 — `POST /webhooks/video` over the real tables (FR-440; R-SESS-1, R-SESS-7; research R-303,
// R-304; contracts/video.md, "The webhook"; SC-405, SC-406).
//
// Real HTTP to the real route: `createVideoWebhookRoute`, the sessions module's public entry, mounted
// under `VIDEO_WEBHOOK_PATH` as the application mounts it (the path taken off the request's URL as
// Express's `use` does), over the shared spec database and the video port's stand-in. Every event
// comes from the harness, `tests/support/video-stand-in.ts`, the only way a spec produces one.
//
//   - R-SESS-7's CI test (SC-406): each of the three forgeries of a join, a leave and a room's end is
//     refused with 401 and writes nothing, read back from `session_participant_events`;
//   - SC-405: one event delivered 100 times leaves one row;
//   - what a row holds (R-304's table): a participant's event its user and connection, the room's end
//     neither, each at the provider's instant;
//   - events out of order are each recorded as they happened;
//   - an event for a settled session is recorded and changes nothing of the session;
//   - an event for no session (an unknown id, a room name that is no id) and an identity that is
//     neither participant answer 200, write nothing and are reported; a non-party's join writes one
//     warn line of exactly `{ sessionId, eventId }` (the note under T012 of 2026-11-07);
//   - nothing of the event's identity, connection or signature is in any log line;
//   - T065 (app-surface.md, the `session` event; research R-324, item 6): a recorded event publishes
//     one `session` `{ sessionId, enrollmentId }` through the bus once its insert has committed, a
//     participant's join or leave to the other participant and the room's end to both, never to
//     anyone else; nothing for a replay, an event not recorded, an event that is not attendance or a
//     transaction rolled back; a publish that fails is one warn line of the deletion's shape
//     (`deletion.service.ts`, `#endLiveStreams`), no payload, never retried, and the answer 200.
//
// The planted rows are written through the integrity harness's builders as the application role.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { LiveEvent } from '@ijazah/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createVideoWebhookRoute,
  VIDEO_WEBHOOK_PATH,
} from '../../apps/api/src/modules/sessions/index';
import {
  closeDatabase,
  openDatabase,
  type Database,
} from '../../apps/api/src/platform/db/prisma.repository';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures';
import { transactionsOver } from '../../apps/api/src/platform/db/transaction.repository';
import type { LiveBus, LiveMessage } from '../../apps/api/src/platform/live/live-bus';
import { createLogger } from '../../apps/api/src/platform/logging/logger';
import {
  createVideoPort,
  standInVideoWebhookSecret,
  type VideoConfig,
} from '../../apps/api/src/platform/ports/video/index';
import { connectAsApplication, type Db, makeSession, makeUser } from '../db-integrity/harness';
import {
  VIDEO_FORGERIES,
  type VideoForgery,
  type VideoStandIn,
  type VideoStandInEvent,
  VIDEO_WEBHOOK_PATH as HARNESS_PATH,
  videoStandIn,
} from '../support/video-stand-in';

const CONFIG: VideoConfig = {
  VIDEO_PROVIDER: 'fake',
  ENCRYPTION_KEY: randomBytes(32).toString('base64'),
};
const START = new Date('2026-10-04T06:00:00Z');
const MIDDLE = new Date('2026-10-04T06:30:00Z');
const END = new Date('2026-10-04T07:00:00Z');
/** What pino writes on every line, beside a line's own fields. */
const PINO_FIELDS = ['hostname', 'level', 'msg', 'pid', 'time'];

let db: Db;
let database: Database;
let server: Server;
let stand: VideoStandIn;
const lines: string[] = [];
const reported: Error[] = [];

/**
 * T065: what the route's transactions and its bus did, in order: `commit` once a transaction has
 * committed, `rollback` once one has not, `publish` at each publish.
 */
const steps: string[] = [];
/** T065: every message the route published, as the bus received it. */
const published: LiveMessage[] = [];
/** T065: what the bus does with a message; it fails on demand. */
let publishing: (message: LiveMessage) => void;
/** T065: when set, each transaction throws once its work has resolved, so nothing commits. */
let refuseCommit = false;

const bus: LiveBus = {
  publish: (message) => {
    steps.push('publish');
    published.push(message);
    publishing(message);
  },
  subscribe: () => () => undefined,
};

beforeAll(async () => {
  db = await connectAsApplication();
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 2,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 30_000,
  });
  const committing = transactionsOver(database);
  const route = createVideoWebhookRoute({
    transactions: {
      run: async (work) => {
        try {
          const answer = await committing.run(async (tx) => {
            const done = await work(tx);
            if (refuseCommit) throw new Error('the spec refuses the commit');
            return done;
          });
          steps.push('commit');
          return answer;
        } catch (error) {
          steps.push('rollback');
          throw error;
        }
      },
    },
    video: createVideoPort(CONFIG),
    log: createLogger({ level: 'info', destination: { write: (line) => void lines.push(line) } }),
    maxBodyBytes: 1_048_576,
    report: (error) => void reported.push(error),
    live: bus,
  });
  server = createServer((request, response) => {
    const url = request.url ?? '/';
    if (url !== VIDEO_WEBHOOK_PATH && !url.startsWith(`${VIDEO_WEBHOOK_PATH}/`)) {
      response.statusCode = 404;
      response.end();
      return;
    }
    request.url = url.slice(VIDEO_WEBHOOK_PATH.length) || '/';
    route(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  stand = videoStandIn({ origin, config: CONFIG });
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
  steps.length = 0;
  published.length = 0;
  publishing = () => undefined;
  refuseCommit = false;
});

interface Row {
  provider_event_id: string;
  session_id: string;
  user_id: string | null;
  event_type: string;
  connection_ref: string | null;
  occurred_at: Date;
}

/** Every row recorded for the session, or under any of the events' provider ids. */
async function rowsOf(
  sessionId: string,
  events: readonly VideoStandInEvent[] = [],
): Promise<Row[]> {
  const { rows } = await db.query<Row>(
    `SELECT provider_event_id, session_id::text, user_id::text, event_type::text, connection_ref,
            occurred_at
       FROM session_participant_events
      WHERE session_id = $1::uuid OR provider_event_id = ANY($2::text[])
      ORDER BY occurred_at, provider_event_id`,
    [sessionId, events.map(({ providerEventId }) => providerEventId)],
  );
  return rows;
}

const parsed = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);

/** Nothing of an identity, a connection or a signature is in any log line. */
function expectNothingLogged(...texts: string[]): void {
  for (const line of lines) {
    for (const text of texts) expect(line).not.toContain(text);
  }
}

describe('the harness posts to the sessions module’s own route', () => {
  it('names the path the module mounts', () => {
    expect(HARNESS_PATH).toBe(VIDEO_WEBHOOK_PATH);
  });
});

type Kind = 'joined' | 'left' | 'room_ended';
const KINDS: readonly Kind[] = ['joined', 'left', 'room_ended'];

function eventOf(kind: Kind, session: Awaited<ReturnType<typeof makeSession>>) {
  if (kind === 'room_ended') return stand.roomEnded(session.sessionId, { at: END });
  return stand[kind](session.sessionId, session.studentId, { at: MIDDLE });
}

describe('a forged event is refused with 401 and writes nothing (R-SESS-7, SC-406)', () => {
  it.each(KINDS.flatMap((kind) => VIDEO_FORGERIES.map((how): [Kind, VideoForgery] => [kind, how])))(
    'a %s event, %s',
    async (kind, how) => {
      const session = await makeSession(db);
      const event = eventOf(kind, session);
      const forged = stand.tamper(event, how);

      expect(await stand.deliver(forged)).toBe(401);

      expect(await rowsOf(session.sessionId, [event, forged])).toEqual([]);
      expect(parsed()).toEqual([
        expect.objectContaining({ level: 'warn', errorCode: 'UNAUTHENTICATED' }),
      ]);
      expectNothingLogged(session.studentId, forged.headers['x-fake-signature'] ?? 'no signature');
    },
  );

  it('a forged event is refused however often it is sent', async () => {
    const session = await makeSession(db);
    const forged = stand.tamper(eventOf('joined', session), 'wrong_secret');

    expect(await stand.deliverTimes(forged, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(await rowsOf(session.sessionId, [forged])).toEqual([]);
  });
});

describe('a signed event is recorded once under its provider id (R-SESS-1, R-304, SC-405)', () => {
  it('a participant’s join and leave: the user, the connection and the provider’s instant', async () => {
    const session = await makeSession(db);
    const joined = stand.joined(session.sessionId, session.teacherId, {
      at: START,
      connection: 'PA_teacher_1',
    });
    const left = stand.left(session.sessionId, session.teacherId, {
      at: END,
      connection: 'PA_teacher_1',
    });

    expect(await stand.deliverInOrder([joined, left])).toEqual([200, 200]);

    expect(await rowsOf(session.sessionId)).toEqual([
      {
        provider_event_id: joined.providerEventId,
        session_id: session.sessionId,
        user_id: session.teacherId,
        event_type: 'joined',
        connection_ref: 'PA_teacher_1',
        occurred_at: START,
      },
      {
        provider_event_id: left.providerEventId,
        session_id: session.sessionId,
        user_id: session.teacherId,
        event_type: 'left',
        connection_ref: 'PA_teacher_1',
        occurred_at: END,
      },
    ]);
    expect(lines).toEqual([]);
    expect(reported).toEqual([]);
  });

  it('the room’s end: no user and no connection', async () => {
    const session = await makeSession(db);
    const ended = stand.roomEnded(session.sessionId, { at: END });

    expect(await stand.deliver(ended)).toBe(200);

    expect(await rowsOf(session.sessionId)).toEqual([
      {
        provider_event_id: ended.providerEventId,
        session_id: session.sessionId,
        user_id: null,
        event_type: 'room_ended',
        connection_ref: null,
        occurred_at: END,
      },
    ]);
  });

  it('one event delivered 100 times leaves one row, each delivery answered 200 (SC-405)', async () => {
    const session = await makeSession(db);
    const joined = stand.joined(session.sessionId, session.studentId, { at: START });

    const statuses = await stand.deliverTimes(joined, 100);

    expect(statuses).toEqual(Array.from({ length: 100 }, () => 200));
    expect((await rowsOf(session.sessionId)).map((row) => row.provider_event_id)).toEqual([
      joined.providerEventId,
    ]);
    expect(lines).toEqual([]);
  });

  it('events out of order are each recorded as they happened, by the provider’s instants', async () => {
    const session = await makeSession(db);
    const first = { at: START, connection: 'PA_student_1' };
    const second = { at: MIDDLE, connection: 'PA_student_2' };
    const events = [
      stand.left(session.sessionId, session.studentId, { at: MIDDLE, connection: 'PA_student_1' }),
      stand.joined(session.sessionId, session.studentId, second),
      stand.roomEnded(session.sessionId, { at: END }),
      stand.joined(session.sessionId, session.studentId, first),
    ];

    expect(await stand.deliverInOrder(events)).toEqual([200, 200, 200, 200]);

    expect(
      (await rowsOf(session.sessionId)).map((row) => [
        row.event_type,
        row.connection_ref,
        row.occurred_at.toISOString(),
      ]),
    ).toEqual(
      expect.arrayContaining([
        ['joined', 'PA_student_1', START.toISOString()],
        ['left', 'PA_student_1', MIDDLE.toISOString()],
        ['joined', 'PA_student_2', MIDDLE.toISOString()],
        ['room_ended', null, END.toISOString()],
      ]),
    );
    expect(await rowsOf(session.sessionId)).toHaveLength(4);
  });

  it('an event for a settled session is recorded and changes nothing of the session', async () => {
    const session = await makeSession(db);
    await db.query(`UPDATE sessions SET status = 'done' WHERE id = $1::uuid`, [session.sessionId]);
    const before = await db.query('SELECT * FROM sessions WHERE id = $1::uuid', [
      session.sessionId,
    ]);
    const left = stand.left(session.sessionId, session.studentId, { at: END });

    expect(await stand.deliver(left)).toBe(200);

    expect((await rowsOf(session.sessionId)).map((row) => row.provider_event_id)).toEqual([
      left.providerEventId,
    ]);
    const after = await db.query('SELECT * FROM sessions WHERE id = $1::uuid', [session.sessionId]);
    expect(after.rows).toEqual(before.rows);
  });
});

describe('an event the webhook does not record answers 200, writes nothing and is reported (R-304)', () => {
  it.each([
    ['a session that does not exist', () => randomUUID()],
    ['a room whose name is no session id', () => 'not-a-session'],
  ])('%s', async (_case, sessionIdOf) => {
    const sessionId = sessionIdOf();
    const userId = await makeUser(db);
    const joined = stand.joined(sessionId, userId, { at: START, connection: 'PA_stray' });

    expect(await stand.deliver(joined)).toBe(200);

    expect(await rowsOf(randomUUID(), [joined])).toEqual([]);
    expect(reported).toHaveLength(1);
    expect(reported[0]?.message).not.toContain(userId);
    expect(parsed().map((line) => [line.level, line.reason])).toEqual([
      ['warn', 'unknown_session'],
    ]);
    expectNothingLogged(userId, 'PA_stray', sessionId, joined.providerEventId);
  });

  it('a join from someone who is not a party: one warn line of exactly its session’s and its event’s ids', async () => {
    const session = await makeSession(db);
    const stranger = await makeUser(db);
    const joined = stand.joined(session.sessionId, stranger, { at: START, connection: 'PA_third' });

    expect(await stand.deliver(joined)).toBe(200);

    expect(await rowsOf(session.sessionId, [joined])).toEqual([]);
    expect(reported).toHaveLength(1);
    expect(reported[0]?.message).not.toContain(stranger);
    const warnings = parsed().filter((line) => line.level === 'warn');
    expect(warnings).toHaveLength(1);
    expect(
      Object.keys(warnings[0] ?? {})
        .filter((key) => !PINO_FIELDS.includes(key))
        .sort(),
    ).toEqual(['eventId', 'sessionId']);
    expect(warnings[0]).toMatchObject({
      sessionId: session.sessionId,
      eventId: joined.providerEventId,
    });
    expect(lines).toHaveLength(1);
    expectNothingLogged(stranger, 'PA_third', joined.headers['x-fake-signature'] ?? 'none');
  });

  it('a leave from someone who is not a party: written nowhere, one warn line of its reason alone', async () => {
    const session = await makeSession(db);
    const stranger = await makeUser(db);
    const left = stand.left(session.sessionId, stranger, { at: END });

    expect(await stand.deliver(left)).toBe(200);

    expect(await rowsOf(session.sessionId, [left])).toEqual([]);
    expect(reported).toHaveLength(1);
    expect(parsed().map((line) => [line.level, line.reason])).toEqual([['warn', 'not_a_party']]);
    expectNothingLogged(stranger, session.sessionId, left.providerEventId);
  });
});

// T065: the `session` signal after the insert commits (app-surface.md, `LiveEvent`'s `session` row;
// research R-324, items 5 and 6). R-304's mapping: `participant_joined` is `joined`,
// `participant_left` and `participant_connection_aborted` are both `left` (the adapter's, its own
// spec's), `room_finished` is `room_ended`; so a stored type's recipients are the producers' own.
describe('a recorded event signals the session over the live bus once committed (T065)', () => {
  type Session = Awaited<ReturnType<typeof makeSession>>;

  const signal = (session: Session): LiveEvent => ({
    type: 'session',
    sessionId: session.sessionId,
    enrollmentId: session.enrollmentId,
  });

  /** Every recipient the bus was handed is one of the session's two parties (R-GENDER-1). */
  function expectOnlyParties(session: Session): void {
    for (const { to } of published) {
      for (const userId of to) expect([session.studentId, session.teacherId]).toContain(userId);
    }
  }

  it('a join by the student: one signal to the teacher alone, after the commit', async () => {
    const session = await makeSession(db);
    const joined = stand.joined(session.sessionId, session.studentId, { at: START });

    expect(await stand.deliver(joined)).toBe(200);

    expect(published).toEqual([{ to: [session.teacherId], event: signal(session) }]);
    expect(steps).toEqual(['commit', 'publish']);
    expect(lines).toEqual([]);
  });

  it('a join by the teacher: one signal to the student alone', async () => {
    const session = await makeSession(db);

    expect(
      await stand.deliver(stand.joined(session.sessionId, session.teacherId, { at: START })),
    ).toBe(200);

    expect(published).toEqual([{ to: [session.studentId], event: signal(session) }]);
  });

  it('a leave (`participant_left` or `participant_connection_aborted`): one signal to the other participant', async () => {
    const session = await makeSession(db);
    const left = stand.left(session.sessionId, session.teacherId, { at: MIDDLE });

    expect(await stand.deliver(left)).toBe(200);

    expect(published).toEqual([{ to: [session.studentId], event: signal(session) }]);
    expect(steps).toEqual(['commit', 'publish']);
  });

  it('the room’s end: one signal to both participants', async () => {
    const session = await makeSession(db);

    expect(await stand.deliver(stand.roomEnded(session.sessionId, { at: END }))).toBe(200);

    expect(published).toHaveLength(1);
    expect(published[0]?.event).toEqual(signal(session));
    expect([...(published[0]?.to ?? [])].sort()).toEqual(
      [session.studentId, session.teacherId].sort(),
    );
    expect(steps).toEqual(['commit', 'publish']);
  });

  it('one signal per recorded event: a sequence of four publishes four, each after its own commit', async () => {
    const session = await makeSession(db);
    const events = [
      stand.joined(session.sessionId, session.studentId, { at: START, connection: 'PA_s' }),
      stand.joined(session.sessionId, session.teacherId, { at: START, connection: 'PA_t' }),
      stand.left(session.sessionId, session.studentId, { at: MIDDLE, connection: 'PA_s' }),
      stand.roomEnded(session.sessionId, { at: END }),
    ];

    expect(await stand.deliverInOrder(events)).toEqual([200, 200, 200, 200]);

    expect(published.map(({ to }) => [...to].sort())).toEqual([
      [session.teacherId],
      [session.studentId],
      [session.teacherId],
      [session.studentId, session.teacherId].sort(),
    ]);
    expect(steps).toEqual(Array.from({ length: 4 }, () => ['commit', 'publish']).flat());
    expectOnlyParties(session);
  });

  it('a replay publishes nothing: one event delivered five times, one signal', async () => {
    const session = await makeSession(db);
    const joined = stand.joined(session.sessionId, session.studentId, { at: START });

    expect(await stand.deliverTimes(joined, 5)).toEqual([200, 200, 200, 200, 200]);

    expect(published).toEqual([{ to: [session.teacherId], event: signal(session) }]);
    expect(steps).toEqual(['commit', 'publish', 'rollback', 'rollback', 'rollback', 'rollback']);
  });

  it('a rolled-back insert publishes nothing and answers 500, so the provider retries', async () => {
    const session = await makeSession(db);
    refuseCommit = true;
    const joined = stand.joined(session.sessionId, session.studentId, { at: START });

    expect(await stand.deliver(joined)).toBe(500);

    expect(published).toEqual([]);
    expect(steps).toEqual(['rollback']);
    expect(await rowsOf(session.sessionId, [joined])).toEqual([]);
  });

  it('nothing for an event not recorded: no session, a room that is no session, or someone not a party', async () => {
    const session = await makeSession(db);
    const stranger = await makeUser(db);
    const events = [
      stand.joined(randomUUID(), stranger, { at: START }),
      stand.joined('not-a-session', stranger, { at: START }),
      stand.joined(session.sessionId, stranger, { at: START }),
      stand.left(session.sessionId, stranger, { at: END }),
    ];

    expect(await stand.deliverInOrder(events)).toEqual([200, 200, 200, 200]);

    expect(published).toEqual([]);
    expect(steps).not.toContain('publish');
  });

  it('nothing for a signed event that is not attendance', async () => {
    const session = await makeSession(db);
    const rawBody = Buffer.from(
      JSON.stringify({
        id: `fake_vev_${randomUUID()}`,
        type: 'track_published',
        session: session.sessionId,
      }),
    );
    const signature = createHmac('sha256', standInVideoWebhookSecret(CONFIG))
      .update(rawBody)
      .digest('hex');

    expect(
      await stand.deliver({
        rawBody,
        headers: { 'x-fake-signature': signature },
        providerEventId: 'not attendance',
      }),
    ).toBe(200);

    expect(published).toEqual([]);
    expect(steps).toEqual([]);
  });

  it('a publish that fails: recorded, answered 200, one warn line of the event’s type and the error’s name, never retried', async () => {
    const session = await makeSession(db);
    publishing = () => {
      throw new TypeError(`no stream for ${session.teacherId}`);
    };
    const joined = stand.joined(session.sessionId, session.studentId, {
      at: START,
      connection: 'PA_unpublished',
    });

    expect(await stand.deliver(joined)).toBe(200);

    expect((await rowsOf(session.sessionId)).map((row) => row.provider_event_id)).toEqual([
      joined.providerEventId,
    ]);
    expect(published).toHaveLength(1);
    const warnings = parsed().filter((line) => line.level === 'warn');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ eventType: 'session', errorName: 'TypeError' });
    expect(
      Object.keys(warnings[0] ?? {})
        .filter((key) => !PINO_FIELDS.includes(key))
        .sort(),
    ).toEqual(['errorName', 'eventType']);
    expect(lines).toHaveLength(1);
    expectNothingLogged(
      session.sessionId,
      session.enrollmentId,
      session.studentId,
      session.teacherId,
      'PA_unpublished',
      joined.providerEventId,
    );
    expect(reported).toEqual([]);
  });
});
