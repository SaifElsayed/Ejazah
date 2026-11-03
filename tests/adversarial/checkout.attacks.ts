// T036 — `checkout.hold`'s, `checkout.retry`'s and `checkout.pay`'s attacks, registered with T011's harness as their
// router lands (FR-410, SC-304; FR-351 to FR-356, M3; R-GENDER-1, R-GENDER-2, R-GENDER-4,
// R-GENDER-5), as B28's T032 registered `booking.slots`. T043's further cases (a foreign slot with
// nothing written, a verification-required teacher at hold, the teacher's name on `checkout.status`
// after a suspension and a deletion) are in `checkout-standing.spec.ts`; a suspension between hold
// and pay lands with T041's subscriber (the note under T043).
//
// The procedures are called through the real user surface and the real checkout services over the
// stand-in gateway (`discovery-world.ts`), once per direction: a male requester against female
// teachers and a female requester against male teachers, each also against the own gender's
// teachers in every excluded state. What every attack holds: a package of a teacher the requester
// may not book, and an enrollment that is not the requester's, answer exactly as an id that never
// existed (404, `NOT_FOUND`, no field), and the requester's own answer, so no attack passes on a
// refusal of everything. A held slot outlives its case, so every hold attack ends the student's
// holds again (`endHolds`).
//
//   directCall            every package of every teacher of the world, as the phone sends it; the
//                         student's own enrollment for a Retry.
//   forgedId              the other gender's packages, visible ones included, a visible teacher's
//                         slot id sent as a package id and its package with another teacher's slot;
//                         the other gender's student's enrollment, and its hold id, for a Retry.
//   guessedId             ids never handed out: random ones, an excluded id's neighbour and its
//                         upper-case spelling.
//   tamperedToken         the requester's genuine bearer token with its signature or its session
//                         changed: refused as unauthenticated before any service is reached.
//   clientSuppliedGender  the input carrying the other gender: ignored, the answer the session's.
import { randomUUID } from 'node:crypto';

import { expect } from 'vitest';

import type {
  CheckoutHoldInput,
  CheckoutPayInput,
  CheckoutRetryInput,
} from '../../packages/contracts/src/index.js';
import {
  expectUnauthenticated,
  neighbourOf,
  surfaceFor,
  tamperedTokens,
} from './discovery.attacks.js';
import type { AppCaller, SeededTeacher } from './discovery-world.js';
import {
  type Direction,
  expectAnswersAsNonexistent,
  notApplicable,
  type ProcedureAttacks,
} from './procedure-harness.js';

const key = () => randomUUID();

const holdOf = (caller: AppCaller, packageId: string, slotId: string) =>
  caller.checkout.hold({ packageId, slotId, idempotencyKey: key() });

/** The hold answers as one on a package that never existed. */
function expectHoldHidden(caller: AppCaller, packageId: string, slotId: string): Promise<void> {
  return expectAnswersAsNonexistent(
    () => holdOf(caller, packageId, slotId),
    () => holdOf(caller, randomUUID(), slotId),
  );
}

/** A visible teacher's package is held on the teacher's slot, the summary naming that teacher. */
async function expectHeld(caller: AppCaller, teacher: SeededTeacher, packageId: string) {
  const answer = await holdOf(caller, packageId, teacher.slotId);
  expect(answer.summary.teacher.teacherId).toBe(teacher.id);
  expect(answer.summary.price_piasters).toBe(100_000);
}

