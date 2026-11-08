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
//   directCall            both parties' own session, read and joined as the phone asks; the other
//                         gender's session by its id; outside the join period, before it
//                         (JOIN_NOT_OPEN with `opensAt`) and after it (JOIN_CLOSED); a token replayed
//                         by the other participant: each party's join mints a token bound to that
//                         party, never the other's (the stand-in's record).
//   forgedId              another session's id (the other gender's pair's), the enrollment's id and
//                         a party's own user id, sent as a session id.
//   guessedId             ids never handed out: random ones, the other session's neighbour and its
//                         upper-case spelling.
//   tamperedToken         the requester's genuine bearer token with its signature or its session
//                         changed: refused as unauthenticated before any service is reached.
//   clientSuppliedGender  the input carrying the other gender: ignored, the answer the server's
//                         records'; and after an administrator's gender correction (the note under
//                         T011, K2: `users.gender` changed directly in the test world, as the server's
//                         record after Phase 4's FR-GENDER-7), the corrected record decides: the
//                         session answers as a nonexistent one, and again once restored.
import { randomUUID } from 'node:crypto';

import { expect } from 'vitest';

import type { SessionsGetInput, SessionsJoinInput } from '../../packages/contracts/src/index.js';
import { expectUnauthenticated, neighbourOf, tamperedTokens } from './discovery.attacks.js';
import { type AppCaller, discoverySurface, type SessionPair } from './discovery-world.js';
import {
  type Direction,
  expectAnswersAsNonexistent,
  type ProcedureAttacks,
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

function attacksOn(procedure: Procedure): ProcedureAttacks {
  return {
    path: `sessions.${procedure}`,
    holds: HOLDS,
    attacks: {
      async directCall(direction) {
        const { surface, own, theirs } = await pairsFor(direction);
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
        // A token replayed by the other participant: each join mints a token for its own caller.
        const before = surface.video.calls.length;
        const student = await own.student.caller.sessions.join({ sessionId: own.sessions.open });
        const teacher = await own.teacher.caller.sessions.join({ sessionId: own.sessions.open });
        expect(teacher.token).not.toBe(student.token);
        const minted = surface.video.calls
          .slice(before)
          .filter(({ operation }) => operation === 'createSessionToken')
          .map(({ args }) => args.slice(0, 2));
        expect(minted).toEqual([
          [own.sessions.open, own.student.userId],
          [own.sessions.open, own.teacher.userId],
        ]);
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
        const { surface, own, theirs } = await pairsFor(direction);
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
    },
  };
}

export const sessionsAttacks: readonly ProcedureAttacks[] = [attacksOn('get'), attacksOn('join')];
