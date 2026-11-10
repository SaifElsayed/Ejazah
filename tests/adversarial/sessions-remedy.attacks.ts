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
// (`CHOICE_NOT_ALLOWED`, `SLOT_NOT_OFFERED`), so no attack passes on a refusal of everything.
//
//   directCall            the student on their own remedy answered; the other gender's remedy, and
//                         for the student's four the pair's own teacher, as a nonexistent one.
//   forgedId              the other gender's remedy session, the enrollment's id and a party's own
//                         user id, sent as the session.
//   guessedId             ids never handed out: random ones, the other's neighbour and its upper-case
//                         spelling.
//   tamperedToken         the caller's genuine bearer with its signature or its session changed:
//                         refused as unauthenticated before any service is reached.
//   clientSuppliedGender  the input carrying the other gender: ignored, the server's records decide;
//                         after an administrator's correction of the counterparty's gender (K2), the
//                         own remedy answers as a nonexistent one, and again once restored.
//
// Each procedure's own answer, for the caller's own remedy:
//   choose          `CHOICE_NOT_ALLOWED` (the remedy is `proposed`, no longer awaiting a choice);
//   accept          the proposal booked, on a remedy made for that one call;
//   counterOptions  the options;
//   counter         `SLOT_NOT_OFFERED` (a date years before the bound), nothing written.
import { randomUUID } from 'node:crypto';

import { expect } from 'vitest';

import { DomainError } from '../../apps/api/src/platform/errors/domain-error.js';
import { expectUnauthenticated, neighbourOf, tamperedTokens } from './discovery.attacks.js';
import { type AppCaller, discoverySurface, type SessionPair } from './discovery-world.js';
import {
  type Direction,
  expectAnswersAsNonexistent,
  type ProcedureAttacks,
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

/** One procedure's call on a remedy's session, and how the caller's own is answered. */
interface Procedure {
  readonly path: string;
  readonly call: (caller: AppCaller, sessionId: string, extra?: object) => Promise<unknown>;
  /** The caller's own remedy answered: a result, or a refusal only a found remedy gives. */
  readonly ownAnswered: (
    pair: SessionPair,
    sessionId: string,
    gender: Direction['requester'],
  ) => Promise<void>;
}

const studentProcedures: readonly Procedure[] = [
  {
    path: 'sessions.remedy.choose',
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
    call: (caller, sessionId, extra = {}) =>
      caller.sessions.remedy.counterOptions({ sessionId, ...extra } as never),
    ownAnswered: async (pair, sessionId) => {
      const { options } = await pair.student.caller.sessions.remedy.counterOptions({ sessionId });
      expect(Array.isArray(options)).toBe(true);
    },
  },
  {
    path: 'sessions.remedy.counter',
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
];

/** The five attack kinds of a procedure the student calls (the header). */
function studentAttacks(procedure: Procedure): ProcedureAttacks {
  const { call, ownAnswered } = procedure;
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
        // The teacher is no student of the remedy: the same answer as a nonexistent one.
        await expectAnswersAsNonexistent(
          () => call(own.teacher.caller, ownRemedy),
          () => call(own.teacher.caller, randomUUID()),
        );
      },
      async forgedId(direction) {
        const { own, theirRemedy } = await remediesFor(direction);
        for (const forged of [
          theirRemedy,
          own.enrollmentId,
          own.student.userId,
          own.teacher.userId,
        ]) {
          await expectAnswersAsNonexistent(
            () => call(own.student.caller, forged),
            () => call(own.student.caller, randomUUID()),
          );
        }
      },
      async guessedId(direction) {
        const { own, theirRemedy } = await remediesFor(direction);
        for (const guessed of [randomUUID(), neighbourOf(theirRemedy), theirRemedy.toUpperCase()]) {
          await expectAnswersAsNonexistent(
            () => call(own.student.caller, guessed),
            () => call(own.student.caller, randomUUID()),
          );
        }
      },
      async tamperedToken(direction) {
        const { surface, own, theirs, ownRemedy } = await remediesFor(direction);
        for (const token of tamperedTokens(
          direction,
          own.student.accessToken,
          theirs.student.sessionId,
        )) {
          const tampered = await surface.bearing(token);
          await expectUnauthenticated(() => call(tampered, ownRemedy));
        }
      },
      async clientSuppliedGender(direction) {
        const { surface, own, ownRemedy, theirRemedy } = await remediesFor(direction);
        const gendered = { gender: direction.other };
        await expectAnswersAsNonexistent(
          () => call(own.student.caller, theirRemedy, gendered),
          () => call(own.student.caller, randomUUID(), gendered),
        );
        // After an administrator's correction of the teacher's gender (K2): the server's record.
        await surface.setGender(own.teacher.userId, direction.other);
        try {
          await expectAnswersAsNonexistent(
            () => call(own.student.caller, ownRemedy, gendered),
            () => call(own.student.caller, randomUUID(), gendered),
          );
        } finally {
          await surface.setGender(own.teacher.userId, direction.requester);
        }
        await ownAnswered(own, ownRemedy, direction.requester);
      },
    },
  };
}

export const sessionsRemedyAttacks: readonly ProcedureAttacks[] =
  studentProcedures.map(studentAttacks);
