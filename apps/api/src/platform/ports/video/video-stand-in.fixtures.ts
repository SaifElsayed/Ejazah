// T010: the video stand-in's test harness (contracts/video.md, "The stand-in and its harness";
// FR-440; SC-402 to SC-406), for specs and nothing a request ever runs. It is the only way a spec
// produces a video event: it builds the event as the provider would, signed under the stand-in's
// secret, and POSTs it over HTTP to the listening API's `POST /webhooks/video`, so every event passes
// the same raw-body check and the same recording a real provider's would. No spec hands an event to
// the webhook's service directly.
//
// WHY HERE, as `003:T013` placed the gateway's (`../payment/gateway-stand-in.fixtures.ts`). Its
// entry for the test tree is `tests/support/video-stand-in.ts`, which binds it to the webhook's path.
// The building lives in the video port's folder because the specs of `apps/api/src` cannot import
// the test tree (the API's `rootDir` is `src`), and because only this folder may name the stand-in
// itself (R-API-4). The kernel imports no module, so the webhook's path is handed in by the caller.
//
// THE EVENTS are built for any session and any user, whether or not the stand-in the API holds ever
// created that room: a session's attendance can be told from its events alone (SC-404), and the API
// may run in another process. Each carries a fresh provider event id. A participant's event carries
// the connection named, or that participant's one connection (`standInConnectionRef`), so a join and
// a leave given none pair; a reconnection names its connections. The room's end carries neither.
// `tamper` makes the three forgeries of SC-406: a wrong secret, no signature, and a body changed
// after signing (here the same event under a new provider id, so it would be recorded anew were the
// signature not checked).
//
// SCENARIOS (the owner's decision of 2026-11-07): `scenario(session, row)` builds, in the order they
// happen, the events of a row of SRS §3.7.5's table, a reconnection (SC-402) and a lost final leave
// (SC-403), under the seed's default settings (`prisma/seed.ts:96-98`: `attendance_threshold_pct`
// 70, `join_window_minutes` 10, `minimum_connection_seconds` 60). Every join is at the scheduled
// start, inside the join window. `done`: both from the start to the end, then the room ends.
// `student_no_show` and `teacher_no_show`: the other one alone. `both_no_show`: no event, since
// nobody opened the room. `under_threshold`: both joined, the student leaving one second before the
// threshold's share of the session. `reconnection`: the student drops a third of the way in and
// rejoins a minimum connection's length later on a new connection, together still over the
// threshold. `lost_final_leave`: both join, the teacher leaves at the end, and the student's leave and
// the room's end never arrive. A session too short to hold a row's shape is refused. The
// Provider-Outage row is not here: its cause is an outage window an administrator records
// (`provider_outages`), not a video event, so no harness of the provider's events can produce it.
//
// Nothing here logs: the secret, the signatures and the bodies stay in the caller's hands (R-SEC-2).
import { randomBytes, randomUUID } from 'node:crypto';
import { addSeconds, unixSeconds } from '@ijazah/time';
import {
  FakeVideoAdapter,
  type SignedEvent,
  standInConnectionRef,
  type StandInVideoEventBody,
} from './fake.adapter.js';
import { standInVideoWebhookSecret, type VideoConfig } from './index.js';

/** The stand-in's signature header (`fake.adapter.ts`). */
const SIGNATURE_HEADER = 'x-fake-signature';

/** LiveKit's webhook content type, which the route accepts (T012). */
const CONTENT_TYPE = 'application/webhook+json';

/** How long a delivery waits for the webhook's answer. */
const DELIVERY_TIMEOUT_MS = 10_000;

/** The forged variants of SC-406, in the contract's order. */
export const VIDEO_FORGERIES = ['wrong_secret', 'no_signature', 'body_changed'] as const;

export type VideoForgery = (typeof VIDEO_FORGERIES)[number];

/** An event as the provider sends it, with the provider event id its body carries. */
export interface VideoStandInEvent extends SignedEvent {
  readonly providerEventId: string;
}

/** When a participant's event happened, and on which connection. */
export interface ParticipantEventAt {
  readonly at: Date;
  /** The connection; the participant's one connection when none is named. */
  readonly connection?: string;
}

/** When the room ended. */
export interface RoomEndedAt {
  readonly at: Date;
}

/** SRS §3.7.5's rows but Provider-Outage, a reconnection and a lost final leave (the header). */
export const VIDEO_SCENARIOS = [
  'done',
  'student_no_show',
  'teacher_no_show',
  'both_no_show',
  'under_threshold',
  'reconnection',
  'lost_final_leave',
] as const;

