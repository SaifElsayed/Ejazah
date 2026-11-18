// T011 of specs/005-certification — `reports.create`'s attacks (contracts/app-surface.md,
// «Adversarial suite»; FR-611; R-408, R-413; R-GENDER-2, R-GENDER-4; the note under T011, Q-R4 (a),
// Q-R5 (a)). The procedure is student-reachable (the user kind), so it is a registration of the
// procedure harness. Each runs in the discovery world (`discovery-world.ts`), over the module's
// router mounted under `reports` (`DiscoverySurface.reports`), on each gender's session pair (a
// student and a lone visible teacher with a confirmed enrollment) and the world's seeded teachers.
//
// What every attack holds: a session, a chat or a profile the caller may not report from or of, the
// other gender's above all, answers exactly as a session that never existed (404, `NOT_FOUND`, no
// field); the pair's own report is received, and a teacher the student can see is reportable, so no
// attack passes on a refusal of everything. Each received report is a distinct reporter, person and
// context, so no attack meets another's `open_exists`.
//
//   directCall            the student reports the teacher from their session (received); #143 r3:
//                         the student reports, from that session, the other gender's teacher, a
//                         non-party, and gets NOT_FOUND; the other pair's session and chat; a
//                         profile of the other gender; a teacher caller's profile report.
//   forgedId              the other pair's session and enrollment, the own enrollment as a session,
//                         the parties' user ids, sent as a session or an enrollment id.
//   guessedId             random ids, the own session's neighbour and its upper-case spelling.
//   tamperedToken         a tampered bearer token: 401 before anything is read.
//   clientSuppliedGender  a `gender` field naming the other gender is ignored: the other gender's
//                         teacher stays hidden, the own one stays reportable.
import { randomUUID } from 'node:crypto';

import { expect } from 'vitest';

import { expectUnauthenticated, neighbourOf, tamperedTokens } from './discovery.attacks.js';
import {
  discoverySurface,
  type ReportsCaller,
  type SessionPair,
  visibleTo,
} from './discovery-world.js';
import {
  type Direction,
  expectAnswersAsNonexistent,
  type ProcedureAttacks,
} from './procedure-harness.js';

const HOLDS = 'R-GENDER-2, R-GENDER-4, FR-611, R-408, R-413';
const REASON = 'كلام غير لائق';

/** The requester's pair, the other gender's, the visible teachers and every caller an attack needs. */
async function worldFor(direction: Direction) {
  const surface = await discoverySurface();
  const [own, theirs] = await Promise.all([
    surface.sessionPair(direction.requester),
    surface.sessionPair(direction.other),
  ]);
  const [student, teacher] = await Promise.all([
    surface.reports(own.student.accessToken),
    surface.reports(own.teacher.accessToken),
  ]);
  const lone = surface.student(direction.requester);
  return {
    surface,
    own,
    theirs,
    student,
    teacher,
    lone: { userId: lone.userId, reports: await surface.reports(lone.accessToken) },
    visible: visibleTo(surface.world, direction.requester),
    otherGender: visibleTo(surface.world, direction.other),
  };
}

function report(caller: ReportsCaller, input: object) {
  return caller.reports.create({
    reason: REASON,
    idempotencyKey: `report-attack-${randomUUID()}`,
    ...input,
  } as Parameters<ReportsCaller['reports']['create']>[0]);
}

const sessionOf = (pair: SessionPair) => pair.sessions.later;

/** The report answers exactly as one from a session that never existed. */
function expectHidden(caller: ReportsCaller, input: object, reportedUserId: string): Promise<void> {
  return expectAnswersAsNonexistent(
    () => report(caller, input),
    () => report(caller, { reportedUserId, context: 'session', sessionId: randomUUID() }),
  );
}

