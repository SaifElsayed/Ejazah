// T025 — catalog's discovery service over the real tables (research R-204 as amended 2026-11-01,
// analysis C2; FR-332 to FR-335, FR-338; specs/003-booking/contracts/app-surface.md "`discovery`").
//
// Catalog computes the candidate ids its own tables allow (an active package, its subject and its
// track, an approved credential's riwaya) and hands them, with the name prefix, the minimum rating
// and the cursor, to identity's `visibleTeacherPage`, which applies the predicate, orders and cuts
// the page; catalog then builds the cards of the page it gets back and writes no order of its own
// on identity's columns. What is probed: each card's fields; the subject tabs' counts, on the first
// page only, over the same candidate set the cards use and after the predicate (R-GENDER-3); each
// filter; the riwaya values of `discovery.filters`, folded for matching and shown as typed; paging
// through the opaque cursor at every page size, ties and unrated teachers included (T010's three
// paging cases), and the page size read from `discovery_page_size`; the matched length of a folded
// name; a teacher the predicate excludes never present, in both directions. The adversarial cases
// are T028's (`tests/adversarial/`).
//
// Other specs commit teachers to this database, so every case writes subjects of its own and
// browses inside them, and the tab of all subjects is read as a difference: the case's transaction
// is REPEATABLE READ, so what others commit meanwhile never moves its count.
//
// NOTHING IS LEFT BEHIND: every case runs inside one Prisma interactive transaction that always ends
// by throwing, so its rows roll back, as in `tests/db-integrity/catalog-use.spec.ts`.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { afterAll, describe, expect, it } from 'vitest';

import {
  createDiscoveryCatalog,
  type DiscoveryCatalog,
} from '../../apps/api/src/modules/catalog/index.js';
import { visibleTeacherPage } from '../../apps/api/src/modules/identity/index.js';
import {
  closeDatabase,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import {
  specDatabaseUrl,
  whenDatabaseSpecs,
} from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import { DomainError } from '../../apps/api/src/platform/errors/domain-error.js';
import type { RequesterGender } from '../../apps/api/src/platform/guards/requester-gender.js';
import { SettingError } from '../../apps/api/src/platform/settings/settings-reader.js';
import type {
  DiscoveryBrowseInput,
  DiscoveryBrowseOutput,
  DiscoveryCursor,
} from '../../packages/contracts/src/index.js';

const database = whenDatabaseSpecs(() =>
  openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 2,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  }),
);
afterAll(() => closeDatabase(database));

const ROLLBACK = new Error('rolled back on purpose: the case leaves no row behind');

async function inRollback(probe: (tx: Transaction) => Promise<void>): Promise<void> {
  try {
    await database.$transaction(
      async (tx) => {
        await probe(tx);
        throw ROLLBACK;
      },
      { timeout: 60_000, isolationLevel: 'RepeatableRead' },
    );
  } catch (error: unknown) {
    if (error !== ROLLBACK) throw error;
  }
}

type Gender = 'male' | 'female';
type AccountStatus = 'active' | 'suspended' | 'verification_required' | 'banned';
type VerificationStatus = 'pending' | 'approved' | 'rejected' | 'suspended' | 'banned' | 'revoked';

// A spec file may mint the requester's gender; the request context is the only other place (T138).
const requesterOf = (gender: Gender) => gender as RequesterGender;
const otherOf = (gender: Gender): Gender => (gender === 'male' ? 'female' : 'male');

const DIRECTIONS: readonly { readonly name: string; readonly own: Gender }[] = [
  { name: 'a male requester', own: 'male' },
  { name: 'a female requester', own: 'female' },
];

/**
 * The discovery service over a settings reader holding `discovery_page_size` only, and a storage
 * port no card reaches: the profile's photo is `discovery-teacher.spec.ts`'s (T027).
 */
function catalogWithPageSize(size: number): DiscoveryCatalog {
  return createDiscoveryCatalog(
    {
      async read(key, schema) {
        // 006:T004 (rule d): the programme's switch off, as seeded, so no programme package shows.
        if (key === 'programme_enabled') return schema.parse(0);
        if (key !== 'discovery_page_size') throw new SettingError(key, 'missing');
        return schema.parse(size);
      },
    },
    { temporaryLink: async () => Promise.reject(new Error('no photo link in these cases')) },
  );
}

const catalog = catalogWithPageSize(20);

interface TeacherValues {
  readonly gender: Gender;
  readonly displayName?: string;
  readonly bio?: string;
  readonly accountStatus?: AccountStatus;
  readonly verificationStatus?: VerificationStatus;
  readonly payoutVerified?: boolean;
  readonly deleted?: boolean;
  /** `numeric(3,2)` as text; null for no review. */
  readonly averageRating?: string | null;
  readonly reviewCount?: number;
}

