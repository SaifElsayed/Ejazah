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
// Nothing here logs: the secret, the signatures and the bodies stay in the caller's hands (R-SEC-2).
import { randomUUID } from 'node:crypto';
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
  // Used to sign only: its rooms are never asked for.
  const signer = new FakeVideoAdapter({ webhookSecret: standInVideoWebhookSecret(config) });
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

  return {
    joined: (sessionId, userId, when) => participantEvent('joined', sessionId, userId, when),
    left: (sessionId, userId, when) => participantEvent('left', sessionId, userId, when),
    roomEnded: (sessionId, { at }) =>
      event({
        id: freshEventId(),
        type: 'room_ended',
        session: sessionId,
        occurred_at: at.toISOString(),
      }),
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
  };
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
