// T118: the video port and its stand-in (contracts/ports.md, R-GENDER-7, FR-SESS-3, R-SESS-1).
//
// The port has exactly four operations: create a room for a session, issue a join token, verify and
// read an inbound participant event, end a room. A join token is issued for a session and a
// participant together, and the token itself carries both, so a token bound to a session alone
// cannot be written. The stand-in keeps rooms in memory and can produce a correctly and an
// incorrectly signed participant event for any room it created, so attendance evidence is testable
// without a network. It records what it was asked and fails an operation when told (T122).
//
// T009 (contracts/video.md, "The port, as this phase calls it"): the port widens additively. A room
// is created with the two timeouts the settings give, a token with the instant it stops admitting,
// and an event is a join, a leave or the room's end, a participant's carrying its connection; a
// signed event the port does not treat as attendance answers `{ kind: 'ignored' }`.
//
// The type checks are enforced by `pnpm typecheck` (CI stage 1), not by vitest.
import { describe, expect, expectTypeOf, it } from 'vitest';
import { EventSignatureError, MalformedEventError } from '../inbound-event.js';
import { StandInFailure } from '../stand-in.js';
import { FakeVideoAdapter } from './fake.adapter.js';
import {
  bindJoinToken,
  type IgnoredEvent,
  type JoinToken,
  type ParticipantEvent,
  type RoomTimeouts,
  type TokenValidity,
  type VideoPort,
} from './video.port.js';

