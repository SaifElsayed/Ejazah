// T014 of specs/005-certification (Q-G4 (a); SC-604; R-402) — certification's read and write behind
// `rerenderOfParty` over the real `ijazahs` table as the application role, through certification's
// entry (`partyRerenderStore`):
//
// - a person's ijazahs, as teacher and as student, not signed off and not revoked, in id order;
//   another person's, a signed-off one and a revoked one left out;
// - under the locks, each still unsigned and unrevoked has its generation raised by one and its
//   rendering cleared; a signed-off one handed in is left as it is (SC-604).
//
// Every world is written on one transaction that is rolled back. Observed red first against the
// stub repository and under the named mutants «the signed-off filter dropped» (lane D's `mutants\`).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { partyRerenderStore } from '../../apps/api/src/modules/certification/index';
import type { Database, Transaction } from '../../apps/api/src/platform/db/prisma.repository';
import { closeDatabase, openSpecDatabase, rolledBack, worldOn } from './report-world';

let database: Database;

beforeAll(() => {
  database = openSpecDatabase();
});

afterAll(async () => {
  await closeDatabase(database);
});

const RENDERED = new Date('2026-11-10T08:00:00Z');

type State = 'unsigned' | 'rendered' | 'signed' | 'revoked';

/** An ijazah of the pair's enrollment in `state`, generation 0. */
async function ijazah(
  tx: Transaction,
  pair: Awaited<ReturnType<ReturnType<typeof worldOn>['pair']>>,
  state: State,
  admin: string,
): Promise<string> {
  const { id } = await tx.ijazah.create({
    data: {
      certificateNumber: `PROBE-${randomUUID()}`,
      enrollmentId: pair.enrollmentId,
      studentUserId: pair.studentId,
      teacherUserId: pair.teacherId,
      subjectId: pair.subjectId,
      mode: 'generated',
      language: 'ar',
      certificateStorageKey: `certificates/${randomUUID()}.pdf`,
      paperCopyIntended: false,
      verificationTokenHash: randomUUID(),
      grantedAt: RENDERED,
      studentNamePrinted: 'طالب',
      teacherNamePrinted: 'معلم',
      riwayaPrinted: 'حفص عن عاصم',
      ...(state === 'unsigned' ? {} : { renderedAt: RENDERED }),
      ...(state === 'signed' ? { signedOffAt: RENDERED, signedOffByAdminId: admin } : {}),
      ...(state === 'revoked'
        ? { revokedAt: RENDERED, revokedReason: 'خطأ', revokedByAdminId: admin }
        : {}),
    },
    select: { id: true },
  });
  return id;
}

describe('unsignedOfParty', () => {
  it('answers the person’s unsigned, unrevoked ijazahs as teacher and as student, in id order', async () => {
    await rolledBack(database, async (tx) => {
      const world = worldOn(tx);
      const admin = await world.admin();
      const pair = await world.pair();
      const asStudent = await world.pair();
      const theirs = await world.pair();
      const unsigned = await ijazah(tx, pair, 'unsigned', admin);
      const rendered = await ijazah(tx, pair, 'rendered', admin);
      await ijazah(tx, pair, 'signed', admin);
      await ijazah(tx, pair, 'revoked', admin);
      await ijazah(tx, theirs, 'unsigned', admin);
      expect(await partyRerenderStore.unsignedOfParty(tx, pair.teacherId)).toEqual(
        [unsigned, rendered].sort(),
      );
      expect(await partyRerenderStore.unsignedOfParty(tx, pair.studentId)).toEqual(
        [unsigned, rendered].sort(),
      );
      const ofStudent = await ijazah(tx, asStudent, 'rendered', admin);
      expect(await partyRerenderStore.unsignedOfParty(tx, asStudent.studentId)).toEqual([
        ofStudent,
      ]);
    });
  });
});

describe('rerender', () => {
  it('raises each unsigned one’s generation and clears its rendering; a signed-off one is left', async () => {
    await rolledBack(database, async (tx) => {
      const world = worldOn(tx);
      const admin = await world.admin();
      const pair = await world.pair();
      const rendered = await ijazah(tx, pair, 'rendered', admin);
      const signed = await ijazah(tx, pair, 'signed', admin);
      await partyRerenderStore.lockIjazahs(tx, [rendered, signed].sort());
      expect(await partyRerenderStore.rerender(tx, [rendered, signed].sort())).toEqual([
        { id: rendered, generation: 1 },
      ]);
      const rows = await tx.ijazah.findMany({
        where: { id: { in: [rendered, signed] } },
        select: { id: true, renderGeneration: true, renderedAt: true, signedOffAt: true },
      });
      expect(rows.find(({ id }) => id === rendered)).toMatchObject({
        renderGeneration: 1,
        renderedAt: null,
      });
      expect(rows.find(({ id }) => id === signed)).toMatchObject({
        renderGeneration: 0,
        renderedAt: RENDERED,
        signedOffAt: RENDERED,
      });
    });
  });
});
