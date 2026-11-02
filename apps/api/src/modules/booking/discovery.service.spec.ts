// T026 — discovery composed in booking (R-205): catalog's cards for the page (its discovery service,
// reached through the `DiscoveryCatalog` seam), then booking's nearest free slot for the teachers of
// that page and no other, both asked with the requester's gender the procedure handed in; a card
// whose teacher has no free slot keeps no `nearestSlot`. `filters` and `teacher` (T027) are catalog's
// answers as they are.
import type { DiscoveryBrowseInput } from '@ijazah/contracts';
import { describe, expect, it } from 'vitest';

import type { RequesterGender } from '../../platform/guards/requester-gender.js';
import {
  type CatalogDiscoveryCard,
  type DiscoveryCatalog,
  DiscoveryService,
  type NearestSlots,
} from './discovery.service.js';

const FEMALE = 'female' as RequesterGender;
const FIRST = '0199d0a0-0000-7000-8000-0000000000d1';
const SECOND = '0199d0a0-0000-7000-8000-0000000000d2';
const SUBJECT = { id: '0199d0a0-0000-7000-8000-0000000000d3', nameAr: 'القرآن', nameEn: 'Quran' };
const PROFILE = {
  teacherId: FIRST,
  displayName: 'Teacher',
  gender: 'female' as const,
  bio: 'Bio',
  qualificationSummary: 'Ijazah',
  subjects: [SUBJECT],
  reviewCount: 0,
  packages: [],
};

function card(teacherId: string): CatalogDiscoveryCard {
  return {
    teacherId,
    displayName: 'Teacher',
    subjects: [SUBJECT],
    tracks: ['recitation'],
    bioExcerpt: 'Bio',
    reviewCount: 0,
    lowestPerSession_piasters: 12_500,
  };
}

function world() {
  const calls: unknown[][] = [];
  const catalog: DiscoveryCatalog = {
    browse: async (...args) => {
      calls.push(['catalog.browse', ...args]);
      return {
        tabs: [{ subjectId: null, count: 2 }],
        cards: [card(FIRST), card(SECOND)],
        nextCursor: 'next-page',
      };
    },
    filters: async (...args) => {
      calls.push(['catalog.filters', ...args]);
      return { riwayas: ['حفص عن عاصم'] };
    },
    teacher: async (...args) => {
      calls.push(['catalog.teacher', ...args]);
      return PROFILE;
    },
  };
  const nearest: NearestSlots = {
    of: async (...args) => {
      calls.push(['nearest', ...args]);
      return new Map([[SECOND, { startsAt: '2026-11-04T09:00:00Z', timezone: 'Africa/Cairo' }]]);
    },
  };
  return { calls, service: new DiscoveryService({ catalog, nearest }) };
}

describe('DiscoveryService.browse (R-205, FR-335)', () => {
  it("adds the nearest free slot to the page's cards, asking for the page's teachers only", async () => {
    const { calls, service } = world();
    const input: DiscoveryBrowseInput = { subjectId: SUBJECT.id, minRating: 4 };
    await expect(service.browse(FEMALE, input)).resolves.toEqual({
      tabs: [{ subjectId: null, count: 2 }],
      cards: [
        card(FIRST),
        {
          ...card(SECOND),
          nearestSlot: { startsAt: '2026-11-04T09:00:00Z', timezone: 'Africa/Cairo' },
        },
      ],
      nextCursor: 'next-page',
    });
    expect(calls).toEqual([
      ['catalog.browse', FEMALE, input],
      ['nearest', FEMALE, [FIRST, SECOND]],
    ]);
  });
});

describe('DiscoveryService.filters (FR-334)', () => {
  it("answers catalog's riwayas, asked with the requester's gender", async () => {
    const { calls, service } = world();
    await expect(service.filters(FEMALE, { subjectId: SUBJECT.id })).resolves.toEqual({
      riwayas: ['حفص عن عاصم'],
    });
    expect(calls).toEqual([['catalog.filters', FEMALE, { subjectId: SUBJECT.id }]]);
  });
});

describe('DiscoveryService.teacher (T027, FR-336)', () => {
  it("answers catalog's profile, asked with the requester's gender, and reads no slot", async () => {
    const { calls, service } = world();
    await expect(service.teacher(FEMALE, { teacherId: FIRST })).resolves.toEqual(PROFILE);
    expect(calls).toEqual([['catalog.teacher', FEMALE, { teacherId: FIRST }]]);
  });
});
