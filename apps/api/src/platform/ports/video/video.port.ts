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

declare const joinTokenBrand: unique symbol;

/** Admission of one participant to one session's room. The credential is never logged (R-SEC-2). */
export interface JoinToken {
  readonly sessionId: string;
  readonly participantUserId: string;
  /** What the participant's app presents to the provider; opaque to the platform. */
  readonly credential: string;
  readonly [joinTokenBrand]: true;
}

/** A participant connecting to or leaving a session's room, as the provider reported it. */
export interface ParticipantEvent {
  /** The provider's own id, for `session_participant_events.provider_event_id` (R-SESS-1). */
  readonly providerEventId: string;
  readonly sessionId: string;
  readonly participantUserId: string;
  /** The `session_participant_events.event_type` it is stored under. */
  readonly type: 'joined' | 'left';
  /** When the provider says it happened. */
  readonly occurredAt: Date;
}

export interface VideoPort {
  /** Prepare a lesson. Answers the provider's room reference (`sessions.provider_room_id`). */
  createRoom(sessionId: string): Promise<string>;
  /** Admit one participant to one session (R-GENDER-7, FR-SESS-3). */
  createSessionToken(sessionId: string, participantUserId: string): Promise<JoinToken>;
  /** Attendance evidence from the provider's signed webhook (R-SESS-1). */
  verifyAndParseParticipantEvent(
    rawBody: Buffer,
    headers: Readonly<Record<string, string | undefined>>,
  ): Promise<ParticipantEvent>;
  /** Cleanup. Ending a room that has ended already is not an error. */
  endRoom(sessionId: string): Promise<void>;
}

/** The only way to make a `JoinToken`: bound to a session and a participant, with a credential. */
export function bindJoinToken(
  sessionId: string,
  participantUserId: string,
  credential: string,
): JoinToken {
  if (sessionId.length === 0 || participantUserId.length === 0) {
    throw new RangeError('A join token is bound to one session and one participant (R-GENDER-7).');
  }
  if (credential.length === 0) {
    throw new RangeError('A join token carries a credential.');
  }
  return { sessionId, participantUserId, credential } as JoinToken;
}