/** A teacher, visible to a requester of the same gender unless a field says otherwise. */
async function teacher(tx: Transaction, values: TeacherValues): Promise<string> {
  const { id } = await tx.user.create({
    data: {
      email: `discovery-${randomUUID()}@example.invalid`,
      gender: values.gender,
      dateOfBirth: new Date('1985-03-01'),
      displayName: values.displayName ?? 'معلم',
      preferredLanguage: 'ar',
      timezone: 'Africa/Cairo',
      accountStatus: values.accountStatus ?? 'active',
      deletedAt: values.deleted === true ? new Date('2026-10-30T09:00:00Z') : null,
    },
    select: { id: true },
  });
  await tx.teacherProfile.create({
    data: {
      userId: id,
      bio: values.bio ?? 'نبذة',
      qualificationSummary: 'إجازة',
      verificationStatus: values.verificationStatus ?? 'approved',
      payoutVerifiedAt: values.payoutVerified === false ? null : new Date('2026-10-20T09:00:00Z'),
      averageRating: values.averageRating ?? null,
      reviewCount: values.reviewCount ?? 0,
    },
    select: { id: true },
  });
  return id;
}

interface SubjectRow {
  readonly id: string;
  readonly nameAr: string;
  readonly nameEn: string;
}

async function subject(tx: Transaction, isActive = true): Promise<SubjectRow> {
  const tag = randomUUID().slice(0, 8);
  return tx.subject.create({
    data: { nameAr: `مادة ${tag}`, nameEn: `Subject ${tag}`, isActive },
    select: { id: true, nameAr: true, nameEn: true },
  });
}

/** An active subject of the given names (T070's search by a subject's name). */
async function namedSubject(tx: Transaction, nameAr: string, nameEn: string): Promise<SubjectRow> {
  return tx.subject.create({
    data: { nameAr, nameEn, isActive: true },
    select: { id: true, nameAr: true, nameEn: true },
  });
}

/** Makes `subjects` the teacher's `teacher_subjects`, as a credential's approval does. */
async function grant(tx: Transaction, teacherId: string, subjects: readonly SubjectRow[]) {
  await tx.teacherSubject.createMany({
    data: subjects.map(({ id }) => ({ teacherUserId: teacherId, subjectId: id })),
  });
}

interface PackageValues {
  readonly track?: 'recitation' | 'ijazah_track';
  readonly sessionCount?: number;
  readonly price?: number;
  readonly isActive?: boolean;
}

async function offer(
  tx: Transaction,
  teacherId: string,
  on: SubjectRow,
  values: PackageValues = {},
): Promise<void> {
  await tx.package.create({
    data: {
      teacherUserId: teacherId,
      subjectId: on.id,
      track: values.track ?? 'recitation',
      sessionCount: values.sessionCount ?? 4,
      sessionDurationMinutes: 60,
      pricePiasters: BigInt(values.price ?? 100_000),
      isActive: values.isActive ?? true,
    },
    select: { id: true },
  });
}

/** A credential of the teacher on `on`, approved unless said, with its riwaya as transcribed. */
async function credential(
  tx: Transaction,
  teacherId: string,
  on: SubjectRow,
  riwaya: string,
  status: 'approved' | 'rejected' | 'pending' = 'approved',
): Promise<void> {
  const { id: adminId } = await tx.adminUser.create({
    data: {
      email: `discovery-${randomUUID()}@example.invalid`,
      mfaSecretEncrypted: Buffer.from('spec'),
      displayName: 'Spec administrator',
      isActive: true,
    },
    select: { id: true },
  });
  const { id: documentId } = await tx.verificationDocument.create({
    data: {
      userId: teacherId,
      documentType: 'credential',
      storageKeyEncrypted: Buffer.from('spec'),
    },
    select: { id: true },
  });
  const reviewed =
    status === 'pending'
      ? {}
      : {
          reviewedByAdminId: adminId,
          reviewedAt: new Date('2026-10-18T09:00:00Z'),
          reviewReason: status === 'approved' ? null : 'Spec reason',
        };
  await tx.teacherCredential.create({
    data: {
      teacherUserId: teacherId,
      subjectId: on.id,
      documentId,
      status,
      riwaya,
      submittedWithApplication: true,
      ...reviewed,
    },
    select: { id: true },
  });
}

/** Every page of `input`, following `nextCursor`, the pages as answered. */
async function allPages(
  tx: Transaction,
  service: DiscoveryCatalog,
  requester: RequesterGender,
  input: DiscoveryBrowseInput,
): Promise<DiscoveryBrowseOutput[]> {
  const pages: DiscoveryBrowseOutput[] = [];
  let cursor: DiscoveryCursor | undefined;
  do {
    const page = await service.browse(tx, requester, {
      ...input,
      ...(cursor === undefined ? {} : { cursor }),
    });
    pages.push(page);
    cursor = page.nextCursor;
    if (pages.length > 100) throw new Error('the pages never end');
  } while (cursor !== undefined);
  return pages;
}

