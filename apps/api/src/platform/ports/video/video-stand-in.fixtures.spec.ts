// T010: the video stand-in's test harness over real HTTP (contracts/video.md, "The stand-in and its
// harness"; FR-440; SC-402 to SC-406). A receiver listens on an ephemeral port and verifies what
// reaches it with `FakeVideoAdapter.verifyAndParseParticipantEvent` of a second port built from the
// same configuration, the operation `POST /webhooks/video` calls (T012): an event that passes here
// passes there, and one refused here is refused there. The route itself, with the database, is
// T012's and is driven through `tests/support/video-stand-in.ts`; a kernel spec imports no module,
// so the receiver's path is this file's own.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { clip, intersect, type Interval, measureSeconds, union } from '@ijazah/time';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EventSignatureError } from '../inbound-event.js';
import { FakeVideoAdapter, standInConnectionRef } from './fake.adapter.js';
import { createVideoPort, type VideoConfig } from './index.js';
import type { IgnoredEvent, ParticipantEvent } from './video.port.js';
import {
  createVideoStandIn,
  VIDEO_FORGERIES,
  VIDEO_SCENARIOS,
  type VideoStandIn,
  type VideoStandInEvent,
} from './video-stand-in.fixtures.js';

const CONFIG: VideoConfig = {
  VIDEO_PROVIDER: 'fake',
  ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
};
const WEBHOOK_PATH = '/receiver';

const SESSION = '01928c3e-7a10-7000-8000-000000000001';
const TEACHER = '01928c3e-7a10-7000-8000-0000000000b1';
const STUDENT = '01928c3e-7a10-7000-8000-0000000000a1';
const START = new Date('2026-11-08T17:00:00Z');
const LATER = new Date('2026-11-08T17:20:00Z');
const END = new Date('2026-11-08T17:45:00Z');

/** What reached the receiver, in arrival order: the verified event, or the refusal's status. */
interface Arrival {
  readonly status: number;
  readonly event?: ParticipantEvent | IgnoredEvent;
  readonly contentType: string | undefined;
}

const arrivals: Arrival[] = [];
let server: Server;
let stand: VideoStandIn;

function receiver(verifier: FakeVideoAdapter) {
  return (request: IncomingMessage, response: ServerResponse): void => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const rawBody = Buffer.concat(chunks);
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(request.headers)) {
        if (typeof value === 'string') headers[name] = value;
      }
      const answer = (status: number, event?: ParticipantEvent | IgnoredEvent): void => {
        arrivals.push({
          status,
          contentType: headers['content-type'],
          ...(event === undefined ? {} : { event }),
        });
        response.statusCode = status;
        response.end();
      };
      if (request.url !== WEBHOOK_PATH || request.method !== 'POST') {
        answer(404);
        return;
      }
      verifier.verifyAndParseParticipantEvent(rawBody, headers).then(
        (event) => answer(200, event),
        (error: unknown) => answer(error instanceof EventSignatureError ? 401 : 400),
      );
    });
  };
}

beforeAll(async () => {
  const verifier = createVideoPort(CONFIG);
  if (!(verifier instanceof FakeVideoAdapter)) throw new Error('the stand-in is configured');
  server = createServer(receiver(verifier));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  stand = createVideoStandIn({ origin, webhookPath: WEBHOOK_PATH, config: CONFIG });
});

afterAll(async () => {
  await new Promise((resolve) =>
    server === undefined ? resolve(undefined) : server.close(resolve),
  );
});

beforeEach(() => {
  arrivals.length = 0;
});

const events = (): (ParticipantEvent | IgnoredEvent | undefined)[] =>
  arrivals.map((arrival) => arrival.event);

