// T118: the video port (contracts/ports.md). Named for what the product does, never a provider
// (R-API-5): a room for a session, a token admitting one participant, the attendance evidence the
// provider reports, the room's end.
//
// R-GENDER-7 is held by the shape. A token is issued for a session and a participant together, and
// the token itself carries both, so there is no way to ask for, or to hold, a token bound to a
// session alone. A `JoinToken` is minted only by `bindJoinToken`, which refuses an empty binding;
// the brand below is declared and never exported (the money-brand technique, research R-3), so a
// literal cannot pass for one. Whether the two participants may meet at all is the token issuer's
// check from server-held records (FR-SESS-2), made before this port is asked.
//
// Attendance comes from the provider, never the client (R-SESS-1). The inbound operation takes the
// raw body and its headers, verifies the provider's signature on it and only then reads it, as the
// payment port does (R-MONEY-9, FR-074); it rejects with `EventSignatureError` or
// `MalformedEventError` (`../inbound-event.ts`), which the webhook signature guard answers 401 and
// 400. Every event carries the provider's own id, stored under the unique
// `session_participant_events.provider_event_id` before anything acts on it.
//
// ARCHITECTURE §3.4's sketch names this operation `recordParticipantEvent(event)`, returning
// nothing; its names are illustrative (note under T117). Recording is the sessions module's write;
// what the provider-facing port can do is verify and read the event, which is the contract's
// "Record an inbound participant event | Attendance evidence" from this side of the port.
//
// T009 (contracts/video.md, "The port, as this phase calls it"; research R-302, R-304) widens it
// additively: a room is created with the two timeouts the settings `video_empty_timeout_seconds`
// and `video_departure_timeout_seconds` give, a token with the instant it stops opening a
// connection (the session's scheduled end), and an event is a participant's join or leave, carrying
// the participant and their connection, or the room's end, carrying neither. A correctly signed
// event that is not attendance answers `{ kind: 'ignored' }`, which the webhook acknowledges with
// 200 and records nowhere.
//
// T011 (the note under T011, K1): a token also carries the provider's address the participant's
// app connects to, `serverUrl`, which only the adapter knows (LiveKit: the project's `LIVEKIT_URL`;
// the stand-in: one fixed address), so `sessions.join` answers it beside the credential and no
// address is built into the app (R-302).
//
// 004:T084 (SRS DEC-102, NFR-SEC-13; the note under T084, (2)): a token also carries the session's
// media key, with which both phones encrypt the room's audio, camera and screen share end to end, so
// the provider forwards frames it cannot read. `mediaKeyOf` makes it: 32 bytes, HMAC-SHA-256 of the
// session's id under the platform's own secret (`VIDEO_MEDIA_KEY_SECRET`, or its stand-in in
// development and test, `index.ts`), never the provider's secret. So both participants of one
// session get the same key and no other session's, and nothing is stored for it. The key is never
// sent to the provider and never logged (R-SEC-2): `mediaKey` is a redacted name (`logger.ts`).
import { createHmac } from 'node:crypto';

declare const joinTokenBrand: unique symbol;

/** Admission of one participant to one session's room. The credential is never logged (R-SEC-2). */
export interface JoinToken {
  readonly sessionId: string;
  readonly participantUserId: string;
  /** What the participant's app presents to the provider; opaque to the platform. */
  readonly credential: string;
  /** Where the participant's app presents it: the provider's address (K1). */
  readonly serverUrl: string;
  /** T084: the session's media key, 32 bytes in base64 (`mediaKeyOf`); never logged (R-SEC-2). */
  readonly mediaKey: string;
  readonly [joinTokenBrand]: true;
}

/** How long the provider keeps a room open, from the two settings (R-302; the analysis, K2). */
export interface RoomTimeouts {
  /** Before anyone joins: `video_empty_timeout_seconds`. */
  readonly emptyTimeoutSeconds: number;
  /** After the last participant leaves: `video_departure_timeout_seconds`. */
  readonly departureTimeoutSeconds: number;
}

/** Until when a token may open a connection: the session's `scheduled_end_at` (R-302). */
export interface TokenValidity {
  readonly validUntil: Date;
}

/**
 * A participant connecting to or leaving a session's room, or the room's end, as the provider
 * reported it. The participant and the connection are present exactly when `type` is not
 * `room_ended` (contracts/video.md).
 */
export interface ParticipantEvent {
  /** The provider's own id, for `session_participant_events.provider_event_id` (R-SESS-1). */
  readonly providerEventId: string;
  readonly sessionId: string;
  /** The `session_participant_events.event_type` it is stored under. */
  readonly type: 'joined' | 'left' | 'room_ended';
  /** Whose connection it is; absent for `room_ended`. */
  readonly participantUserId?: string;
  /** The provider's id of the connection (`connection_ref`, R-304); absent for `room_ended`. */
  readonly connectionRef?: string;
  /** When the provider says it happened, by the provider's clock (R-TIME-6). */
  readonly occurredAt: Date;
}

/** A correctly signed event that is not attendance: acknowledged, recorded nowhere (R-304). */
export interface IgnoredEvent {
  readonly kind: 'ignored';
}

export interface VideoPort {
  /**
   * Prepare a lesson's room, named by the session's id: nothing is stored for it, the room is found
   * again by that id. Idempotent: a room that exists is answered. Answers the provider's room
   * reference.
   */
  createRoom(sessionId: string, timeouts: RoomTimeouts): Promise<string>;
  /** Admit one participant to one session until `validUntil` (R-GENDER-7, FR-SESS-3). */
  createSessionToken(
    sessionId: string,
    participantUserId: string,
    validity: TokenValidity,
  ): Promise<JoinToken>;
  /** Attendance evidence from the provider's signed webhook (R-SESS-1). */
  verifyAndParseParticipantEvent(
    rawBody: Buffer,
    headers: Readonly<Record<string, string | undefined>>,
  ): Promise<ParticipantEvent | IgnoredEvent>;
  /** Cleanup. Ending a room that has ended already is not an error. */
  endRoom(sessionId: string): Promise<void>;
}

/**
 * T084: the session's media key, 32 bytes in base64: HMAC-SHA-256 of the session's id under
 * `secret`, the platform's own (this file's head). The same for every participant of the session.
 */
export function mediaKeyOf(secret: Buffer, sessionId: string): string {
  if (secret.length === 0 || sessionId.length === 0) {
    throw new RangeError('A media key is of one session, under a secret.');
  }
  return createHmac('sha256', secret).update(sessionId).digest('base64');
}

/**
 * The only way to make a `JoinToken`: bound to a session and a participant, with a credential, the
 * provider's address it is presented at (K1) and the session's media key (T084).
 */
export function bindJoinToken(
  sessionId: string,
  participantUserId: string,
  credential: string,
  serverUrl: string,
  mediaKey: string,
): JoinToken {
  if (sessionId.length === 0 || participantUserId.length === 0) {
    throw new RangeError('A join token is bound to one session and one participant (R-GENDER-7).');
  }
  if (credential.length === 0) {
    throw new RangeError('A join token carries a credential.');
  }
  if (serverUrl.length === 0) {
    throw new RangeError('A join token carries the address it is presented at.');
  }
  if (mediaKey.length === 0) {
    throw new RangeError('A join token carries the session’s media key (T084).');
  }
  return { sessionId, participantUserId, credential, serverUrl, mediaKey } as JoinToken;
}
