// 003:T112 (SRS §3.8.6, FR-POSTPONE-1, DEC-90) — `sessions.postpone`'s attacks, registered with the
// procedure harness as its router lands (FR-496, SC-407; R-GENDER-1, R-GENDER-2, R-GENDER-4). Each
// attack runs in the discovery world (`discovery-world.ts`), whose surface binds the sessions
// services as `main.ts` does. A postponement writes (the enrollment's week moves to `postponed`), so
// the attacks never postpone on the shared pairs other registrations read: for each gender, one pair
// of its own (`freshSessionPair`) is postponed once by its student, its `later` session (three days
// on) moved, and every later call on it is the requester's own enrollment answered with a refusal of
// its state (the student's `interval_not_passed`, the teacher's `no_session_in_week`), never as a
// nonexistent one. The other gender's enrollment is the shared pair's, which no call here moves.
//
// What every attack holds: an enrollment the requester is not a party of, the other gender's pair's
// above all, answers exactly as an id that never existed (404, `NOT_FOUND`, no field); the
// requester's own is answered, so no attack passes on a refusal of everything.
//
//   directCall            the student's postponement answered with the `later` session; the
//                         teacher's then refused `no_session_in_week`, the student's again
//                         `interval_not_passed`; the other gender's enrollment by its id.
//   forgedId              the other gender's enrollment, a session's id and a party's own user id,
//                         sent as the enrollment.
//   guessedId             ids never handed out: random ones, the other's neighbour and its upper-case
//                         spelling.
//   tamperedToken         the requester's genuine bearer with its signature or its session changed:
//                         refused as unauthenticated before any service is reached.
//   clientSuppliedGender  the input carrying the other gender: ignored, the server's records decide.
//   otherSessionToken, replayedToken: not applicable (no token issued or taken).
//   afterGenderCorrection after an administrator's correction of the teacher's gender (K2), the own
//                         enrollment answers as a nonexistent one, and as its own again once restored.
import { randomUUID } from 'node:crypto';

import { expect } from 'vitest';

import { DomainError } from '../../apps/api/src/platform/errors/domain-error.js';
import type { SessionsPostponeInput } from '../../packages/contracts/src/index.js';
import { expectUnauthenticated, neighbourOf, tamperedTokens } from './discovery.attacks.js';
import {
  type AppCaller,
  type DiscoverySurface,
  discoverySurface,
  type SessionPair,
} from './discovery-world.js';
import {
  type Direction,
  expectAnswersAsNonexistent,
  notApplicable,
  type SessionProcedureAttacks,
} from './procedure-harness.js';

const HOLDS = 'R-GENDER-1, R-GENDER-2, R-GENDER-4, FR-POSTPONE-1, FR-496, SC-407';

const key = () => `attack-${randomUUID()}`;

/** A postponement of `enrollmentId`, as the phone sends it, with a fresh key. */
const postpone = (caller: AppCaller, enrollmentId: string) =>
  caller.sessions.postpone({ enrollmentId, reason: 'سفر', idempotencyKey: key() });

/** The code and the cause tRPC carries a refusal with. */
async function refusalOf(
  attempt: () => Promise<unknown>,
): Promise<{ code: unknown; cause: unknown }> {
  try {
    await attempt();
  } catch (error) {
    const cause: unknown = error instanceof Error ? error.cause : undefined;
    if (cause instanceof DomainError) {
      return { code: cause.code, cause: cause.details?.find(({ path }) => path === 'cause')?.code };
    }
    throw error;
  }
  throw new Error('answered where it must be refused');
}

/** Each gender's own pair, postponed once by its student on first use, and the moved session. */
const postponed = new Map<
  string,
  Promise<{ readonly pair: SessionPair; readonly moved: readonly string[] }>
>();

function postponedPair(surface: DiscoverySurface, gender: Direction['requester']) {
  const made = postponed.get(gender);
  if (made !== undefined) return made;
  const making = (async () => {
    const pair = await surface.freshSessionPair(gender);
    const { sessionIds } = await postpone(pair.student.caller, pair.enrollmentId);
    return { pair, moved: sessionIds };
  })();
  postponed.set(gender, making);
  return making;
}

