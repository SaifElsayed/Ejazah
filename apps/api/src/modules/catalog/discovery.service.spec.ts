// T027 — catalog's profile read for `discovery.teacher` (FR-331, FR-336, R-GENDER-2, R-GENDER-5),
// over a recording store: the teacher is asked of identity's predicate first, for `discover` with
// the requester's gender, and an excluded or unknown teacher is refused NOT_FOUND before anything
// else is read; a visible one is answered with the photo as a signed link that lapses after
// `document_link_ttl_seconds` (never the key), the subjects and the active packages the store
// gives, each with its price per session from `packages/money`. The rows themselves (only active
// packages, approved subjects, every excluded state in both directions) are probed over the
// database in `tests/db-integrity/discovery-teacher.spec.ts`. `discovery.browse`'s cards carry no
// photo, even for a teacher who has one (FR-335; the owner's decision of 2026-11-02).
import { piasters } from '@ijazah/money';
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import type { RequesterGender } from '../../platform/guards/requester-gender.js';
import { SettingError } from '../../platform/settings/settings-reader.js';
import type { VisibleTeacher } from '../identity/index.js';
import { DiscoveryService, type DiscoveryStore } from './discovery.service.js';

const TX = {} as Transaction;
const MALE = 'male' as RequesterGender;
const TEACHER = '0199d0a0-0000-7000-8000-0000000000e1';
const PACKAGE = '0199d0a0-0000-7000-8000-0000000000e2';
const SUBJECT = { id: '0199d0a0-0000-7000-8000-0000000000e3', nameAr: 'القرآن', nameEn: 'Quran' };
const PHOTO_KEY = 'photos/0199d0a0-0000-7000-8000-0000000000e1/secret-key.webp';
const TTL_SECONDS = 600;
const PAGE_SIZE = 20;

function visible(values: Partial<VisibleTeacher> = {}): VisibleTeacher {
  return {
    id: TEACHER,
    displayName: 'أحمد',
    gender: 'male',
    photoKey: PHOTO_KEY,
    bio: 'نبذة\nسطر ثان',
    qualificationSummary: 'إجازة في حفص',
    averageRating: '4.50',
    reviewCount: 12,
    ...values,
  };
}

function world(teachers: VisibleTeacher[], overrides: Partial<DiscoveryStore> = {}) {
  const calls: unknown[][] = [];
  const unreached = (name: string) => async () => {
    calls.push([name]);
    throw new Error(`${name} is not this spec's`);
  };
  const store: DiscoveryStore = {
    offerings: unreached('offerings'),
    riwayas: unreached('riwayas'),
    activeSubjects: unreached('activeSubjects'),
    fold: unreached('fold'),
    packagesOf: unreached('packagesOf'),
    visibleTeacherPage: unreached('visibleTeacherPage'),
    visibleTeachers: async (...args) => {
      calls.push(['visibleTeachers', ...args]);
      return teachers;
    },
    subjectsOf: async (...args) => {
      calls.push(['subjectsOf', ...args]);
      return [{ teacherUserId: TEACHER, subject: SUBJECT }];
    },
    profilePackagesOf: async (...args) => {
      calls.push(['profilePackagesOf', ...args]);
      return [
        {
          id: PACKAGE,
          subject: SUBJECT,
          track: 'ijazah_track',
          sessionCount: 3,
          sessionDurationMinutes: 45,
          price_piasters: piasters(100_000),
        },
      ];
    },
    ...overrides,
  };
  const service = new DiscoveryService({
    settings: {
      async read(key, schema) {
        calls.push(['settings', key]);
        if (key === 'discovery_page_size') return schema.parse(PAGE_SIZE);
        if (key !== 'document_link_ttl_seconds') throw new SettingError(key, 'missing');
        return schema.parse(TTL_SECONDS);
      },
    },
    storage: {
      async temporaryLink(key, seconds) {
        calls.push(['temporaryLink', key, seconds]);
        return `https://files.invalid/signed?expires=${String(seconds)}`;
      },
    },
    store,
  });
  return { calls, service };
}

