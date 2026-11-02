// T029 (FR-332 to FR-334): what the discovery tab asks for each choice, and which state it draws.
import { describe, expect, it } from '@jest/globals';

import {
  appliedFilters,
  browseQueryOf,
  type DiscoveryChoice,
  discoveryView,
  filterCount,
  NO_FILTERS,
  searchOf,
  withFilter,
} from './state';

const QURAN = '0193a6f0-0000-7000-8000-0000000000a1';

const choice = (over: Partial<DiscoveryChoice>): DiscoveryChoice => ({
  subjectId: null,
  search: '',
  filters: NO_FILTERS,
  ...over,
});

describe('browseQueryOf', () => {
  it('asks the tab of all subjects with nothing, and a subject tab with its subject', () => {
    expect(browseQueryOf(choice({}))).toEqual({});
    expect(browseQueryOf(choice({ subjectId: QURAN }))).toEqual({ subjectId: QURAN });
  });

  it('sends the filters in force, the riwaya only within a subject (FR-334)', () => {
    const filters = { track: 'ijazah_track', minRating: 4, riwaya: 'حفص عن عاصم' } as const;
    expect(browseQueryOf(choice({ subjectId: QURAN, filters }))).toEqual({
      subjectId: QURAN,
      track: 'ijazah_track',
      minRating: 4,
      riwaya: 'حفص عن عاصم',
    });
    expect(browseQueryOf(choice({ filters }))).toEqual({ track: 'ijazah_track', minRating: 4 });
  });

  it('searches every subject: no subject and no riwaya, the track and the rating kept (FR-333)', () => {
    const filters = { track: 'recitation', minRating: 3, riwaya: 'ورش عن نافع' } as const;
    expect(browseQueryOf(choice({ subjectId: QURAN, search: '  أحمد ', filters }))).toEqual({
      query: 'أحمد',
      track: 'recitation',
      minRating: 3,
    });
  });

  it('cuts a search at the contract bound and treats spaces alone as no search', () => {
    expect(searchOf('   ')).toBe('');
    expect(searchOf('ا'.repeat(150))).toHaveLength(100);
    expect(browseQueryOf(choice({ search: '   ' }))).toEqual({});
  });
});

describe('appliedFilters and filterCount', () => {
  it('counts each filter in force, the riwaya out of force outside its subject', () => {
    const filters = { track: 'recitation', minRating: 5, riwaya: 'حفص عن عاصم' } as const;
    expect(filterCount(appliedFilters(choice({ subjectId: QURAN, filters })))).toBe(3);
    expect(filterCount(appliedFilters(choice({ filters })))).toBe(2);
    expect(filterCount(appliedFilters(choice({ subjectId: QURAN, search: 'أ', filters })))).toBe(2);
    expect(filterCount(NO_FILTERS)).toBe(0);
  });
});

describe('withFilter', () => {
  it('sets one filter and removes it again, the others kept', () => {
    const set = withFilter({ track: 'recitation' }, 'minRating', 4);
    expect(set).toEqual({ track: 'recitation', minRating: 4 });
    expect(withFilter(set, 'minRating', undefined)).toEqual({ track: 'recitation' });
    expect(withFilter(set, 'riwaya', undefined)).toEqual(set);
  });
});

describe('discoveryView', () => {
  const view = (over: Partial<Parameters<typeof discoveryView>[0]>) =>
    discoveryView({ loaded: true, allCount: 3, cardCount: 2, searching: false, ...over });

  it('loads first, then says no teacher at all when the tab of all subjects counts none', () => {
    expect(view({ loaded: false })).toBe('loading');
    expect(view({ allCount: 0, cardCount: 0 })).toBe('noTeachers');
    expect(view({ allCount: 0, cardCount: 0, searching: true })).toBe('noTeachers');
  });

  it('draws the cards, or the empty state of a search or of the section and its filters', () => {
    expect(view({})).toBe('cards');
    expect(view({ cardCount: 0, searching: true })).toBe('searchEmpty');
    expect(view({ cardCount: 0 })).toBe('filteredEmpty');
  });
});
