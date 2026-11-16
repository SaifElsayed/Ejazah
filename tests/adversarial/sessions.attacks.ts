// T011 of specs/004-sessions — `sessions.get`'s and `sessions.join`'s attacks, registered with the
// procedure harness as their router lands (FR-496, SC-407; FR-431, FR-432; R-GENDER-1, R-GENDER-2,
// R-GENDER-4, R-GENDER-7). Each attack runs in the discovery world (`discovery-world.ts`), whose
// surface binds the sessions services as `main.ts` does, over the video stand-in: for each gender, a
// lone visible teacher signed in, with a confirmed enrollment of that gender's student and three
// sessions, one inside its join period, one not yet open and one over (`sessionPair`).
//
// What every attack holds: a session the requester is not a party of, the other gender's pair's
// above all, answers exactly as an id that never existed (404, `NOT_FOUND`, no field), from either
// procedure; the requester's own session is answered, so no attack passes on a refusal of everything.
//
//   directCall             both parties' own session, read and joined as the phone asks; the other
//                          gender's session by its id; outside the join period, before it
//                          (JOIN_NOT_OPEN with `opensAt`) and after it (JOIN_CLOSED).
//   forgedId               another session's id (the other gender's pair's), the enrollment's id and
//                          a party's own user id, sent as a session id.
//   guessedId              ids never handed out: random ones, the other session's neighbour and its
//                          upper-case spelling.
//   tamperedToken          the requester's genuine bearer token with its signature or its session
//                          changed: refused as unauthenticated before any service is reached.
//   clientSuppliedGender   the input carrying the other gender: ignored, the answer the server's
//                          records'.
// T052 (FR-496's three kinds, Q2 (a)); the replay and the correction moved here unchanged:
//   otherSessionToken      `join`: the other gender's student's token for their session, sent by the
//                          requester, opens that session as a nonexistent one and stands in for no
//                          token of the requester's own, who is minted one bound to their own session;
//                          `get` issues and takes no token (not applicable).
//   replayedToken          `join`: each party's join mints a token bound to that party, never the
//                          other's (the stand-in's record); `get` issues none (not applicable).
//   afterGenderCorrection  after an administrator's gender correction (the note under T011, K2:
//                          `users.gender` changed directly in the test world, as the server's record
//                          after Phase 4's FR-GENDER-7), the corrected record decides: the session
//                          answers as a nonexistent one, and again as the requester's once restored.
import { randomUUID } from 'node:crypto';

import { expect } from 'vitest';

import type {
  SessionsComplaintRaiseInput,
  SessionsDisputeRaiseInput,
  SessionsGetInput,
  SessionsJoinInput,
} from '../../packages/contracts/src/index.js';
import { expectUnauthenticated, neighbourOf, tamperedTokens } from './discovery.attacks.js';
import {
  type AppCaller,
  discoverySurface,
  type RecordedVideo,
  type SessionPair,
} from './discovery-world.js';
import {
  type Direction,
  expectAnswersAsNonexistent,
  notApplicable,
  type SessionProcedureAttacks,
} from './procedure-harness.js';

const HOLDS = 'R-GENDER-1, R-GENDER-2, R-GENDER-4, R-GENDER-7, FR-431, FR-432, FR-496, SC-407';

type Procedure = 'get' | 'join';

/** One call of `procedure` with `sessionId`, as the phone sends it. */
function call(caller: AppCaller, procedure: Procedure, sessionId: string): Promise<unknown> {
  return procedure === 'get'
    ? caller.sessions.get({ sessionId })
    : caller.sessions.join({ sessionId });
}

/** The session answers `procedure` as one that never existed. */
function expectSessionHidden(
  caller: AppCaller,
  procedure: Procedure,
  sessionId: string,
): Promise<void> {
  return expectAnswersAsNonexistent(
    () => call(caller, procedure, sessionId),
    () => call(caller, procedure, randomUUID()),
  );
}

/** The requester's pair and the other gender's, in the world built once per file. */
async function pairsFor(direction: Direction) {
  const surface = await discoverySurface();
  const [own, theirs] = await Promise.all([
    surface.sessionPair(direction.requester),
    surface.sessionPair(direction.other),
  ]);
  return { surface, own, theirs };
}

/** Both parties of `pair`, as callers. */
const partiesOf = (pair: SessionPair) => [pair.student, pair.teacher] as const;

/** The code and details `call` is refused with. */
async function refusalOf(
  attempt: () => Promise<unknown>,
): Promise<{ code?: unknown; details?: unknown }> {
  try {
    await attempt();
  } catch (error) {
    const cause: unknown = error instanceof Error ? error.cause : undefined;
    if (typeof cause === 'object' && cause !== null) {
      return { code: Reflect.get(cause, 'code'), details: Reflect.get(cause, 'details') };
    }
    throw error;
  }
  throw new Error('answered where it must be refused');
}

