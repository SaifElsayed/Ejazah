// T014 of specs/005-certification (FR-616, FR-617, FR-618; SRS FR-GENDER-4, FR-GENDER-5; research
// R-409) — identity's administrators-only setter of `users.gender` over the real table as the
// application role, read through identity's entry:
//
// - `declaredGenderOf` answers a live person's declared gender, null for none or a deleted one;
// - `setDeclaredGender` writes `to` only while the row still holds `from` (one conditional update),
//   both directions; a row holding another value, a deleted person and an unknown id are left as
//   they are, answering false.
//
// Every world is written on one transaction that is rolled back. Observed red first against the stub
// repository and under the named mutant «the setter not conditional on `from`» (lane D's `mutants\`).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { declaredGenderOf, setDeclaredGender } from '../../apps/api/src/modules/identity/index';
import type { Database } from '../../apps/api/src/platform/db/prisma.repository';
import { closeDatabase, openSpecDatabase, rolledBack, worldOn } from './report-world';

let database: Database;

beforeAll(() => {
  database = openSpecDatabase();
});

afterAll(async () => {
  await closeDatabase(database);
});

const MISSING = '0199d0a0-0000-7000-8000-00000000dead';

describe('declaredGenderOf', () => {
  it('answers a live person’s declared gender, null for none and for a deleted one', async () => {
    await rolledBack(database, async (tx) => {
      const world = worldOn(tx);
      const man = await world.person('male');
      const woman = await world.person('female');
      expect(await declaredGenderOf(tx, man)).toBe('male');
      expect(await declaredGenderOf(tx, woman)).toBe('female');
      expect(await declaredGenderOf(tx, MISSING)).toBeNull();
      await tx.user.update({ where: { id: man }, data: { deletedAt: new Date() } });
      expect(await declaredGenderOf(tx, man)).toBeNull();
    });
  });
});

describe('setDeclaredGender', () => {
  it.each([
    ['male', 'female'],
    ['female', 'male'],
  ] as const)('writes %s → %s while the row holds the first', async (from, to) => {
    await rolledBack(database, async (tx) => {
      const person = await worldOn(tx).person(from);
      expect(await setDeclaredGender(tx, person, from, to)).toBe(true);
      expect(await declaredGenderOf(tx, person)).toBe(to);
    });
  });

  it('leaves a row holding another value as it is', async () => {
    await rolledBack(database, async (tx) => {
      const person = await worldOn(tx).person('female');
      expect(await setDeclaredGender(tx, person, 'male', 'female')).toBe(false);
      expect(await setDeclaredGender(tx, person, 'male', 'male')).toBe(false);
      expect(await declaredGenderOf(tx, person)).toBe('female');
    });
  });

  it('leaves a deleted person and an unknown id as they are', async () => {
    await rolledBack(database, async (tx) => {
      const person = await worldOn(tx).person('male');
      await tx.user.update({ where: { id: person }, data: { deletedAt: new Date() } });
      expect(await setDeclaredGender(tx, person, 'male', 'female')).toBe(false);
      expect(await setDeclaredGender(tx, MISSING, 'male', 'female')).toBe(false);
      const row = await tx.user.findFirst({
        where: { id: person },
        select: { gender: true },
      });
      expect(row).toBeNull();
    });
  });
});
