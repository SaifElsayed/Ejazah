// T021 of specs/004-sessions — `sessions.cancellation.request`'s and `.answer`'s attacks, registered
// with the procedure harness as their router lands (FR-496, SC-407; FR-456; R-GENDER-1, R-GENDER-2,
// R-GENDER-4). Each attack runs in the discovery world (`discovery-world.ts`), whose surface binds
// the sessions services as `main.ts` does, on the session pairs `sessions.attacks.ts` uses: for each
// gender, a lone visible teacher and a student of that gender with a confirmed enrollment and three
// sessions. The requests are asked on `later` (three days on), never `open`, whose start the run
// could reach; every request an attack makes is declined before it ends, so no session's status
// changes and no pending request is left for the next attack (an acceptance is the database specs').
//
// What every attack holds: a session or a request the requester is not a party of, the other
// gender's pair's above all, answers exactly as an id that never existed (404, `NOT_FOUND`, no
// field); the requester's own is answered, so no attack passes on a refusal of everything.
//
//   directCall            both parties ask on their own session and the counterparty declines; the
//                         other gender's session or request by its id; a session already started
//                         (`past`) CANCELLATION_EXPIRED; the requester answering their own request
//                         as a nonexistent one.
//   forgedId              the other gender's session or request, the enrollment's id and a party's
//                         own user id, sent as the session or the request.
//   guessedId             ids never handed out: random ones, the other's neighbour and its upper-case
//                         spelling.
//   tamperedToken         the requester's genuine bearer with its signature or its session changed:
//                         refused as unauthenticated before any service is reached.
//   clientSuppliedGender  the input carrying the other gender: ignored, the server's records decide.
// T052 (FR-496's three kinds, Q2 (a)): otherSessionToken and replayedToken not applicable (no token
// issued or taken);
//   afterGenderCorrection after an administrator's correction of the counterparty's gender (K2, as
//                         `sessions.attacks.ts` makes it), the own session or request answers as a
//                         nonexistent one, and again once restored (moved from clientSuppliedGender
//                         unchanged; `answer`'s clientSuppliedGender keeps its own request declined
//                         with the gender in the input, which the moved block had ended with).
import { randomUUID } from 'node:crypto';

import { expect } from 'vitest';

import { DomainError } from '../../apps/api/src/platform/errors/domain-error.js';
import type {
  SessionsCancellationAnswerInput,
  SessionsCancellationRequestInput,
} from '../../packages/contracts/src/index.js';
import { expectUnauthenticated, neighbourOf, tamperedTokens } from './discovery.attacks.js';
import { type AppCaller, discoverySurface, type SessionPair } from './discovery-world.js';
import {
  type Direction,
  expectAnswersAsNonexistent,
  notApplicable,
  type SessionProcedureAttacks,
} from './procedure-harness.js';

const HOLDS = 'R-GENDER-1, R-GENDER-2, R-GENDER-4, FR-456, FR-496, SC-407';

const key = () => `attack-${randomUUID()}`;

/** A request on `sessionId`, as the phone sends it, with a fresh key. */
const ask = (caller: AppCaller, sessionId: string) =>
  caller.sessions.cancellation.request({ sessionId, reason: 'سفر', idempotencyKey: key() });

/** A decline of `requestId`, as the phone sends it. */
const decline = (caller: AppCaller, requestId: string) =>
  caller.sessions.cancellation.answer({ requestId, accept: false });

/** A decline of a request, as the phone sends it, with the other gender in its input. */
const declineWithGender = (direction: Direction) => (caller: AppCaller, requestId: string) =>
  caller.sessions.cancellation.answer({
    requestId,
    accept: false,
    gender: direction.other,
  } as SessionsCancellationAnswerInput);

