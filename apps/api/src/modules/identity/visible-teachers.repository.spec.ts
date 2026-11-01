// T010 — the visibility predicate against Postgres (SRS §3.7.1 as amended 2026-10-31, `002:T143`;
// research R-201, R-203, R-204; FR-330, FR-333).
//
// A teacher is visible to a requester on a student-facing path when all five hold: the same gender,
// an approved application, a live account, a verified payout account, and an account that is
// neither suspended nor banned. Booking asks one thing more, an active account, so a teacher whose
// account is verification-required stays visible but cannot be booked. Every case runs in both
// directions: a male requester against male and female teachers, and a female requester against
// both (PR #109's review round 3). One case per conjunct breaks that conjunct alone, so a predicate
// that drops any one of them fails here.
//
// The page is ordered by rating (no review last), review count, name, then id, and cut by a keyset
// whose NULL branch is written out (R-204): three cases hold the three ways it can go wrong. The
// name prefix is folded on both sides by the kernel's query, and a typed `%` or `_` matches only
// itself. `isBookablePair`, for the confirm job that has no request, reads the student's gender and
// standing itself and applies the same `book` clause.
//
// NOTHING IS LEFT BEHIND: every case runs inside one Prisma interactive transaction that always ends
// by throwing, so its rows roll back, as in `tests/db-integrity/encrypted-columns.spec.ts`.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, describe, expect, it } from 'vitest';

import { idsWithFoldedNamePrefix } from '../../platform/db/folded-name.js';
import { closeDatabase, type Transaction } from '../../platform/db/prisma.repository.js';
import type { RequesterGender } from '../../platform/guards/requester-gender.js';

import { openSpecDatabase } from './__fixtures__/identity.js';
import {
  createPerson,
  createTeacher,
  type SpecAccountStatus,
  type SpecGender,
  type SpecTeacher,
  type SpecVerificationStatus,
} from './__fixtures__/visible-teachers-rows.repository.js';
import {
  isBookablePair,
  type TeacherPageCursor,
  type VisibilityPurpose,
  type VisibleTeacher,
  visibleTeacherPage,
  visibleTeachers,
} from './visible-teachers.repository.js';

const database = openSpecDatabase();
afterAll(() => closeDatabase(database));

const ROLLBACK = new Error('rolled back on purpose: the spec leaves no row behind');

async function inRollback(spec: (tx: Transaction) => Promise<void>): Promise<void> {
  try {
    await database.$transaction(
      async (tx) => {
        await spec(tx);
        throw ROLLBACK;
      },
      { timeout: 30_000 },
    );
  } catch (error: unknown) {
    if (error !== ROLLBACK) throw error;
  }
}

/**
 * The same, on the client without the soft-delete extension (T148), which leaves a deleted row out
 * of every ordinary read by itself: there the deletion conjuncts are seen to hold on their own.
 */
async function inUnfilteredRollback(spec: (tx: Transaction) => Promise<void>): Promise<void> {
  try {
    await database.includeDeleted.$transaction(
      async (raw) => {
        // The unextended client's transaction has the delegates the repository reads.
        await spec(raw as unknown as Transaction);
        throw ROLLBACK;
      },
      { timeout: 30_000 },
    );
  } catch (error: unknown) {
    if (error !== ROLLBACK) throw error;
  }
}

// A spec file may mint the requester's gender; the request context is the only other place (T138).
const requesterOf = (gender: SpecGender) => gender as RequesterGender;
const otherOf = (gender: SpecGender): SpecGender => (gender === 'male' ? 'female' : 'male');

const DIRECTIONS: readonly { readonly name: string; readonly own: SpecGender }[] = [
  { name: 'a male requester', own: 'male' },
  { name: 'a female requester', own: 'female' },
];

const PURPOSES: readonly VisibilityPurpose[] = ['discover', 'book'];

/**
 * One teacher per case, written relative to the requester, each breaking one conjunct of the
 * predicate or none; the purposes it is visible for, written from SRS §3.7.1 by hand.
 */
interface StandingCase {
  readonly name: string;
  readonly teacher: (own: SpecGender) => SpecTeacher;
  readonly visibleFor: readonly VisibilityPurpose[];
}

const NOT_APPROVED: readonly SpecVerificationStatus[] = [
  'pending',
  'rejected',
  'suspended',
  'banned',
  'revoked',
];