const SECRET = 'stand-in-video-webhook-secret';
const SESSION = '01928c3e-7a10-7000-8000-000000000001';
const OTHER_SESSION = '01928c3e-7a10-7000-8000-000000000002';
const STUDENT = '01928c3e-7a10-7000-8000-0000000000a1';
const TEACHER = '01928c3e-7a10-7000-8000-0000000000b1';
const TIMEOUTS = { emptyTimeoutSeconds: 300, departureTimeoutSeconds: 20 } as const;
const UNTIL = { validUntil: new Date('2026-10-08T17:45:00.000Z') } as const;

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
      [sessionId: string, participantUserId: string, validity: TokenValidity]
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

  it('widens additively: a room with its two timeouts, an event of three kinds or ignored (T009)', () => {
    expectTypeOf<Parameters<VideoPort['createRoom']>>().toEqualTypeOf<
      [sessionId: string, timeouts: RoomTimeouts]
    >();
    expectTypeOf<RoomTimeouts>().toEqualTypeOf<{
      readonly emptyTimeoutSeconds: number;
      readonly departureTimeoutSeconds: number;
    }>();
    expectTypeOf<TokenValidity>().toEqualTypeOf<{ readonly validUntil: Date }>();
    expectTypeOf<ParticipantEvent['type']>().toEqualTypeOf<'joined' | 'left' | 'room_ended'>();
    expectTypeOf<ParticipantEvent['participantUserId']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<ParticipantEvent['connectionRef']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<ReturnType<VideoPort['verifyAndParseParticipantEvent']>>().toEqualTypeOf<
      Promise<ParticipantEvent | IgnoredEvent>
    >();
    expectTypeOf<IgnoredEvent>().toEqualTypeOf<{ readonly kind: 'ignored' }>();
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
    expect(await video().createRoom(SESSION, TIMEOUTS)).toMatch(/^fake_room_/);
  });

  it('answers the same room when asked twice for one session, so a retried job opens one', async () => {
    const rooms = video();
    expect(await rooms.createRoom(SESSION, TIMEOUTS)).toBe(
      await rooms.createRoom(SESSION, TIMEOUTS),
    );
    expect(await rooms.createRoom(SESSION, TIMEOUTS)).not.toBe(
      await rooms.createRoom(OTHER_SESSION, TIMEOUTS),
    );
  });

  it('issues a token bound to the session and the participant it was asked for', async () => {
    const rooms = video();
    await rooms.createRoom(SESSION, TIMEOUTS);

    const token = await rooms.createSessionToken(SESSION, STUDENT, UNTIL);

    expect(token).toMatchObject({ sessionId: SESSION, participantUserId: STUDENT });
    expect(token.credential).toMatch(/^fake_vtk_/);
  });

  it('issues every participant a credential of their own', async () => {
    const rooms = video();
    await rooms.createRoom(SESSION, TIMEOUTS);
    const student = await rooms.createSessionToken(SESSION, STUDENT, UNTIL);
    const teacher = await rooms.createSessionToken(SESSION, TEACHER, UNTIL);

    expect(student.credential).not.toBe(teacher.credential);
  });

  it('refuses a token for a session with no room, or with an empty participant', async () => {
    const rooms = video();
    await expect(rooms.createSessionToken(SESSION, STUDENT, UNTIL)).rejects.toThrow('unknown room');
    await rooms.createRoom(SESSION, TIMEOUTS);
    await expect(rooms.createSessionToken(SESSION, '', UNTIL)).rejects.toThrow(RangeError);
  });

  it('ends a room, answers again when ended twice, and admits nobody after', async () => {
    const rooms = video();
    await rooms.createRoom(SESSION, TIMEOUTS);

    await rooms.endRoom(SESSION);
    await expect(rooms.endRoom(SESSION)).resolves.toBeUndefined();
    await expect(rooms.createSessionToken(SESSION, STUDENT, UNTIL)).rejects.toThrow(
      'room has ended',
    );
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
      await rooms.createRoom(SESSION, TIMEOUTS);
      const occurredAt = new Date('2026-10-08T17:00:05.000Z');
      const { rawBody, headers } = rooms.participantEvent(SESSION, STUDENT, type, {
        occurredAt,
        connectionRef: 'fake_conn_1',
      });

      expect(await rooms.verifyAndParseParticipantEvent(rawBody, headers)).toEqual({
        providerEventId: expect.stringMatching(/^fake_vev_/) as unknown,
        sessionId: SESSION,
        participantUserId: STUDENT,
        connectionRef: 'fake_conn_1',
        type,
        occurredAt,
      } satisfies Record<keyof ParticipantEvent, unknown>);
    },
  );

  it('gives a participant one connection by default, so their join and leave pair (T009)', async () => {
    const rooms = video();
    await rooms.createRoom(SESSION, TIMEOUTS);
    const join = rooms.participantEvent(SESSION, STUDENT, 'joined');
    const leave = rooms.participantEvent(SESSION, STUDENT, 'left');
    const other = rooms.participantEvent(SESSION, TEACHER, 'joined');

    const joined = await rooms.verifyAndParseParticipantEvent(join.rawBody, join.headers);
    const left = await rooms.verifyAndParseParticipantEvent(leave.rawBody, leave.headers);
    const teacher = await rooms.verifyAndParseParticipantEvent(other.rawBody, other.headers);
    const connectionRef = (joined as ParticipantEvent).connectionRef;

    expect(connectionRef).toEqual(expect.any(String));
    expect((left as ParticipantEvent).connectionRef).toBe(connectionRef);
    expect((teacher as ParticipantEvent).connectionRef).not.toBe(connectionRef);
  });

  it("reads a correctly signed room's end, with no participant and no connection (T009)", async () => {
    const rooms = video();
    await rooms.createRoom(SESSION, TIMEOUTS);
    const occurredAt = new Date('2026-10-08T17:46:00.000Z');
    const { rawBody, headers } = rooms.roomEndedEvent(SESSION, { occurredAt });

    expect(await rooms.verifyAndParseParticipantEvent(rawBody, headers)).toEqual({
      providerEventId: expect.stringMatching(/^fake_vev_/) as unknown,
      sessionId: SESSION,
      type: 'room_ended',
      occurredAt,
    });
  });

  it('answers ignored for a correctly signed event that is not attendance (T009)', async () => {
    const rooms = video();
    const body = Buffer.from(
      JSON.stringify({ id: 'fake_vev_other', type: 'track_published', session: SESSION }),
    );
    const { headers } = rooms.signed(body);

    expect(await rooms.verifyAndParseParticipantEvent(body, headers)).toEqual({ kind: 'ignored' });
  });

  it('refuses an unsigned event that is not attendance, before reading its kind (T009)', async () => {
    const body = Buffer.from(JSON.stringify({ id: 'fake_vev_other', type: 'track_published' }));

    await expect(video().verifyAndParseParticipantEvent(body, {})).rejects.toThrow(
      EventSignatureError,
    );
  });

  it.each([
    ['a join with no connection', { type: 'joined', participant: STUDENT }],
    ['a leave with no participant', { type: 'left', connection: 'fake_conn_1' }],
  ])('rejects a signed %s as unreadable (T009)', async (_name, fields) => {
    const rooms = video();
    const body = Buffer.from(
      JSON.stringify({
        id: 'fake_vev_bad',
        session: SESSION,
        occurred_at: '2026-10-08T17:00:05.000Z',
        ...fields,
      }),
    );
    const { headers } = rooms.signed(body);

    await expect(rooms.verifyAndParseParticipantEvent(body, headers)).rejects.toThrow(
      MalformedEventError,
    );
  });

  it('a replayed event reads to the same provider event id, for the unique column', async () => {
    const rooms = video();
    await rooms.createRoom(SESSION, TIMEOUTS);
    const { rawBody, headers } = rooms.participantEvent(SESSION, TEACHER, 'joined');

    const first = await rooms.verifyAndParseParticipantEvent(rawBody, headers);
    const replay = await rooms.verifyAndParseParticipantEvent(rawBody, headers);

    expect((replay as ParticipantEvent).providerEventId).toBe(
      (first as ParticipantEvent).providerEventId,
    );
  });

  it('refuses an incorrectly signed, an unsigned and an altered event', async () => {
    const rooms = video();
    await rooms.createRoom(SESSION, TIMEOUTS);
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
    expect(() => video().roomEndedEvent(SESSION)).toThrow('unknown room');
  });
});

