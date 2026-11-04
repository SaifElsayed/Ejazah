// T049 — `enrollments.list`'s and `enrollments.get`'s attacks, registered with T011's harness as their
// router lands (FR-410, SC-304; FR-390, FR-395, M3; R-GENDER-2, R-GENDER-4, R-GENDER-5), as T037
// registered `checkout.status`. Each attack builds its own enrollments as `checkout.status`' do
// (`paidFor`): each student holds a visible teacher of their own gender and pays, so each has an
// enrollment awaiting payment, on their active tab.
//
// What every attack holds: the other gender's student's enrollment, and every id that is not the
// requester's own enrollment, answers `enrollments.get` exactly as an id that never existed (404,
// `NOT_FOUND`, no field), and never appears on the requester's list, by tab or by cursor; the
// requester's own enrollment is answered, so no attack passes on a refusal of everything; no item
// names a teacher of the other gender.
//
//   directCall            the student's own enrollment and list, as the phone asks for them; the
//                         other gender's student's enrollment by its id.
//   forgedId              the other student's enrollment and hold ids, and the requester's own hold
//                         id, sent as an enrollment id or as the list's cursor.
//   guessedId             ids never handed out: random ones, the other enrollment's neighbour and its
//                         upper-case spelling.
//   tamperedToken         the requester's genuine bearer token with its signature or its session
//                         changed: refused as unauthenticated before any service is reached.
//   clientSuppliedGender  the input carrying the other gender: ignored, the answer the session's.
import { randomUUID } from 'node:crypto';

import { expect } from 'vitest';

import type {
  EnrollmentsGetInput,
  EnrollmentsListInput,
  EnrollmentsListOutput,
} from '../../packages/contracts/src/index.js';
import { paidFor } from './checkout.attacks.js';
import { expectUnauthenticated, neighbourOf, tamperedTokens } from './discovery.attacks.js';
import type { AppCaller } from './discovery-world.js';
import {
  type Direction,
  expectAnswersAsNonexistent,
  type ProcedureAttacks,
} from './procedure-harness.js';

const HOLDS = 'R-GENDER-2, R-GENDER-4, R-GENDER-5, FR-390, FR-395, M3';

/** The enrollment answers as one that never existed. */
function expectEnrollmentHidden(caller: AppCaller, enrollmentId: string): Promise<void> {
  return expectAnswersAsNonexistent(
    () => caller.enrollments.get({ enrollmentId }),
    () => caller.enrollments.get({ enrollmentId: randomUUID() }),
  );
}

/** Every tab and cursor the attack sends, read through `list`. */
async function listsOf(
  caller: AppCaller,
  cursors: readonly string[],
  extra: Record<string, unknown> = {},
): Promise<EnrollmentsListOutput[]> {
  const inputs: EnrollmentsListInput[] = [
    { tab: 'active' },
    { tab: 'ended' },
    ...cursors.flatMap((cursor) => [
      { tab: 'active' as const, cursor },
      { tab: 'ended' as const, cursor },
    ]),
  ];
  return Promise.all(
    inputs.map((input) => caller.enrollments.list({ ...input, ...extra } as EnrollmentsListInput)),
  );
}

type Paid = Awaited<ReturnType<typeof paidFor>>;

/** No list names the other student's enrollment or a teacher of the other gender; the active tab names the own. */
function expectListsOwnOnly(
  direction: Direction,
  paid: Paid,
  answers: readonly EnrollmentsListOutput[],
): void {
  const hidden = [paid.theirEnrollment];
  const otherGender = new Set(
    paid.world.teachers.filter(({ gender }) => gender === direction.other).map(({ id }) => id),
  );
  for (const answer of answers) {
    for (const item of answer.items) {
      expect(hidden, 'another student’s enrollment on the list').not.toContain(item.enrollmentId);
      expect(otherGender.has(item.teacher.teacherId), 'a teacher of the other gender').toBe(false);
    }
  }
  const [active] = answers;
  expect(active?.items.map(({ enrollmentId }) => enrollmentId)).toContain(paid.ownEnrollment);
}

const get: ProcedureAttacks = {
  path: 'enrollments.get',
  holds: HOLDS,
  attacks: {
    async directCall(direction) {
      const { caller, ownEnrollment, theirEnrollment } = await paidFor(direction);
      const answer = await caller.enrollments.get({ enrollmentId: ownEnrollment });
      expect(answer.status).toBe('pending_payment');
      await expectEnrollmentHidden(caller, theirEnrollment);
    },
    async forgedId(direction) {
      const { caller, theirEnrollment, theirs, own } = await paidFor(direction);
      for (const forged of [theirEnrollment, theirs.holdId, own.holdId]) {
        await expectEnrollmentHidden(caller, forged);
      }
    },
    async guessedId(direction) {
      const { caller, theirEnrollment } = await paidFor(direction);
      for (const guessed of [
        randomUUID(),
        neighbourOf(theirEnrollment),
        theirEnrollment.toUpperCase(),
      ]) {
        await expectEnrollmentHidden(caller, guessed);
      }
    },
    async tamperedToken(direction) {
      const { surface, ownEnrollment } = await paidFor(direction);
      const mine = surface.student(direction.requester);
      const theirs = surface.student(direction.other);
      for (const token of tamperedTokens(direction, mine.accessToken, theirs.sessionId)) {
        const tampered = await surface.bearing(token);
        await expectUnauthenticated(() =>
          tampered.enrollments.get({ enrollmentId: ownEnrollment }),
        );
      }
    },
    async clientSuppliedGender(direction) {
      const { caller, ownEnrollment, theirEnrollment } = await paidFor(direction);
      const withGender = (enrollmentId: string) =>
        caller.enrollments.get({ enrollmentId, gender: direction.other } as EnrollmentsGetInput);
      await expectAnswersAsNonexistent(
        () => withGender(theirEnrollment),
        () => withGender(randomUUID()),
      );
      expect((await withGender(ownEnrollment)).enrollmentId).toBe(ownEnrollment);
    },
  },
};

const list: ProcedureAttacks = {
  path: 'enrollments.list',
  holds: HOLDS,
  attacks: {
    async directCall(direction) {
      const paid = await paidFor(direction);
      expectListsOwnOnly(direction, paid, await listsOf(paid.caller, []));
    },
    async forgedId(direction) {
      const paid = await paidFor(direction);
      const forged = [paid.theirEnrollment, paid.theirs.holdId, paid.own.holdId];
      expectListsOwnOnly(direction, paid, await listsOf(paid.caller, forged));
    },
    async guessedId(direction) {
      const paid = await paidFor(direction);
      const guessed = [
        randomUUID(),
        neighbourOf(paid.theirEnrollment),
        paid.theirEnrollment.toUpperCase(),
      ];
      expectListsOwnOnly(direction, paid, await listsOf(paid.caller, guessed));
    },
    async tamperedToken(direction) {
      const { surface } = await paidFor(direction);
      const mine = surface.student(direction.requester);
      const theirs = surface.student(direction.other);
      for (const token of tamperedTokens(direction, mine.accessToken, theirs.sessionId)) {
        const tampered = await surface.bearing(token);
        await expectUnauthenticated(() => tampered.enrollments.list({ tab: 'active' }));
      }
    },
    async clientSuppliedGender(direction) {
      const paid = await paidFor(direction);
      expectListsOwnOnly(
        direction,
        paid,
        await listsOf(paid.caller, [], { gender: direction.other }),
      );
    },
  },
};

/** The `enrollments` namespace's registrations (T049). */
export const enrollmentsAttacks: readonly ProcedureAttacks[] = [list, get];