const idsOf = (page: DiscoveryBrowseOutput) => page.cards.map(({ teacherId }) => teacherId);

describe('discovery.browse: the cards (T025, FR-335)', () => {
  it('carries the subjects, the tracks of active packages, the bio excerpt, the rating, the count and the lowest per session', async () => {
    await inRollback(async (tx) => {
      const [quran, tajweed] = [await subject(tx), await subject(tx)];
      const bio = 'أدرّس حفظ القرآن\nوأجيز بالسند المتصل';
      const id = await teacher(tx, {
        gender: 'female',
        displayName: 'فاطمة',
        bio,
        averageRating: '4.50',
        reviewCount: 12,
      });
      await grant(tx, id, [quran, tajweed]);
      // 100000 / 3 = 33333 a session; 100000 / 4 = 25000; 120000 / 4 = 30000; the inactive
      // 10000 / 10 = 1000 is no offer. The lowest is neither the first written nor the last.
      await offer(tx, id, tajweed, { track: 'ijazah_track', sessionCount: 3, price: 100_000 });
      await offer(tx, id, quran, { track: 'recitation', sessionCount: 4, price: 100_000 });
      await offer(tx, id, quran, { track: 'recitation', sessionCount: 4, price: 120_000 });
      await offer(tx, id, quran, { sessionCount: 10, price: 10_000, isActive: false });

      const { cards } = await catalog.browse(tx, requesterOf('female'), { subjectId: quran.id });

      expect(cards).toHaveLength(1);
      const [card] = cards;
      expect(card).toEqual({
        teacherId: id,
        displayName: 'فاطمة',
        subjects: [quran, tajweed],
        tracks: ['recitation', 'ijazah_track'],
        bioExcerpt: 'أدرّس حفظ القرآن',
        rating: 4.5,
        reviewCount: 12,
        lowestPerSession_piasters: 25_000,
      });
    });
  });

  it('leaves the rating out for a teacher with no review, and keeps a short bio whole', async () => {
    await inRollback(async (tx) => {
      const quran = await subject(tx);
      const id = await teacher(tx, { gender: 'male', bio: 'أدرّس التجويد', averageRating: null });
      await grant(tx, id, [quran]);
      await offer(tx, id, quran);

      const { cards } = await catalog.browse(tx, requesterOf('male'), { subjectId: quran.id });

      expect(cards).toHaveLength(1);
      expect(cards[0]?.rating).toBeUndefined();
      expect(cards[0]?.reviewCount).toBe(0);
      expect(cards[0]?.bioExcerpt).toBe('أدرّس التجويد');
    });
  });

  it('shows a teacher only with an active package: one whose packages are all inactive is no candidate', async () => {
    await inRollback(async (tx) => {
      const quran = await subject(tx);
      const offering = await teacher(tx, { gender: 'male' });
      const inactive = await teacher(tx, { gender: 'male' });
      await grant(tx, offering, [quran]);
      await grant(tx, inactive, [quran]);
      await offer(tx, offering, quran);
      await offer(tx, inactive, quran, { isActive: false });

      const page = await catalog.browse(tx, requesterOf('male'), { subjectId: quran.id });

      expect(idsOf(page)).toEqual([offering]);
    });
  });
});

