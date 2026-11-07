// T009 (FR-425, FR-430, FR-431, FR-436; research R-302, R-303, R-304; contracts/video.md, "The
// LiveKit adapter"; ADR 0003 D2): LiveKit Cloud behind the video port, selected by
// `VIDEO_PROVIDER=livekit`, over `livekit-server-sdk` 2.19.2. The project's API key and secret
// authorise every server call, sign every join token and verify every webhook: LiveKit has no other
// secret. Neither, nor a token, nor a body, is ever logged or put in an error (R-SEC-1, R-SEC-2).
//
// THE ROOM is named by the session's id, so nothing is stored for it (the session's id finds it
// again), and is created through `RoomServiceClient.createRoom` with `maxParticipants: 2`, which
// holds FR-436 at the provider, and the two timeouts as the caller read them from the settings
// (`video_empty_timeout_seconds`, `video_departure_timeout_seconds`). LiveKit answers an existing
// room for its name, so a second call opens nothing new: idempotent. `endRoom` is `deleteRoom`,
// which disconnects whoever is in it (FR-482); a room LiveKit no longer has (ended, or never opened)
// answers `not_found`, which is not an error here.
//
// THE TOKEN is LiveKit's `AccessToken`: identity the user's id (an opaque UUID, since LiveKit
// records identities in its logs; no name, no metadata), the grant `roomJoin` to the session's room
// with `canPublish` and `canSubscribe`, and `canPublishData: false` (LiveKit's default is true); no
// `roomCreate`, no `roomAdmin`, nothing else. Its life ends at `validUntil`, never after: the SDK
// counts the TTL in whole seconds from its own reading of the clock, taken after this one and so
// possibly a second further on, so the TTL is the whole seconds between now and `validUntil` less
// one (the token ends one or two seconds early, never late). LiveKit checks it on the first
// connection only and refreshes it for a connected client (R-302). With no whole second left the
// SDK would fall back to its six-hour default (a TTL of 0 is falsy there), so that is refused.
//
// THE WEBHOOK is verified by `WebhookReceiver.receive(body, Authorization)`, never with `skipAuth`:
// it verifies the JWT in `Authorization` under the key and secret and compares its `sha256` claim
// with the body's digest, so a body changed after signing is refused (R-303, R-SESS-7). A refusal
// there is `EventSignatureError`. The SDK reads the body only after the signature held, and throws
// a `SyntaxError` (not JSON) or protobuf's "cannot decode …" (not a `WebhookEvent`); those two alone
// are `MalformedEventError`, anything else failing closed as a signature refusal. Then R-304's
// mapping: `participant_joined` is `joined`; `participant_left` and
// `participant_connection_aborted` are `left`, each with the participant's identity as the user and
// its `sid` as the connection; `room_finished` is `room_ended`, with neither; anything else
// (`room_started`, `track_*`, egress, ingress, agents) is `{ kind: 'ignored' }`. The session is the
// room's name, the provider event id LiveKit's event `id`, and the instant its `createdAt` (UNIX
// seconds, the provider's clock, R-TIME-6). An attendance event missing any of these is
// `MalformedEventError`, quoting nothing of the body.
//
// Every server call has the SDK's timeout, set here (R-API rules: no outbound call without one).
import { AccessToken, RoomServiceClient, TwirpError, WebhookReceiver } from 'livekit-server-sdk';
import type { WebhookEvent } from 'livekit-server-sdk';
import { addSeconds, unixSeconds } from '@ijazah/time';
import { EventSignatureError, MalformedEventError } from '../inbound-event.js';
import {
  bindJoinToken,
  type IgnoredEvent,
  type JoinToken,
  type ParticipantEvent,
  type RoomTimeouts,
  type TokenValidity,
  type VideoPort,
} from './video.port.js';

/** How long a call to LiveKit's server API waits before it is aborted, in seconds. */
const REQUEST_TIMEOUT_SECONDS = 10;

/** FR-436: a lesson is one teacher and one student. */
const MAX_PARTICIPANTS = 2;

const AUTHORIZATION_HEADER = 'authorization';

/** The second the SDK's own clock may be ahead of this one when it counts a token's TTL. */
const SDK_CLOCK_MARGIN_SECONDS = 1;

/** LiveKit's `createdAt` counts whole seconds from here. */
const UNIX_EPOCH = new Date(0);

const IGNORED: IgnoredEvent = { kind: 'ignored' };

export interface LiveKitVideoOptions {
  /** The project's `wss://` address (`LIVEKIT_URL`). */
  readonly url: string;
  readonly apiKey: string;
  readonly apiSecret: string;
}

export class LiveKitVideoAdapter implements VideoPort {
  readonly #apiKey: string;
  readonly #apiSecret: string;
  readonly #rooms: RoomServiceClient;
  readonly #receiver: WebhookReceiver;