function attacksOn(procedure: Procedure): SessionProcedureAttacks {
  return {
    path: `sessions.${procedure}`,
    holds: HOLDS,
    attacks: {
      async directCall(direction) {
        const { own, theirs } = await pairsFor(direction);
        for (const party of partiesOf(own)) {
          const answer = (await call(party.caller, procedure, own.sessions.open)) as {
            sessionId: string;
          };
          expect(answer.sessionId).toBe(own.sessions.open);
          await expectSessionHidden(party.caller, procedure, theirs.sessions.open);
        }
        if (procedure === 'get') return;
        // Outside the join period, before and after it.
        const early = await refusalOf(() =>
          own.student.caller.sessions.join({ sessionId: own.sessions.later }),
        );
        expect(early.code).toBe('JOIN_NOT_OPEN');
        expect(early.details).toEqual([{ path: 'opensAt', code: expect.any(String) as unknown }]);
        const late = await refusalOf(() =>
          own.teacher.caller.sessions.join({ sessionId: own.sessions.past }),
        );
        expect(late.code).toBe('JOIN_CLOSED');
      },
      async forgedId(direction) {
        const { own, theirs } = await pairsFor(direction);
        for (const party of partiesOf(own)) {
          for (const forged of [
            theirs.sessions.open,
            theirs.sessions.later,
            own.enrollmentId,
            own.student.userId,
            own.teacher.userId,
          ]) {
            await expectSessionHidden(party.caller, procedure, forged);
          }
        }
      },
      async guessedId(direction) {
        const { own, theirs } = await pairsFor(direction);
        for (const guessed of [
          randomUUID(),
          neighbourOf(theirs.sessions.open),
          theirs.sessions.open.toUpperCase(),
        ]) {
          await expectSessionHidden(own.student.caller, procedure, guessed);
        }
      },
      async tamperedToken(direction) {
        const { surface, own, theirs } = await pairsFor(direction);
        for (const token of tamperedTokens(
          direction,
          own.student.accessToken,
          theirs.student.sessionId,
        )) {
          const tampered = await surface.bearing(token);
          await expectUnauthenticated(() => call(tampered, procedure, own.sessions.open));
        }
      },
      async clientSuppliedGender(direction) {
        const { own, theirs } = await pairsFor(direction);
        const withGender = (caller: AppCaller, sessionId: string) =>
          procedure === 'get'
            ? caller.sessions.get({ sessionId, gender: direction.other } as SessionsGetInput)
            : caller.sessions.join({ sessionId, gender: direction.other } as SessionsJoinInput);
        await expectAnswersAsNonexistent(
          () => withGender(own.student.caller, theirs.sessions.open),
          () => withGender(own.student.caller, randomUUID()),
        );
        const answered = (await withGender(own.student.caller, own.sessions.open)) as {
          sessionId: string;
        };
        expect(answered.sessionId).toBe(own.sessions.open);
      },
      async afterGenderCorrection(direction) {
        const { surface, own } = await pairsFor(direction);
        // After an administrator's correction of the teacher's gender (K2): the server's record.
        await surface.setGender(own.teacher.userId, direction.other);
        try {
          await expectSessionHidden(own.student.caller, procedure, own.sessions.open);
        } finally {
          await surface.setGender(own.teacher.userId, direction.requester);
        }
        const restored = (await call(own.student.caller, procedure, own.sessions.open)) as {
          sessionId: string;
        };
        expect(restored.sessionId).toBe(own.sessions.open);
      },
      otherSessionToken:
        procedure === 'join'
          ? anotherSessionsToken
          : notApplicable(
              'sessions.get issues no token and takes none: it names its session by id (forgedId, guessedId) and its caller by the bearer (tamperedToken); a join token is sessions.join’s alone',
            ),
      replayedToken:
        procedure === 'join'
          ? replayedByTheOtherParticipant
          : notApplicable(
              'sessions.get issues no token, so the other participant has none of the caller’s to replay; the only token it reads is the caller’s own bearer (tamperedToken)',
            ),
    },
  };
}

/** The join tokens the stand-in was asked for since `before`, each as `[sessionId, userId]`. */
function mintedSince(video: RecordedVideo, before: number): unknown[][] {
  return video.calls
    .slice(before)
    .filter(({ operation }) => operation === 'createSessionToken')
    .map(({ args }) => args.slice(0, 2));
}