describe('discovery.browse: the tabs (T025, FR-332, R-GENDER-3, PR #109 follow-up 1)', () => {
  for (const { name, own } of DIRECTIONS) {
    it(`counts each subject's visible teachers with an active package in it, and all of them, for ${name}`, async () => {
      await inRollback(async (tx) => {
        const requester = requesterOf(own);
        const before = await catalog.browse(tx, requester, {});
        const allBefore = before.tabs?.find(({ subjectId }) => subjectId === null)?.count ?? -1;

        const [quran, tajweed] = [await subject(tx), await subject(tx)];
        const both = await teacher(tx, { gender: own });
        const quranOnly = await teacher(tx, { gender: own });
        await offer(tx, both, quran);
        await offer(tx, both, tajweed, { track: 'ijazah_track' });
        await offer(tx, quranOnly, quran);
        // Each excluded state, with an active package in both subjects: counted nowhere.
        const excluded: TeacherValues[] = [
          { gender: otherOf(own) },
          { gender: own, verificationStatus: 'pending' },
          { gender: own, payoutVerified: false },
          { gender: own, deleted: true },
          { gender: own, accountStatus: 'suspended' },
          { gender: own, accountStatus: 'banned' },
        ];
        for (const values of excluded) {
          const id = await teacher(tx, values);
          await offer(tx, id, quran);
          await offer(tx, id, tajweed);
        }
        // A teacher with an inactive package only: no candidate, so no count.
        const idle = await teacher(tx, { gender: own });
        await offer(tx, idle, tajweed, { isActive: false });

        const page = await catalog.browse(tx, requester, { subjectId: quran.id });

        const tabs = page.tabs ?? [];
        expect(tabs[0]).toEqual({ subjectId: null, count: allBefore + 2 });
        const tabOf = ({ id, nameAr, nameEn }: SubjectRow, count: number) => ({
          subjectId: id,
          nameAr,
          nameEn,
          count,
        });
        expect(tabs).toContainEqual(tabOf(quran, 2));
        expect(tabs).toContainEqual(tabOf(tajweed, 1));
        // The counts match the cards each tab lists (SC-310).
        for (const tab of [quran, tajweed]) {
          const pages = await allPages(tx, catalog, requester, { subjectId: tab.id });
          const listed = pages.flatMap(idsOf);
          const count = tabs.find(({ subjectId }) => subjectId === tab.id)?.count;
          expect(listed).toHaveLength(count ?? -1);
        }
      });
    });
  }

  it('answers the tabs on the first page only, never with a cursor', async () => {
    await inRollback(async (tx) => {
      const quran = await subject(tx);
      for (const name of ['أ', 'ب']) {
        const id = await teacher(tx, { gender: 'male', displayName: name });
        await offer(tx, id, quran);
      }
      const pages = await allPages(tx, catalogWithPageSize(1), requesterOf('male'), {
        subjectId: quran.id,
      });
      expect(pages).toHaveLength(2);
      expect(pages[0]?.tabs).toBeDefined();
      expect(pages[1]?.tabs).toBeUndefined();
    });
  });

  it('lists a tab for every active subject, an inactive subject none', async () => {
    await inRollback(async (tx) => {
      const [shown, hidden] = [await subject(tx), await subject(tx, false)];
      const { tabs } = await catalog.browse(tx, requesterOf('female'), {});
      const ids = (tabs ?? []).map(({ subjectId }) => subjectId);
      expect(ids[0]).toBeNull();
      expect(ids).toContain(shown.id);
      expect(ids).not.toContain(hidden.id);
    });
  });
});

describe('discovery.browse: the filters (T025, FR-334)', () => {
  it('narrows by track, the package of the subject carrying it', async () => {
    await inRollback(async (tx) => {
      const [quran, tajweed] = [await subject(tx), await subject(tx)];
      const recites = await teacher(tx, { gender: 'male' });
      const grants = await teacher(tx, { gender: 'male' });
      const elsewhere = await teacher(tx, { gender: 'male' });
      await offer(tx, recites, quran, { track: 'recitation' });
      await offer(tx, grants, quran, { track: 'ijazah_track' });
      // The ijazah track in another subject only: not a quran ijazah-track teacher.
      await offer(tx, elsewhere, quran, { track: 'recitation' });
      await offer(tx, elsewhere, tajweed, { track: 'ijazah_track' });

      const ijazah = await catalog.browse(tx, requesterOf('male'), {
        subjectId: quran.id,
        track: 'ijazah_track',
      });
      const recitation = await catalog.browse(tx, requesterOf('male'), {
        subjectId: quran.id,
        track: 'recitation',
      });

      expect(idsOf(ijazah)).toEqual([grants]);
      expect(new Set(idsOf(recitation))).toEqual(new Set([recites, elsewhere]));
    });
  });

  it('narrows by minimum rating, a teacher with no review left out', async () => {
    await inRollback(async (tx) => {
      const quran = await subject(tx);
      const high = await teacher(tx, { gender: 'female', averageRating: '4.80', reviewCount: 5 });
      const middle = await teacher(tx, { gender: 'female', averageRating: '3.90', reviewCount: 5 });
      const none = await teacher(tx, { gender: 'female', averageRating: null });
      for (const id of [high, middle, none]) await offer(tx, id, quran);

      const atLeast = (minRating: number) =>
        catalog.browse(tx, requesterOf('female'), { subjectId: quran.id, minRating });

      expect(idsOf(await atLeast(4))).toEqual([high]);
      expect(idsOf(await atLeast(3))).toEqual([high, middle]);
      expect(idsOf(await atLeast(5))).toEqual([]);
    });
  });

  it('narrows by riwaya, folded on both sides, from approved credentials only', async () => {
    await inRollback(async (tx) => {
      const quran = await subject(tx);
      const hafs = await teacher(tx, { gender: 'male' });
      const warsh = await teacher(tx, { gender: 'male' });
      const rejected = await teacher(tx, { gender: 'male' });
      for (const id of [hafs, warsh, rejected]) await offer(tx, id, quran);
      await credential(tx, hafs, quran, 'حفص عن عاصم');
      await credential(tx, warsh, quran, 'ورش عن نافع');
      await credential(tx, rejected, quran, 'حفص عن عاصم', 'rejected');

      const page = await catalog.browse(tx, requesterOf('male'), {
        subjectId: quran.id,
        riwaya: 'حَفص عن عاصِم',
      });

      expect(idsOf(page)).toEqual([hafs]);
    });
  });

  it('combines the filters: each narrows the same candidate set', async () => {
    await inRollback(async (tx) => {
      const quran = await subject(tx);
      const fits = await teacher(tx, { gender: 'female', averageRating: '4.20', reviewCount: 3 });
      const lowRated = await teacher(tx, {
        gender: 'female',
        averageRating: '2.00',
        reviewCount: 3,
      });
      for (const id of [fits, lowRated]) {
        await offer(tx, id, quran, { track: 'ijazah_track' });
        await credential(tx, id, quran, 'قالون عن نافع');
      }

      const page = await catalog.browse(tx, requesterOf('female'), {
        subjectId: quran.id,
        track: 'ijazah_track',
        minRating: 4,
        riwaya: 'قالون عن نافع',
      });

      expect(idsOf(page)).toEqual([fits]);
    });
  });
});

