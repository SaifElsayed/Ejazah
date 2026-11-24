// 004:T084 (SRS DEC-105; the note under T084, (3), Q-5 (a)) — `sessions.encryptionFailed`'s attacks,
// registered with the procedure harness as its router lands (FR-496, SC-407; R-GENDER-1, R-GENDER-2,
// R-GENDER-4), as 003:T112 registered `sessions.postpone`'s (`sessions-postpone.attacks.ts`). Each
// attack runs in the discovery world (`discovery-world.ts`), whose surface binds the sessions services
// as `main.ts` does, on each gender's shared pair (`sessionPair`). A report writes one append-only
// `session_events` row and moves nothing another registration reads.
//
// What every attack holds: a session the requester is not a party of, the other gender's pair's above
// all, answers exactly as an id that never existed (404, `NOT_FOUND`, no field); the requester's own
// session is answered (nothing), so no attack passes on a refusal of everything.
//
//   directCall            both parties report on their own session; the other gender's by its id.
//   forgedId              the other gender's session, the enrollment's id and a party's own user id,
//                         sent as the session.
//   guessedId             ids never handed out: random ones, the other's neighbour and its upper-case
//                         spelling.
//   tamperedToken         the requester's genuine bearer with its signature or its session changed:
//                         refused as unauthenticated before any service is reached.
//   clientSuppliedGender  the input carrying the other gender and a side: ignored, the server's
//                         records decide.
//   otherSessionToken, replayedToken: not applicable (no token issued or taken).
//   afterGenderCorrection after an administrator's correction of the teacher's gender (K2), the own
//                         session answers as a nonexistent one, and as its own again once restored.
import { randomUUID } from 'node:crypto';

import { expect } from 'vitest';

import type { SessionsEncryptionFailedInput } from '../../packages/contracts/src/index.js';
import { expectUnauthenticated, neighbourOf, tamperedTokens } from './discovery.attacks.js';
import { type AppCaller, discoverySurface } from './discovery-world.js';
import {
  type Direction,
  expectAnswersAsNonexistent,
  notApplicable,
  type SessionProcedureAttacks,
} from './procedure-harness.js';

const HOLDS = 'R-GENDER-1, R-GENDER-2, R-GENDER-4, FR-SESS-2, DEC-105, FR-496, SC-407';

const report = (caller: AppCaller, sessionId: string) =>
  caller.sessions.encryptionFailed({ sessionId });

/** The requester's own pair and the other gender's. */
async function pairsFor(direction: Direction) {
  const surface = await discoverySurface();
  const [own, theirs] = await Promise.all([
    surface.sessionPair(direction.requester),
    surface.sessionPair(direction.other),
  ]);
  return { surface, own, theirs };
}

/** `sessionId` answers `caller` as a session that never existed. */
function expectHidden(caller: AppCaller, sessionId: string): Promise<void> {
  return expectAnswersAsNonexistent(
    () => report(caller, sessionId),
    () => report(caller, randomUUID()),
  );
}

const encryptionFailedAttacks: SessionProcedureAttacks = {
  path: 'sessions.encryptionFailed',
  holds: HOLDS,
  attacks: {
    async directCall(direction) {
      const { own, theirs } = await pairsFor(direction);
      for (const party of [own.student, own.teacher]) {
        await expect(report(party.caller, own.sessions.open)).resolves.toBeUndefined();
        await expectHidden(party.caller, theirs.sessions.open);
      }
    },
    async forgedId(direction) {
      const { own, theirs } = await pairsFor(direction);
      for (const party of [own.student, own.teacher]) {
        for (const forged of [
          theirs.sessions.open,
          own.enrollmentId,
          own.student.userId,
          own.teacher.userId,
        ]) {
          await expectHidden(party.caller, forged);
        }
      }
      await expect(report(own.student.caller, own.sessions.open)).resolves.toBeUndefined();
    },
    async guessedId(direction) {
      const { own, theirs } = await pairsFor(direction);
      for (const guessed of [
        randomUUID(),
        neighbourOf(theirs.sessions.open),
        theirs.sessions.open.toUpperCase(),
      ]) {
        await expectHidden(own.student.caller, guessed);
      }
      await expect(report(own.student.caller, own.sessions.open)).resolves.toBeUndefined();
    },
    async tamperedToken(direction) {
      const { surface, own, theirs } = await pairsFor(direction);
      for (const token of tamperedTokens(
        direction,
        own.student.accessToken,
        theirs.student.sessionId,
      )) {
        const tampered = await surface.bearing(token);
        await expectUnauthenticated(() => report(tampered, own.sessions.open));
      }
    },
    async clientSuppliedGender(direction) {
      const { own, theirs } = await pairsFor(direction);
      const withGender = (caller: AppCaller, sessionId: string) =>
        caller.sessions.encryptionFailed({
          sessionId,
          gender: direction.other,
          party: 'teacher',
        } as SessionsEncryptionFailedInput);
      await expectAnswersAsNonexistent(
        () => withGender(own.student.caller, theirs.sessions.open),
        () => withGender(own.student.caller, randomUUID()),
      );
      await expect(withGender(own.student.caller, own.sessions.open)).resolves.toBeUndefined();
    },
    otherSessionToken: notApplicable(
      'sessions.encryptionFailed issues no token and takes none: it names its session by id (forgedId, guessedId) and its caller by the bearer (tamperedToken)',
    ),
    replayedToken: notApplicable(
      'sessions.encryptionFailed issues no token, so the other participant has none of the caller’s to replay; either party reporting on its own session is answered (directCall)',
    ),
    async afterGenderCorrection(direction) {
      const { surface, own } = await pairsFor(direction);
      // After an administrator's correction of the teacher's gender (K2): the server's record.
      await surface.setGender(own.teacher.userId, direction.other);
      try {
        await expectHidden(own.student.caller, own.sessions.open);
      } finally {
        await surface.setGender(own.teacher.userId, direction.requester);
      }
      await expect(report(own.student.caller, own.sessions.open)).resolves.toBeUndefined();
    },
  },
};

export const sessionsEncryptionAttacks: readonly SessionProcedureAttacks[] = [
  encryptionFailedAttacks,
];
