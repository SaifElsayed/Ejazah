// T043 — the checkout's refusals and the purchase record, through the real user surface, in both
// directions (FR-410, FR-303, FR-353, SC-304; R-GENDER-2, R-GENDER-5; SRS §3.7.1, `002:T143`; the
// owner's decision of 2026-11-03 in the note under T043).
//
// The seven procedures of `booking` and `checkout` are registered with T011's harness
// (`booking.attacks.ts`, `checkout.attacks.ts`). What their five attacks do not reach is here, each
// case once as a male requester against female teachers and once as a female requester against male
// teachers, in the world of `discovery-world.ts`:
//
//   - one teacher's package with another teacher's slot, of the own gender and of the other, answers
//     exactly as a package that never existed, and writes nothing: the rows the checkout writes are
//     read back equal, the student's own hold included, which a new checkout releases first in the
//     same transaction (FR-353, FR-BOOK-12);
//   - a `verification_required` teacher's slot is refused at hold: `NOT_BOOKABLE` for the own
//     gender's teacher, who stays visible (FR-VERIFY-10), and as a nonexistent package for the other
//     gender's, with nothing written; the same teacher made active again is held (FR-303, T143);
//   - `checkout.status` keeps the teacher's name for the student who bought, read from the
//     enrollment, never through discovery's predicate: after the teacher's suspension the answer is
//     unchanged while the teacher answers no one on `booking.slots`; after the teacher deletes the
//     account the answer carries what the deletion leaves, the teacher's id and no name (FR-141
//     erases `display_name`); the other gender's student is answered as for an enrollment that never
//     existed throughout (M3).
//
// «A teacher suspended between hold and pay» lands with T041's subscriber (the note under T043).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { CheckoutStatusOutput } from '../../packages/contracts/src/index.js';
import { refusalOf, surfaceFor } from './discovery.attacks.js';
import type { AppCaller, SeededTeacher } from './discovery-world.js';
import { type Direction, directions, expectAnswersAsNonexistent } from './procedure-harness.js';

/** The first case of the file seeds the world (T028). */
const CASE_TIMEOUT_MS = 180_000;

function packageOf(teacher: SeededTeacher | undefined): string {
  const packageId = teacher?.packageIds[0];
  if (packageId === undefined) throw new Error('a world teacher without a package');
  return packageId;
}

const holdOf = (caller: AppCaller, packageId: string, slotId: string) =>
  caller.checkout.hold({ packageId, slotId, idempotencyKey: randomUUID() });

/** The hold answers as one on a package that never existed (R-GENDER-2, FR-353). */
function expectHoldHidden(caller: AppCaller, packageId: string, slotId: string): Promise<void> {
  return expectAnswersAsNonexistent(
    () => holdOf(caller, packageId, slotId),
    () => holdOf(caller, randomUUID(), slotId),
  );
}

/** The other gender's teacher no direction may see, in the world's visible state. */
function otherGendersVisible(excluded: readonly SeededTeacher[], direction: Direction) {
  const teacher = excluded.find(
    ({ gender, state }) => gender === direction.other && state === 'plainName',
  );
  if (teacher === undefined) throw new Error('no visible teacher of the other gender');
  return teacher;
}

/** The student holds the teacher's package and pays: the enrollment awaiting payment. */
async function boughtFrom(caller: AppCaller, teacher: SeededTeacher): Promise<string> {
  const held = await holdOf(caller, packageOf(teacher), teacher.slotId);
  const { summary } = held;
  const paid = await caller.checkout.pay({
    holdId: held.holdId,
    quoted: {
      price_piasters: summary.price_piasters,
      sessionCount: summary.sessionCount,
      sessionDurationMinutes: summary.sessionDurationMinutes,
      track: summary.track,
    },
    idempotencyKey: randomUUID(),
  });
  return paid.enrollmentId;
}

const statusOf = (caller: AppCaller, enrollmentId: string): Promise<CheckoutStatusOutput> =>
  caller.checkout.status({ enrollmentId });

/** The other gender's student meets the enrollment as one that never existed (M3). */
function expectStatusHidden(caller: AppCaller, enrollmentId: string): Promise<void> {
  return expectAnswersAsNonexistent(
    () => statusOf(caller, enrollmentId),
    () => statusOf(caller, randomUUID()),
  );
}