/**
 * T052 (FR-496): a token replayed by the other participant. Each party's join mints a token bound
 * to that party, never the other's (the stand-in's record); moved from `directCall` unchanged.
 */
async function replayedByTheOtherParticipant(direction: Direction): Promise<void> {
  const { surface, own } = await pairsFor(direction);
  const before = surface.video.calls.length;
  const student = await own.student.caller.sessions.join({ sessionId: own.sessions.open });
  const teacher = await own.teacher.caller.sessions.join({ sessionId: own.sessions.open });
  expect(teacher.token).not.toBe(student.token);
  expect(mintedSince(surface.video, before)).toEqual([
    [own.sessions.open, own.student.userId],
    [own.sessions.open, own.teacher.userId],
  ]);
}

/**
 * T052 (FR-496): another session's token. The other gender's student's token for their own session,
 * sent by the requester beside that session's id, answers as a nonexistent session, and beside the
 * requester's own session's id is ignored: the requester is minted a token of their own, bound to
 * their own session; no token is ever minted for the other session to the requester.
 */
async function anotherSessionsToken(direction: Direction): Promise<void> {
  const { surface, own, theirs } = await pairsFor(direction);
  const before = surface.video.calls.length;
  const theirToken = await theirs.student.caller.sessions.join({
    sessionId: theirs.sessions.open,
  });
  const presenting = (sessionId: string) =>
    own.student.caller.sessions.join({
      sessionId,
      token: theirToken.token,
    } as SessionsJoinInput);
  await expectAnswersAsNonexistent(
    () => presenting(theirs.sessions.open),
    () => presenting(randomUUID()),
  );
  const ownToken = await presenting(own.sessions.open);
  expect(ownToken.sessionId).toBe(own.sessions.open);
  expect(ownToken.token).not.toBe(theirToken.token);
  expect(mintedSince(surface.video, before)).toEqual([
    [theirs.sessions.open, theirs.student.userId],
    [own.sessions.open, own.student.userId],
  ]);
}

export const sessionsAttacks: readonly SessionProcedureAttacks[] = [
  attacksOn('get'),
  attacksOn('join'),
];

// T026 of specs/004-sessions — `sessions.dispute.raise`'s attacks (FR-496, SC-407; FR-473; R-GENDER-2,
// R-GENDER-4), in the same world, on each pair's `ended` session, which no other registration reads:
// a session of the other gender's pair, a forged or a guessed id, raised by either party, answers
// exactly as an id that never existed; the requester's own session is never answered so: raised, or
// refused DISPUTE_OPEN once raised, or DISPUTE_WINDOW_CLOSED before its end.
//
//   directCall            either party raises their own ended session (the second DISPUTE_OPEN);
//                         a session not yet ended DISPUTE_WINDOW_CLOSED; the other gender's ended
//                         session by its id, from either party.
//   forgedId              the other pair's sessions, the enrollment's id and the parties' user ids.
//   guessedId             random ids, the other ended session's neighbour and its upper-case spelling.
//   tamperedToken         a tampered bearer token: unauthenticated before any service.
//   clientSuppliedGender  the input carrying the other gender is ignored.
// T052: otherSessionToken and replayedToken not applicable (no token issued or taken);
//   afterGenderCorrection after an administrator's correction of the teacher's gender, the
//                         student's own session answers as a nonexistent one, and again as their
//                         own once restored (moved from clientSuppliedGender unchanged).
const DISPUTE_HOLDS = 'R-GENDER-1, R-GENDER-2, R-GENDER-4, FR-473, FR-496, SC-407';

/** One raise of `sessionId`, as the phone sends it, under a fresh key. */
function raise(caller: AppCaller, sessionId: string, extra: Record<string, unknown> = {}) {
  return caller.sessions.dispute.raise({
    sessionId,
    reason: 'سبب الفحص',
    idempotencyKey: `attack-${randomUUID()}`,
    ...extra,
  } as SessionsDisputeRaiseInput);
}

/** The session answers the raise as one that never existed. */
function expectDisputeHidden(caller: AppCaller, sessionId: string): Promise<void> {
  return expectAnswersAsNonexistent(
    () => raise(caller, sessionId),
    () => raise(caller, randomUUID()),
  );
}

/** The requester's own session is answered as theirs: raised, or refused as already raised. */
async function expectOwnDispute(attempt: () => Promise<unknown>): Promise<void> {
  try {
    const raised = (await attempt()) as { status?: unknown };
    expect(raised.status).toBe('open');
  } catch (error) {
    const cause: unknown = error instanceof Error ? error.cause : undefined;
    expect(typeof cause === 'object' && cause !== null ? Reflect.get(cause, 'code') : error).toBe(
      'DISPUTE_OPEN',
    );
  }
}