describe('the video stand-in: records and induced failure (T122)', () => {
  it('records every operation it was asked to do, with its arguments', async () => {
    const rooms = video();
    await rooms.createRoom(SESSION, TIMEOUTS);
    await rooms.createSessionToken(SESSION, STUDENT, UNTIL);
    await rooms.endRoom(SESSION);

    expect(rooms.calls).toEqual([
      { operation: 'createRoom', args: [SESSION, TIMEOUTS] },
      { operation: 'createSessionToken', args: [SESSION, STUDENT, UNTIL] },
      { operation: 'endRoom', args: [SESSION] },
    ]);
  });

  it('fails a room when told, creating none', async () => {
    const rooms = video();
    rooms.failNext('createRoom');

    await expect(rooms.createRoom(SESSION, TIMEOUTS)).rejects.toThrow(StandInFailure);
    await expect(rooms.createSessionToken(SESSION, STUDENT, UNTIL)).rejects.toThrow('unknown room');
  });

  it('fails a token, an event and an end when told, leaving the room open', async () => {
    const rooms = video();
    await rooms.createRoom(SESSION, TIMEOUTS);
    const { rawBody, headers } = rooms.participantEvent(SESSION, STUDENT, 'joined');
    rooms.failNext('createSessionToken');
    rooms.failNext('verifyAndParseParticipantEvent');
    rooms.failNext('endRoom');

    await expect(rooms.createSessionToken(SESSION, STUDENT, UNTIL)).rejects.toThrow(StandInFailure);
    await expect(rooms.verifyAndParseParticipantEvent(rawBody, headers)).rejects.toThrow(
      StandInFailure,
    );
    await expect(rooms.endRoom(SESSION)).rejects.toThrow(StandInFailure);
    await expect(rooms.createSessionToken(SESSION, STUDENT, UNTIL)).resolves.toMatchObject({
      participantUserId: STUDENT,
    });
  });
});
