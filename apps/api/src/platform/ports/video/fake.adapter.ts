// T118: the video stand-in. Rooms live in memory, one per session. It can produce a correctly signed
// and an incorrectly signed participant event for any room it created, so attendance evidence and
// the webhook signature guard (FR-074, T133) are exercised without a network: a body signed with
// HMAC-SHA256 under the webhook secret in the `x-fake-signature` header, or under a random secret
// for the incorrect one. T122: it records each operation it was asked to do and fails one when told,
// before anything changes.
//
// T009 (contracts/video.md, "The stand-in and its harness"): widened to the port as LiveKit serves
// it. A room is created with its two timeouts and a token with its `validUntil`, both recorded as
// asked and neither enforced: the stand-in admits whom it is told to. An event is `joined`, `left` or
// `room_ended`; a participant's carries their connection (`connection`), by default one per
// participant (`standInConnectionRef`), so their join and leave pair as LiveKit's `sid` makes them;
// the room's end carries no participant. A correctly signed body of any other `type` answers
// `{ kind: 'ignored' }`, as LiveKit's `track_*` and `room_started` do; its signature is checked first.
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { EventSignatureError, MalformedEventError } from '../inbound-event.js';
import { StandIn } from '../stand-in.js';
import {
  bindJoinToken,
  type IgnoredEvent,
  type JoinToken,
  type ParticipantEvent,
  type RoomTimeouts,
  type TokenValidity,
  type VideoPort,
} from './video.port.js';

const SIGNATURE_HEADER = 'x-fake-signature';

/** An inbound event as it arrives: the raw body and the headers that carry its signature. */
export interface SignedEvent {
  readonly rawBody: Buffer;
  readonly headers: Readonly<Record<string, string>>;
}

export interface EventOptions {
  /** `invalid` signs under a secret nobody holds. */
  readonly signature?: 'valid' | 'invalid';
}

export interface RoomEndedEventOptions extends EventOptions {
  /** When the provider says it happened; the stand-in's clock by default. */
  readonly occurredAt?: Date;
}

export interface ParticipantEventOptions extends RoomEndedEventOptions {
  /** The connection it is of; the participant's one connection by default. */
  readonly connectionRef?: string;
}

interface Room {
  readonly providerRoomId: string;
  ended: boolean;
}

const ATTENDANCE_TYPES: readonly string[] = ['joined', 'left', 'room_ended'];

const eventKind = z.object({ type: z.string() });

