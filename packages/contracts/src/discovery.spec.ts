// T024 — the `discovery` schemas of specs/003-booking/contracts/app-surface.md (FR-332 to FR-338,
// R-204). Written before the schemas, and run red first.
//
// The student names what they ask for and never who asks: no input carries a gender, a user id or
// a role, and one that is sent is stripped, never read (R-GENDER-4, R-GENDER-6). The cursor is
// opaque: a bounded string the server wrote and alone reads (R-204). Money crosses as whole
// piasters (R-MONEY-1); the nearest slot is an instant with its zone (R-TIME-6). The profile
// carries no riwaya, tariq or chain, and a stored field the schema does not name is stripped
// (FR-336, R-HONEST-4).
import { describe, expect, it } from 'vitest';

import {
  DISCOVERY_CURSOR_MAX_LENGTH,
  DISCOVERY_QUERY_MAX_LENGTH,
  discoveryBrowseInput,
  discoveryBrowseOutput,
  discoveryCard,
  discoveryCursor,
  discoveryFiltersInput,
  discoveryFiltersOutput,
  discoveryTab,
  discoveryTeacherInput,
  discoveryTeacherOutput,
  RIWAYA_FILTER_MAX_LENGTH,
} from './discovery.js';

const ids = {
  subject: '0199d0a0-0000-7000-8000-000000000051',
  teacher: '0199d0a0-0000-7000-8000-0000000000c1',
  package: '0199d0a0-0000-7000-8000-0000000000a1',
};

const subject = { id: ids.subject, nameAr: 'حفظ القرآن', nameEn: 'Quran memorisation' } as const;

const card = {
  teacherId: ids.teacher,
  displayName: 'أحمد سالم',
  match: { length: 3 },
  photoUrl: 'https://files.example/photo?signature=abc',
  subjects: [subject],
  tracks: ['recitation', 'ijazah_track'],
  bioExcerpt: 'أدرّس حفظ القرآن وتجويده',
  rating: 4.67,
  reviewCount: 12,
  nearestSlot: { startsAt: '2026-11-08T15:00:00.000Z', timezone: 'Africa/Cairo' },
  lowestPerSession_piasters: 15_000,
} as const;

const profile = {
  teacherId: ids.teacher,
  displayName: 'أحمد سالم',
  gender: 'male',
  photoUrl: 'https://files.example/photo?signature=abc',
  bio: 'أدرّس حفظ القرآن وتجويده منذ ثماني سنوات.',
  qualificationSummary: 'إجازة في حفظ القرآن برواية حفص',
  subjects: [subject],
  rating: 4.67,
  reviewCount: 12,
  packages: [
    {
      packageId: ids.package,
      subject,
      track: 'recitation',
      sessionCount: 8,
      sessionDurationMinutes: 45,
      price_piasters: 120_000,
      perSession_piasters: 15_000,
    },
  ],
} as const;

describe('discovery.browse input (FR-332 to FR-334)', () => {
  it('takes nothing: the all-subjects tab, first page, no filter', () => {
    expect(discoveryBrowseInput.parse({})).toEqual({});
  });

  it('takes a subject tab, a query, a track, a minimum rating, a riwaya and a cursor', () => {
    const input = {
      subjectId: ids.subject,
      query: 'احم',
      track: 'ijazah_track',
      minRating: 4,
      riwaya: 'حفص عن عاصم',
      cursor: 'eyJyIjoiNC42NyJ9',
    };
    expect(discoveryBrowseInput.parse(input)).toEqual(input);
  });

  it('takes a minimum rating of 1 to 5 whole stars and nothing else', () => {
    for (const minRating of [1, 2, 3, 4, 5]) {
      expect(discoveryBrowseInput.safeParse({ minRating }).success).toBe(true);
    }
    for (const minRating of [0, 6, 4.5, -1, '4']) {
      expect(discoveryBrowseInput.safeParse({ minRating }).success).toBe(false);
    }
  });

  it('refuses a track `package_track` does not hold, and a subject that is not an id', () => {
    expect(discoveryBrowseInput.safeParse({ track: 'tajweed' }).success).toBe(false);
    expect(discoveryBrowseInput.safeParse({ subjectId: 'quran' }).success).toBe(false);
  });

  it('trims the query, and refuses a blank one or one past its bound', () => {
    expect(discoveryBrowseInput.parse({ query: '  احم  ' }).query).toBe('احم');
    const longest = 'ا'.repeat(DISCOVERY_QUERY_MAX_LENGTH);
    expect(discoveryBrowseInput.safeParse({ query: longest }).success).toBe(true);
    for (const query of ['', '   ', `${longest}ا`, 3]) {
      expect(discoveryBrowseInput.safeParse({ query }).success).toBe(false);
    }
  });

  it('keeps `%` and `_` in the query as typed: escaping them is the server’s (R-203)', () => {
    expect(discoveryBrowseInput.parse({ query: '50%_x' }).query).toBe('50%_x');
  });

  it('refuses a blank riwaya or one past the transcription’s bound', () => {
    expect(
      discoveryBrowseInput.safeParse({ riwaya: 'ر'.repeat(RIWAYA_FILTER_MAX_LENGTH) }).success,
    ).toBe(true);
    for (const riwaya of ['', '  ', 'ر'.repeat(RIWAYA_FILTER_MAX_LENGTH + 1)]) {
      expect(discoveryBrowseInput.safeParse({ riwaya }).success).toBe(false);
    }
  });

  it('strips a gender, a user id or a role it was sent: the requester is the session (R-GENDER-4)', () => {
    const parsed = discoveryBrowseInput.parse({ gender: 'female', userId: ids.teacher, role: 'x' });
    expect(parsed).toEqual({});
    for (const schema of [discoveryBrowseInput, discoveryFiltersInput, discoveryTeacherInput]) {
      for (const key of Object.keys(schema.shape)) {
        expect(key).not.toMatch(/^(user)(Id)?$|gender|role/i);
      }
    }
  });
});