const disputeAttacks: SessionProcedureAttacks = {
  path: 'sessions.dispute.raise',
  holds: DISPUTE_HOLDS,
  attacks: {
    async directCall(direction) {
      const { own, theirs } = await pairsFor(direction);
      await expectOwnDispute(() => raise(own.student.caller, own.sessions.ended));
      const second = await refusalOf(() => raise(own.teacher.caller, own.sessions.ended));
      expect(second.code).toBe('DISPUTE_OPEN');
      const early = await refusalOf(() => raise(own.student.caller, own.sessions.later));
      expect(early.code).toBe('DISPUTE_WINDOW_CLOSED');
      for (const party of partiesOf(own)) {
        await expectDisputeHidden(party.caller, theirs.sessions.ended);
      }
    },
    async forgedId(direction) {
      const { own, theirs } = await pairsFor(direction);
      for (const party of partiesOf(own)) {
        for (const forged of [
          theirs.sessions.ended,
          theirs.sessions.past,
          own.enrollmentId,
          own.student.userId,
          own.teacher.userId,
        ]) {
          await expectDisputeHidden(party.caller, forged);
        }
      }
    },
    async guessedId(direction) {
      const { own, theirs } = await pairsFor(direction);
      for (const guessed of [
        randomUUID(),
        neighbourOf(theirs.sessions.ended),
        theirs.sessions.ended.toUpperCase(),
      ]) {
        await expectDisputeHidden(own.student.caller, guessed);
      }
    },
    async tamperedToken(direction) {
      const { surface, own, theirs } = await pairsFor(direction);
      for (const token of tamperedTokens(
        direction,
        own.student.accessToken,
        theirs.student.sessionId,
      )) {
        const tampered = await surface.bearing(token);
        await expectUnauthenticated(() => raise(tampered, own.sessions.ended));
      }
    },
    async clientSuppliedGender(direction) {
      const { own, theirs } = await pairsFor(direction);
      const withGender = { gender: direction.other };
      await expectAnswersAsNonexistent(
        () => raise(own.student.caller, theirs.sessions.ended, withGender),
        () => raise(own.student.caller, randomUUID(), withGender),
      );
      await expectOwnDispute(() => raise(own.student.caller, own.sessions.ended, withGender));
    },
    otherSessionToken: notApplicable(
      'sessions.dispute.raise issues no token and takes none: it names its session by id (forgedId, guessedId) and its caller by the bearer (tamperedToken)',
    ),
    replayedToken: notApplicable(
      'sessions.dispute.raise issues no token, so the other participant has none of the caller’s to replay; a party raising on their own session is answered DISPUTE_OPEN (directCall)',
    ),
    async afterGenderCorrection(direction) {
      const { surface, own } = await pairsFor(direction);
      // After an administrator's correction of the teacher's gender (K2): the server's record.
      await surface.setGender(own.teacher.userId, direction.other);
      try {
        await expectDisputeHidden(own.student.caller, own.sessions.ended);
      } finally {
        await surface.setGender(own.teacher.userId, direction.requester);
      }
      await expectOwnDispute(() => raise(own.student.caller, own.sessions.ended));
    },
  },
};

export const sessionDisputeAttacks: readonly SessionProcedureAttacks[] = [disputeAttacks];

// T060 of specs/004-sessions — `sessions.complaint.raise`'s attacks (FR-496, FR-452; R-GENDER-2,
// R-GENDER-4), in the same world, on each pair's confirmed enrollment: an enrollment the requester is
// not the student of — the other gender's pair's, from either party; their own, raised by its
// teacher; a forged or a guessed id — answers exactly as an id that never existed; the student's own
// is never answered so: raised, or refused COMPLAINT_OPEN once raised.
//
//   directCall            the student raises their own enrollment's complaint (a second
//                         COMPLAINT_OPEN with the open one's id); the teacher raising one on it, and
//                         either party on the other gender's enrollment, as nonexistent.
//   forgedId              the other pair's enrollment, the own pair's session ids (sent as an
//                         enrollment id) and the parties' user ids.
//   guessedId             random ids, the other enrollment's neighbour and its upper-case spelling.
//   tamperedToken         a tampered bearer token: unauthenticated before any service.
//   clientSuppliedGender  the input carrying the other gender is ignored.
// T052: otherSessionToken and replayedToken not applicable (no token issued or taken);
//   afterGenderCorrection after an administrator's correction of the teacher's gender, the
//                         student's own enrollment answers as a nonexistent one, and again as their
//                         own once restored (moved from clientSuppliedGender unchanged).
const COMPLAINT_HOLDS = 'R-GENDER-1, R-GENDER-2, R-GENDER-4, FR-452, FR-496, SC-407';

