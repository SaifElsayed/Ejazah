// T118: the video stand-in. Rooms live in memory, one per session. It can produce a correctly signed
// and an incorrectly signed participant event for any room it created, so attendance evidence and
// the webhook signature guard (FR-074, T133) are exercised without a network: a body signed with
// HMAC-SHA256 under the webhook secret in the `x-fake-signature` header, or under a random secret
// for the incorrect one. Recording calls and induced failure are T122's.
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { EventSignatureError, MalformedEventError } from '../inbound-event.js';
import {
  bindJoinToken,
  type JoinToken,
  type ParticipantEvent,
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

export interface ParticipantEventOptions extends EventOptions {
  /** When the provider says it happened; the stand-in's clock by default. */
  readonly occurredAt?: Date;
}

interface Room {
  readonly providerRoomId: string;
  ended: boolean;
}

const eventBody = z.object({
  id: z.string().min(1),
  type: z.enum(['joined', 'left']),
  session: z.string().min(1),
  participant: z.string().min(1),
  occurred_at: z.iso.datetime(),
});

type EventBody = z.infer<typeof eventBody>;

export class FakeVideoAdapter implements VideoPort {
  readonly #webhookSecret: string;
  readonly #rooms = new Map<string, Room>();

  constructor(options: { readonly webhookSecret: string }) {
    this.#webhookSecret = options.webhookSecret;
  }

  createRoom(sessionId: string): Promise<string> {
    if (sessionId.length === 0) return Promise.reject(new RangeError('A room is for a session.'));
    const existing = this.#rooms.get(sessionId);
    if (existing !== undefined && !existing.ended) return Promise.resolve(existing.providerRoomId);
    const providerRoomId = `fake_room_${randomUUID()}`;
    this.#rooms.set(sessionId, { providerRoomId, ended: false });
    return Promise.resolve(providerRoomId);
  }

  createSessionToken(sessionId: string, participantUserId: string): Promise<JoinToken> {
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
  ): Promise<ParticipantEvent> {
    const signature = Object.entries(headers).find(
      ([name]) => name.toLowerCase() === SIGNATURE_HEADER,
    )?.[1];
    const expected = Buffer.from(sign(this.#webhookSecret, rawBody), 'hex');
    const given = Buffer.from(signature ?? '', 'hex');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return Promise.reject(new EventSignatureError());
    }
    let body: EventBody;
    try {
      body = eventBody.parse(JSON.parse(rawBody.toString('utf8')));
    } catch {
      // The parser's message can quote the body; the refusal carries none of it (R-SEC-2).
      return Promise.reject(new MalformedEventError());
    }
    return Promise.resolve({
      providerEventId: body.id,
      sessionId: body.session,
      participantUserId: body.participant,
      type: body.type,
      occurredAt: new Date(body.occurred_at),
    });
  }

  endRoom(sessionId: string): Promise<void> {
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
    type: ParticipantEvent['type'],
    options: ParticipantEventOptions = {},
  ): SignedEvent {
    if (!this.#rooms.has(sessionId))
      throw new Error('unknown room: the stand-in did not create it.');
    const body: EventBody = {
      id: `fake_vev_${randomUUID()}`,
      type,
      session: sessionId,
      participant: participantUserId,
      occurred_at: (options.occurredAt ?? new Date()).toISOString(),
    };
    return this.signed(Buffer.from(JSON.stringify(body)), options);
  }

  /** Any body, signed as the provider would sign it (or under a secret nobody holds). */
  signed(rawBody: Buffer, options: EventOptions = {}): SignedEvent {
    const secret =
      options.signature === 'invalid' ? randomBytes(32).toString('hex') : this.#webhookSecret;
    return { rawBody, headers: { [SIGNATURE_HEADER]: sign(secret, rawBody) } };
  }

  #openRoom(sessionId: string): Room {
    const room = this.#rooms.get(sessionId);
    if (room === undefined) throw new Error('unknown room: the stand-in did not create it.');
    if (room.ended) throw new Error('the room has ended: the stand-in admits nobody to it.');
    return room;
  }
}

function sign(secret: string, rawBody: Buffer): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}