export type VideoScenario = (typeof VIDEO_SCENARIOS)[number];

/** The session a scenario is built for: its id, its two participants and its scheduled window. */
export interface ScenarioSession {
  readonly id: string;
  readonly teacherUserId: string;
  readonly studentUserId: string;
  readonly startAt: Date;
  readonly endAt: Date;
}

// The seed's defaults (`prisma/seed.ts:96-98`); a spec that changes a setting builds its own events.
const DEFAULT_ATTENDANCE_THRESHOLD_PCT = 70;
const DEFAULT_MINIMUM_CONNECTION_SECONDS = 60;
const PERCENT = 100;

/** The student's second connection in `reconnection`. */
const RECONNECTED_SUFFIX = '_reconnected';
/** `reconnection` drops the student a third of the way into the session. */
const RECONNECTION_DROP_DIVISOR = 3;

export interface VideoStandIn {
  joined(sessionId: string, userId: string, when: ParticipantEventAt): VideoStandInEvent;
  left(sessionId: string, userId: string, when: ParticipantEventAt): VideoStandInEvent;
  roomEnded(sessionId: string, when: RoomEndedAt): VideoStandInEvent;
  /** POSTs the event to the webhook; the status it answered. */
  deliver(event: VideoStandInEvent): Promise<number>;
  /** The same body and id twice, one after the other. */
  deliverTwice(event: VideoStandInEvent): Promise<readonly [number, number]>;
  /** The same body and id `n` times, one after the other (SC-405's hundred). */
  deliverTimes(event: VideoStandInEvent, n: number): Promise<number[]>;
  /** One after the other, in the order given, whatever order they happened in. */
  deliverInOrder(events: readonly VideoStandInEvent[]): Promise<number[]>;
  /** A forged variant of the event. */
  tamper(event: VideoStandInEvent, how: VideoForgery): VideoStandInEvent;
  /** The events of a scenario's row, in the order they happen, each fresh (the header). */
  scenario(session: ScenarioSession, row: VideoScenario): VideoStandInEvent[];
}

export interface VideoStandInOptions {
  /** The listening API's origin. */
  readonly origin: string;
  /** Where on it the webhook listens: `POST /webhooks/video`. */
  readonly webhookPath: string;
  /** The configuration the API's video port was built from: the secret is derived from it. */
  readonly config: Pick<VideoConfig, 'ENCRYPTION_KEY'>;
  readonly fetch?: typeof fetch;
}