describe('the cursor (opaque, R-204)', () => {
  it('is a bounded, non-empty string the client hands back unread', () => {
    expect(discoveryCursor.parse('abc')).toBe('abc');
    expect(discoveryCursor.safeParse('x'.repeat(DISCOVERY_CURSOR_MAX_LENGTH)).success).toBe(true);
    for (const cursor of ['', 'x'.repeat(DISCOVERY_CURSOR_MAX_LENGTH + 1), 7, null]) {
      expect(discoveryCursor.safeParse(cursor).success).toBe(false);
      expect(discoveryBrowseInput.safeParse({ cursor }).success).toBe(false);
    }
  });

  it('is not an object of the four keys: the client never builds one', () => {
    const keys = { averageRating: '4.67', reviewCount: 12, displayName: 'أحمد', id: ids.teacher };
    expect(discoveryBrowseInput.safeParse({ cursor: keys }).success).toBe(false);
  });
});

describe('discovery.browse output (FR-332, FR-335)', () => {
  it('a card carries what FR-335 shows, the lowest price per session in piasters', () => {
    expect(discoveryCard.parse(card)).toEqual(card);
  });

  it('a card with no review, no photo, no match and no free slot', () => {
    const { match: _m, photoUrl: _p, rating: _r, nearestSlot: _n, ...bare } = card;
    expect(discoveryCard.parse({ ...bare, reviewCount: 0 })).toEqual({ ...bare, reviewCount: 0 });
  });

  it('refuses a price that is not whole piasters, and pounds as text (R-MONEY-1)', () => {
    for (const lowestPerSession_piasters of [150.5, -1, '150', undefined]) {
      expect(discoveryCard.safeParse({ ...card, lowestPerSession_piasters }).success).toBe(false);
    }
  });

  it('refuses a rating outside 1 to 5 and a negative review count', () => {
    for (const rating of [0, 5.01, '4.5']) {
      expect(discoveryCard.safeParse({ ...card, rating }).success).toBe(false);
    }
    expect(discoveryCard.safeParse({ ...card, reviewCount: -1 }).success).toBe(false);
    expect(discoveryCard.safeParse({ ...card, reviewCount: 1.5 }).success).toBe(false);
  });

  it('the nearest slot is a UTC instant with its zone, never a local time alone (R-TIME-6)', () => {
    for (const nearestSlot of [
      { startsAt: '2026-11-08 17:00', timezone: 'Africa/Cairo' },
      { startsAt: '2026-11-08T17:00:00+02:00', timezone: 'Africa/Cairo' },
      { startsAt: '2026-11-08T15:00:00.000Z' },
      { startsAt: '2026-11-08T15:00:00.000Z', timezone: '' },
    ]) {
      expect(discoveryCard.safeParse({ ...card, nearestSlot }).success).toBe(false);
    }
  });

  it('a match marks at least one character of the name', () => {
    expect(discoveryCard.safeParse({ ...card, match: { length: 0 } }).success).toBe(false);
    expect(discoveryCard.safeParse({ ...card, match: { length: 2.5 } }).success).toBe(false);
  });

  it('the tracks are `package_track`’s values', () => {
    expect(discoveryCard.safeParse({ ...card, tracks: ['tajweed'] }).success).toBe(false);
  });

  it('strips a stored field it does not name: no riwaya, key or payout on a card (R-HONEST-4)', () => {
    const parsed = discoveryCard.parse({
      ...card,
      riwaya: 'حفص',
      photoKey: 'photos/x',
      gender: 'male',
      payoutVerifiedAt: '2026-10-01T00:00:00.000Z',
    });
    for (const key of ['riwaya', 'photoKey', 'gender', 'payoutVerifiedAt']) {
      expect(parsed).not.toHaveProperty(key);
    }
  });

  it('the all-subjects tab has no subject; a subject tab carries both names; counts are whole', () => {
    expect(discoveryTab.parse({ subjectId: null, count: 7 })).toEqual({
      subjectId: null,
      count: 7,
    });
    const tab = {
      subjectId: ids.subject,
      nameAr: subject.nameAr,
      nameEn: subject.nameEn,
      count: 3,
    };
    expect(discoveryTab.parse(tab)).toEqual(tab);
    expect(discoveryTab.safeParse({ subjectId: ids.subject, count: 3 }).success).toBe(false);
    expect(discoveryTab.safeParse({ subjectId: null, count: -1 }).success).toBe(false);
    expect(discoveryTab.safeParse({ ...tab, count: 2.5 }).success).toBe(false);
  });

  it('a page: tabs on the first only, the cards, and a cursor while more remain', () => {
    const first = {
      tabs: [{ subjectId: null, count: 1 }],
      cards: [card],
      nextCursor: 'eyJyIjoiNC42NyJ9',
    };
    expect(discoveryBrowseOutput.parse(first)).toEqual(first);
    expect(discoveryBrowseOutput.parse({ cards: [] })).toEqual({ cards: [] });
    expect(discoveryBrowseOutput.safeParse({ tabs: [] }).success).toBe(false);
    expect(discoveryBrowseOutput.safeParse({ cards: [], nextCursor: '' }).success).toBe(false);
  });
});