/** The requester's own postponed pair and the other gender's shared pair. */
async function pairsFor(direction: Direction) {
  const surface = await discoverySurface();
  const [{ pair: own, moved }, theirs] = await Promise.all([
    postponedPair(surface, direction.requester),
    surface.sessionPair(direction.other),
  ]);
  return { surface, own, moved, theirs };
}

/** The requester's own enrollment answered with a refusal of its state, never as nonexistent. */
async function expectOwnAnswered(own: SessionPair): Promise<void> {
  expect(await refusalOf(() => postpone(own.student.caller, own.enrollmentId))).toEqual({
    code: 'CONFLICT',
    cause: 'interval_not_passed',
  });
  expect(await refusalOf(() => postpone(own.teacher.caller, own.enrollmentId))).toEqual({
    code: 'CONFLICT',
    cause: 'no_session_in_week',
  });
}

const postponeAttacks: SessionProcedureAttacks = {
  path: 'sessions.postpone',
  holds: HOLDS,
  attacks: {
    async directCall(direction) {
      const { own, moved, theirs } = await pairsFor(direction);
      expect(moved).toEqual([own.sessions.later]);
      await expectOwnAnswered(own);
      for (const party of [own.student, own.teacher]) {
        await expectAnswersAsNonexistent(
          () => postpone(party.caller, theirs.enrollmentId),
          () => postpone(party.caller, randomUUID()),
        );
      }
    },
    async forgedId(direction) {
      const { own, theirs } = await pairsFor(direction);
      for (const party of [own.student, own.teacher]) {
        for (const forged of [
          theirs.enrollmentId,
          own.sessions.later,
          theirs.sessions.later,
          own.student.userId,
          own.teacher.userId,
        ]) {
          await expectAnswersAsNonexistent(
            () => postpone(party.caller, forged),
            () => postpone(party.caller, randomUUID()),
          );
        }
      }
      await expectOwnAnswered(own);
    },
    async guessedId(direction) {
      const { own, theirs } = await pairsFor(direction);
      for (const guessed of [
        randomUUID(),
        neighbourOf(theirs.enrollmentId),
        theirs.enrollmentId.toUpperCase(),
      ]) {
        await expectAnswersAsNonexistent(
          () => postpone(own.student.caller, guessed),
          () => postpone(own.student.caller, randomUUID()),
        );
      }
      await expectOwnAnswered(own);
    },
    async tamperedToken(direction) {
      const { surface, own, theirs } = await pairsFor(direction);
      for (const token of tamperedTokens(
        direction,
        own.student.accessToken,
        theirs.student.sessionId,
      )) {
        const tampered = await surface.bearing(token);
        await expectUnauthenticated(() => postpone(tampered, own.enrollmentId));
      }
    },
    async clientSuppliedGender(direction) {
      const { own, theirs } = await pairsFor(direction);
      const withGender = (caller: AppCaller, enrollmentId: string) =>
        caller.sessions.postpone({
          enrollmentId,
          reason: 'سفر',
          idempotencyKey: key(),
          gender: direction.other,
        } as SessionsPostponeInput);
      await expectAnswersAsNonexistent(
        () => withGender(own.student.caller, theirs.enrollmentId),
        () => withGender(own.student.caller, randomUUID()),
      );
      expect(await refusalOf(() => withGender(own.student.caller, own.enrollmentId))).toEqual({
        code: 'CONFLICT',
        cause: 'interval_not_passed',
      });
    },
    otherSessionToken: notApplicable(
      'sessions.postpone issues no token and takes none: it names its enrollment by id (forgedId, guessedId) and its caller by the bearer (tamperedToken)',
    ),
    replayedToken: notApplicable(
      'sessions.postpone issues no token, so the other participant has none of the caller’s to replay; either party postponing its own enrollment is answered its own (directCall)',
    ),
    async afterGenderCorrection(direction) {
      const { surface, own } = await pairsFor(direction);
      // After an administrator's correction of the teacher's gender (K2): the server's record.
      await surface.setGender(own.teacher.userId, direction.other);
      try {
        await expectAnswersAsNonexistent(
          () => postpone(own.student.caller, own.enrollmentId),
          () => postpone(own.student.caller, randomUUID()),
        );
      } finally {
        await surface.setGender(own.teacher.userId, direction.requester);
      }
      await expectOwnAnswered(own);
    },
  },
};

export const sessionsPostponeAttacks: readonly SessionProcedureAttacks[] = [postponeAttacks];
