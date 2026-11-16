// T031 and T032 of specs/004-sessions — `sessions.remedy`'s attacks, registered with the procedure
// harness as their router lands (FR-496, SC-407; FR-463 to FR-466; R-GENDER-1, R-GENDER-2,
// R-GENDER-4). Each attack runs in the discovery world (`discovery-world.ts`), whose surface binds
// the sessions services as `main.ts` does, on the session pairs of `sessions.attacks.ts`: for each
// gender, a lone visible teacher and a student of that gender with a confirmed enrollment. Each
// remedy is a session of its own (`remedySession`): a Teacher-No-Show with a `proposed` remedy whose
// proposal lies years ahead, so the one attack that books (`accept`'s own call) meets no other.
//
// What every attack holds: a remedy's session the caller is not the right party of, the other
// gender's pair's above all, answers exactly as an id that never existed (404, `NOT_FOUND`, no
// field); the caller's own is answered, by a result or by a refusal that only a found remedy gives
// (`CHOICE_NOT_ALLOWED`, `SLOT_NOT_OFFERED`, `REMEDY_NOT_OPEN`), so no attack passes on a refusal of
// everything. The student's four are attacked as the student, `answerCounter` as the teacher.
//
//   directCall            the caller on their own remedy answered; the other gender's remedy, and
//                         the pair's other party on the caller's procedure, as a nonexistent one.
//   forgedId              the other gender's remedy session, the enrollment's id and a party's own
//                         user id, sent as the session.
//   guessedId             ids never handed out: random ones, the other's neighbour and its upper-case
//                         spelling.
//   tamperedToken         the caller's genuine bearer with its signature or its session changed:
//                         refused as unauthenticated before any service is reached.
//   clientSuppliedGender  the input carrying the other gender: ignored, the server's records decide;
//                         the caller's own remedy answered.
// T052 (FR-496's three kinds, Q2 (a)): otherSessionToken and replayedToken not applicable (no token
// issued or taken);
//   afterGenderCorrection after an administrator's correction of the counterparty's gender (K2), the
//                         own remedy answers as a nonexistent one, and again once restored (moved
//                         from clientSuppliedGender unchanged; clientSuppliedGender keeps a call of
//                         `ownAnswered`, which the moved block had ended with).
//
// Each procedure's own answer, for the caller's own remedy:
//   choose          `CHOICE_NOT_ALLOWED` (the remedy is `proposed`, no longer awaiting a choice);
//   accept          the proposal booked, on a remedy made for that one call;
//   counterOptions  the options;
//   counter         `SLOT_NOT_OFFERED` (a date years before the bound), nothing written;
//   answerCounter   `REMEDY_NOT_OPEN` (no counter pending), nothing written (T032).
import { randomUUID } from 'node:crypto';

import { expect } from 'vitest';

import { DomainError } from '../../apps/api/src/platform/errors/domain-error.js';
import { expectUnauthenticated, neighbourOf, tamperedTokens } from './discovery.attacks.js';
import { type AppCaller, discoverySurface, type SessionPair } from './discovery-world.js';
import {
  type Direction,
  expectAnswersAsNonexistent,
  notApplicable,
  type SessionProcedureAttacks,
} from './procedure-harness.js';

const HOLDS = 'R-GENDER-1, R-GENDER-2, R-GENDER-4, FR-463, FR-465, FR-496, SC-407';

/** The pairs of the requester's gender and of the other's, and a remedy session of each. */
async function remediesFor(direction: Direction) {
  const surface = await discoverySurface();
  const [own, theirs] = await Promise.all([
    surface.sessionPair(direction.requester),
    surface.sessionPair(direction.other),
  ]);
  const ownRemedy = await surface.remedySession(direction.requester);
  const theirRemedy = await surface.remedySession(direction.other);
  return { surface, own, theirs, ownRemedy, theirRemedy };
}