describe('DiscoveryService.teacher (FR-336)', () => {
  it('answers the profile: the photo as a signed link, the subjects, the active packages with their price per session', async () => {
    const { calls, service } = world([visible()]);
    const answer = await service.teacher(TX, MALE, { teacherId: TEACHER });
    expect(answer).toEqual({
      teacherId: TEACHER,
      displayName: 'أحمد',
      gender: 'male',
      photoUrl: `https://files.invalid/signed?expires=${String(TTL_SECONDS)}`,
      bio: 'نبذة\nسطر ثان',
      qualificationSummary: 'إجازة في حفص',
      subjects: [SUBJECT],
      rating: 4.5,
      reviewCount: 12,
      packages: [
        {
          packageId: PACKAGE,
          subject: SUBJECT,
          track: 'ijazah_track',
          sessionCount: 3,
          sessionDurationMinutes: 45,
          price_piasters: 100_000,
          // 100_000 / 3 = 33_333.33…, rounded by `perSession`.
          perSession_piasters: 33_333,
        },
      ],
    });
    expect(JSON.stringify(answer)).not.toContain(PHOTO_KEY);
    expect(calls[0]).toEqual([
      'visibleTeachers',
      TX,
      MALE,
      { purpose: 'discover', teacherIds: [TEACHER] },
    ]);
    expect(calls).toContainEqual(['temporaryLink', PHOTO_KEY, TTL_SECONDS]);
  });

  it('answers no photo and no rating for a teacher with neither, and reads no link', async () => {
    const { calls, service } = world([visible({ photoKey: null, averageRating: null })]);
    const answer = await service.teacher(TX, MALE, { teacherId: TEACHER });
    expect(answer).not.toHaveProperty('photoUrl');
    expect(answer).not.toHaveProperty('rating');
    expect(answer.reviewCount).toBe(12);
    expect(calls.map(([name]) => name)).not.toContain('temporaryLink');
  });

  it('refuses a teacher the predicate does not answer NOT_FOUND, with no field, before anything else is read', async () => {
    const { calls, service } = world([]);
    const refusal = await service.teacher(TX, MALE, { teacherId: TEACHER }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(refusal).toBeInstanceOf(DomainError);
    expect(refusal).toMatchObject({ code: 'NOT_FOUND', details: undefined });
    expect(calls).toEqual([
      ['visibleTeachers', TX, MALE, { purpose: 'discover', teacherIds: [TEACHER] }],
    ]);
  });
});

describe('DiscoveryService.browse (FR-335)', () => {
  it('sends no photo on a card, even for a teacher who has one, and reads no link', async () => {
    const { calls, service } = world([visible()], {
      offerings: async () => [
        { teacherUserId: TEACHER, subjectId: SUBJECT.id, track: 'recitation' },
      ],
      activeSubjects: async () => [],
      visibleTeacherPage: async () => [visible()],
      packagesOf: async () => [
        {
          teacherUserId: TEACHER,
          track: 'recitation',
          sessionCount: 4,
          price_piasters: piasters(80_000),
        },
      ],
    });
    const { cards } = await service.browse(TX, MALE, {});
    expect(cards).toHaveLength(1);
    expect(cards[0]).not.toHaveProperty('photoUrl');
    expect(calls.filter(([name]) => name === 'temporaryLink')).toEqual([]);
  });
});

// T070 (FR-333, R-203): the search matches a subject's name too. The fold here stands in for the
// kernel's `ijazah_fold` (lower case and أ to ا are enough for these cases); the database specs
// run the real one (`tests/db-integrity/discovery.spec.ts`).
describe('DiscoveryService.browse: a search by subject (T070, FR-333)', () => {
  const OTHER = '0199d0a0-0000-7000-8000-0000000000e4';
  const THIRD = '0199d0a0-0000-7000-8000-0000000000e5';
  const TAJWEED = {
    id: '0199d0a0-0000-7000-8000-0000000000e6',
    nameAr: 'أحكام التجويد',
    nameEn: 'Tajweed',
  };
  const fold = (text: string) => text.toLowerCase().replaceAll('أ', 'ا');

  function searching(page: VisibleTeacher[] = [visible()]) {
    const asked: unknown[] = [];
    const { calls, service } = world([], {
      offerings: async () => [
        { teacherUserId: TEACHER, subjectId: SUBJECT.id, track: 'recitation' },
        { teacherUserId: OTHER, subjectId: TAJWEED.id, track: 'recitation' },
        { teacherUserId: THIRD, subjectId: TAJWEED.id, track: 'ijazah_track' },
      ],
      activeSubjects: async () => [SUBJECT, TAJWEED],
      fold: async (_tx, texts) => texts.map(fold),
      visibleTeachers: async () => [],
      visibleTeacherPage: async (_tx, _requester, query) => {
        asked.push(query);
        return page;
      },
      packagesOf: async (_tx, ids) =>
        ids.map((teacherUserId) => ({
          teacherUserId,
          track: 'recitation' as const,
          sessionCount: 4,
          price_piasters: piasters(80_000),
        })),
      subjectsOf: async () => [],
    });
    return { asked, calls, service };
  }

  it('hands identity the teachers of a subject whose folded Arabic name begins with the query, beside the name prefix', async () => {
    const { asked, service } = searching();
    await service.browse(TX, MALE, { query: 'احكام' });
    expect(asked).toEqual([
      expect.objectContaining({ namePrefix: 'احكام', alsoMatched: [OTHER, THIRD] }),
    ]);
  });

  it('matches the English name without case, and a subject holding the query past its start not at all', async () => {
    const { asked, service } = searching();
    await service.browse(TX, MALE, { query: 'TAJ' });
    await service.browse(TX, MALE, { query: 'التجويد' });
    await service.browse(TX, MALE, { query: 'weed' });
    expect(asked.map((query) => (query as { alsoMatched?: string[] }).alsoMatched)).toEqual([
      [OTHER, THIRD],
      [],
      [],
    ]);
  });

  it('keeps the subject match inside the tab and the track the student chose', async () => {
    const { asked, service } = searching();
    await service.browse(TX, MALE, { query: 'tajweed', track: 'ijazah_track' });
    await service.browse(TX, MALE, { query: 'tajweed', subjectId: SUBJECT.id });
    expect(asked.map((query) => (query as { alsoMatched?: string[] }).alsoMatched)).toEqual([
      [THIRD],
      [],
    ]);
  });

  it('marks no match on a card the subject alone matched, and the name prefix on one the name matched', async () => {
    const { service } = searching([visible({ id: OTHER, displayName: 'محمود' }), visible()]);
    const { cards } = await service.browse(TX, MALE, { query: 'احم' });
    expect(cards.map(({ teacherId, match }) => ({ teacherId, match }))).toEqual([
      { teacherId: OTHER, match: undefined },
      { teacherId: TEACHER, match: { length: 3 } },
    ]);
  });

  it('asks no subject match of identity on a browse with no query', async () => {
    const { asked, service } = searching();
    await service.browse(TX, MALE, {});
    expect(asked).toHaveLength(1);
    expect(asked[0]).not.toHaveProperty('alsoMatched');
    expect(asked[0]).not.toHaveProperty('namePrefix');
  });
});