const STANDING_CASES: readonly StandingCase[] = [
  {
    name: 'every conjunct holds: visible and bookable',
    teacher: (own) => ({ gender: own }),
    visibleFor: ['discover', 'book'],
  },
  {
    name: 'the gender conjunct: a teacher of the other gender',
    teacher: (own) => ({ gender: otherOf(own) }),
    visibleFor: [],
  },
  ...NOT_APPROVED.map((status): StandingCase => ({
    name: `the approval conjunct: verification_status ${status}`,
    teacher: (own) => ({ gender: own, verificationStatus: status }),
    visibleFor: [],
  })),
  {
    name: 'the deletion conjunct: a deleted teacher',
    teacher: (own) => ({ gender: own, deleted: true }),
    visibleFor: [],
  },
  {
    name: 'the payout conjunct: no verified payout account',
    teacher: (own) => ({ gender: own, payoutVerified: false }),
    visibleFor: [],
  },
  {
    name: 'the standing conjunct: a suspended account (002:T143)',
    teacher: (own) => ({ gender: own, accountStatus: 'suspended' }),
    visibleFor: [],
  },
  {
    name: 'the standing conjunct: a banned account (002:T143)',
    teacher: (own) => ({ gender: own, accountStatus: 'banned' }),
    visibleFor: [],
  },
  {
    name: "booking's conjunct: a verification-required account is visible but not bookable (002:T143)",
    teacher: (own) => ({ gender: own, accountStatus: 'verification_required' }),
    visibleFor: ['discover'],
  },
];

describe.each(DIRECTIONS)('visibleTeachers, $name (T010)', ({ own }) => {
  it.each(STANDING_CASES)('$name', async ({ teacher, visibleFor }) => {
    await inRollback(async (tx) => {
      const id = await createTeacher(tx, teacher(own));
      for (const purpose of PURPOSES) {
        const rows = await visibleTeachers(tx, requesterOf(own), { purpose, teacherIds: [id] });
        expect(
          rows.map((row) => row.id),
          purpose,
        ).toEqual(visibleFor.includes(purpose) ? [id] : []);
      }
    });
  });

  it("answers the visible teacher's public fields, and nothing for an id that is not a teacher", async () => {
    await inRollback(async (tx) => {
      const id = await createTeacher(tx, {
        gender: own,
        displayName: 'الشيخ محمود',
        averageRating: '4.50',
        reviewCount: 12,
      });
      const student = await createPerson(tx, { gender: own });
      const rows = await visibleTeachers(tx, requesterOf(own), {
        purpose: 'discover',
        teacherIds: [id, student],
      });
      expect(rows).toEqual([
        {
          id,
          displayName: 'الشيخ محمود',
          gender: own,
          photoKey: null,
          bio: 'Spec bio',
          qualificationSummary: 'Spec qualification',
          averageRating: '4.5',
          reviewCount: 12,
        },
      ]);
    });
  });

  it('answers nothing for no ids, without a query', async () => {
    await inRollback(async (tx) => {
      expect(
        await visibleTeachers(tx, requesterOf(own), { purpose: 'discover', teacherIds: [] }),
      ).toEqual([]);
    });
  });
});

/** Every page of `candidateIds`, `limit` rows each, each cut after the last row of the one before. */
async function allPages(
  tx: Transaction,
  own: SpecGender,
  candidateIds: readonly string[],
  limit: number,
  options: { readonly namePrefix?: string; readonly minRating?: number } = {},
): Promise<VisibleTeacher[][]> {
  const pages: VisibleTeacher[][] = [];
  let after: TeacherPageCursor | undefined;
  for (;;) {
    const page = await visibleTeacherPage(tx, requesterOf(own), {
      candidateIds,
      limit,
      ...options,
      ...(after === undefined ? {} : { after }),
    });
    if (page.length === 0) return pages;
    pages.push(page);
    after = page.at(-1);
    if (page.length < limit) return pages;
  }
}

const ids = (pages: readonly (readonly VisibleTeacher[])[]) => pages.flat().map((row) => row.id);