describe.each(directions)(
  'T043, $name',
  { tags: ['database'], timeout: CASE_TIMEOUT_MS },
  (direction) => {
    it("one teacher's package with another teacher's slot: NOT_FOUND, nothing written (FR-353)", async () => {
      const { surface, caller, visible, excluded } = await surfaceFor(direction);
      const [own, another] = visible;
      if (own === undefined || another === undefined) throw new Error('two visible teachers');
      const otherGender = otherGendersVisible(excluded, direction);
      const packageId = packageOf(own);
      const slots = [own.slotId, another.slotId, otherGender.slotId];
      try {
        // The student's own hold: a new checkout releases it first, inside the refused transaction.
        await holdOf(caller, packageId, own.slotId);
        const before = await surface.checkoutRows(direction.requester, slots);
        expect(before.holds.some((row) => row.includes(' active '))).toBe(true);
        await expectHoldHidden(caller, packageId, another.slotId);
        await expectHoldHidden(caller, packageId, otherGender.slotId);
        await expectHoldHidden(caller, packageOf(another), own.slotId);
        expect(await surface.checkoutRows(direction.requester, slots)).toStrictEqual(before);
      } finally {
        await surface.endHolds(direction.requester);
      }
    });

    it("a verification_required teacher's slot is refused at hold, nothing written (FR-303, T143)", async () => {
      const { surface, caller, visible } = await surfaceFor(direction);
      const [{ teacher: required }, { teacher: theirs }] = await Promise.all([
        surface.loneTeacher(direction.requester),
        surface.loneTeacher(direction.other),
      ]);
      await Promise.all([
        surface.setAccountStatus(required.id, 'verification_required'),
        surface.setAccountStatus(theirs.id, 'verification_required'),
      ]);
      const [control] = visible;
      if (control === undefined) throw new Error('no visible teacher');
      const slots = [required.slotId, theirs.slotId, control.slotId];
      try {
        await holdOf(caller, packageOf(control), control.slotId);
        const before = await surface.checkoutRows(direction.requester, slots);
        const refusal = await refusalOf(() => holdOf(caller, packageOf(required), required.slotId));
        expect({ status: refusal.status, body: refusal.body }).toStrictEqual({
          status: 409,
          body: { code: 'NOT_BOOKABLE', message: refusal.body.message },
        });
        await expectHoldHidden(caller, packageOf(theirs), theirs.slotId);
        expect(await surface.checkoutRows(direction.requester, slots)).toStrictEqual(before);
        // The refusal was the standing: the same teacher, active again, is held.
        await surface.setAccountStatus(required.id, 'active');
        const held = await holdOf(caller, packageOf(required), required.slotId);
        expect(held.summary.teacher.teacherId).toBe(required.id);
      } finally {
        await surface.endHolds(direction.requester);
      }
    });

    it("checkout.status keeps the teacher's name for the buyer after the teacher's suspension", async () => {
      const { surface, caller } = await surfaceFor(direction);
      const other = surface.student(direction.other).caller;
      const { teacher } = await surface.loneTeacher(direction.requester);
      const enrollmentId = await boughtFrom(caller, teacher);
      const before = await statusOf(caller, enrollmentId);
      expect(before.summary.teacher).toStrictEqual({
        teacherId: teacher.id,
        displayName: teacher.displayName,
      });
      await expectStatusHidden(other, enrollmentId);

      await surface.setAccountStatus(teacher.id, 'suspended');
      // Discovery's predicate hides the teacher now; the purchase record does not go through it.
      await expectAnswersAsNonexistent(
        () => caller.booking.slots({ packageId: packageOf(teacher) }),
        () => caller.booking.slots({ packageId: randomUUID() }),
      );
      expect(await statusOf(caller, enrollmentId)).toStrictEqual(before);
      await expectStatusHidden(other, enrollmentId);
    });

    it('checkout.status shows what the deletion leaves after the teacher deletes the account', async () => {
      const { surface, caller } = await surfaceFor(direction);
      const other = surface.student(direction.other).caller;
      const { teacher } = await surface.loneTeacher(direction.requester);
      const enrollmentId = await boughtFrom(caller, teacher);
      const before = await statusOf(caller, enrollmentId);
      expect(before.summary.teacher.displayName).toBe(teacher.displayName);

      await surface.deleteAccount(teacher.id);
      // FR-141 erases the display name; the enrollment keeps the teacher's id and everything else.
      expect(await statusOf(caller, enrollmentId)).toStrictEqual({
        ...before,
        summary: { ...before.summary, teacher: { teacherId: teacher.id, displayName: '' } },
      });
      await expectStatusHidden(other, enrollmentId);
    });
  },
);