  constructor({ url, apiKey, apiSecret }: LiveKitVideoOptions) {
    this.#apiKey = apiKey;
    this.#apiSecret = apiSecret;
    this.#rooms = new RoomServiceClient(url, apiKey, apiSecret, {
      requestTimeout: REQUEST_TIMEOUT_SECONDS,
    });
    this.#receiver = new WebhookReceiver(apiKey, apiSecret);
  }

  async createRoom(sessionId: string, timeouts: RoomTimeouts): Promise<string> {
    if (sessionId.length === 0) throw new RangeError('A room is for a session.');
    const room = await this.#rooms.createRoom({
      name: sessionId,
      maxParticipants: MAX_PARTICIPANTS,
      emptyTimeout: timeouts.emptyTimeoutSeconds,
      departureTimeout: timeouts.departureTimeoutSeconds,
    });
    return room.name;
  }

  async createSessionToken(
    sessionId: string,
    participantUserId: string,
    { validUntil }: TokenValidity,
  ): Promise<JoinToken> {
    if (sessionId.length === 0 || participantUserId.length === 0) {
      throw new RangeError(
        'A join token is bound to one session and one participant (R-GENDER-7).',
      );
    }
    // One second less than the whole seconds between them: the SDK reads its own clock after this
    // one, and may be a second further on (the header).
    const ttlSeconds = unixSeconds(validUntil) - unixSeconds(new Date()) - SDK_CLOCK_MARGIN_SECONDS;
    if (!(ttlSeconds >= 1)) {
      throw new RangeError('A join token needs at least one whole second before validUntil.');
    }
    const token = new AccessToken(this.#apiKey, this.#apiSecret, {
      identity: participantUserId,
      ttl: ttlSeconds,
    });
    token.addGrant({
      roomJoin: true,
      room: sessionId,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
    });
    return bindJoinToken(sessionId, participantUserId, await token.toJwt());
  }

  async verifyAndParseParticipantEvent(
    rawBody: Buffer,
    headers: Readonly<Record<string, string | undefined>>,
  ): Promise<ParticipantEvent | IgnoredEvent> {
    const authorization = Object.entries(headers).find(
      ([name]) => name.toLowerCase() === AUTHORIZATION_HEADER,
    )?.[1];
    if (authorization === undefined || authorization.length === 0) {
      throw new EventSignatureError();
    }
    let event: WebhookEvent;
    try {
      event = await this.#receiver.receive(rawBody.toString('utf8'), authorization);
    } catch (error: unknown) {
      // Neither refusal carries the SDK's message, which can quote the body (R-SEC-2).
      throw unreadableAfterVerifying(error) ? new MalformedEventError() : new EventSignatureError();
    }
    return attendanceOf(event);
  }

  async endRoom(sessionId: string): Promise<void> {
    try {
      await this.#rooms.deleteRoom(sessionId);
    } catch (error: unknown) {
      if (error instanceof TwirpError && (error.code === 'not_found' || error.status === 404)) {
        return;
      }
      throw error;
    }
  }
}

/**
 * Whether `receive` failed reading a body whose signature held: its last step, after the
 * verification, is `WebhookEvent.fromJson(JSON.parse(body))`.
 */
function unreadableAfterVerifying(error: unknown): boolean {
  return (
    error instanceof SyntaxError ||
    (error instanceof Error && error.message.startsWith('cannot decode '))
  );
}

function attendanceOf(event: WebhookEvent): ParticipantEvent | IgnoredEvent {
  const type = attendanceType(event.event);
  if (type === undefined) return IGNORED;
  const providerEventId = event.id;
  const sessionId = event.room?.name ?? '';
  const createdAtSeconds = Number(event.createdAt);
  if (
    providerEventId === '' ||
    sessionId === '' ||
    !Number.isSafeInteger(createdAtSeconds) ||
    createdAtSeconds <= 0
  ) {
    throw new MalformedEventError();
  }
  const occurredAt = new Date(addSeconds(UNIX_EPOCH, createdAtSeconds));
  if (type === 'room_ended') return { providerEventId, sessionId, type, occurredAt };
  const participantUserId = event.participant?.identity ?? '';
  const connectionRef = event.participant?.sid ?? '';
  if (participantUserId === '' || connectionRef === '') throw new MalformedEventError();
  return { providerEventId, sessionId, type, participantUserId, connectionRef, occurredAt };
}

function attendanceType(name: string): ParticipantEvent['type'] | undefined {
  switch (name) {
    case 'participant_joined':
      return 'joined';
    case 'participant_left':
    case 'participant_connection_aborted':
      return 'left';
    case 'room_finished':
      return 'room_ended';
    default:
      return undefined;
  }
}
