// T027 — catalog's profile read for `discovery.teacher` (FR-331, FR-336, R-GENDER-2, R-GENDER-5),
// over a recording store: the teacher is asked of identity's predicate first, for `discover` with
// the requester's gender, and an excluded or unknown teacher is refused NOT_FOUND before anything
// else is read; a visible one is answered with the photo as a signed link that lapses after
// `document_link_ttl_seconds` (never the key), the subjects and the active packages the store
// gives, each with its price per session from `packages/money`. The rows themselves (only active
// packages, approved subjects, every excluded state in both directions) are probed over the
// database in `tests/db-integrity/discovery-teacher.spec.ts`. `discovery.browse`'s cards carry no
// photo, even for a teacher who has one (FR-335; the owner's decision of 2026-11-02).
import type { DiscoveryCard } from '@ijazah/contracts';
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

/** 006:T004 (Q-5 (a)): the programme's switch and the assessment's price; open by default. */
interface Programme {
  readonly enabled: 0 | 1;
  readonly fee: number;
}
const OPEN: Programme = { enabled: 1, fee: 50_000 };

function world(
  teachers: VisibleTeacher[],
  overrides: Partial<DiscoveryStore> = {},
  programme: Programme = OPEN,
) {
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
          isProgramme: false,
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
        if (key === 'programme_enabled') return schema.parse(programme.enabled);
        if (key === 'assessment_price_piasters') return schema.parse(programme.fee);
        if (key === 'assessment_duration_minutes') return schema.parse(30);
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
        { teacherUserId: TEACHER, subjectId: SUBJECT.id, track: 'recitation', isProgramme: false },
      ],
      activeSubjects: async () => [],
      visibleTeacherPage: async () => [visible()],
      packagesOf: async () => [
        {
          teacherUserId: TEACHER,
          track: 'recitation',
          isProgramme: false,
          sessionCount: 4,
          sessionDurationMinutes: 30,
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
        { teacherUserId: TEACHER, subjectId: SUBJECT.id, track: 'recitation', isProgramme: false },
        { teacherUserId: OTHER, subjectId: TAJWEED.id, track: 'recitation', isProgramme: false },
        { teacherUserId: THIRD, subjectId: TAJWEED.id, track: 'ijazah_track', isProgramme: false },
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
          isProgramme: false as const,
          sessionCount: 4,
          sessionDurationMinutes: 30 as const,
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

// 006:T004 (FR-704, R-516; Q-5 (a)): a programme package on discovery: its three prices, their
// lowest and highest, and the assessment's price, only while the switch is on and the price above
// 0; otherwise no programme package is shown, on the profile, the cards, the tabs or the filter.
describe('discovery and the programme package (006:T004)', () => {
  const PROGRAMME_ONLY = '0199d0a0-0000-7000-8000-0000000000e7';
  const PROGRAMME_PACKAGE = '0199d0a0-0000-7000-8000-0000000000e8';
  const PRICES = {
    m30_piasters: piasters(28_000),
    m45_piasters: piasters(20_000),
    m60_piasters: piasters(35_000),
  };
  const FIXED = {
    id: PACKAGE,
    subject: SUBJECT,
    track: 'recitation' as const,
    isProgramme: false as const,
    sessionCount: 4,
    sessionDurationMinutes: 30 as const,
    price_piasters: piasters(100_000),
  };
  const PROGRAMME = {
    id: PROGRAMME_PACKAGE,
    subject: SUBJECT,
    track: 'ijazah_track' as const,
    isProgramme: true as const,
    prices: PRICES,
  };

  function profile(programme: Programme) {
    return world([visible()], { profilePackagesOf: async () => [FIXED, PROGRAMME] }, programme);
  }

  it('answers a programme package on the profile with its prices, their range and the assessment’s price', async () => {
    const { service } = profile(OPEN);
    const { packages } = await service.teacher(TX, MALE, { teacherId: TEACHER });
    expect(packages).toEqual([
      {
        packageId: PACKAGE,
        subject: SUBJECT,
        track: 'recitation',
        sessionCount: 4,
        sessionDurationMinutes: 30,
        price_piasters: 100_000,
        perSession_piasters: 25_000,
      },
      {
        packageId: PROGRAMME_PACKAGE,
        subject: SUBJECT,
        track: 'ijazah_track',
        isProgramme: true,
        prices: { m30_piasters: 28_000, m45_piasters: 20_000, m60_piasters: 35_000 },
        priceRange: { lowest_piasters: 20_000, highest_piasters: 35_000 },
        assessmentPrice_piasters: 50_000,
      },
    ]);
  });

  it('shows no programme package on the profile while the switch is off', async () => {
    const { service } = profile({ enabled: 0, fee: 50_000 });
    const { packages } = await service.teacher(TX, MALE, { teacherId: TEACHER });
    expect(packages.map(({ packageId }) => packageId)).toEqual([PACKAGE]);
  });

  it('shows no programme package on the profile while the assessment’s price is 0', async () => {
    const { service } = profile({ enabled: 1, fee: 0 });
    const { packages } = await service.teacher(TX, MALE, { teacherId: TEACHER });
    expect(packages.map(({ packageId }) => packageId)).toEqual([PACKAGE]);
  });

  function browsing(programme: Programme) {
    const asked: { readonly candidateIds: readonly string[] }[] = [];
    const { service } = world(
      [],
      {
        offerings: async () => [
          {
            teacherUserId: TEACHER,
            subjectId: SUBJECT.id,
            track: 'recitation',
            isProgramme: false,
          },
          {
            teacherUserId: TEACHER,
            subjectId: SUBJECT.id,
            track: 'ijazah_track',
            isProgramme: true,
          },
          {
            teacherUserId: PROGRAMME_ONLY,
            subjectId: SUBJECT.id,
            track: 'ijazah_track',
            isProgramme: true,
          },
        ],
        activeSubjects: async () => [],
        visibleTeachers: async (_tx, _requester, { teacherIds }) =>
          teacherIds.map((id) => visible({ id })),
        visibleTeacherPage: async (_tx, _requester, query) => {
          asked.push(query);
          return query.candidateIds.map((id) => visible({ id }));
        },
        packagesOf: async () => [
          { teacherUserId: TEACHER, ...FIXED },
          { teacherUserId: TEACHER, ...PROGRAMME },
          { teacherUserId: PROGRAMME_ONLY, ...PROGRAMME },
        ],
        subjectsOf: async () => [],
        riwayas: async () => [
          { teacherUserId: TEACHER, subjectId: SUBJECT.id, riwaya: 'حفص' },
          { teacherUserId: PROGRAMME_ONLY, subjectId: SUBJECT.id, riwaya: 'ورش' },
        ],
        fold: async (_tx, texts) => [...texts],
      },
      programme,
    );
    return { asked, service };
  }

  const shown = (cards: readonly DiscoveryCard[]) =>
    cards.map(({ teacherId, tracks, lowestPerSession_piasters }) => ({
      teacherId,
      tracks,
      lowestPerSession_piasters,
    }));

  it('lists a teacher of a programme package alone while the programme is open, the card’s lowest from its prices', async () => {
    const { asked, service } = browsing(OPEN);
    const { cards, tabs } = await service.browse(TX, MALE, {});
    expect(asked[0]?.candidateIds).toEqual([TEACHER, PROGRAMME_ONLY]);
    expect(shown(cards)).toEqual([
      {
        teacherId: TEACHER,
        tracks: ['recitation', 'ijazah_track'],
        lowestPerSession_piasters: 20_000,
      },
      { teacherId: PROGRAMME_ONLY, tracks: ['ijazah_track'], lowestPerSession_piasters: 20_000 },
    ]);
    expect(tabs?.[0]).toEqual({ subjectId: null, count: 2 });
  });

  it('lists no teacher for a programme package, counts none and prices none, while the switch is off', async () => {
    const { asked, service } = browsing({ enabled: 0, fee: 50_000 });
    const { cards, tabs } = await service.browse(TX, MALE, {});
    expect(asked[0]?.candidateIds).toEqual([TEACHER]);
    expect(shown(cards)).toEqual([
      { teacherId: TEACHER, tracks: ['recitation'], lowestPerSession_piasters: 25_000 },
    ]);
    expect(tabs?.[0]).toEqual({ subjectId: null, count: 1 });
    await service.browse(TX, MALE, { track: 'ijazah_track' });
    expect(asked[1]?.candidateIds).toEqual([]);
  });

  it('lists no teacher for a programme package while the assessment’s price is 0', async () => {
    const { asked, service } = browsing({ enabled: 1, fee: 0 });
    await service.browse(TX, MALE, {});
    expect(asked[0]?.candidateIds).toEqual([TEACHER]);
  });

  it('gives the riwaya filter no value of a teacher of a programme package alone while it is closed', async () => {
    const { service } = browsing({ enabled: 0, fee: 50_000 });
    await expect(service.filters(TX, MALE, { subjectId: SUBJECT.id })).resolves.toEqual({
      riwayas: ['حفص'],
    });
    const { service: open } = browsing(OPEN);
    await expect(open.filters(TX, MALE, { subjectId: SUBJECT.id })).resolves.toEqual({
      riwayas: ['حفص', 'ورش'],
    });
  });
});