describe.each(DIRECTIONS)('visibleTeacherPage, $name (T010, R-204)', ({ own }) => {
  it('orders by rating, then review count, then name, then id; a teacher with no review comes after every rated one', async () => {
    await inRollback(async (tx) => {
      const unrated = await createTeacher(tx, { gender: own, displayName: 'أ', reviewCount: 0 });
      const low = await createTeacher(tx, {
        gender: own,
        displayName: 'ب',
        averageRating: '1.00',
        reviewCount: 1,
      });
      const highFew = await createTeacher(tx, {
        gender: own,
        displayName: 'ت',
        averageRating: '4.90',
        reviewCount: 3,
      });
      const highMany = await createTeacher(tx, {
        gender: own,
        displayName: 'ث',
        averageRating: '4.90',
        reviewCount: 40,
      });
      const highManyEarlierName = await createTeacher(tx, {
        gender: own,
        displayName: 'ا',
        averageRating: '4.90',
        reviewCount: 40,
      });
      const candidates = [unrated, low, highFew, highMany, highManyEarlierName];
      const order = [highManyEarlierName, highMany, highFew, low, unrated];
      const [page] = await allPages(tx, own, candidates, 10);
      expect(page?.map((row) => row.id)).toEqual(order);
      // Every page size puts a boundary between each two neighbours, rated to unrated included.
      for (let limit = 1; limit < candidates.length; limit += 1) {
        expect(ids(await allPages(tx, own, candidates, limit)), `limit ${limit}`).toEqual(order);
      }
    });
  });

  it('two teachers of one name, rating and count on either side of a page boundary each appear exactly once', async () => {
    await inRollback(async (tx) => {
      const twin = { gender: own, displayName: 'أحمد علي', averageRating: '4.00', reviewCount: 7 };
      const first = await createTeacher(tx, twin);
      const second = await createTeacher(tx, twin);
      const before = await createTeacher(tx, { ...twin, averageRating: '5.00' });
      const candidates = [first, second, before];
      const pages = await allPages(tx, own, candidates, 2);
      expect(pages.map((page) => page.length)).toEqual([2, 1]);
      expect(ids(pages)).toEqual([before, ...[first, second].sort()]);
      expect(ids(await allPages(tx, own, candidates, 1))).toEqual(ids(pages));
    });
  });

  it('a page whose last row is a teacher with no review is followed by a page that repeats and skips no one', async () => {
    await inRollback(async (tx) => {
      const rated = await createTeacher(tx, {
        gender: own,
        displayName: 'ي',
        averageRating: '3.00',
        reviewCount: 2,
      });
      const unratedA = await createTeacher(tx, { gender: own, displayName: 'ب' });
      const unratedB = await createTeacher(tx, { gender: own, displayName: 'ج' });
      const unratedC = await createTeacher(tx, { gender: own, displayName: 'ج' });
      const unratedD = await createTeacher(tx, { gender: own, displayName: 'د' });
      const candidates = [rated, unratedA, unratedB, unratedC, unratedD];
      const pages = await allPages(tx, own, candidates, 2);
      const order = [rated, unratedA, ...[unratedB, unratedC].sort(), unratedD];
      expect(pages[0]?.at(-1)?.averageRating).toBeNull();
      expect(ids(pages)).toEqual(order);
      expect(new Set(ids(pages)).size).toBe(candidates.length);
      // A page of one cuts after each unrated row in turn, the two of one name included.
      expect(ids(await allPages(tx, own, candidates, 1))).toEqual(order);
    });
  });

  it('pages only the candidates the predicate admits, each excluded state left out', async () => {
    await inRollback(async (tx) => {
      const visible = await createTeacher(tx, { gender: own });
      const restrictedIds: string[] = [];
      for (const { teacher, visibleFor } of STANDING_CASES) {
        if (visibleFor.includes('discover')) continue;
        restrictedIds.push(await createTeacher(tx, teacher(own)));
      }
      const verificationRequired = await createTeacher(tx, {
        gender: own,
        accountStatus: 'verification_required',
      });
      const outsideCandidates = await createTeacher(tx, { gender: own });
      const pages = await allPages(tx, own, [visible, verificationRequired, ...restrictedIds], 50);
      expect(ids(pages).sort()).toEqual([visible, verificationRequired].sort());
      expect(ids(pages)).not.toContain(outsideCandidates);
    });
  });

  it('keeps only teachers rated at least the minimum; a teacher with no review is left out', async () => {
    await inRollback(async (tx) => {
      const four = await createTeacher(tx, { gender: own, averageRating: '4.00', reviewCount: 1 });
      const three = await createTeacher(tx, { gender: own, averageRating: '3.99', reviewCount: 1 });
      const unrated = await createTeacher(tx, { gender: own });
      const pages = await allPages(tx, own, [four, three, unrated], 10, { minRating: 4 });
      expect(ids(pages)).toEqual([four]);
    });
  });

  it('matches a name prefix after the same fold on both sides, and never a hidden teacher of that name (SC-314)', async () => {
    await inRollback(async (tx) => {
      const ahmad = await createTeacher(tx, { gender: own, displayName: 'أحمد إبراهيم' });
      const fatima = await createTeacher(tx, { gender: own, displayName: 'فاطمة' });
      const other = await createTeacher(tx, { gender: otherOf(own), displayName: 'أحمد سالم' });
      const suspended = await createTeacher(tx, {
        gender: own,
        displayName: 'احمد يوسف',
        accountStatus: 'suspended',
      });
      const candidates = [ahmad, fatima, other, suspended];
      for (const typed of ['احمد', 'أحمد', 'اَحْمـد', 'إحمد', 'آحمد']) {
        expect(ids(await allPages(tx, own, candidates, 10, { namePrefix: typed })), typed).toEqual([
          ahmad,
        ]);
      }
      expect(ids(await allPages(tx, own, candidates, 10, { namePrefix: 'فاطمه' }))).toEqual([
        fatima,
      ]);
      expect(ids(await allPages(tx, own, candidates, 10, { namePrefix: 'محمد' }))).toEqual([]);
    });
  });

  it('matches a typed % or _ only as itself, never as a wildcard (the owner’s decision of 2026-11-01)', async () => {
    await inRollback(async (tx) => {
      const percent = await createTeacher(tx, { gender: own, displayName: 'ab%cd' });
      const plain = await createTeacher(tx, { gender: own, displayName: 'abxcd' });
      const underscore = await createTeacher(tx, { gender: own, displayName: 'ab_cd' });
      const backslash = await createTeacher(tx, { gender: own, displayName: 'ab\\cd' });
      const candidates = [percent, plain, underscore, backslash];
      const match = async (typed: string) =>
        (await idsWithFoldedNamePrefix(tx, candidates, typed)).sort();
      expect(await match('ab%')).toEqual([percent]);
      expect(await match('ab_')).toEqual([underscore]);
      expect(await match('ab\\')).toEqual([backslash]);
      expect(await match('ab')).toEqual([...candidates].sort());
      expect(ids(await allPages(tx, own, candidates, 10, { namePrefix: 'ab%c' }))).toEqual([
        percent,
      ]);
    });
  });
});