describe('discovery.filters: the riwaya values (T025, FR-334, R-204)', () => {
  for (const { name, own } of DIRECTIONS) {
    it(`answers the distinct riwayas of approved credentials of visible teachers in the subject, folded once and shown as typed, for ${name}`, async () => {
      await inRollback(async (tx) => {
        const [quran, other] = [await subject(tx), await subject(tx)];
        const make = async (
          values: TeacherValues,
          riwaya: string,
          opts: { status?: 'approved' | 'rejected'; on?: SubjectRow; offered?: boolean } = {},
        ) => {
          const id = await teacher(tx, values);
          if (opts.offered !== false) await offer(tx, id, quran);
          await credential(tx, id, opts.on ?? quran, riwaya, opts.status ?? 'approved');
        };
        await make({ gender: own }, 'حفص عن عاصم');
        await make({ gender: own }, 'حَفص عن عاصِم');
        await make({ gender: own }, 'ورش عن نافع');
        await make({ gender: own }, 'قالون عن نافع', { status: 'rejected' });
        await make({ gender: otherOf(own) }, 'شعبة عن عاصم');
        await make({ gender: own, accountStatus: 'suspended' }, 'البزي عن ابن كثير');
        await make({ gender: own, payoutVerified: false }, 'قنبل عن ابن كثير');
        await make({ gender: own }, 'الدوري عن أبي عمرو', { on: other });
        await make({ gender: own }, 'السوسي عن أبي عمرو', { offered: false });

        const { riwayas } = await catalog.filters(tx, requesterOf(own), { subjectId: quran.id });

        expect(riwayas).toHaveLength(2);
        expect(riwayas).toContain('ورش عن نافع');
        expect(['حفص عن عاصم', 'حَفص عن عاصِم']).toContain(
          riwayas.find((value) => value !== 'ورش عن نافع'),
        );
      });
    });
  }

  it('answers none for a subject no visible teacher has a riwaya in', async () => {
    await inRollback(async (tx) => {
      const quran = await subject(tx);
      const id = await teacher(tx, { gender: 'male' });
      await offer(tx, id, quran);
      expect(await catalog.filters(tx, requesterOf('male'), { subjectId: quran.id })).toEqual({
        riwayas: [],
      });
    });
  });
});

describe('discovery.browse: the name search (T025, FR-333, R-203)', () => {
  it('matches a folded prefix and answers the matched length in the name as stored', async () => {
    await inRollback(async (tx) => {
      const quran = await subject(tx);
      const marked = await teacher(tx, { gender: 'male', displayName: 'مُحَمَّد علي' });
      const plain = await teacher(tx, { gender: 'male', displayName: 'محمود' });
      const hamza = await teacher(tx, { gender: 'male', displayName: 'أحمد' });
      const other = await teacher(tx, { gender: 'male', displayName: 'علي محمد' });
      for (const id of [marked, plain, hamza, other]) await offer(tx, id, quran);

      const search = (query: string) =>
        catalog.browse(tx, requesterOf('male'), { subjectId: quran.id, query });

      const mohammed = await search('محم');
      const byId = new Map(mohammed.cards.map((card) => [card.teacherId, card]));
      expect(new Set(byId.keys())).toEqual(new Set([marked, plain]));
      // 'مُحَمَّ' folds to 'محم': the marks of the last matched letter belong to the match.
      expect(byId.get(marked)?.match).toEqual({ length: 'مُحَمَّ'.length });
      expect(byId.get(plain)?.match).toEqual({ length: 3 });

      const ahmad = await search('احمد');
      expect(ahmad.cards.map(({ teacherId, match }) => ({ teacherId, match }))).toEqual([
        { teacherId: hamza, match: { length: 4 } },
      ]);
    });
  });

  it('marks no match on a browse with no query', async () => {
    await inRollback(async (tx) => {
      const quran = await subject(tx);
      const id = await teacher(tx, { gender: 'female', displayName: 'مريم' });
      await offer(tx, id, quran);
      const { cards } = await catalog.browse(tx, requesterOf('female'), { subjectId: quran.id });
      expect(cards[0]?.match).toBeUndefined();
    });
  });
});

