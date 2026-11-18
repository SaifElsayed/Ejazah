// T013 of specs/005-certification — `genderFlags.raise`'s attacks (contracts/app-surface.md,
// «Adversarial suite»; FR-614; SRS FR-GENDER-3; R-409, R-413; R-GENDER-2, R-GENDER-4). The procedure
// is student-reachable (the user kind), so it is a registration of the procedure harness. Each runs
// in the discovery world (`discovery-world.ts`), over moderation's router mounted under
// `genderFlags` (`DiscoverySurface.genderFlags`), on each gender's session pair (a student and a lone
// visible teacher with a confirmed enrollment), its lone student and the world's seeded teachers.
//
// What every attack holds: a person the caller is neither paired with nor shown, the other gender's
// above all, answers exactly as a person who does not exist (404, `NOT_FOUND`, no field); a person
// the caller is paired with, and a teacher the student is shown, is flagged, so no attack passes on
// a refusal of everything. One open flag per flagged person (rule 57): each received flag names a
// person no other attack flags, in either direction.
//
//   directCall            the student flags the pair's teacher (received); the other gender's pair
//                         teacher, the lone student flagging the other gender's teachers, and the
//                         pair's teacher flagging the lone student they are not paired with: hidden.
//   forgedId              the other pair's enrollment and session ids, the own enrollment and
//                         session ids, sent as the person: hidden; the pair's teacher flags the
//                         pair's student (received).
//   guessedId             random ids, the other gender's pair teacher's neighbour and the upper-case
//                         spelling of their id: hidden; the lone student flags a teacher they are
//                         shown (received).
//   tamperedToken         a tampered bearer token: 401 before anything is read.
//   clientSuppliedGender  a `gender` field naming the other gender is ignored: the other gender's
//                         teacher stays hidden, another teacher the student is shown is flagged.
import { randomUUID } from 'node:crypto';

import { expect } from 'vitest';

import { expectUnauthenticated, neighbourOf, tamperedTokens } from './discovery.attacks.js';
import { discoverySurface, type GenderFlagsCaller, visibleTo } from './discovery-world.js';
import {
  type Direction,
  expectAnswersAsNonexistent,
  type ProcedureAttacks,
} from './procedure-harness.js';

const HOLDS = 'R-GENDER-2, R-GENDER-4, FR-614, R-409, R-413';
const REASON = 'الصوت لا يطابق الجنس المعلن';

/** The requester's pair, the other gender's, the teachers shown and every caller an attack needs. */
async function worldFor(direction: Direction) {
  const surface = await discoverySurface();
  const [own, theirs] = await Promise.all([
    surface.sessionPair(direction.requester),
    surface.sessionPair(direction.other),
  ]);
  const [student, teacher] = await Promise.all([
    surface.genderFlags(own.student.accessToken),
    surface.genderFlags(own.teacher.accessToken),
  ]);
  const lone = surface.student(direction.requester);
  const pairTeachers = new Set([own.teacher.userId, theirs.teacher.userId]);
  const shown = visibleTo(surface.world, direction.requester).filter(
    ({ id }) => !pairTeachers.has(id),
  );
  return {
    surface,
    own,
    theirs,
    student,
    teacher,
    lone: { userId: lone.userId, flags: await surface.genderFlags(lone.accessToken) },
    shown,
    otherGender: visibleTo(surface.world, direction.other),
  };
}

function flag(caller: GenderFlagsCaller, flaggedUserId: string, extra: object = {}) {
  return caller.genderFlags.raise({
    flaggedUserId,
    reason: REASON,
    idempotencyKey: `flag-attack-${randomUUID()}`,
    ...extra,
  } as Parameters<GenderFlagsCaller['genderFlags']['raise']>[0]);
}

/** The flag answers exactly as one on a person who does not exist. */
function expectHidden(caller: GenderFlagsCaller, flaggedUserId: string, extra: object = {}) {
  return expectAnswersAsNonexistent(
    () => flag(caller, flaggedUserId, extra),
    () => flag(caller, randomUUID()),
  );
}

/** The teacher the attack flags as shown: one per attack, so no attack meets another's open flag. */
function shownAt(shown: readonly { readonly id: string }[], index: number): string {
  const teacher = shown.at(index);
  if (teacher === undefined) throw new Error('the world shows too few teachers');
  return teacher.id;
}

const raiseAttacks: ProcedureAttacks = {
  path: 'genderFlags.raise',
  holds: HOLDS,
  attacks: {
    directCall: async (direction) => {
      const { own, theirs, student, teacher, lone, otherGender } = await worldFor(direction);
      expect(await flag(student, own.teacher.userId)).toEqual({ received: true });
      await expectHidden(student, theirs.teacher.userId);
      await expectHidden(student, theirs.student.userId);
      for (const hidden of otherGender) await expectHidden(lone.flags, hidden.id);
      // A teacher flags a student they are paired with, never one they are not.
      await expectHidden(teacher, lone.userId);
    },
    forgedId: async (direction) => {
      const { own, theirs, student, teacher } = await worldFor(direction);
      for (const forged of [
        theirs.enrollmentId,
        theirs.sessions.later,
        own.enrollmentId,
        own.sessions.later,
      ]) {
        await expectHidden(student, forged);
      }
      expect(await flag(teacher, own.student.userId)).toEqual({ received: true });
    },
    guessedId: async (direction) => {
      const { theirs, lone, shown } = await worldFor(direction);
      for (const guessed of [
        randomUUID(),
        randomUUID(),
        neighbourOf(theirs.teacher.userId),
        theirs.teacher.userId.toUpperCase(),
      ]) {
        await expectHidden(lone.flags, guessed);
      }
      expect(await flag(lone.flags, shownAt(shown, 0))).toEqual({ received: true });
    },
    tamperedToken: async (direction) => {
      const { surface, own, theirs } = await worldFor(direction);
      for (const token of tamperedTokens(
        direction,
        own.student.accessToken,
        theirs.student.sessionId,
      )) {
        const tampered = await surface.genderFlags(token);
        await expectUnauthenticated(() => flag(tampered, own.teacher.userId));
      }
    },
    clientSuppliedGender: async (direction) => {
      const { lone, shown, otherGender } = await worldFor(direction);
      const [hidden] = otherGender;
      if (hidden === undefined) throw new Error('the world has no teachers of the other gender');
      await expectHidden(lone.flags, hidden.id, { gender: direction.other });
      expect(await flag(lone.flags, shownAt(shown, -1), { gender: direction.other })).toEqual({
        received: true,
      });
    },
  },
};

export const genderFlagsAttacks: readonly ProcedureAttacks[] = [raiseAttacks];
