// T011 of specs/005-certification (research R-408, «`Pairings`»; the note under T011, Q-R5 (a)) —
// the bodies of moderation's `Pairings` port over the real tables as the application role, read
// through the entries `main.ts` binds them from: sessions' `partyOfSession` and booking's
// `partyOfEnrollment` and `paired`.
//
// - A party of a session or an enrollment, the student or the teacher, gets its enrollment and the
//   other party; anyone else, an unknown id and a soft-deleted row get null (R-GENDER-2's one shape).
// - `paired` answers whether an enrollment of any status joins the two, in either order; a
//   soft-deleted one does not count (ADR 0006).
// - No answer compares genders (Q-R5 (a)): a pair whose declared genders now differ still answers.
//
// Every world is written and read on one transaction that is rolled back. Observed red first against
// the stub bodies (null and false), and against the named mutants (lane A's `mutants\`).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { paired, partyOfEnrollment } from '../../apps/api/src/modules/booking/index';
import { partyOfSession } from '../../apps/api/src/modules/sessions/index';
import type { Database } from '../../apps/api/src/platform/db/prisma.repository';
import { closeDatabase, openSpecDatabase, rolledBack, worldOn } from './report-world';

let database: Database;

beforeAll(() => {
  database = openSpecDatabase();
});

afterAll(async () => {
  await closeDatabase(database);
});

describe('Pairings.partyOfSession (sessions entry)', () => {
  it('answers the student the enrollment and the teacher', async () => {
    await rolledBack(database, async (tx) => {
      const pair = await worldOn(tx).pair();
      expect(await partyOfSession(tx, pair.sessionId, pair.studentId)).toEqual({
        enrollmentId: pair.enrollmentId,
        counterpartUserId: pair.teacherId,
      });
    });
  });

  it('answers the teacher the enrollment and the student', async () => {
    await rolledBack(database, async (tx) => {
      const pair = await worldOn(tx).pair();
      expect(await partyOfSession(tx, pair.sessionId, pair.teacherId)).toEqual({
        enrollmentId: pair.enrollmentId,
        counterpartUserId: pair.studentId,
      });
    });
  });

  it('answers null to a stranger, for an unknown session and for a soft-deleted one', async () => {
    await rolledBack(database, async (tx) => {
      const world = worldOn(tx);
      const pair = await world.pair();
      const stranger = await world.person();
      expect(await partyOfSession(tx, pair.sessionId, stranger)).toBeNull();
      expect(await partyOfSession(tx, randomUUID(), pair.studentId)).toBeNull();
      await tx.session.update({ where: { id: pair.sessionId }, data: { deletedAt: new Date() } });
      expect(await partyOfSession(tx, pair.sessionId, pair.studentId)).toBeNull();
    });
  });

  it('compares parties, not genders: a corrected party still answers (Q-R5 (a))', async () => {
    await rolledBack(database, async (tx) => {
      const pair = await worldOn(tx).pair('male');
      await tx.user.update({ where: { id: pair.teacherId }, data: { gender: 'female' } });
      expect(await partyOfSession(tx, pair.sessionId, pair.studentId)).toEqual({
        enrollmentId: pair.enrollmentId,
        counterpartUserId: pair.teacherId,
      });
    });
  });
});

describe('Pairings.partyOfEnrollment (booking entry)', () => {
  it('answers each party the enrollment and the other party, whatever its status', async () => {
    await rolledBack(database, async (tx) => {
      const pair = await worldOn(tx).pair('female', 'pending_payment');
      expect(await partyOfEnrollment(tx, pair.enrollmentId, pair.studentId)).toEqual({
        enrollmentId: pair.enrollmentId,
        counterpartUserId: pair.teacherId,
      });
      expect(await partyOfEnrollment(tx, pair.enrollmentId, pair.teacherId)).toEqual({
        enrollmentId: pair.enrollmentId,
        counterpartUserId: pair.studentId,
      });
    });
  });

  it('answers null to a stranger, for an unknown enrollment and for a soft-deleted one', async () => {
    await rolledBack(database, async (tx) => {
      const world = worldOn(tx);
      const pair = await world.pair();
      const stranger = await world.person();
      expect(await partyOfEnrollment(tx, pair.enrollmentId, stranger)).toBeNull();
      expect(await partyOfEnrollment(tx, randomUUID(), pair.studentId)).toBeNull();
      await tx.enrollment.update({
        where: { id: pair.enrollmentId },
        data: { deletedAt: new Date() },
      });
      expect(await partyOfEnrollment(tx, pair.enrollmentId, pair.studentId)).toBeNull();
    });
  });
});

describe('Pairings.paired (booking entry)', () => {
  it('answers true for the two parties of an enrollment of any status, in either order', async () => {
    await rolledBack(database, async (tx) => {
      const confirmed = await worldOn(tx).pair('male', 'confirmed');
      const pending = await worldOn(tx).pair('female', 'pending_payment');
      for (const pair of [confirmed, pending]) {
        expect(await paired(tx, pair.studentId, pair.teacherId)).toBe(true);
        expect(await paired(tx, pair.teacherId, pair.studentId)).toBe(true);
      }
    });
  });

  it('answers false for two people no enrollment joins, a shared teacher not enough', async () => {
    await rolledBack(database, async (tx) => {
      const world = worldOn(tx);
      const pair = await world.pair();
      const otherStudent = await world.person();
      await world.enrollment(pair, otherStudent);
      const stranger = await world.person();
      expect(await paired(tx, pair.studentId, otherStudent)).toBe(false);
      expect(await paired(tx, otherStudent, pair.studentId)).toBe(false);
      expect(await paired(tx, pair.teacherId, stranger)).toBe(false);
    });
  });

  it('does not count a soft-deleted enrollment (ADR 0006)', async () => {
    await rolledBack(database, async (tx) => {
      const pair = await worldOn(tx).pair();
      await tx.enrollment.update({
        where: { id: pair.enrollmentId },
        data: { deletedAt: new Date() },
      });
      expect(await paired(tx, pair.studentId, pair.teacherId)).toBe(false);
    });
  });
});