/** The code tRPC carries a refusal with. */
async function codeOf(attempt: () => Promise<unknown>): Promise<unknown> {
  try {
    await attempt();
  } catch (error) {
    const cause: unknown = error instanceof Error ? error.cause : undefined;
    if (cause instanceof DomainError) return cause.code;
    if (typeof cause === 'object' && cause !== null) return Reflect.get(cause, 'code');
    throw error;
  }
  throw new Error('answered where it must be refused');
}

/** One procedure's call on a remedy's session, its caller's role, and how its own is answered. */
interface Procedure {
  readonly path: string;
  readonly role: 'student' | 'teacher';
  readonly call: (caller: AppCaller, sessionId: string, extra?: object) => Promise<unknown>;
  /** The caller's own remedy answered: a result, or a refusal only a found remedy gives. */
  readonly ownAnswered: (
    pair: SessionPair,
    sessionId: string,
    gender: Direction['requester'],
  ) => Promise<void>;
}

const procedures: readonly Procedure[] = [
  {
    path: 'sessions.remedy.choose',
    role: 'student',
    call: (caller, sessionId, extra = {}) =>
      caller.sessions.remedy.choose({ sessionId, choice: 'refund', ...extra } as never),
    ownAnswered: async (pair, sessionId) => {
      expect(
        await codeOf(() =>
          pair.student.caller.sessions.remedy.choose({ sessionId, choice: 'refund' }),
        ),
      ).toBe('CHOICE_NOT_ALLOWED');
    },
  },
  {
    path: 'sessions.remedy.accept',
    role: 'student',
    call: (caller, sessionId, extra = {}) =>
      caller.sessions.remedy.accept({ sessionId, ...extra } as never),
    ownAnswered: async (pair, _sessionId, gender) => {
      // A remedy of its own for the one call that books (the header).
      const fresh = await (await discoverySurface()).remedySession(gender);
      const booked = await pair.student.caller.sessions.remedy.accept({ sessionId: fresh });
      expect(booked.status).toBe('booked');
      expect(booked.makeupSessionId).toBeDefined();
    },
  },
  {
    path: 'sessions.remedy.counterOptions',
    role: 'student',
    call: (caller, sessionId, extra = {}) =>
      caller.sessions.remedy.counterOptions({ sessionId, ...extra } as never),
    ownAnswered: async (pair, sessionId) => {
      const { options } = await pair.student.caller.sessions.remedy.counterOptions({ sessionId });
      expect(Array.isArray(options)).toBe(true);
    },
  },
  {
    path: 'sessions.remedy.counter',
    role: 'student',
    call: (caller, sessionId, extra = {}) =>
      caller.sessions.remedy.counter({
        sessionId,
        slotId: randomUUID(),
        localDate: '2020-01-05',
        idempotencyKey: `attack-${randomUUID()}`,
        ...extra,
      } as never),
    ownAnswered: async (pair, sessionId) => {
      expect(
        await codeOf(() =>
          pair.student.caller.sessions.remedy.counter({
            sessionId,
            slotId: randomUUID(),
            localDate: '2020-01-05',
            idempotencyKey: `attack-${randomUUID()}`,
          }),
        ),
      ).toBe('SLOT_NOT_OFFERED');
    },
  },
  {
    path: 'sessions.remedy.answerCounter',
    role: 'teacher',
    call: (caller, sessionId, extra = {}) =>
      caller.sessions.remedy.answerCounter({ sessionId, accept: false, ...extra } as never),
    ownAnswered: async (pair, sessionId) => {
      expect(
        await codeOf(() =>
          pair.teacher.caller.sessions.remedy.answerCounter({ sessionId, accept: false }),
        ),
      ).toBe('REMEDY_NOT_OPEN');
    },
  },
];