const hold: ProcedureAttacks = {
  path: 'checkout.hold',
  holds: 'R-GENDER-1, R-GENDER-2, R-GENDER-4, R-GENDER-5, FR-351 to FR-353, FR-BOOK-12',
  attacks: {
    async directCall(direction) {
      const { surface, caller, visible, excluded } = await surfaceFor(direction);
      expect(visible.length).toBeGreaterThan(0);
      try {
        for (const teacher of visible) {
          for (const packageId of teacher.packageIds) await expectHeld(caller, teacher, packageId);
        }
        for (const teacher of excluded) {
          for (const packageId of teacher.packageIds) {
            await expectHoldHidden(caller, packageId, teacher.slotId);
          }
        }
      } finally {
        await surface.endHolds(direction.requester);
      }
    },

    async forgedId(direction) {
      const { surface, caller, visible, excluded } = await surfaceFor(direction);
      const forged = excluded.filter(({ gender }) => gender === direction.other);
      expect(forged.length).toBeGreaterThan(visible.length);
      try {
        for (const teacher of forged) {
          for (const packageId of teacher.packageIds) {
            await expectHoldHidden(caller, packageId, teacher.slotId);
          }
        }
        const [own, other] = visible;
        if (own === undefined || other === undefined) throw new Error('two visible teachers');
        const [packageId] = own.packageIds;
        if (packageId === undefined) throw new Error('a world teacher without a package');
        // A slot id sent as a package id, and the package on another teacher's slot (round 2 N2).
        await expectHoldHidden(caller, own.slotId, own.slotId);
        await expectHoldHidden(caller, packageId, other.slotId);
        await expectHeld(caller, own, packageId);
      } finally {
        await surface.endHolds(direction.requester);
      }
    },

    async guessedId(direction) {
      const { caller, excluded } = await surfaceFor(direction);
      for (const teacher of excluded) {
        const [packageId] = teacher.packageIds;
        if (packageId === undefined) throw new Error('a world teacher without a package');
        await expectHoldHidden(caller, randomUUID(), teacher.slotId);
        await expectHoldHidden(caller, neighbourOf(packageId), teacher.slotId);
        await expectHoldHidden(caller, packageId.toUpperCase(), teacher.slotId);
      }
    },

    async tamperedToken(direction) {
      const { surface, visible } = await surfaceFor(direction);
      const own = surface.student(direction.requester);
      const other = surface.student(direction.other);
      const [teacher] = visible;
      const packageId = teacher?.packageIds[0];
      if (teacher === undefined || packageId === undefined) throw new Error('no visible package');
      for (const token of tamperedTokens(direction, own.accessToken, other.sessionId)) {
        const tampered = await surface.bearing(token);
        await expectUnauthenticated(() => holdOf(tampered, packageId, teacher.slotId));
      }
    },

    async clientSuppliedGender(direction) {
      const { surface, caller, visible, excluded } = await surfaceFor(direction);
      const withGender = (packageId: string, slotId: string) =>
        caller.checkout.hold({
          packageId,
          slotId,
          idempotencyKey: key(),
          gender: direction.other,
        } as CheckoutHoldInput);
      try {
        for (const teacher of excluded.filter(({ gender }) => gender === direction.other)) {
          for (const packageId of teacher.packageIds) {
            await expectAnswersAsNonexistent(
              () => withGender(packageId, teacher.slotId),
              () => withGender(randomUUID(), teacher.slotId),
            );
          }
        }
        for (const teacher of visible) {
          const [packageId] = teacher.packageIds;
          if (packageId === undefined) throw new Error('a world teacher without a package');
          const answer = await withGender(packageId, teacher.slotId);
          expect(answer.summary.teacher.teacherId).toBe(teacher.id);
        }
      } finally {
        await surface.endHolds(direction.requester);
      }
    },
  },
};

const retryOf = (caller: AppCaller, enrollmentId: string) =>
  caller.checkout.retry({ enrollmentId, idempotencyKey: key() });

/** The Retry answers as one on an enrollment that never existed. */
function expectRetryHidden(caller: AppCaller, enrollmentId: string): Promise<void> {
  return expectAnswersAsNonexistent(
    () => retryOf(caller, enrollmentId),
    () => retryOf(caller, randomUUID()),
  );
}