export function createVideoStandIn({
  origin,
  webhookPath,
  config,
  fetch: send = fetch,
}: VideoStandInOptions): VideoStandIn {
  // Used to sign only: its rooms are never asked for, so no token and no media key (T084) either.
  const signer = new FakeVideoAdapter({
    webhookSecret: standInVideoWebhookSecret(config),
    mediaKeySecret: randomBytes(32),
  });
  const webhook = new URL(webhookPath, origin);

  const event = (body: StandInVideoEventBody): VideoStandInEvent => ({
    ...signer.signed(Buffer.from(JSON.stringify(body))),
    providerEventId: body.id,
  });

  const participantEvent = (
    type: 'joined' | 'left',
    sessionId: string,
    userId: string,
    { at, connection }: ParticipantEventAt,
  ): VideoStandInEvent =>
    event({
      id: freshEventId(),
      type,
      session: sessionId,
      participant: userId,
      connection: connection ?? standInConnectionRef(userId),
      occurred_at: at.toISOString(),
    });

  const deliver = async ({ rawBody, headers }: VideoStandInEvent): Promise<number> => {
    const response = await send(webhook, {
      method: 'POST',
      headers: { 'content-type': CONTENT_TYPE, ...headers },
      body: new Uint8Array(rawBody),
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    // The answer's body is the webhook's; nothing of it is needed.
    await response.body?.cancel();
    return response.status;
  };

  const deliverInOrder = async (events: readonly VideoStandInEvent[]): Promise<number[]> => {
    const statuses: number[] = [];
    for (const each of events) statuses.push(await deliver(each));
    return statuses;
  };

  const builders: EventBuilders = {
    joined: (sessionId, userId, when) => participantEvent('joined', sessionId, userId, when),
    left: (sessionId, userId, when) => participantEvent('left', sessionId, userId, when),
    roomEnded: (sessionId, { at }) =>
      event({
        id: freshEventId(),
        type: 'room_ended',
        session: sessionId,
        occurred_at: at.toISOString(),
      }),
  };

  return {
    ...builders,
    deliver,
    deliverTwice: async (each) => {
      const first = await deliver(each);
      return [first, await deliver(each)];
    },
    deliverTimes: async (each, n) => {
      if (!Number.isSafeInteger(n) || n < 1) {
        throw new RangeError('An event is delivered a positive whole number of times.');
      }
      return deliverInOrder(Array.from({ length: n }, () => each));
    },
    deliverInOrder,
    tamper: (each, how) => tampered(signer, each, how),
    scenario: (session, row) => scenarioEvents(builders, session, row),
  };
}

type EventBuilders = Pick<VideoStandIn, 'joined' | 'left' | 'roomEnded'>;

/** The events of `row` for `session`, in the order they happen (the header). */
function scenarioEvents(
  { joined, left, roomEnded }: EventBuilders,
  { id, teacherUserId: teacher, studentUserId: student, startAt, endAt }: ScenarioSession,
  row: VideoScenario,
): VideoStandInEvent[] {
  const lengthSeconds = unixSeconds(endAt) - unixSeconds(startAt);
  const thresholdSeconds = Math.ceil((lengthSeconds * DEFAULT_ATTENDANCE_THRESHOLD_PCT) / PERCENT);
  const shortOfThresholdSeconds = thresholdSeconds - 1;
  const gapSeconds = DEFAULT_MINIMUM_CONNECTION_SECONDS;
  // Each row's student is connected at least the minimum, and a reconnection's gap keeps the two
  // together at or over the threshold.
  if (
    shortOfThresholdSeconds < DEFAULT_MINIMUM_CONNECTION_SECONDS ||
    lengthSeconds - gapSeconds < thresholdSeconds
  ) {
    throw new RangeError('The session is too short for the scenario’s rows.');
  }
  const after = (seconds: number): Date => new Date(addSeconds(startAt, seconds));
  const start = { at: startAt };
  const end = { at: endAt };

  switch (row) {
    case 'done':
      return [
        joined(id, teacher, start),
        joined(id, student, start),
        left(id, teacher, end),
        left(id, student, end),
        roomEnded(id, end),
      ];
    case 'student_no_show':
      return [joined(id, teacher, start), left(id, teacher, end), roomEnded(id, end)];
    case 'teacher_no_show':
      return [joined(id, student, start), left(id, student, end), roomEnded(id, end)];
    case 'both_no_show':
      return [];
    case 'under_threshold':
      return [
        joined(id, teacher, start),
        joined(id, student, start),
        left(id, student, { at: after(shortOfThresholdSeconds) }),
        left(id, teacher, end),
        roomEnded(id, end),
      ];
    case 'reconnection': {
      const dropSeconds = Math.floor(lengthSeconds / RECONNECTION_DROP_DIVISOR);
      const first = standInConnectionRef(student);
      const second = `${first}${RECONNECTED_SUFFIX}`;
      return [
        joined(id, teacher, start),
        joined(id, student, { at: startAt, connection: first }),
        left(id, student, { at: after(dropSeconds), connection: first }),
        joined(id, student, { at: after(dropSeconds + gapSeconds), connection: second }),
        left(id, teacher, end),
        left(id, student, { at: endAt, connection: second }),
        roomEnded(id, end),
      ];
    }
    case 'lost_final_leave':
      return [joined(id, teacher, start), joined(id, student, start), left(id, teacher, end)];
  }
}

function freshEventId(): string {
  return `fake_vev_${randomUUID()}`;
}

function tampered(
  signer: FakeVideoAdapter,
  event: VideoStandInEvent,
  how: VideoForgery,
): VideoStandInEvent {
  switch (how) {
    case 'wrong_secret':
      return {
        ...signer.signed(event.rawBody, { signature: 'invalid' }),
        providerEventId: event.providerEventId,
      };
    case 'no_signature':
      return {
        rawBody: event.rawBody,
        headers: Object.fromEntries(
          Object.entries(event.headers).filter(([name]) => name.toLowerCase() !== SIGNATURE_HEADER),
        ),
        providerEventId: event.providerEventId,
      };
    case 'body_changed': {
      const body = JSON.parse(event.rawBody.toString('utf8')) as Record<string, unknown>;
      const providerEventId = freshEventId();
      return {
        rawBody: Buffer.from(JSON.stringify({ ...body, id: providerEventId })),
        headers: event.headers,
        providerEventId,
      };
    }
  }
}
