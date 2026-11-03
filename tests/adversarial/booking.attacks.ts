// T032 — `booking.slots`' attacks, registered with T011's harness as its router lands (FR-410,
// SC-304; FR-350; R-GENDER-1, R-GENDER-2, R-GENDER-4, R-GENDER-5). The cases the five attacks do not
// reach (a foreign slot, a verification-required teacher at hold) are T043's, in
// `checkout-standing.spec.ts`; a suspension between hold and pay lands with T041's subscriber.
//
// The procedure is called through the real user surface and the real booking services
// (`discovery-world.ts`), once per direction: a male requester against female teachers and a female
// requester against male teachers, each also against the own gender's teachers in every excluded
// state. What every attack holds: a package of a teacher the requester may not book answers exactly
// as a package that never existed (404, `NOT_FOUND`, no field), and a visible teacher's package
// answers that teacher's slot, so no attack passes on an empty answer.
//
//   directCall            every package of every teacher of the world, as the phone sends it.
//   forgedId              the other gender's packages, visible ones included, and a visible
//                         teacher's slot id sent as a package id.
//   guessedId             ids never handed out: random ones, an excluded package id's neighbour and
//                         its upper-case spelling.
//   tamperedToken         the requester's genuine bearer token with its signature or its session
//                         changed: refused as unauthenticated before any service is reached.
//   clientSuppliedGender  the input carrying the other gender: ignored, the answer the session's.
import { randomUUID } from 'node:crypto';

import { expect } from 'vitest';

import type { BookingSlotsInput } from '../../packages/contracts/src/index.js';
import {
  expectUnauthenticated,
  neighbourOf,
  surfaceFor,
  tamperedTokens,
} from './discovery.attacks.js';
import type { AppCaller, SeededTeacher } from './discovery-world.js';
import { expectAnswersAsNonexistent, type ProcedureAttacks } from './procedure-harness.js';

const CAIRO = 'Africa/Cairo';

/** The package answers as one that never existed. */
function expectHidden(caller: AppCaller, packageId: string): Promise<void> {
  return expectAnswersAsNonexistent(
    () => caller.booking.slots({ packageId }),
    () => caller.booking.slots({ packageId: randomUUID() }),
  );
}

/** A visible teacher's package answers the teacher's slot, in the slot's zone. */
async function expectOffered(caller: AppCaller, teacher: SeededTeacher, packageId: string) {
  const answer = await caller.booking.slots({ packageId });
  expect(answer.teacherTimezone).toBe(CAIRO);
  expect(answer.slots.map(({ slotId }) => slotId)).toEqual([teacher.slotId]);
}

const slots: ProcedureAttacks = {
  path: 'booking.slots',
  holds: 'R-GENDER-1, R-GENDER-2, R-GENDER-4, R-GENDER-5, FR-350',
  attacks: {
    async directCall(direction) {
      const { caller, visible, excluded } = await surfaceFor(direction);
      expect(visible.length).toBeGreaterThan(0);
      for (const teacher of visible) {
        for (const packageId of teacher.packageIds) {
          await expectOffered(caller, teacher, packageId);
        }
      }
      for (const teacher of excluded) {
        for (const packageId of teacher.packageIds) await expectHidden(caller, packageId);
      }
    },

    async forgedId(direction) {
      const { caller, visible, excluded } = await surfaceFor(direction);
      // The other gender's visible teachers are the forged ids that matter most (R-GENDER-2).
      const forged = excluded.filter(({ gender }) => gender === direction.other);
      expect(forged.length).toBeGreaterThan(visible.length);
      for (const teacher of forged) {
        for (const packageId of teacher.packageIds) await expectHidden(caller, packageId);
      }
      for (const teacher of visible) await expectHidden(caller, teacher.slotId);
    },

    async guessedId(direction) {
      const { caller, excluded } = await surfaceFor(direction);
      await expectHidden(caller, randomUUID());
      for (const teacher of excluded) {
        const [packageId] = teacher.packageIds;
        if (packageId === undefined) throw new Error('a world teacher without a package');
        await expectHidden(caller, neighbourOf(packageId));
        await expectHidden(caller, packageId.toUpperCase());
      }
    },

    async tamperedToken(direction) {
      const { surface, visible } = await surfaceFor(direction);
      const own = surface.student(direction.requester);
      const other = surface.student(direction.other);
      const packageId = visible[0]?.packageIds[0];
      if (packageId === undefined) throw new Error('no visible package');
      for (const token of tamperedTokens(direction, own.accessToken, other.sessionId)) {
        const tampered = await surface.bearing(token);
        await expectUnauthenticated(() => tampered.booking.slots({ packageId }));
      }
    },

    async clientSuppliedGender(direction) {
      const { caller, visible, excluded } = await surfaceFor(direction);
      for (const teacher of excluded.filter(({ gender }) => gender === direction.other)) {
        for (const packageId of teacher.packageIds) {
          const input = { packageId, gender: direction.other } as BookingSlotsInput;
          await expectAnswersAsNonexistent(
            () => caller.booking.slots(input),
            () => caller.booking.slots({ packageId: randomUUID() }),
          );
        }
      }
      for (const teacher of visible) {
        const [packageId] = teacher.packageIds;
        if (packageId === undefined) throw new Error('a world teacher without a package');
        const input = { packageId, gender: direction.other } as BookingSlotsInput;
        const answer = await caller.booking.slots(input);
        expect(answer.slots.map(({ slotId }) => slotId)).toEqual([teacher.slotId]);
      }
    },
  },
};

/** The `booking` namespace's registrations (T032; T043 adds the checkout's). */
export const bookingAttacks: readonly ProcedureAttacks[] = [slots];