// T070: FR-333's "match by subject". A subject matches when its Arabic or its English name, folded
// by the same `ijazah_fold`, begins with the folded query; a teacher matches by a name with the
// prefix or by an active package in a matched subject, and only then through the predicate. Every
// name carries a tag of its own, so what other specs commit never answers these searches.
describe('discovery.browse: the search by subject (T070, FR-333, R-203)', () => {
  const tagged = () => randomUUID().slice(0, 8);
  const pick = (page: DiscoveryBrowseOutput) =>
    page.cards.map(({ teacherId, match }) => ({ teacherId, match }));

  it('finds the teachers of a subject whose folded name begins with the query, in Arabic or in English, and marks no name', async () => {
    await inRollback(async (tx) => {
      const tag = tagged();
      const rules = await namedSubject(tx, `أَحكامُ التجويـد ${tag}`, `Tajweed rules ${tag}`);
      const elsewhere = await subject(tx);
      const salem = await teacher(tx, { gender: 'male', displayName: 'سالم', reviewCount: 2 });
      const yusuf = await teacher(tx, { gender: 'male', displayName: 'يوسف', reviewCount: 1 });
      const zaid = await teacher(tx, { gender: 'male', displayName: 'زيد' });
      await offer(tx, salem, rules);
      await offer(tx, yusuf, rules, { track: 'ijazah_track' });
      await offer(tx, zaid, elsewhere);
      const search = (input: DiscoveryBrowseInput) =>
        catalog.browse(tx, requesterOf('male'), input);
      const both = [
        { teacherId: salem, match: undefined },
        { teacherId: yusuf, match: undefined },
      ];

      for (const query of [
        `احكام التجويد ${tag}`,
        `أحكام التجويد ${tag}`,
        `اَحْكامُ التجويـد ${tag}`,
        `TAJWEED RULES ${tag}`,
        `tajweed rules ${tag}`,
      ]) {
        expect(pick(await search({ query })), query).toEqual(both);
      }
      // A short prefix inside the subject's own tab; a part of the name that does not begin it
      // matches nothing (a prefix, as the name's).
      expect(pick(await search({ subjectId: rules.id, query: 'احكام' }))).toEqual(both);
      expect(pick(await search({ subjectId: rules.id, query: 'التجويد' }))).toEqual([]);
      // The track narrows the subject's teachers as it narrows any browse.
      expect(pick(await search({ query: `tajweed rules ${tag}`, track: 'ijazah_track' }))).toEqual([
        { teacherId: yusuf, match: undefined },
      ]);
    });
  });

  it('drops the article «ال» from the subject and the query: «تجويد», «التجويد» and «تج» find «التجويد», the article or «ل» alone no subject', async () => {
    await inRollback(async (tx) => {
      const tag = tagged();
      const tajweed = await namedSubject(tx, `التجويد ${tag}`, `Tajweed ${tag}`);
      const salem = await teacher(tx, { gender: 'male', displayName: 'سالم' });
      await offer(tx, salem, tajweed);
      const inTab = (query: string) =>
        catalog.browse(tx, requesterOf('male'), { subjectId: tajweed.id, query });
      // Inside the subject's own tab, so the database's other subjects and teachers stay out.
      for (const query of ['تجويد', 'التجويد', 'تج', 'تَجْويد']) {
        expect(pick(await inTab(query)), query).toEqual([{ teacherId: salem, match: undefined }]);
      }
      // The owner's decision of 2026-11-02: a lone «ل», or the article alone, matches no subject.
      for (const query of ['ل', 'ال']) {
        expect(pick(await inTab(query)), query).toEqual([]);
      }
    });
  });

  it('a mixed search: a teacher whose name has the prefix or who teaches a subject that begins with it, the name marked', async () => {
    await inRollback(async (tx) => {
      const tag = `zq${tagged()}`;
      const named = await subject(tx);
      const studies = await namedSubject(tx, `مادة ${tag}`, `${tag} studies`);
      const byName = await teacher(tx, {
        gender: 'female',
        displayName: `${tag.toUpperCase()} Maryam`,
        reviewCount: 2,
      });
      const bySubject = await teacher(tx, { gender: 'female', displayName: 'هدى', reviewCount: 1 });
      const neither = await teacher(tx, { gender: 'female', displayName: `Maryam ${tag}` });
      await offer(tx, byName, named);
      await offer(tx, bySubject, studies);
      await offer(tx, neither, named);

      const { cards } = await catalog.browse(tx, requesterOf('female'), { query: tag });
      expect(cards.map(({ teacherId, match }) => ({ teacherId, match }))).toEqual([
        { teacherId: byName, match: { length: tag.length } },
        { teacherId: bySubject, match: undefined },
      ]);
    });
  });

  it('pages a search by subject through the cursor at every page size, each card once, in R-204’s order', async () => {
    await inRollback(async (tx) => {
      const tag = `zq${tagged()}`;
      const studies = await namedSubject(tx, `مادة ${tag}`, `${tag} studies`);
      const named = await subject(tx);
      const rows = [
        { name: 'ب', rating: '4.00', count: 2 },
        { name: 'ب', rating: '4.00', count: 2 },
        { name: 'ا', rating: '5.00', count: 1 },
        { name: 'ج', rating: null, count: 0 },
        { name: `${tag} ي`, rating: '4.00', count: 2 },
        { name: `${tag} ا`, rating: null, count: 0 },
      ];
      for (const row of rows) {
        const id = await teacher(tx, {
          gender: 'male',
          displayName: row.name,
          averageRating: row.rating,
          reviewCount: row.count,
        });
        await offer(tx, id, row.name.startsWith(tag) ? named : studies);
      }
      const whole = await catalogWithPageSize(rows.length + 1).browse(tx, requesterOf('male'), {
        query: tag,
      });
      expect(whole.cards).toHaveLength(rows.length);
      for (let size = 1; size <= rows.length; size += 1) {
        const pages = await allPages(tx, catalogWithPageSize(size), requesterOf('male'), {
          query: tag,
        });
        expect(pages.flatMap(idsOf), `page size ${size}`).toEqual(idsOf(whole));
        expect(pages.at(-1)?.nextCursor, `page size ${size}`).toBeUndefined();
      }
    });
  });

  for (const { name, own } of DIRECTIONS) {
    it(`never answers a hidden teacher of a matched subject, for ${name}`, async () => {
      await inRollback(async (tx) => {
        const tag = tagged();
        const rules = await namedSubject(tx, `أحكام ${tag}`, `Rules ${tag}`);
        const shown = await teacher(tx, { gender: own, displayName: 'أنس' });
        await offer(tx, shown, rules);
        const hidden: string[] = [];
        for (const values of [
          { gender: otherOf(own) },
          { gender: own, verificationStatus: 'pending' as const },
          { gender: own, verificationStatus: 'rejected' as const },
          { gender: own, payoutVerified: false },
          { gender: own, deleted: true },
          { gender: own, accountStatus: 'suspended' as const },
          { gender: own, accountStatus: 'banned' as const },
        ]) {
          const id = await teacher(tx, { ...values, displayName: 'بلال' });
          await offer(tx, id, rules);
          hidden.push(id);
        }

        const answers = await Promise.all(
          [`احكام ${tag}`, `RULES ${tag}`].map((query) =>
            allPages(tx, catalog, requesterOf(own), { query }),
          ),
        );
        for (const pages of answers) {
          expect(pages.flatMap(idsOf)).toEqual([shown]);
          const serialized = JSON.stringify(pages);
          for (const id of hidden) expect(serialized).not.toContain(id);
        }
        const tab = await catalog.browse(tx, requesterOf(own), {});
        expect(tab.tabs?.find(({ subjectId }) => subjectId === rules.id)?.count).toBe(1);
      });
    });
  }
});