/** The student's own enrollment gets a new order and its hosted page. */
async function expectRetried(caller: AppCaller, enrollmentId: string): Promise<void> {
  const answer = await retryOf(caller, enrollmentId);
  expect(answer.checkoutUrl).toMatch(/^https?:\/\//);
}

async function enrollmentsFor(direction: Direction) {
  const found = await surfaceFor(direction);
  const [own, other] = await Promise.all([
    found.surface.pendingEnrollment(direction.requester),
    found.surface.pendingEnrollment(direction.other),
  ]);
  return { ...found, own, other };
}

const retry: ProcedureAttacks = {
  path: 'checkout.retry',
  holds: 'R-GENDER-2, R-GENDER-4, R-GENDER-5, FR-356, M3',
  attacks: {
    async directCall(direction) {
      const { caller, own, other } = await enrollmentsFor(direction);
      await expectRetried(caller, own.enrollmentId);
      await expectRetryHidden(caller, other.enrollmentId);
    },

    async forgedId(direction) {
      const { caller, own, other } = await enrollmentsFor(direction);
      await expectRetryHidden(caller, other.enrollmentId);
      await expectRetryHidden(caller, other.holdId);
      await expectRetryHidden(caller, own.holdId);
      await expectRetried(caller, own.enrollmentId);
    },

    async guessedId(direction) {
      const { caller, other } = await enrollmentsFor(direction);
      await expectRetryHidden(caller, randomUUID());
      await expectRetryHidden(caller, neighbourOf(other.enrollmentId));
      await expectRetryHidden(caller, other.enrollmentId.toUpperCase());
    },

    async tamperedToken(direction) {
      const { surface, own } = await enrollmentsFor(direction);
      const mine = surface.student(direction.requester);
      const theirs = surface.student(direction.other);
      for (const token of tamperedTokens(direction, mine.accessToken, theirs.sessionId)) {
        const tampered = await surface.bearing(token);
        await expectUnauthenticated(() => retryOf(tampered, own.enrollmentId));
      }
    },

    async clientSuppliedGender(direction) {
      const { caller, own, other } = await enrollmentsFor(direction);
      const withGender = (enrollmentId: string) =>
        caller.checkout.retry({
          enrollmentId,
          idempotencyKey: key(),
          gender: direction.other,
        } as CheckoutRetryInput);
      await expectAnswersAsNonexistent(
        () => withGender(other.enrollmentId),
        () => withGender(randomUUID()),
      );
      const answer = await withGender(own.enrollmentId);
      expect(answer.checkoutUrl).toMatch(/^https?:\/\//);
    },
  },
};

/** The requester's hold on a visible teacher's package: the hold and the summary Pay sends back. */
async function heldBy(caller: AppCaller, teacher: SeededTeacher | undefined) {
  const packageId = teacher?.packageIds[0];
  if (teacher === undefined || packageId === undefined) throw new Error('no visible package');
  const held = await holdOf(caller, packageId, teacher.slotId);
  const { summary } = held;
  return {
    holdId: held.holdId,
    quoted: {
      price_piasters: summary.price_piasters,
      sessionCount: summary.sessionCount,
      sessionDurationMinutes: summary.sessionDurationMinutes,
      track: summary.track,
    },
  };
}

type Quoted = Awaited<ReturnType<typeof heldBy>>['quoted'];

const payOf = (caller: AppCaller, holdId: string, quoted: Quoted) =>
  caller.checkout.pay({ holdId, quoted, idempotencyKey: key() });

/** Pay answers as on a hold that never existed. */
function expectPayHidden(caller: AppCaller, holdId: string, quoted: Quoted): Promise<void> {
  return expectAnswersAsNonexistent(
    () => payOf(caller, holdId, quoted),
    () => payOf(caller, randomUUID(), quoted),
  );
}

/** Each student holds a visible teacher of their own gender: the requester's and the other's. */
async function holdsFor(direction: Direction) {
  const found = await surfaceFor(direction);
  const other = found.surface.student(direction.other);
  const otherVisible = found.excluded.filter(
    ({ gender, state }) => gender === direction.other && state === 'plainName',
  );
  const [own, theirs] = await Promise.all([
    heldBy(found.caller, found.visible[0]),
    heldBy(other.caller, otherVisible[0]),
  ]);
  return { ...found, own, theirs };
}

const pay: ProcedureAttacks = {
  path: 'checkout.pay',
  holds: 'R-GENDER-2, R-GENDER-4, R-GENDER-5, FR-354, M3',
  attacks: {
    async directCall(direction) {
      const { caller, own, theirs } = await holdsFor(direction);
      const answer = await payOf(caller, own.holdId, own.quoted);
      expect(answer.checkoutUrl).toMatch(/^https?:\/\//);
      await expectPayHidden(caller, theirs.holdId, theirs.quoted);
    },

    async forgedId(direction) {
      const { caller, own, theirs } = await holdsFor(direction);
      await expectPayHidden(caller, theirs.holdId, theirs.quoted);
      await expectPayHidden(caller, theirs.holdId, own.quoted);
      const answer = await payOf(caller, own.holdId, own.quoted);
      await expectPayHidden(caller, answer.enrollmentId, own.quoted);
    },

    async guessedId(direction) {
      const { caller, own, theirs } = await holdsFor(direction);
      await expectPayHidden(caller, randomUUID(), own.quoted);
      await expectPayHidden(caller, neighbourOf(theirs.holdId), own.quoted);
      await expectPayHidden(caller, theirs.holdId.toUpperCase(), own.quoted);
    },

    async tamperedToken(direction) {
      const { surface, own } = await holdsFor(direction);
      const mine = surface.student(direction.requester);
      const theirs = surface.student(direction.other);
      for (const token of tamperedTokens(direction, mine.accessToken, theirs.sessionId)) {
        const tampered = await surface.bearing(token);
        await expectUnauthenticated(() => payOf(tampered, own.holdId, own.quoted));
      }
    },

    async clientSuppliedGender(direction) {
      const { caller, own, theirs } = await holdsFor(direction);
      const withGender = (holdId: string, quoted: Quoted) =>
        caller.checkout.pay({
          holdId,
          quoted,
          idempotencyKey: key(),
          gender: direction.other,
        } as CheckoutPayInput);
      await expectAnswersAsNonexistent(
        () => withGender(theirs.holdId, theirs.quoted),
        () => withGender(randomUUID(), theirs.quoted),
      );
      const answer = await withGender(own.holdId, own.quoted);
      expect(answer.checkoutUrl).toMatch(/^https?:\/\//);
    },
  },
};

/** T037: each student holds a visible teacher of their own gender and pays: the two enrollments. */
async function paidFor(direction: Direction) {
  const found = await holdsFor(direction);
  const other = found.surface.student(direction.other);
  const [own, theirs] = await Promise.all([
    payOf(found.caller, found.own.holdId, found.own.quoted),
    payOf(other.caller, found.theirs.holdId, found.theirs.quoted),
  ]);
  return { ...found, ownEnrollment: own.enrollmentId, theirEnrollment: theirs.enrollmentId };
}

const SESSION_ONLY = 'takes no id: it answers the session’s own hold, and no input names one';

const current: ProcedureAttacks = {
  path: 'checkout.current',
  holds: 'R-GENDER-2, R-GENDER-4, R-GENDER-5, FR-BOOK-12 (c)',
  attacks: {
    async directCall(direction) {
      const { caller, visible } = await holdsFor(direction);
      const answer = await caller.checkout.current({});
      expect(answer.hold?.summary.teacher.teacherId).toBe(visible[0]?.id);
    },
    forgedId: notApplicable(SESSION_ONLY),
    guessedId: notApplicable(SESSION_ONLY),
    async tamperedToken(direction) {
      const { surface } = await surfaceFor(direction);
      const mine = surface.student(direction.requester);
      const theirs = surface.student(direction.other);
      for (const token of tamperedTokens(direction, mine.accessToken, theirs.sessionId)) {
        const tampered = await surface.bearing(token);
        await expectUnauthenticated(() => tampered.checkout.current({}));
      }
    },
    async clientSuppliedGender(direction) {
      const { caller, visible } = await holdsFor(direction);
      // The input is strictly empty: a gender sent is refused, and never reaches the service.
      await expect(
        caller.checkout.current({ gender: direction.other } as unknown as Record<string, never>),
      ).rejects.toThrow();
      const answer = await caller.checkout.current({});
      expect(answer.hold?.summary.teacher.teacherId).toBe(visible[0]?.id);
    },
  },
};

/** An enrollment answers as one that never existed, through `call`. */
function expectEnrollmentHidden(
  call: (enrollmentId: string) => Promise<unknown>,
  enrollmentId: string,
): Promise<void> {
  return expectAnswersAsNonexistent(
    () => call(enrollmentId),
    () => call(randomUUID()),
  );
}

/** `continue` and `status` take the student's own enrollment: one registration each, one shape. */
function enrollmentRead(
  path: 'checkout.continue' | 'checkout.status',
  read: (caller: AppCaller, input: { enrollmentId: string }) => Promise<unknown>,
  expectOwn: (answer: unknown) => void,
): ProcedureAttacks {
  return {
    path,
    holds: 'R-GENDER-2, R-GENDER-4, R-GENDER-5, M3, data-model §2.4.1',
    attacks: {
      async directCall(direction) {
        const { caller, ownEnrollment, theirEnrollment } = await paidFor(direction);
        expectOwn(await read(caller, { enrollmentId: ownEnrollment }));
        await expectEnrollmentHidden((id) => read(caller, { enrollmentId: id }), theirEnrollment);
      },
      async forgedId(direction) {
        const { caller, theirEnrollment, theirs, own } = await paidFor(direction);
        for (const forged of [theirEnrollment, theirs.holdId, own.holdId]) {
          await expectEnrollmentHidden((id) => read(caller, { enrollmentId: id }), forged);
        }
      },
      async guessedId(direction) {
        const { caller, theirEnrollment } = await paidFor(direction);
        for (const guessed of [
          randomUUID(),
          neighbourOf(theirEnrollment),
          theirEnrollment.toUpperCase(),
        ]) {
          await expectEnrollmentHidden((id) => read(caller, { enrollmentId: id }), guessed);
        }
      },
      async tamperedToken(direction) {
        const { surface, ownEnrollment } = await paidFor(direction);
        const mine = surface.student(direction.requester);
        const theirs = surface.student(direction.other);
        for (const token of tamperedTokens(direction, mine.accessToken, theirs.sessionId)) {
          const tampered = await surface.bearing(token);
          await expectUnauthenticated(() => read(tampered, { enrollmentId: ownEnrollment }));
        }
      },
      async clientSuppliedGender(direction) {
        const { caller, ownEnrollment, theirEnrollment } = await paidFor(direction);
        const withGender = (enrollmentId: string) =>
          read(caller, { enrollmentId, gender: direction.other } as { enrollmentId: string });
        await expectEnrollmentHidden(withGender, theirEnrollment);
        expectOwn(await withGender(ownEnrollment));
      },
    },
  };
}

const continueOrder = enrollmentRead(
  'checkout.continue',
  (caller, input) => caller.checkout.continue(input),
  (answer) => expect((answer as { checkoutUrl: string }).checkoutUrl).toMatch(/^https?:\/\//),
);

const status = enrollmentRead(
  'checkout.status',
  (caller, input) => caller.checkout.status(input),
  (answer) => expect((answer as { status: string }).status).toBe('pending_payment'),
);

/**
 * The `checkout` namespace's registrations (T036, T037), Pay and the reads after Retry: their
 * enrollments hold the slots they paid on.
 */
export const checkoutAttacks: readonly ProcedureAttacks[] = [
  hold,
  retry,
  pay,
  current,
  continueOrder,
  status,
];
