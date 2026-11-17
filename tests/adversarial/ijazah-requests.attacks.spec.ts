// T006 of specs/005-certification — `teacher.ijazahRequests.preview`, `.send` and `.get` attacked in
// both directions (contracts/app-surface.md, «Adversarial suite»; FR-603, FR-608; R-GENDER-2,
// R-GENDER-4; R-413). A teacher procedure is not student-facing, so the procedure harness's
// coverage does not reach it (`procedure-harness.ts`, «WHAT MUST BE REGISTERED»); these cases run
// on their own, as `chat-upload.attacks.spec.ts` does, in the discovery world, on each gender's
// session pair (a student and a lone visible teacher with a confirmed enrollment), over the module's
// router mounted as `app.router.ts` mounts it (`DiscoverySurface.ijazahRequests`).
//
// What every attack holds: an enrollment that is not the teacher's own, the other gender's pair's
// above all, answers each procedure exactly as an id that never existed (404, `NOT_FOUND`, no
// field); the teacher's own enrollment is reached (its request read, the preview's own refusal), so
// no attack passes on a refusal of everything; a student is refused before any service.
//
//   directCall            the teacher's own enrollment read; the other gender's enrollment by its id;
//                         the pair's student calling the teacher's procedures.
//   forgedId              the other pair's enrollment, a session's id and the parties' user ids.
//   guessedId             random ids, the other enrollment's neighbour and its upper-case spelling.
//   tamperedToken         a tampered bearer token: 401 before anything is read.
//   clientSuppliedGender  a `gender` field naming the other gender is ignored.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  expectUnauthenticated,
  neighbourOf,
  refusalOf,
  tamperedTokens,
} from './discovery.attacks.js';
import { discoverySurface, type IjazahRequestsCaller } from './discovery-world.js';
import { type Direction, directions, expectAnswersAsNonexistent } from './procedure-harness.js';

const HOLDS = 'R-GENDER-2, R-GENDER-4, FR-603, FR-608, R-413';
const ATTACK_TIMEOUT_MS = 180_000;
const COMPLETED = '2026-11-01';

async function pairsFor(direction: Direction) {
  const surface = await discoverySurface();
  const [own, theirs] = await Promise.all([
    surface.sessionPair(direction.requester),
    surface.sessionPair(direction.other),
  ]);
  // Both pairs' teachers approved as an approved teacher's application is, so the kind admits them.
  await surface.approveApplication(own.teacher.userId);
  await surface.approveApplication(theirs.teacher.userId);
  const teacher = await surface.ijazahRequests(own.teacher.accessToken);
  return { surface, own, theirs, teacher };
}

/** Each procedure on `enrollmentId`, with `extra` added to its input. */
function callsOn(caller: IjazahRequestsCaller, enrollmentId: string, extra: object = {}) {
  const input = { enrollmentId, completionDate: COMPLETED, ...extra };
  return [
    () => caller.teacher.ijazahRequests.preview(input as never),
    () =>
      caller.teacher.ijazahRequests.send({
        ...input,
        idempotencyKey: `attack-${randomUUID()}`,
      } as never),
    () => caller.teacher.ijazahRequests.get({ enrollmentId, ...extra } as never),
  ] as const;
}

/** Every procedure answers `enrollmentId` byte for byte as an id that never existed. */
async function expectHidden(
  caller: IjazahRequestsCaller,
  enrollmentId: string,
  extra: object = {},
): Promise<void> {
  const hidden = callsOn(caller, enrollmentId, extra);
  const absent = callsOn(caller, randomUUID(), extra);
  for (const [index, call] of hidden.entries()) {
    const nonexistent = absent[index];
    if (nonexistent === undefined) throw new Error('a procedure without its twin');
    await expectAnswersAsNonexistent(call, nonexistent);
  }
}

/** The teacher's own enrollment is reached: get answers, the preview refuses its track. */
async function expectOwnReached(
  caller: IjazahRequestsCaller,
  enrollmentId: string,
  extra: object = {},
): Promise<void> {
  expect(await caller.teacher.ijazahRequests.get({ enrollmentId, ...extra } as never)).toEqual({
    request: null,
  });
  const preview = await refusalOf(() =>
    caller.teacher.ijazahRequests.preview({
      enrollmentId,
      completionDate: COMPLETED,
      ...extra,
    } as never),
  );
  // The pair's enrollment is a recitation one: its own refusal, never NOT_FOUND.
  expect(preview.body).toEqual({
    code: 'CONFLICT',
    message: expect.any(String),
    details: [{ path: 'enrollmentId', code: 'not_ijazah_track' }],
  });
}

describe(
  `the attacks on teacher.ijazahRequests (${HOLDS})`,
  { tags: ['database'], timeout: ATTACK_TIMEOUT_MS },
  () => {
    for (const direction of directions) {
      it(`directCall: ${direction.name}`, async () => {
        const { surface, own, theirs, teacher } = await pairsFor(direction);
        await expectOwnReached(teacher, own.enrollmentId);
        await expectHidden(teacher, theirs.enrollmentId);
        const student = await surface.ijazahRequests(own.student.accessToken);
        for (const call of callsOn(student, own.enrollmentId)) {
          const refusal = await refusalOf(call);
          expect(refusal.status).toBe(403);
          expect(refusal.body.code).toBe('FORBIDDEN');
        }
      });

      it(`forgedId: ${direction.name}`, async () => {
        const { own, theirs, teacher } = await pairsFor(direction);
        for (const forged of [
          theirs.enrollmentId,
          own.sessions.open,
          own.student.userId,
          own.teacher.userId,
          theirs.teacher.userId,
        ]) {
          await expectHidden(teacher, forged);
        }
      });

      it(`guessedId: ${direction.name}`, async () => {
        const { theirs, teacher } = await pairsFor(direction);
        for (const guessed of [
          randomUUID(),
          neighbourOf(theirs.enrollmentId),
          theirs.enrollmentId.toUpperCase(),
        ]) {
          await expectHidden(teacher, guessed);
        }
      });

      it(`tamperedToken: ${direction.name}`, async () => {
        const { surface, own, theirs } = await pairsFor(direction);
        for (const token of tamperedTokens(
          direction,
          own.teacher.accessToken,
          theirs.teacher.sessionId,
        )) {
          const tampered = await surface.ijazahRequests(token);
          for (const call of callsOn(tampered, own.enrollmentId)) {
            await expectUnauthenticated(call);
          }
        }
      });

      it(`clientSuppliedGender: ${direction.name}`, async () => {
        const { own, theirs, teacher } = await pairsFor(direction);
        const extra = { gender: direction.other };
        await expectHidden(teacher, theirs.enrollmentId, extra);
        await expectOwnReached(teacher, own.enrollmentId, extra);
      });
    }
  },
);