describe("discovery.browse: paging (T025, R-204, T010's three paging cases)", () => {
  /** Rows written in no particular order, and the order R-204 puts them in. */
  const ROWS: readonly { key: string; rating: string | null; count: number; name: string }[] = [
    { key: 'unrated-b', rating: null, count: 0, name: 'ب' },
    { key: 'twin-2', rating: '4.00', count: 2, name: 'سمير' },
    { key: 'top', rating: '5.00', count: 3, name: 'ي' },
    { key: 'unrated-a', rating: null, count: 0, name: 'أ' },
    { key: 'twin-1', rating: '4.00', count: 2, name: 'سمير' },
    { key: 'after-twins', rating: '4.00', count: 2, name: 'ع' },
    { key: 'more-reviews', rating: '4.00', count: 9, name: 'ي' },
    { key: 'unrated-counted', rating: null, count: 1, name: 'ي' },
  ];

  it("lists every card exactly once in R-204's order at every page size, unrated teachers last, the cursor holding ties", async () => {
    await inRollback(async (tx) => {
      const quran = await subject(tx);
      const ids = new Map<string, string>();
      for (const row of ROWS) {
        const id = await teacher(tx, {
          gender: 'female',
          displayName: row.name,
          averageRating: row.rating,
          reviewCount: row.count,
        });
        await offer(tx, id, quran);
        ids.set(row.key, id);
      }
      const twins = [ids.get('twin-1') ?? '', ids.get('twin-2') ?? ''].sort();
      const expected = [
        ids.get('top'),
        ids.get('more-reviews'),
        ...twins,
        ids.get('after-twins'),
        ids.get('unrated-counted'),
        ids.get('unrated-a'),
        ids.get('unrated-b'),
      ];

      for (let size = 1; size <= ROWS.length + 1; size += 1) {
        const pages = await allPages(tx, catalogWithPageSize(size), requesterOf('female'), {
          subjectId: quran.id,
        });
        expect(pages.flatMap(idsOf), `page size ${size}`).toEqual(expected);
        for (const page of pages.slice(0, -1)) expect(page.cards).toHaveLength(size);
        expect(pages.at(-1)?.nextCursor, `page size ${size}`).toBeUndefined();
      }
    });
  });

  it('answers pages of discovery_page_size cards', async () => {
    await inRollback(async (tx) => {
      const quran = await subject(tx);
      for (let index = 0; index < 5; index += 1) {
        const id = await teacher(tx, { gender: 'male', displayName: `معلم ${index}` });
        await offer(tx, id, quran);
      }
      const pages = await allPages(tx, catalogWithPageSize(2), requesterOf('male'), {
        subjectId: quran.id,
      });
      expect(pages.map(({ cards }) => cards.length)).toEqual([2, 2, 1]);
      const single = await catalogWithPageSize(20).browse(tx, requesterOf('male'), {
        subjectId: quran.id,
      });
      expect(single.cards).toHaveLength(5);
      expect(single.nextCursor).toBeUndefined();
    });
  });

  it('refuses a cursor the server did not write as an invalid input', async () => {
    await inRollback(async (tx) => {
      for (const cursor of ['not-a-cursor', Buffer.from('[1,2]').toString('base64url'), '!!!']) {
        const thrown = await catalog
          .browse(tx, requesterOf('male'), { cursor: cursor as DiscoveryCursor })
          .then(
            () => null,
            (error: unknown) => error,
          );
        expect(thrown, cursor).toBeInstanceOf(DomainError);
        expect((thrown as DomainError).code).toBe('VALIDATION_FAILED');
        expect((thrown as DomainError).details).toEqual([{ path: 'cursor', code: 'invalid' }]);
      }
    });
  });

  it("keeps identity's order: the cards are visibleTeacherPage's rows in its order", async () => {
    await inRollback(async (tx) => {
      const quran = await subject(tx);
      const candidates: string[] = [];
      for (const row of ROWS) {
        const id = await teacher(tx, {
          gender: 'male',
          displayName: row.name,
          averageRating: row.rating,
          reviewCount: row.count,
        });
        await offer(tx, id, quran);
        candidates.push(id);
      }
      const page = await catalog.browse(tx, requesterOf('male'), { subjectId: quran.id });
      const identity = await visibleTeacherPage(tx, requesterOf('male'), {
        candidateIds: candidates,
        limit: 20,
      });
      expect(idsOf(page)).toEqual(identity.map(({ id }) => id));
    });
  });
});