/** The five attack kinds of one procedure, as its caller's role makes them (the header). */
function attacksOn(procedure: Procedure): SessionProcedureAttacks {
  const { call, ownAnswered, role } = procedure;
  /** The caller of the procedure's role in `pair`. */
  const callerIn = (pair: SessionPair) => (role === 'student' ? pair.student : pair.teacher);
  /** The pair's other party. */
  const counterpartIn = (pair: SessionPair) => (role === 'student' ? pair.teacher : pair.student);
  return {
    path: procedure.path,
    holds: HOLDS,
    attacks: {
      async directCall(direction) {
        const { own, ownRemedy, theirRemedy } = await remediesFor(direction);
        await ownAnswered(own, ownRemedy, direction.requester);
        for (const party of [own.student, own.teacher]) {
          await expectAnswersAsNonexistent(
            () => call(party.caller, theirRemedy),
            () => call(party.caller, randomUUID()),
          );
        }
        // The other party is not the caller the procedure admits: as a nonexistent one.
        const counterpart = counterpartIn(own);
        await expectAnswersAsNonexistent(
          () => call(counterpart.caller, ownRemedy),
          () => call(counterpart.caller, randomUUID()),
        );
      },
      async forgedId(direction) {
        const { own, theirRemedy } = await remediesFor(direction);
        const mine = callerIn(own);
        for (const forged of [
          theirRemedy,
          own.enrollmentId,
          own.student.userId,
          own.teacher.userId,
        ]) {
          await expectAnswersAsNonexistent(
            () => call(mine.caller, forged),
            () => call(mine.caller, randomUUID()),
          );
        }
      },
      async guessedId(direction) {
        const { own, theirRemedy } = await remediesFor(direction);
        const mine = callerIn(own);
        for (const guessed of [randomUUID(), neighbourOf(theirRemedy), theirRemedy.toUpperCase()]) {
          await expectAnswersAsNonexistent(
            () => call(mine.caller, guessed),
            () => call(mine.caller, randomUUID()),
          );
        }
      },
      async tamperedToken(direction) {
        const { surface, own, theirs, ownRemedy } = await remediesFor(direction);
        for (const token of tamperedTokens(
          direction,
          callerIn(own).accessToken,
          callerIn(theirs).sessionId,
        )) {
          const tampered = await surface.bearing(token);
          await expectUnauthenticated(() => call(tampered, ownRemedy));
        }
      },
      async clientSuppliedGender(direction) {
        const { own, ownRemedy, theirRemedy } = await remediesFor(direction);
        const mine = callerIn(own);
        const gendered = { gender: direction.other };
        await expectAnswersAsNonexistent(
          () => call(mine.caller, theirRemedy, gendered),
          () => call(mine.caller, randomUUID(), gendered),
        );
        // T052: the caller's own remedy answered, which ended the correction's block before the
        // correction moved to its own kind, so this kind never passes on a refusal of everything.
        await ownAnswered(own, ownRemedy, direction.requester);
      },
      otherSessionToken: notApplicable(
        `${procedure.path} issues no token and takes none: it names a remedy’s session by id (forgedId, guessedId) and its caller by the bearer (tamperedToken)`,
      ),
      replayedToken: notApplicable(
        `${procedure.path} issues no token, so the other participant has none of the caller’s to replay; the pair’s other party calling it on the caller’s remedy answers as a nonexistent one (directCall)`,
      ),
      async afterGenderCorrection(direction) {
        const { surface, own, ownRemedy } = await remediesFor(direction);
        const mine = callerIn(own);
        const counterpart = counterpartIn(own);
        const gendered = { gender: direction.other };
        // After an administrator's correction of the counterparty's gender (K2): the server's record.
        await surface.setGender(counterpart.userId, direction.other);
        try {
          await expectAnswersAsNonexistent(
            () => call(mine.caller, ownRemedy, gendered),
            () => call(mine.caller, randomUUID(), gendered),
          );
        } finally {
          await surface.setGender(counterpart.userId, direction.requester);
        }
        await ownAnswered(own, ownRemedy, direction.requester);
      },
    },
  };
}

export const sessionsRemedyAttacks: readonly SessionProcedureAttacks[] = procedures.map(attacksOn);