describe.each(DIRECTIONS)(
  'the deletion conjuncts hold on their own, without the soft-delete extension, $name (T010)',
  ({ own }) => {
    it('a deleted teacher is neither visible nor on a page', async () => {
      await inUnfilteredRollback(async (tx) => {
        const deleted = await createTeacher(tx, { gender: own, deleted: true });
        for (const purpose of PURPOSES) {
          expect(
            await visibleTeachers(tx, requesterOf(own), { purpose, teacherIds: [deleted] }),
            purpose,
          ).toEqual([]);
        }
        expect(ids(await allPages(tx, own, [deleted], 10))).toEqual([]);
      });
    });

    it('a student who deleted the account books no one', async () => {
      await inUnfilteredRollback(async (tx) => {
        const student = await createPerson(tx, { gender: own, deleted: true });
        const teacherId = await createTeacher(tx, { gender: own });
        expect(await isBookablePair(tx, student, teacherId)).toBe(false);
      });
    });
  },
);

describe.each(DIRECTIONS)('isBookablePair, $name (T010)', ({ own }) => {
  it.each(STANDING_CASES)('the teacher: $name', async ({ teacher, visibleFor }) => {
    await inRollback(async (tx) => {
      const student = await createPerson(tx, { gender: own });
      const teacherId = await createTeacher(tx, teacher(own));
      expect(await isBookablePair(tx, student, teacherId)).toBe(visibleFor.includes('book'));
    });
  });

  it.each<SpecAccountStatus>(['suspended', 'banned', 'verification_required'])(
    'a student whose account is %s books no one',
    async (accountStatus) => {
      await inRollback(async (tx) => {
        const student = await createPerson(tx, { gender: own, accountStatus });
        const teacherId = await createTeacher(tx, { gender: own });
        expect(await isBookablePair(tx, student, teacherId)).toBe(false);
      });
    },
  );

  it('a student who deleted the account books no one (PR #109 round 4, follow-up 2)', async () => {
    await inRollback(async (tx) => {
      const student = await createPerson(tx, { gender: own, deleted: true });
      const teacherId = await createTeacher(tx, { gender: own });
      expect(await isBookablePair(tx, student, teacherId)).toBe(false);
    });
  });

  it('an id that is no person books no one', async () => {
    await inRollback(async (tx) => {
      const teacherId = await createTeacher(tx, { gender: own });
      expect(await isBookablePair(tx, '0199d0a0-0000-7000-8000-00000000dead', teacherId)).toBe(
        false,
      );
    });
  });
});