describe('discovery: a teacher the predicate excludes is never present (T025, R-GENDER-1)', () => {
  for (const { name, own } of DIRECTIONS) {
    it(`leaves out every excluded state from the cards, the search and the riwaya filter, for ${name}`, async () => {
      await inRollback(async (tx) => {
        const quran = await subject(tx);
        const shown = await teacher(tx, { gender: own, displayName: 'أنس' });
        await offer(tx, shown, quran);
        await credential(tx, shown, quran, 'حفص عن عاصم');
        const hidden: string[] = [];
        for (const values of [
          { gender: otherOf(own) },
          { gender: own, verificationStatus: 'rejected' as const },
          { gender: own, payoutVerified: false },
          { gender: own, deleted: true },
          { gender: own, accountStatus: 'suspended' as const },
          { gender: own, accountStatus: 'banned' as const },
        ]) {
          const id = await teacher(tx, { ...values, displayName: 'أنس' });
          await offer(tx, id, quran);
          await credential(tx, id, quran, 'حفص عن عاصم');
          hidden.push(id);
        }

        const answers = await Promise.all([
          allPages(tx, catalog, requesterOf(own), { subjectId: quran.id }),
          allPages(tx, catalog, requesterOf(own), { subjectId: quran.id, query: 'انس' }),
          allPages(tx, catalog, requesterOf(own), { subjectId: quran.id, riwaya: 'حفص عن عاصم' }),
        ]);
        for (const pages of answers) {
          expect(pages.flatMap(idsOf)).toEqual([shown]);
          const serialized = JSON.stringify(pages);
          for (const id of hidden) expect(serialized).not.toContain(id);
        }
      });
    });
  }
});

describe("catalog writes no ORDER BY on identity's columns (T025, R-204 as amended, analysis C2)", () => {
  const sources = [
    'apps/api/src/modules/catalog/discovery.service.ts',
    'apps/api/src/modules/catalog/discovery.repository.ts',
  ].map((path) => ({
    path,
    text: readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'),
  }));

  it('names no rating, review count or name in any orderBy, and sorts no card', () => {
    for (const { path, text } of sources) {
      for (const [block] of text.matchAll(/orderBy[^\n]*(?:\n[^\n]*){0,4}/g)) {
        expect(block, path).not.toMatch(/averageRating|reviewCount|displayName/);
      }
      for (const [call] of text.matchAll(/\.(?:sort|toSorted)\([^)]*\)/g)) {
        expect(call, path).toMatch(/riwaya/i);
      }
    }
  });
});