describe('the harness builds signed events the webhook accepts (T010, FR-440)', () => {
  it('joined: the participant, their connection and the instant, under a fresh provider id', async () => {
    const event = stand.joined(SESSION, STUDENT, { at: START, connection: 'conn-1' });

    expect(await stand.deliver(event)).toBe(200);
    expect(events()).toEqual([
      {
        providerEventId: event.providerEventId,
        sessionId: SESSION,
        type: 'joined',
        participantUserId: STUDENT,
        connectionRef: 'conn-1',
        occurredAt: START,
      },
    ]);
    expect(arrivals[0]?.contentType).toBe('application/webhook+json');
  });

  it('left: the same, a leave', async () => {
    const event = stand.left(SESSION, TEACHER, { at: LATER, connection: 'conn-2' });

    expect(await stand.deliver(event)).toBe(200);
    expect(events()).toEqual([
      {
        providerEventId: event.providerEventId,
        sessionId: SESSION,
        type: 'left',
        participantUserId: TEACHER,
        connectionRef: 'conn-2',
        occurredAt: LATER,
      },
    ]);
  });

  it('a participant’s join and leave with no connection named share one connection', async () => {
    const join = stand.joined(SESSION, STUDENT, { at: START });
    const leave = stand.left(SESSION, STUDENT, { at: LATER });
    const other = stand.joined(SESSION, TEACHER, { at: START });

    expect(await stand.deliverInOrder([join, leave, other])).toEqual([200, 200, 200]);
    const [joined, left, teacher] = events() as ParticipantEvent[];
    expect(joined?.connectionRef).toEqual(expect.any(String));
    expect(left?.connectionRef).toBe(joined?.connectionRef);
    expect(teacher?.connectionRef).not.toBe(joined?.connectionRef);
  });

  it('roomEnded: the room’s end, with no participant and no connection', async () => {
    const event = stand.roomEnded(SESSION, { at: END });

    expect(await stand.deliver(event)).toBe(200);
    expect(events()).toEqual([
      {
        providerEventId: event.providerEventId,
        sessionId: SESSION,
        type: 'room_ended',
        occurredAt: END,
      },
    ]);
  });

  it('every event carries a provider event id of its own', () => {
    const ids = [
      stand.joined(SESSION, STUDENT, { at: START }),
      stand.joined(SESSION, STUDENT, { at: START }),
      stand.left(SESSION, STUDENT, { at: LATER }),
      stand.roomEnded(SESSION, { at: END }),
    ].map((event) => event.providerEventId);

    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('the harness delivers (T010, SC-405)', () => {
  it('deliverTwice: the same body and id twice, one after the other', async () => {
    const event = stand.joined(SESSION, STUDENT, { at: START });

    expect(await stand.deliverTwice(event)).toEqual([200, 200]);
    expect(events().map((arrived) => (arrived as ParticipantEvent).providerEventId)).toEqual([
      event.providerEventId,
      event.providerEventId,
    ]);
  });

  it('deliverTimes: the same event n times, for SC-405’s hundred', async () => {
    const event = stand.left(SESSION, TEACHER, { at: LATER });

    const statuses = await stand.deliverTimes(event, 100);

    expect(statuses).toHaveLength(100);
    expect(new Set(statuses)).toEqual(new Set([200]));
    expect(
      new Set(events().map((arrived) => (arrived as ParticipantEvent).providerEventId)),
    ).toEqual(new Set([event.providerEventId]));
  });

  it('deliverTimes refuses a count that is not a positive whole number', async () => {
    const event = stand.left(SESSION, TEACHER, { at: LATER });

    for (const n of [0, -1, 1.5]) {
      await expect(stand.deliverTimes(event, n)).rejects.toThrow(RangeError);
    }
    expect(arrivals).toEqual([]);
  });

  it('deliverInOrder: in the order given, whatever order they happened in', async () => {
    const join = stand.joined(SESSION, STUDENT, { at: START });
    const leave = stand.left(SESSION, STUDENT, { at: LATER });
    const end = stand.roomEnded(SESSION, { at: END });

    expect(await stand.deliverInOrder([end, leave, join])).toEqual([200, 200, 200]);
    expect(events().map((arrived) => (arrived as ParticipantEvent).type)).toEqual([
      'room_ended',
      'left',
      'joined',
    ]);
  });
});

describe('the harness forges (T010, R-SESS-7, SC-406)', () => {
  const built: [string, () => VideoStandInEvent][] = [
    ['joined', () => stand.joined(SESSION, STUDENT, { at: START })],
    ['left', () => stand.left(SESSION, STUDENT, { at: LATER })],
    ['roomEnded', () => stand.roomEnded(SESSION, { at: END })],
  ];

  it('names the three forgeries of the contract, in its order', () => {
    expect(VIDEO_FORGERIES).toEqual(['wrong_secret', 'no_signature', 'body_changed']);
  });

  for (const [name, build] of built) {
    it.each(VIDEO_FORGERIES)(
      `${name}, %s: refused 401, as the original is accepted`,
      async (how) => {
        const event = build();

        expect(await stand.deliver(stand.tamper(event, how))).toBe(401);
        expect(await stand.deliver(event)).toBe(200);
        expect(arrivals.map((arrival) => arrival.status)).toEqual([401, 200]);
      },
    );
  }

  it('body_changed carries a provider id of its own, so it would be recorded anew were it not refused', () => {
    const event = stand.joined(SESSION, STUDENT, { at: START });
    const changed = stand.tamper(event, 'body_changed');

    expect(changed.providerEventId).not.toBe(event.providerEventId);
    expect(changed.headers).toEqual(event.headers);
    expect(stand.tamper(event, 'wrong_secret').rawBody).toEqual(event.rawBody);
    expect(stand.tamper(event, 'no_signature').rawBody).toEqual(event.rawBody);
  });

  it('a harness built from another ENCRYPTION_KEY signs what this webhook refuses', async () => {
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const elsewhere = createVideoStandIn({
      origin,
      webhookPath: WEBHOOK_PATH,
      config: { ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') },
    });

    expect(await elsewhere.deliver(elsewhere.joined(SESSION, STUDENT, { at: START }))).toBe(401);
  });
});

// The owner's decision of 2026-11-07 (B34): `scenario` builds the events of a row of SRS §3.7.5's
// table, a reconnection (SC-402) and a lost final leave (SC-403), under the seed's default settings
// (70%, a 10-minute join window, 60 seconds' minimum connection). Provider-Outage is not a video
// event and stays outside the harness. The simultaneous time is measured here with the interval
// operations of `@ijazah/time` (R-305), so each row's events are shown to give its outcome.
describe('the harness builds a scenario (T010, SC-402 to SC-404)', () => {
  const session = {
    id: SESSION,
    teacherUserId: TEACHER,
    studentUserId: STUDENT,
    startAt: START,
    endAt: END,
  } as const;
  const studentFirst = standInConnectionRef(STUDENT);
  const teacherOnly = standInConnectionRef(TEACHER);
  /** The seed's `attendance_threshold_pct` (70) of the 45-minute session, rounded up. */
  const THRESHOLD_SECONDS = 1890;

  type Row = readonly [string, string | null, string | null, string];

  async function delivered(built: readonly VideoStandInEvent[]): Promise<Row[]> {
    expect(await stand.deliverInOrder(built)).toEqual(built.map(() => 200));
    expect(new Set(built.map((event) => event.providerEventId)).size).toBe(built.length);
    return (events() as ParticipantEvent[]).map((event) => [
      event.type,
      event.participantUserId ?? null,
      event.connectionRef ?? null,
      event.occurredAt.toISOString(),
    ]);
  }

  /** A participant's connected time: each connection from its join to its leave, or to the end. */
  function connected(rows: readonly Row[], user: string): Interval[] {
    const intervals: Interval[] = [];
    const open = new Map<string, Date>();
    for (const [type, participant, connection, instant] of rows) {
      if (participant !== user || connection === null) continue;
      if (type === 'joined') open.set(connection, new Date(instant));
      const startsAt = open.get(connection);
      if (type === 'left' && startsAt !== undefined) {
        intervals.push({ startsAt, endsAt: new Date(instant) });
        open.delete(connection);
      }
    }
    for (const startsAt of open.values()) intervals.push({ startsAt, endsAt: END });
    return union(intervals);
  }

  function simultaneousSeconds(rows: readonly Row[]): number {
    return measureSeconds(
      clip(intersect(connected(rows, TEACHER), connected(rows, STUDENT)), {
        startsAt: START,
        endsAt: END,
      }),
    );
  }

  it('names its rows', () => {
    expect(VIDEO_SCENARIOS).toEqual([
      'done',
      'student_no_show',
      'teacher_no_show',
      'both_no_show',
      'under_threshold',
      'reconnection',
      'lost_final_leave',
    ]);
  });

  it('done: both connected the whole session, then the room ends', async () => {
    const rows = await delivered(stand.scenario(session, 'done'));

    expect(rows).toEqual([
      ['joined', TEACHER, teacherOnly, '2026-11-08T17:00:00.000Z'],
      ['joined', STUDENT, studentFirst, '2026-11-08T17:00:00.000Z'],
      ['left', TEACHER, teacherOnly, '2026-11-08T17:45:00.000Z'],
      ['left', STUDENT, studentFirst, '2026-11-08T17:45:00.000Z'],
      ['room_ended', null, null, '2026-11-08T17:45:00.000Z'],
    ]);
    expect(simultaneousSeconds(rows)).toBe(2700);
  });

  it('student_no_show: the teacher alone', async () => {
    expect(await delivered(stand.scenario(session, 'student_no_show'))).toEqual([
      ['joined', TEACHER, teacherOnly, '2026-11-08T17:00:00.000Z'],
      ['left', TEACHER, teacherOnly, '2026-11-08T17:45:00.000Z'],
      ['room_ended', null, null, '2026-11-08T17:45:00.000Z'],
    ]);
  });

  it('teacher_no_show: the student alone', async () => {
    expect(await delivered(stand.scenario(session, 'teacher_no_show'))).toEqual([
      ['joined', STUDENT, studentFirst, '2026-11-08T17:00:00.000Z'],
      ['left', STUDENT, studentFirst, '2026-11-08T17:45:00.000Z'],
      ['room_ended', null, null, '2026-11-08T17:45:00.000Z'],
    ]);
  });

  it('both_no_show: no event at all, since nobody opened the room', () => {
    expect(stand.scenario(session, 'both_no_show')).toEqual([]);
  });

  it('under_threshold: both joined, together one second short of the threshold', async () => {
    const rows = await delivered(stand.scenario(session, 'under_threshold'));

    expect(rows).toEqual([
      ['joined', TEACHER, teacherOnly, '2026-11-08T17:00:00.000Z'],
      ['joined', STUDENT, studentFirst, '2026-11-08T17:00:00.000Z'],
      ['left', STUDENT, studentFirst, '2026-11-08T17:31:29.000Z'],
      ['left', TEACHER, teacherOnly, '2026-11-08T17:45:00.000Z'],
      ['room_ended', null, null, '2026-11-08T17:45:00.000Z'],
    ]);
    expect(simultaneousSeconds(rows)).toBe(THRESHOLD_SECONDS - 1);
  });

  it('reconnection: the student drops a third of the way in and rejoins on a new connection a minute later (SC-402)', async () => {
    const rows = await delivered(stand.scenario(session, 'reconnection'));
    const studentSecond = `${studentFirst}_reconnected`;

    expect(rows).toEqual([
      ['joined', TEACHER, teacherOnly, '2026-11-08T17:00:00.000Z'],
      ['joined', STUDENT, studentFirst, '2026-11-08T17:00:00.000Z'],
      ['left', STUDENT, studentFirst, '2026-11-08T17:15:00.000Z'],
      ['joined', STUDENT, studentSecond, '2026-11-08T17:16:00.000Z'],
      ['left', TEACHER, teacherOnly, '2026-11-08T17:45:00.000Z'],
      ['left', STUDENT, studentSecond, '2026-11-08T17:45:00.000Z'],
      ['room_ended', null, null, '2026-11-08T17:45:00.000Z'],
    ]);
    // The sum of the two overlaps, 900 s and 1740 s, over the threshold.
    expect(simultaneousSeconds(rows)).toBe(2640);
    expect(simultaneousSeconds(rows)).toBeGreaterThanOrEqual(THRESHOLD_SECONDS);
  });

  it('lost_final_leave: the student’s leave and the room’s end never arrive (SC-403)', async () => {
    const rows = await delivered(stand.scenario(session, 'lost_final_leave'));

    expect(rows).toEqual([
      ['joined', TEACHER, teacherOnly, '2026-11-08T17:00:00.000Z'],
      ['joined', STUDENT, studentFirst, '2026-11-08T17:00:00.000Z'],
      ['left', TEACHER, teacherOnly, '2026-11-08T17:45:00.000Z'],
    ]);
    // The connection never left closes at the scheduled end (R-305, rule 1).
    expect(simultaneousSeconds(rows)).toBe(2700);
  });

  it('builds fresh events each time, for the same session', () => {
    const first = stand.scenario(session, 'done').map((event) => event.providerEventId);
    const second = stand.scenario(session, 'done').map((event) => event.providerEventId);

    expect(first.filter((id) => second.includes(id))).toEqual([]);
  });

  it('refuses a session whose end is not after its start, or too short for the rows', () => {
    expect(() => stand.scenario({ ...session, endAt: START }, 'done')).toThrow(RangeError);
    expect(() =>
      stand.scenario({ ...session, endAt: new Date('2026-11-08T17:03:00Z') }, 'reconnection'),
    ).toThrow(RangeError);
  });
});
