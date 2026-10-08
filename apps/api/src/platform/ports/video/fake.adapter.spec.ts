// T118: the video port and its stand-in (contracts/ports.md, R-GENDER-7, FR-SESS-3, R-SESS-1).
//
// The port has exactly four operations: create a room for a session, issue a join token, verify and
// read an inbound participant event, end a room. A join token is issued for a session and a
// participant together, and the token itself carries both, so a token bound to a session alone
// cannot be written. The stand-in keeps rooms in memory and can produce a correctly and an
// incorrectly signed participant event for any room it created, so attendance evidence is testable
// without a network. Recording calls and induced failure are T122's.
//
// The type checks are enforced by `pnpm typecheck` (CI stage 1), not by vitest.
import { describe, expect, expectTypeOf, it } from 'vitest';
import { EventSignatureError, MalformedEventError } from '../inbound-event.js';
import { FakeVideoAdapter } from './fake.adapter.js';
import {
  bindJoinToken,
  type JoinToken,
  type ParticipantEvent,
  type VideoPort,
} from './video.port.js';

const SECRET = 'stand-in-video-webhook-secret';
const SESSION = '01928c3e-7a10-7000-8000-000000000001';
const OTHER_SESSION = '01928c3e-7a10-7000-8000-000000000002';
const STUDENT = '01928c3e-7a10-7000-8000-0000000000a1';
const TEACHER = '01928c3e-7a10-7000-8000-0000000000b1';

function video(): FakeVideoAdapter {
  return new FakeVideoAdapter({ webhookSecret: SECRET });
}

describe('the video port (T118, contracts/ports.md)', () => {
  it('has exactly four operations, named for what the product does (R-API-5)', () => {
    expectTypeOf<keyof VideoPort>().toEqualTypeOf<
      'createRoom' | 'createSessionToken' | 'verifyAndParseParticipantEvent' | 'endRoom'
    >();
  });

  it('issues a token only for a session and a participant together (R-GENDER-7)', () => {
    expectTypeOf<Parameters<VideoPort['createSessionToken']>>().toEqualTypeOf<
      [sessionId: string, participantUserId: string]
    >();
    expectTypeOf<ReturnType<VideoPort['createSessionToken']>>().toEqualTypeOf<Promise<JoinToken>>();
  });

  it('cannot represent a token bound to a session alone, or written by hand', () => {
    expectTypeOf<JoinToken['sessionId']>().toEqualTypeOf<string>();
    expectTypeOf<JoinToken['participantUserId']>().toEqualTypeOf<string>();
    // @ts-expect-error -- T118: a token without its participant is not a join token (R-GENDER-7)
    const unbound: JoinToken = { sessionId: SESSION, credential: 'x' };
    // @ts-expect-error -- T118: a token is minted by `bindJoinToken`, never written as a literal
    const forged: JoinToken = { sessionId: SESSION, participantUserId: STUDENT, credential: 'x' };
    expect([unbound, forged]).toHaveLength(2);
  });

  it('takes the raw body for an inbound event, so a parsed object cannot skip the signature', () => {
    expectTypeOf<
      Parameters<VideoPort['verifyAndParseParticipantEvent']>[0]
    >().toEqualTypeOf<Buffer>();
  });

  it('refuses to bind a token to an empty session or participant', () => {
    expect(() => bindJoinToken('', STUDENT, 'credential')).toThrow(RangeError);
    expect(() => bindJoinToken(SESSION, '', 'credential')).toThrow(RangeError);
    expect(() => bindJoinToken(SESSION, STUDENT, '')).toThrow(RangeError);
    expect(bindJoinToken(SESSION, STUDENT, 'credential')).toEqual({
      sessionId: SESSION,
      participantUserId: STUDENT,
      credential: 'credential',
    });
  });
});