/** One complaint on `enrollmentId`, as the phone sends it. */
function complain(caller: AppCaller, enrollmentId: string, extra: Record<string, unknown> = {}) {
  return caller.sessions.complaint.raise({
    enrollmentId,
    reason: 'غاب المعلم في الفحص',
    ...extra,
  } as SessionsComplaintRaiseInput);
}

/** The enrollment answers the complaint as one that never existed. */
function expectComplaintHidden(caller: AppCaller, enrollmentId: string): Promise<void> {
  return expectAnswersAsNonexistent(
    () => complain(caller, enrollmentId),
    () => complain(caller, randomUUID()),
  );
}

/** The student's own enrollment is answered as theirs: raised, or refused as already raised. */
async function expectOwnComplaint(attempt: () => Promise<unknown>): Promise<void> {
  try {
    const raised = (await attempt()) as { status?: unknown };
    expect(raised.status).toBe('open');
  } catch (error) {
    const cause: unknown = error instanceof Error ? error.cause : undefined;
    expect(typeof cause === 'object' && cause !== null ? Reflect.get(cause, 'code') : error).toBe(
      'COMPLAINT_OPEN',
    );
  }
}

const complaintAttacks: SessionProcedureAttacks = {
  path: 'sessions.complaint.raise',
  holds: COMPLAINT_HOLDS,
  attacks: {
    async directCall(direction) {
      const { own, theirs } = await pairsFor(direction);
      await expectOwnComplaint(() => complain(own.student.caller, own.enrollmentId));
      const second = await refusalOf(() => complain(own.student.caller, own.enrollmentId));
      expect(second.code).toBe('COMPLAINT_OPEN');
      expect(second.details).toEqual([
        { path: 'complaintId', code: expect.any(String) as unknown },
      ]);
      await expectComplaintHidden(own.teacher.caller, own.enrollmentId);
      for (const party of partiesOf(own)) {
        await expectComplaintHidden(party.caller, theirs.enrollmentId);
      }
    },
    async forgedId(direction) {
      const { own, theirs } = await pairsFor(direction);
      for (const party of partiesOf(own)) {
        for (const forged of [
          theirs.enrollmentId,
          own.sessions.open,
          own.sessions.ended,
          own.student.userId,
          own.teacher.userId,
        ]) {
          await expectComplaintHidden(party.caller, forged);
        }
      }
    },
    async guessedId(direction) {
      const { own, theirs } = await pairsFor(direction);
      for (const guessed of [
        randomUUID(),
        neighbourOf(theirs.enrollmentId),
        theirs.enrollmentId.toUpperCase(),
      ]) {
        await expectComplaintHidden(own.student.caller, guessed);
      }
    },
    async tamperedToken(direction) {
      const { surface, own, theirs } = await pairsFor(direction);
      for (const token of tamperedTokens(
        direction,
        own.student.accessToken,
        theirs.student.sessionId,
      )) {
        const tampered = await surface.bearing(token);
        await expectUnauthenticated(() => complain(tampered, own.enrollmentId));
      }
    },
    async clientSuppliedGender(direction) {
      const { own, theirs } = await pairsFor(direction);
      const withGender = { gender: direction.other };
      await expectAnswersAsNonexistent(
        () => complain(own.student.caller, theirs.enrollmentId, withGender),
        () => complain(own.student.caller, randomUUID(), withGender),
      );
      await expectOwnComplaint(() => complain(own.student.caller, own.enrollmentId, withGender));
    },
    otherSessionToken: notApplicable(
      'sessions.complaint.raise issues no token and takes none: it names an enrollment by id (forgedId, guessedId, a session id sent as one included) and its caller by the bearer (tamperedToken)',
    ),
    replayedToken: notApplicable(
      'sessions.complaint.raise issues no token, so the other participant has none of the caller’s to replay; the teacher raising on the pair’s enrollment answers as a nonexistent one (directCall)',
    ),
    async afterGenderCorrection(direction) {
      const { surface, own } = await pairsFor(direction);
      // After an administrator's correction of the teacher's gender (K2): the server's record.
      await surface.setGender(own.teacher.userId, direction.other);
      try {
        await expectComplaintHidden(own.student.caller, own.enrollmentId);
      } finally {
        await surface.setGender(own.teacher.userId, direction.requester);
      }
      await expectOwnComplaint(() => complain(own.student.caller, own.enrollmentId));
    },
  },
};

export const sessionComplaintAttacks: readonly SessionProcedureAttacks[] = [complaintAttacks];