describe('discovery.filters (FR-334)', () => {
  it('names the subject and answers its riwayas as typed', () => {
    expect(discoveryFiltersInput.parse({ subjectId: ids.subject })).toEqual({
      subjectId: ids.subject,
    });
    expect(discoveryFiltersInput.safeParse({}).success).toBe(false);
    expect(discoveryFiltersInput.safeParse({ subjectId: 'quran' }).success).toBe(false);
    const output = { riwayas: ['حفص عن عاصم', 'ورش عن نافع'] };
    expect(discoveryFiltersOutput.parse(output)).toEqual(output);
    expect(discoveryFiltersOutput.parse({ riwayas: [] })).toEqual({ riwayas: [] });
    expect(discoveryFiltersOutput.safeParse({}).success).toBe(false);
  });
});

describe('discovery.teacher (FR-331, FR-336)', () => {
  it('names the teacher asked for, by id', () => {
    expect(discoveryTeacherInput.parse({ teacherId: ids.teacher })).toEqual({
      teacherId: ids.teacher,
    });
    expect(discoveryTeacherInput.safeParse({}).success).toBe(false);
    expect(discoveryTeacherInput.safeParse({ teacherId: 'ahmed' }).success).toBe(false);
  });

  it('answers the profile FR-336 shows, each package with both prices in piasters', () => {
    expect(discoveryTeacherOutput.parse(profile)).toEqual(profile);
  });

  it('takes a profile with no photo, no review and no package', () => {
    const { photoUrl: _p, rating: _r, ...bare } = profile;
    const empty = { ...bare, reviewCount: 0, packages: [] };
    expect(discoveryTeacherOutput.parse(empty)).toEqual(empty);
  });

  it('refuses a package the database would refuse (ERD §15 rule 36)', () => {
    const [item] = profile.packages;
    for (const change of [
      { sessionDurationMinutes: 31 },
      { price_piasters: 0 },
      { price_piasters: 1200.5 },
      { perSession_piasters: 1.5 },
      { sessionCount: 0 },
      { sessionCount: 53 },
      { track: 'tajweed' },
    ]) {
      const packages = [{ ...item, ...change }];
      expect(discoveryTeacherOutput.safeParse({ ...profile, packages }).success).toBe(false);
    }
  });

  it('refuses a gender other than the two', () => {
    expect(discoveryTeacherOutput.safeParse({ ...profile, gender: 'other' }).success).toBe(false);
  });

  it('carries no riwaya, tariq or chain, on the profile or a package (FR-336, R-HONEST-4)', () => {
    const [item] = profile.packages;
    const parsed = discoveryTeacherOutput.parse({
      ...profile,
      riwaya: 'حفص',
      tariq: 'الشاطبية',
      chain: ['a', 'b'],
      photoKey: 'photos/x',
      packages: [{ ...item, riwaya: 'حفص', isActive: true, teacherUserId: ids.teacher }],
    });
    for (const key of ['riwaya', 'tariq', 'chain', 'photoKey']) {
      expect(parsed).not.toHaveProperty(key);
    }
    for (const key of ['riwaya', 'isActive', 'teacherUserId']) {
      expect(parsed.packages[0]).not.toHaveProperty(key);
    }
    for (const key of ['riwaya', 'tariq', 'chain']) {
      expect(discoveryTeacherOutput.shape).not.toHaveProperty(key);
    }
  });
});
