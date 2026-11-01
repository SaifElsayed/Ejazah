// T010 — the adversarial cases of `002:T143`, at the repository (SRS §3.7.1 as amended 2026-10-31;
// FR-303, FR-330; R-GENDER-1, R-GENDER-5).
//
// The predicate checked gender, approval, deletion and the payout account, and not the account's
// standing, so a suspended or banned teacher stayed visible. `002:T143` sets two conditions, and
// each is attacked here in both directions, a male requester and a female requester, each against
// teachers of the own gender and of the other:
//
//   1. a suspended or a banned teacher is invisible: absent from the visible set for discovery and
//      for booking, from a discovery page, from anything serialized, and not bookable;
//   2. a verification-required teacher stays visible (FR-VERIFY-10 restricts new bookings, not the
//      account's existence) but is not bookable: present for discovery and on a page, absent for
//      booking, and `isBookablePair` answers false.
//
// A control teacher, active and of the own gender, is present and bookable in every case, so a
// case cannot pass on an empty answer. These cases call identity's public entry against Postgres;
// they do not depend on the procedure harness (`tests/adversarial/procedure-harness.ts`, R-202),
// which attacks the procedures built on the same entry.
//
// NOTHING IS LEFT BEHIND: every case runs inside one Prisma interactive transaction that always ends
// by throwing, so its rows roll back, as in `tests/db-integrity/encrypted-columns.spec.ts`.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';

import {
  isBookablePair,
  visibleTeacherPage,
  visibleTeachers,
} from '../../apps/api/src/modules/identity/index.js';
import {
  closeDatabase,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import {
  specDatabaseUrl,
  whenDatabaseSpecs,
} from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import type { RequesterGender } from '../../apps/api/src/platform/guards/requester-gender.js';

const database = whenDatabaseSpecs(() =>
  openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 2,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 30_000,
  }),
);
afterAll(() => closeDatabase(database));

const ROLLBACK = new Error('rolled back on purpose: the case leaves no row behind');

async function inRollback(attack: (tx: Transaction) => Promise<void>): Promise<void> {
  try {
    await database.$transaction(
      async (tx) => {
        await attack(tx);
        throw ROLLBACK;
      },
      { timeout: 30_000 },
    );
  } catch (error: unknown) {
    if (error !== ROLLBACK) throw error;
  }
}

type Gender = 'male' | 'female';
type AccountStatus = 'active' | 'suspended' | 'verification_required' | 'banned';

/** A person of `gender` at `accountStatus`, and when `teacher`, an approved, payable profile. */
async function person(
  tx: Transaction,
  gender: Gender,
  accountStatus: AccountStatus,
  teacher: boolean,
): Promise<string> {
  const { id } = await tx.user.create({
    data: {
      email: `adversarial-${randomUUID()}@example.invalid`,
      gender,
      dateOfBirth: new Date('1990-04-12'),
      displayName: 'محمد عبدالله',
      preferredLanguage: 'ar',
      timezone: 'Africa/Cairo',
      accountStatus,
    },
    select: { id: true },
  });
  if (teacher) {
    await tx.teacherProfile.create({
      data: {
        userId: id,
        bio: '',
        qualificationSummary: '',
        verificationStatus: 'approved',
        payoutVerifiedAt: new Date('2026-10-20T09:00:00Z'),
      },
    });
  }
  return id;
}

const DIRECTIONS: readonly {
  readonly name: string;
  readonly own: Gender;
  readonly other: Gender;
}[] = [
  { name: 'a male requester', own: 'male', other: 'female' },
  { name: 'a female requester', own: 'female', other: 'male' },
];

/** Everything the requester can learn of `teacherIds` through identity's entry. */
async function seenBy(tx: Transaction, own: Gender, teacherIds: readonly string[]) {
  // A spec file may mint the requester's gender; the request context is the only other place.
  const requester = own as RequesterGender;
  const student = await person(tx, own, 'active', false);
  const discover = await visibleTeachers(tx, requester, { purpose: 'discover', teacherIds });
  const book = await visibleTeachers(tx, requester, { purpose: 'book', teacherIds });
  const page = await visibleTeacherPage(tx, requester, {
    candidateIds: teacherIds,
    namePrefix: 'محمد',
    limit: 50,
  });
  const bookable: string[] = [];
  for (const teacherId of teacherIds) {
    if (await isBookablePair(tx, student, teacherId)) bookable.push(teacherId);
  }
  return {
    discover: discover.map(({ id }) => id).sort(),
    book: book.map(({ id }) => id).sort(),
    page: page.map(({ id }) => id).sort(),
    bookable: bookable.sort(),
    serialized: JSON.stringify({ discover, book, page }),
  };
}

describe.each(DIRECTIONS)(
  '002:T143 condition 1, $name: a suspended or banned teacher is invisible',
  ({ own, other }) => {
    it.each<AccountStatus>(['suspended', 'banned'])(
      'a %s teacher of either gender is in no answer, and is not bookable',
      async (standing) => {
        await inRollback(async (tx) => {
          const control = await person(tx, own, 'active', true);
          const restrictedOwn = await person(tx, own, standing, true);
          const restrictedOther = await person(tx, other, standing, true);
          const seen = await seenBy(tx, own, [control, restrictedOwn, restrictedOther]);
          expect(seen.discover).toEqual([control]);
          expect(seen.book).toEqual([control]);
          expect(seen.page).toEqual([control]);
          expect(seen.bookable).toEqual([control]);
          expect(seen.serialized).not.toContain(restrictedOwn);
          expect(seen.serialized).not.toContain(restrictedOther);
        });
      },
    );
  },
);

describe.each(DIRECTIONS)(
  '002:T143 condition 2, $name: a verification-required teacher is visible, not bookable',
  ({ own, other }) => {
    it('of the own gender: on discovery and on a page, never for booking', async () => {
      await inRollback(async (tx) => {
        const control = await person(tx, own, 'active', true);
        const required = await person(tx, own, 'verification_required', true);
        const seen = await seenBy(tx, own, [control, required]);
        expect(seen.discover).toEqual([control, required].sort());
        expect(seen.page).toEqual([control, required].sort());
        expect(seen.book).toEqual([control]);
        expect(seen.bookable).toEqual([control]);
      });
    });

    it('of the other gender: in no answer at all', async () => {
      await inRollback(async (tx) => {
        const control = await person(tx, own, 'active', true);
        const required = await person(tx, other, 'verification_required', true);
        const active = await person(tx, other, 'active', true);
        const seen = await seenBy(tx, own, [control, required, active]);
        expect(seen.discover).toEqual([control]);
        expect(seen.page).toEqual([control]);
        expect(seen.book).toEqual([control]);
        expect(seen.bookable).toEqual([control]);
        expect(seen.serialized).not.toContain(required);
        expect(seen.serialized).not.toContain(active);
      });
    });
  },
);