describe('the video stand-in: rooms and tokens (T118, FR-SESS-3)', () => {
  it('creates a room for a session, answering the provider room reference', async () => {
    expect(await video().createRoom(SESSION)).toMatch(/^fake_room_/);
  });

  it('answers the same room when asked twice for one session, so a retried job opens one', async () => {
    const rooms = video();
    expect(await rooms.createRoom(SESSION)).toBe(await rooms.createRoom(SESSION));
    expect(await rooms.createRoom(SESSION)).not.toBe(await rooms.createRoom(OTHER_SESSION));
  });

  it('issues a token bound to the session and the participant it was asked for', async () => {
    const rooms = video();
    await rooms.createRoom(SESSION);

    const token = await rooms.createSessionToken(SESSION, STUDENT);

    expect(token).toMatchObject({ sessionId: SESSION, participantUserId: STUDENT });
    expect(token.credential).toMatch(/^fake_vtk_/);
  });

  it('issues every participant a credential of their own', async () => {
    const rooms = video();
    await rooms.createRoom(SESSION);
    const student = await rooms.createSessionToken(SESSION, STUDENT);
    const teacher = await rooms.createSessionToken(SESSION, TEACHER);

    expect(student.credential).not.toBe(teacher.credential);
  });

  it('refuses a token for a session with no room, or with an empty participant', async () => {
    const rooms = video();
    await expect(rooms.createSessionToken(SESSION, STUDENT)).rejects.toThrow('unknown room');
    await rooms.createRoom(SESSION);
    await expect(rooms.createSessionToken(SESSION, '')).rejects.toThrow(RangeError);
  });

  it('ends a room, answers again when ended twice, and admits nobody after', async () => {
    const rooms = video();
    await rooms.createRoom(SESSION);

    await rooms.endRoom(SESSION);
    await expect(rooms.endRoom(SESSION)).resolves.toBeUndefined();
    await expect(rooms.createSessionToken(SESSION, STUDENT)).rejects.toThrow('room has ended');
  });

  it('refuses to end a room it never created', async () => {
    await expect(video().endRoom(SESSION)).rejects.toThrow('unknown room');
  });
});

describe('the video stand-in: participant events (T118, R-SESS-1, FR-074)', () => {
  it.each(['joined', 'left'] as const)(
    'reads a correctly signed %s event as attendance evidence',
    async (type) => {
      const rooms = video();
      await rooms.createRoom(SESSION);
      const occurredAt = new Date('2026-10-08T17:00:05.000Z');
      const { rawBody, headers } = rooms.participantEvent(SESSION, STUDENT, type, { occurredAt });

      expect(await rooms.verifyAndParseParticipantEvent(rawBody, headers)).toEqual({
        providerEventId: expect.stringMatching(/^fake_vev_/) as unknown,
        sessionId: SESSION,
        participantUserId: STUDENT,
        type,
        occurredAt,
      } satisfies Record<keyof ParticipantEvent, unknown>);
    },
  );

  it('a replayed event reads to the same provider event id, for the unique column', async () => {
    const rooms = video();
    await rooms.createRoom(SESSION);
    const { rawBody, headers } = rooms.participantEvent(SESSION, TEACHER, 'joined');

    const first = await rooms.verifyAndParseParticipantEvent(rawBody, headers);
    const replay = await rooms.verifyAndParseParticipantEvent(rawBody, headers);

    expect(replay.providerEventId).toBe(first.providerEventId);
  });

  it('refuses an incorrectly signed, an unsigned and an altered event', async () => {
    const rooms = video();
    await rooms.createRoom(SESSION);
    const mis = rooms.participantEvent(SESSION, STUDENT, 'joined', { signature: 'invalid' });
    const { rawBody, headers } = rooms.participantEvent(SESSION, STUDENT, 'joined');
    const altered = Buffer.from(rawBody.toString('utf8').replace(STUDENT, TEACHER));
    const elsewhere = new FakeVideoAdapter({ webhookSecret: 'another-secret' });

    await expect(rooms.verifyAndParseParticipantEvent(mis.rawBody, mis.headers)).rejects.toThrow(
      EventSignatureError,
    );
    await expect(rooms.verifyAndParseParticipantEvent(rawBody, {})).rejects.toThrow(
      EventSignatureError,
    );
    await expect(rooms.verifyAndParseParticipantEvent(altered, headers)).rejects.toThrow(
      EventSignatureError,
    );
    await expect(elsewhere.verifyAndParseParticipantEvent(rawBody, headers)).rejects.toThrow(
      EventSignatureError,
    );
  });

  it('rejects a signed body it cannot read, quoting nothing of it', async () => {
    const rooms = video();
    const body = Buffer.from('not json: student 01000000000');
    const { headers } = rooms.signed(body);

    const refusal = rooms.verifyAndParseParticipantEvent(body, headers);

    await expect(refusal).rejects.toThrow(MalformedEventError);
    await expect(refusal).rejects.not.toThrow('01000000000');
  });

  it('produces events only for a room it created', () => {
    expect(() => video().participantEvent(SESSION, STUDENT, 'joined')).toThrow('unknown room');
  });
});