const eventBody = z.discriminatedUnion('type', [
  z.object({
    id: z.string().min(1),
    type: z.enum(['joined', 'left']),
    session: z.string().min(1),
    participant: z.string().min(1),
    connection: z.string().min(1),
    occurred_at: z.iso.datetime(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('room_ended'),
    session: z.string().min(1),
    occurred_at: z.iso.datetime(),
  }),
]);

/** The stand-in's event body, as it is signed and sent. */
export type StandInVideoEventBody = z.infer<typeof eventBody>;

/** A participant's one connection, when the event names none. */
export function standInConnectionRef(participantUserId: string): string {
  return `fake_conn_${participantUserId}`;
}

export class FakeVideoAdapter extends StandIn<VideoPort> implements VideoPort {
  readonly #webhookSecret: string;
  readonly #rooms = new Map<string, Room>();

  constructor(options: { readonly webhookSecret: string }) {
    super();
    this.#webhookSecret = options.webhookSecret;
  }

  createRoom(sessionId: string, timeouts: RoomTimeouts): Promise<string> {
    const failure = this.attempt('createRoom', [sessionId, timeouts]);
    if (failure !== undefined) return Promise.reject(failure);
    if (sessionId.length === 0) return Promise.reject(new RangeError('A room is for a session.'));
    const existing = this.#rooms.get(sessionId);
    if (existing !== undefined && !existing.ended) return Promise.resolve(existing.providerRoomId);
    const providerRoomId = `fake_room_${randomUUID()}`;
    this.#rooms.set(sessionId, { providerRoomId, ended: false });
    return Promise.resolve(providerRoomId);
  }

  createSessionToken(
    sessionId: string,
    participantUserId: string,
    validity: TokenValidity,
  ): Promise<JoinToken> {
    const failure = this.attempt('createSessionToken', [sessionId, participantUserId, validity]);
    if (failure !== undefined) return Promise.reject(failure);
    try {
      this.#openRoom(sessionId);
      return Promise.resolve(
        bindJoinToken(sessionId, participantUserId, `fake_vtk_${randomUUID()}`),
      );
    } catch (error: unknown) {
      return Promise.reject(error as Error);
    }
  }

  verifyAndParseParticipantEvent(
    rawBody: Buffer,
    headers: Readonly<Record<string, string | undefined>>,
  ): Promise<ParticipantEvent | IgnoredEvent> {
    const failure = this.attempt('verifyAndParseParticipantEvent', [rawBody, headers]);
    if (failure !== undefined) return Promise.reject(failure);
    const signature = Object.entries(headers).find(
      ([name]) => name.toLowerCase() === SIGNATURE_HEADER,
    )?.[1];
    const expected = Buffer.from(sign(this.#webhookSecret, rawBody), 'hex');
    const given = Buffer.from(signature ?? '', 'hex');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return Promise.reject(new EventSignatureError());
    }
    let body: StandInVideoEventBody;
    try {
      const parsed: unknown = JSON.parse(rawBody.toString('utf8'));
      if (!ATTENDANCE_TYPES.includes(eventKind.parse(parsed).type)) {
        return Promise.resolve({ kind: 'ignored' });
      }
      body = eventBody.parse(parsed);
    } catch {
      // The parser's message can quote the body; the refusal carries none of it (R-SEC-2).
      return Promise.reject(new MalformedEventError());
    }
    const occurredAt = new Date(body.occurred_at);
    return Promise.resolve(
      body.type === 'room_ended'
        ? { providerEventId: body.id, sessionId: body.session, type: body.type, occurredAt }
        : {
            providerEventId: body.id,
            sessionId: body.session,
            type: body.type,
            participantUserId: body.participant,
            connectionRef: body.connection,
            occurredAt,
          },
    );
  }

  endRoom(sessionId: string): Promise<void> {
    const failure = this.attempt('endRoom', [sessionId]);
    if (failure !== undefined) return Promise.reject(failure);
    const room = this.#rooms.get(sessionId);
    if (room === undefined)
      return Promise.reject(new Error('unknown room: the stand-in did not create it.'));
    room.ended = true;
    return Promise.resolve();
  }

  /** The provider reporting a participant joining or leaving a room this stand-in created. */
  participantEvent(
    sessionId: string,
    participantUserId: string,
    type: 'joined' | 'left',
    options: ParticipantEventOptions = {},
  ): SignedEvent {
    this.#knownRoom(sessionId);
    return this.#event(
      {
        id: freshEventId(),
        type,
        session: sessionId,
        participant: participantUserId,
        connection: options.connectionRef ?? standInConnectionRef(participantUserId),
        occurred_at: (options.occurredAt ?? new Date()).toISOString(),
      },
      options,
    );
  }

  /** The provider reporting the end of a room this stand-in created. */
  roomEndedEvent(sessionId: string, options: RoomEndedEventOptions = {}): SignedEvent {
    this.#knownRoom(sessionId);
    return this.#event(
      {
        id: freshEventId(),
        type: 'room_ended',
        session: sessionId,
        occurred_at: (options.occurredAt ?? new Date()).toISOString(),
      },
      options,
    );
  }

  /** Any body, signed as the provider would sign it (or under a secret nobody holds). */
  signed(rawBody: Buffer, options: EventOptions = {}): SignedEvent {
    const secret =
      options.signature === 'invalid' ? randomBytes(32).toString('hex') : this.#webhookSecret;
    return { rawBody, headers: { [SIGNATURE_HEADER]: sign(secret, rawBody) } };
  }

  #event(body: StandInVideoEventBody, options: EventOptions): SignedEvent {
    return this.signed(Buffer.from(JSON.stringify(body)), options);
  }

  #knownRoom(sessionId: string): void {
    if (!this.#rooms.has(sessionId))
      throw new Error('unknown room: the stand-in did not create it.');
  }

  #openRoom(sessionId: string): Room {
    const room = this.#rooms.get(sessionId);
    if (room === undefined) throw new Error('unknown room: the stand-in did not create it.');
    if (room.ended) throw new Error('the room has ended: the stand-in admits nobody to it.');
    return room;
  }
}

function freshEventId(): string {
  return `fake_vev_${randomUUID()}`;
}

function sign(secret: string, rawBody: Buffer): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}