const createAttacks: ProcedureAttacks = {
  path: 'reports.create',
  holds: HOLDS,
  attacks: {
    directCall: async (direction) => {
      const { own, theirs, student, teacher, lone, otherGender } = await worldFor(direction);
      expect(
        await report(student, {
          reportedUserId: own.teacher.userId,
          context: 'session',
          sessionId: sessionOf(own),
        }),
      ).toEqual({ received: true });
      // #143 r3: from the own session, a non-party of the other gender.
      await expectHidden(
        student,
        { reportedUserId: theirs.teacher.userId, context: 'session', sessionId: sessionOf(own) },
        theirs.teacher.userId,
      );
      await expectHidden(
        student,
        { reportedUserId: theirs.teacher.userId, context: 'session', sessionId: sessionOf(theirs) },
        theirs.teacher.userId,
      );
      await expectHidden(
        student,
        {
          reportedUserId: theirs.teacher.userId,
          context: 'chat',
          enrollmentId: theirs.enrollmentId,
        },
        theirs.teacher.userId,
      );
      for (const hidden of otherGender) {
        await expectHidden(
          lone.reports,
          { reportedUserId: hidden.id, context: 'profile' },
          hidden.id,
        );
      }
      // Q-R4 (a): a teacher reports a student from a session or a chat, never a profile.
      await expectHidden(
        teacher,
        { reportedUserId: own.student.userId, context: 'profile' },
        own.student.userId,
      );
    },
    forgedId: async (direction) => {
      const { own, theirs, student } = await worldFor(direction);
      const target = own.teacher.userId;
      for (const forged of [
        sessionOf(theirs),
        theirs.enrollmentId,
        own.enrollmentId,
        own.student.userId,
        own.teacher.userId,
      ]) {
        await expectHidden(
          student,
          { reportedUserId: target, context: 'session', sessionId: forged },
          target,
        );
      }
      for (const forged of [theirs.enrollmentId, sessionOf(own), own.student.userId]) {
        await expectHidden(
          student,
          { reportedUserId: target, context: 'chat', enrollmentId: forged },
          target,
        );
      }
      expect(
        await report(student, {
          reportedUserId: target,
          context: 'chat',
          enrollmentId: own.enrollmentId,
        }),
      ).toEqual({ received: true });
    },
    guessedId: async (direction) => {
      const { own, lone } = await worldFor(direction);
      const target = own.teacher.userId;
      const pairTeacher = await (await discoverySurface()).reports(own.teacher.accessToken);
      for (const guessed of [
        randomUUID(),
        randomUUID(),
        neighbourOf(sessionOf(own)),
        sessionOf(own).toUpperCase(),
      ]) {
        await expectHidden(
          lone.reports,
          { reportedUserId: target, context: 'session', sessionId: guessed },
          target,
        );
      }
      // The pair's teacher reports the student from the session: received.
      expect(
        await report(pairTeacher, {
          reportedUserId: own.student.userId,
          context: 'session',
          sessionId: sessionOf(own),
        }),
      ).toEqual({ received: true });
    },
    tamperedToken: async (direction) => {
      const { surface, own, theirs } = await worldFor(direction);
      for (const token of tamperedTokens(
        direction,
        own.student.accessToken,
        theirs.student.sessionId,
      )) {
        const tampered = await surface.reports(token);
        await expectUnauthenticated(() =>
          report(tampered, {
            reportedUserId: own.teacher.userId,
            context: 'session',
            sessionId: sessionOf(own),
          }),
        );
      }
    },
    clientSuppliedGender: async (direction) => {
      const { lone, visible, otherGender } = await worldFor(direction);
      const [hidden] = otherGender;
      const shown = visible.at(-1);
      if (hidden === undefined || shown === undefined) throw new Error('the world has no teachers');
      await expectHidden(
        lone.reports,
        { reportedUserId: hidden.id, context: 'profile', gender: direction.other },
        hidden.id,
      );
      expect(
        await report(lone.reports, {
          reportedUserId: shown.id,
          context: 'profile',
          gender: direction.other,
        }),
      ).toEqual({ received: true });
    },
  },
};

export const reportsAttacks: readonly ProcedureAttacks[] = [createAttacks];