/** The requester's pair and the other gender's, in the world built once per file. */
async function pairsFor(direction: Direction) {
  const surface = await discoverySurface();
  const [own, theirs] = await Promise.all([
    surface.sessionPair(direction.requester),
    surface.sessionPair(direction.other),
  ]);
  return { surface, own, theirs };
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

/**
 * A pending request on `pair`'s `later` session asked by its student, and its decline by its
 * teacher once `use` is done with it, whatever `use` ends in.
 */
async function withPendingRequest(
  pair: SessionPair,
  use: (requestId: string) => Promise<void>,
): Promise<void> {
  const { requestId } = await ask(pair.student.caller, pair.sessions.later);
  try {
    await use(requestId);
  } finally {
    await decline(pair.teacher.caller, requestId).catch(() => undefined);
  }
}

const requestAttacks: SessionProcedureAttacks = {
  path: 'sessions.cancellation.request',
  holds: HOLDS,
  attacks: {
    async directCall(direction) {
      const { own, theirs } = await pairsFor(direction);
      for (const [party, counterparty] of [
        [own.student, own.teacher],
        [own.teacher, own.student],
      ] as const) {
        const asked = await ask(party.caller, own.sessions.later);
        expect(asked.status).toBe('pending');
        await decline(counterparty.caller, asked.requestId);
        await expectAnswersAsNonexistent(
          () => ask(party.caller, theirs.sessions.later),
          () => ask(party.caller, randomUUID()),
        );
      }
      expect(await codeOf(() => ask(own.student.caller, own.sessions.past))).toBe(
        'CANCELLATION_EXPIRED',
      );
    },
    async forgedId(direction) {
      const { own, theirs } = await pairsFor(direction);
      for (const party of [own.student, own.teacher]) {
        for (const forged of [
          theirs.sessions.later,
          theirs.sessions.open,
          own.enrollmentId,
          own.student.userId,
          own.teacher.userId,
        ]) {
          await expectAnswersAsNonexistent(
            () => ask(party.caller, forged),
            () => ask(party.caller, randomUUID()),
          );
        }
      }
    },
    async guessedId(direction) {
      const { own, theirs } = await pairsFor(direction);
      for (const guessed of [
        randomUUID(),
        neighbourOf(theirs.sessions.later),
        theirs.sessions.later.toUpperCase(),
      ]) {
        await expectAnswersAsNonexistent(
          () => ask(own.student.caller, guessed),
          () => ask(own.student.caller, randomUUID()),
        );
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
        await expectUnauthenticated(() => ask(tampered, own.sessions.later));
      }
    },
    async clientSuppliedGender(direction) {
      const { own, theirs } = await pairsFor(direction);
      const withGender = (caller: AppCaller, sessionId: string) =>
        caller.sessions.cancellation.request({
          sessionId,
          reason: 'سفر',
          idempotencyKey: key(),
          gender: direction.other,
        } as SessionsCancellationRequestInput);
      await expectAnswersAsNonexistent(
        () => withGender(own.student.caller, theirs.sessions.later),
        () => withGender(own.student.caller, randomUUID()),
      );
      const asked = await withGender(own.student.caller, own.sessions.later);
      await decline(own.teacher.caller, asked.requestId);
    },
    otherSessionToken: notApplicable(
      'sessions.cancellation.request issues no token and takes none: it names its session by id (forgedId, guessedId) and its caller by the bearer (tamperedToken)',
    ),
    replayedToken: notApplicable(
      'sessions.cancellation.request issues no token, so the other participant has none of the caller’s to replay; either party asking on their own session is answered their own request (directCall)',
    ),
    async afterGenderCorrection(direction) {
      const { surface, own } = await pairsFor(direction);
      // After an administrator's correction of the teacher's gender (K2): the server's record.
      await surface.setGender(own.teacher.userId, direction.other);
      try {
        await expectAnswersAsNonexistent(
          () => ask(own.student.caller, own.sessions.later),
          () => ask(own.student.caller, randomUUID()),
        );
      } finally {
        await surface.setGender(own.teacher.userId, direction.requester);
      }
      const restored = await ask(own.student.caller, own.sessions.later);
      await decline(own.teacher.caller, restored.requestId);
    },
  },
};

const answerAttacks: SessionProcedureAttacks = {
  path: 'sessions.cancellation.answer',
  holds: HOLDS,
  attacks: {
    async directCall(direction) {
      const { own, theirs } = await pairsFor(direction);
      await withPendingRequest(theirs, async (theirRequest) => {
        await withPendingRequest(own, async (ownRequest) => {
          // The requester answering their own request answers as a nonexistent one.
          await expectAnswersAsNonexistent(
            () => decline(own.student.caller, ownRequest),
            () => decline(own.student.caller, randomUUID()),
          );
          for (const party of [own.student, own.teacher]) {
            await expectAnswersAsNonexistent(
              () => decline(party.caller, theirRequest),
              () => decline(party.caller, randomUUID()),
            );
          }
          expect(await decline(own.teacher.caller, ownRequest)).toEqual({
            requestId: ownRequest,
            status: 'declined',
            sessionStatus: 'scheduled',
          });
        });
      });
    },
    async forgedId(direction) {
      const { own, theirs } = await pairsFor(direction);
      await withPendingRequest(theirs, async (theirRequest) => {
        for (const forged of [
          theirRequest,
          own.sessions.later,
          own.enrollmentId,
          own.student.userId,
          own.teacher.userId,
        ]) {
          await expectAnswersAsNonexistent(
            () => decline(own.teacher.caller, forged),
            () => decline(own.teacher.caller, randomUUID()),
          );
        }
      });
    },
    async guessedId(direction) {
      const { own, theirs } = await pairsFor(direction);
      await withPendingRequest(theirs, async (theirRequest) => {
        for (const guessed of [
          randomUUID(),
          neighbourOf(theirRequest),
          theirRequest.toUpperCase(),
        ]) {
          await expectAnswersAsNonexistent(
            () => decline(own.teacher.caller, guessed),
            () => decline(own.teacher.caller, randomUUID()),
          );
        }
      });
    },
    async tamperedToken(direction) {
      const { surface, own, theirs } = await pairsFor(direction);
      await withPendingRequest(own, async (ownRequest) => {
        for (const token of tamperedTokens(
          direction,
          own.teacher.accessToken,
          theirs.teacher.sessionId,
        )) {
          const tampered = await surface.bearing(token);
          await expectUnauthenticated(() => decline(tampered, ownRequest));
        }
      });
    },
    async clientSuppliedGender(direction) {
      const { own, theirs } = await pairsFor(direction);
      const withGender = declineWithGender(direction);
      await withPendingRequest(theirs, async (theirRequest) => {
        await expectAnswersAsNonexistent(
          () => withGender(own.teacher.caller, theirRequest),
          () => withGender(own.teacher.caller, randomUUID()),
        );
      });
      // T052: the own request answered with the gender in the input, which ended the correction's
      // block before the correction moved to its own kind.
      await withPendingRequest(own, async (ownRequest) => {
        expect((await withGender(own.teacher.caller, ownRequest)).status).toBe('declined');
      });
    },
    otherSessionToken: notApplicable(
      'sessions.cancellation.answer issues no token and takes none: it names a request by id (forgedId, guessedId, a session id sent as one included) and its caller by the bearer (tamperedToken)',
    ),
    replayedToken: notApplicable(
      'sessions.cancellation.answer issues no token, so the other participant has none of the caller’s to replay; the requester answering their own request answers as a nonexistent one (directCall)',
    ),
    async afterGenderCorrection(direction) {
      const { surface, own } = await pairsFor(direction);
      const withGender = declineWithGender(direction);
      await withPendingRequest(own, async (ownRequest) => {
        // After an administrator's correction of the student's gender (K2): the server's record.
        await surface.setGender(own.student.userId, direction.other);
        try {
          await expectAnswersAsNonexistent(
            () => withGender(own.teacher.caller, ownRequest),
            () => withGender(own.teacher.caller, randomUUID()),
          );
        } finally {
          await surface.setGender(own.student.userId, direction.requester);
        }
        expect((await withGender(own.teacher.caller, ownRequest)).status).toBe('declined');
      });
    },
  },
};

export const sessionsCancellationAttacks: readonly SessionProcedureAttacks[] = [
  requestAttacks,
  answerAttacks,
];
