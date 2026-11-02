// T029 (FR-332 to FR-335): the discovery tab against the boards (screens.md §4), in both languages.
// The subject tabs with their counts (FR-332, the first page's); the cards with the name, the
// subjects, the track badges, the bio's first line, the rating and its count, the nearest slot in
// the student's own zone and the lowest price per session, and no photo (FR-335, the owner's
// decision of 2026-11-02); the next page asked with the cursor the last answered; the search across
// every subject with the matched prefix marked (FR-333); the filters applied as chips removable one
// by one (FR-334); the empty states, the state with no teacher at all, a failed read and no
// connection. Each case waits for the loaded content itself, never for a header the loading state
// also draws (PR #117's review).
import type { DiscoveryBrowseInput, DiscoveryCard, MeOutput } from '@ijazah/contracts';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { piasters } from '@ijazah/money';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import {
  colour,
  inBothDirections,
  nodesOf,
  renderIn,
  styleOf,
  unmarked,
} from '../../../design/primitives/__tests__/harness';
import { type MessageKey, type MessageValues, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import { formatPounds, formatTime, formatWeekdayDate } from '../../../lib/formatters';
import { fakeApi } from '../../shared/__tests__/api-double';
import { browseQueryKey } from './api';
import { Discovery } from './index';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (route: unknown) => mockPush(route), navigate: jest.fn() },
}));

const QURAN = { id: '0193a6f0-0000-7000-8000-0000000000a1', nameAr: 'حفظ القرآن', nameEn: 'Quran' };
const TAJWEED = {
  id: '0193a6f0-0000-7000-8000-0000000000a2',
  nameAr: 'التجويد',
  nameEn: 'Tajweed',
};

/** The student lives in Riyadh; the teacher's slot is in Cairo's zone. */
const STUDENT_ZONE = 'Asia/Riyadh';

const me: MeOutput = {
  userId: '0193a6f0-0000-7000-8000-000000000001',
  role: 'student',
  displayName: 'أمل حسن',
  email: 'amal@example.com',
  gender: 'female',
  dateOfBirth: '2004-03-12',
  preferredLanguage: 'ar',
  timezone: STUDENT_ZONE,
  signInMethod: 'google',
  memberSince: '2026-02-02T09:00:00Z',
  accountStatus: 'active',
  landing: 'student_home',
};

const ahmed: DiscoveryCard = {
  teacherId: '0193a6f0-0000-7000-8000-0000000000c1',
  displayName: 'الشيخة أمينة المصري',
  // Set to show the card never draws it (the owner's decision of 2026-11-02).
  photoUrl: 'https://files.ijazah.test/photos/c1.jpg?signature=1',
  subjects: [QURAN, TAJWEED],
  tracks: ['recitation', 'ijazah_track'],
  bioExcerpt: 'أدرّس الحفظ والمراجعة للكبار منذ اثني عشر عامًا',
  rating: 4.86,
  reviewCount: 86,
  nearestSlot: { startsAt: '2026-11-08T17:30:00.000Z', timezone: 'Africa/Cairo' },
  lowestPerSession_piasters: 15_000,
};

const mahmoud: DiscoveryCard = {
  teacherId: '0193a6f0-0000-7000-8000-0000000000c2',
  displayName: 'الشيخة مريم فتحي',
  subjects: [QURAN],
  tracks: ['recitation'],
  bioExcerpt: 'نبدأ من مخارج الحروف',
  reviewCount: 0,
  lowestPerSession_piasters: 12_050,
};

const khadija: DiscoveryCard = {
  teacherId: '0193a6f0-0000-7000-8000-0000000000c3',
  displayName: 'الشيخة خديجة عبد العزيز',
  subjects: [TAJWEED],
  tracks: ['ijazah_track'],
  bioExcerpt: 'عشرون عامًا في الإقراء',
  rating: 5,
  reviewCount: 12,
  lowestPerSession_piasters: 18_000,
};

const TABS = [
  { subjectId: null, count: 3 },
  { subjectId: QURAN.id, nameAr: QURAN.nameAr, nameEn: QURAN.nameEn, count: 2 },
  { subjectId: TAJWEED.id, nameAr: TAJWEED.nameAr, nameEn: TAJWEED.nameEn, count: 1 },
];

const CURSOR = 'opaque-cursor-1';

type Browse = (input?: unknown) => Promise<unknown>;

/** Every subject's teachers in two pages, a subject's in one, a search marking its prefix. */
const answer: Browse = async (raw) => {
  const input = (raw ?? {}) as DiscoveryBrowseInput;
  if (input.query !== undefined) {
    return {
      tabs: TABS,
      cards: [{ ...ahmed, match: { length: 'الشيخة أ'.length } }],
    };
  }
  if (input.subjectId === QURAN.id) return { tabs: TABS, cards: [ahmed, mahmoud] };
  if (input.cursor === CURSOR) return { cards: [khadija] };
  return { tabs: TABS, cards: [ahmed, mahmoud], nextCursor: CURSOR };
};

const said = (direction: 'rtl' | 'ltr', key: MessageKey, values?: MessageValues) =>
  translate(direction === 'rtl' ? 'ar' : 'en', key, values);
const ar = (key: MessageKey, values?: MessageValues) => translate('ar', key, values);
const localeOf = (direction: 'rtl' | 'ltr') => (direction === 'rtl' ? 'ar' : 'en');
const named = (direction: 'rtl' | 'ltr', subject: typeof QURAN) =>
  direction === 'rtl' ? subject.nameAr : subject.nameEn;

/** The nearest slot's line, in the student's zone. */
const nearestLine = (direction: 'rtl' | 'ltr', startsAt: string) =>
  said(direction, 'student.discovery.card.nearestSlot', {
    slot: said(direction, 'common.format.dateTime', {
      date: formatWeekdayDate(startsAt, STUDENT_ZONE, localeOf(direction)),
      time: formatTime(startsAt, STUDENT_ZONE, localeOf(direction)),
    }),
  });

const priceLine = (direction: 'rtl' | 'ltr', amount: number) =>
  said(direction, 'student.discovery.card.from', {
    price: formatPounds(piasters(amount), localeOf(direction)),
  });

let queries: QueryClient;
const withQueries = (ui: () => ReactElement) => () => (
  <QueryClientProvider client={queries}>{ui()}</QueryClientProvider>
);
const discovery = withQueries(() => <Discovery />);

const browse = () => mockApi.api.discovery.browse.query;
const browsedWith = () => browse().mock.calls.map(([input]) => input);

beforeEach(() => {
  mockApi = fakeApi();
  mockApi.api.discovery.browse.query.mockImplementation(answer);
  mockApi.api.discovery.filters.query.mockResolvedValue({
    riwayas: ['حفص عن عاصم', 'ورش عن نافع'],
  });
  mockPush.mockReset();
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, me);
});
afterEach(() => onlineManager.setOnline(true));

describe('Discovery (FR-332, FR-335)', () => {
  it('draws the subject tabs with their counts and each card, with no photo', async () => {
    await inBothDirections(discovery, async (rendered, direction) => {
      expect(await screen.findByText(ahmed.displayName)).toBeTruthy();
      expect(screen.getByText(mahmoud.displayName)).toBeTruthy();

      const tabs = screen.getAllByRole('tab');
      expect(tabs).toHaveLength(3);
      expect(screen.getByText(said(direction, 'student.discovery.all'))).toBeTruthy();
      expect(screen.getByText('3')).toBeTruthy();
      expect(screen.getByText('2')).toBeTruthy();
      expect(screen.getByText('1')).toBeTruthy();
      expect(tabs[0]?.props.accessibilityState).toMatchObject({ selected: true });

      // The first card: its subjects, both track badges, its bio, its rating, its slot, its price.
      expect(
        screen.getByText(
          `${named(direction, QURAN)}${said(direction, 'student.discovery.card.subjectsSeparator')}${named(direction, TAJWEED)}`,
        ),
      ).toBeTruthy();
      expect(screen.getAllByText(said(direction, 'common.track.recitation'))).toHaveLength(2);
      expect(screen.getAllByText(said(direction, 'common.track.ijazahTrack'))).toHaveLength(1);
      const bio = screen.getByText(
        said(direction, 'student.discovery.card.bio', { bio: ahmed.bioExcerpt }),
      );
      expect(bio.props.numberOfLines).toBe(2);
      expect(
        screen.getByText(
          said(direction, 'student.discovery.card.ratingCount', { rating: 4.86, count: 86 }),
        ),
      ).toBeTruthy();
      expect(screen.getByText(nearestLine(direction, ahmed.nearestSlot!.startsAt))).toBeTruthy();
      expect(screen.getByText(priceLine(direction, 15_000))).toBeTruthy();

      // The second card: no review yet, no free slot, a price with its piasters.
      expect(screen.getByText(said(direction, 'student.teacherProfile.noReviews'))).toBeTruthy();
      expect(screen.getByText(priceLine(direction, 12_050))).toBeTruthy();
      // Only the first card has a free slot.
      const slotPrefix = unmarked(
        said(direction, 'student.discovery.card.nearestSlot', { slot: '' }),
      ).trim();
      expect(screen.queryAllByText(new RegExp(`^${slotPrefix}`))).toHaveLength(1);

      // No photo and no avatar in its place.
      expect(nodesOf(rendered).filter((node) => node.type === 'Image')).toHaveLength(0);
      expect(screen.queryByText('أ')).toBeNull();
    });
  });

  it('shows the nearest slot in the student’s zone, not the slot’s', async () => {
    await renderIn('rtl', discovery());
    expect(await screen.findByText(nearestLine('rtl', ahmed.nearestSlot!.startsAt))).toBeTruthy();
    expect(formatTime(ahmed.nearestSlot!.startsAt, STUDENT_ZONE, 'ar')).not.toBe(
      formatTime(ahmed.nearestSlot!.startsAt, 'Africa/Cairo', 'ar'),
    );
  });

  it('asks a subject tab with its subject and keeps the first page’s tabs', async () => {
    await renderIn('rtl', discovery());
    expect(await screen.findByText(ahmed.displayName)).toBeTruthy();
    await fireEvent.press(screen.getAllByRole('tab')[1]!);
    await waitFor(() => expect(browsedWith()).toContainEqual({ subjectId: QURAN.id }));
    await waitFor(() =>
      expect(screen.getAllByRole('tab')[1]?.props.accessibilityState).toMatchObject({
        selected: true,
      }),
    );
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });

  it('asks the next page with the cursor the last page answered, the tabs on the first only', async () => {
    await renderIn('rtl', discovery());
    expect(await screen.findByText(ahmed.displayName)).toBeTruthy();
    expect(screen.queryByText(khadija.displayName)).toBeNull();
    await reachEnd(screen.getByText(ahmed.displayName));
    expect(await screen.findByText(khadija.displayName)).toBeTruthy();
    expect(browsedWith()).toContainEqual({ cursor: CURSOR });
    // The second page carries no tabs; the first page's stay.
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.getByText(ahmed.displayName)).toBeTruthy();
  });

  it('opens the teacher’s page from a card', async () => {
    await renderIn('rtl', discovery());
    await fireEvent.press(await screen.findByText(mahmoud.displayName));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(student)/discovery/[teacherId]',
      params: { teacherId: mahmoud.teacherId },
    });
  });
});

describe('DiscoverySearch and DiscoverySearchEmpty (FR-333)', () => {
  it('searches every subject, hides the tabs and marks the matched prefix', async () => {
    await inBothDirections(discovery, async (rendered, direction) => {
      expect(await screen.findByText(mahmoud.displayName)).toBeTruthy();
      await fireEvent.press(screen.getAllByRole('tab')[1]!);
      await fireEvent.changeText(
        screen.getByPlaceholderText(said(direction, 'student.discovery.searchPlaceholder')),
        'الشيخة أ',
      );
      await waitFor(() => expect(screen.queryByText(mahmoud.displayName)).toBeNull());
      expect(browsedWith()).toContainEqual({ query: 'الشيخة أ' });
      expect(screen.queryAllByRole('tab')).toHaveLength(0);
      const marked = screen.getByText('الشيخة أ');
      expect(styleOf(marked)['color']).toBe(colour('light', 'primary'));
      expect(screen.getByText(ahmed.displayName)).toBeTruthy();
      expect(nodesOf(rendered).filter((node) => node.type === 'Image')).toHaveLength(0);
    });
  });

  it('says a search found nobody, and clears it back to the tabs', async () => {
    mockApi.api.discovery.browse.query.mockImplementation(async (raw) => {
      const input = (raw ?? {}) as DiscoveryBrowseInput;
      return input.query === undefined ? answer(raw) : { tabs: TABS, cards: [] };
    });
    await inBothDirections(discovery, async (_rendered, direction) => {
      expect(await screen.findByText(ahmed.displayName)).toBeTruthy();
      await fireEvent.changeText(
        screen.getByPlaceholderText(said(direction, 'student.discovery.searchPlaceholder')),
        'زيد',
      );
      expect(
        await screen.findByText(said(direction, 'student.discovery.search.empty.title')),
      ).toBeTruthy();
      expect(
        screen.getByText(
          said(direction, 'student.discovery.search.resultCount', { count: 0, query: 'زيد' }),
        ),
      ).toBeTruthy();
      expect(screen.getByText(said(direction, 'student.discovery.search.empty.text'))).toBeTruthy();
      // No promise of a search by subject until T070 builds it (the owner's decision of 2026-11-02).
      expect(screen.queryByText(/المادة|subject/i)).toBeNull();
      expect(screen.queryByPlaceholderText(/المادة|subject/i)).toBeNull();
      await fireEvent.press(
        screen.getByRole('button', {
          name: said(direction, 'student.discovery.search.empty.clear'),
        }),
      );
      expect(await screen.findByText(ahmed.displayName)).toBeTruthy();
      expect(screen.getAllByRole('tab')).toHaveLength(3);
    });
  });
});

describe('DiscoveryFilter, DiscoveryFiltered and DiscoveryEmpty (FR-334)', () => {
  async function openFilters(direction: 'rtl' | 'ltr') {
    await fireEvent.press(
      screen.getByRole('button', { name: said(direction, 'common.a11y.filters') }),
    );
  }

  it('applies the rating, the riwaya of the subject and the track, each a removable chip', async () => {
    await inBothDirections(discovery, async (_rendered, direction) => {
      expect(await screen.findByText(ahmed.displayName)).toBeTruthy();
      await fireEvent.press(screen.getAllByRole('tab')[1]!);
      await waitFor(() => expect(browsedWith()).toContainEqual({ subjectId: QURAN.id }));
      await openFilters(direction);
      const fourStars = said(direction, 'student.discovery.filter.starsAndUp', { count: 4 });
      await fireEvent.press(await screen.findByRole('button', { name: fourStars }));
      await fireEvent.press(await screen.findByRole('button', { name: 'حفص عن عاصم' }));
      expect(
        screen.getByText(
          said(direction, 'student.discovery.filter.riwaya', { subject: named(direction, QURAN) }),
        ),
      ).toBeTruthy();
      await fireEvent.press(
        screen.getByRole('button', { name: said(direction, 'common.track.ijazahTrack') }),
      );
      await fireEvent.press(
        screen.getByRole('button', { name: said(direction, 'student.discovery.filter.apply') }),
      );
      await waitFor(() =>
        expect(browsedWith()).toContainEqual({
          subjectId: QURAN.id,
          track: 'ijazah_track',
          minRating: 4,
          riwaya: 'حفص عن عاصم',
        }),
      );
      expect(mockApi.api.discovery.filters.query).toHaveBeenCalledWith({ subjectId: QURAN.id });
      expect(
        screen.getByRole('button', {
          name: said(direction, 'common.a11y.filtersActive', { count: 3 }),
        }),
      ).toBeTruthy();

      // Each chip removes its own filter.
      await fireEvent.press(screen.getByRole('button', { name: fourStars }));
      await waitFor(() =>
        expect(browsedWith()).toContainEqual({
          subjectId: QURAN.id,
          track: 'ijazah_track',
          riwaya: 'حفص عن عاصم',
        }),
      );
      expect(screen.queryByRole('button', { name: fourStars })).toBeNull();
      expect(screen.getByRole('button', { name: 'حفص عن عاصم' })).toBeTruthy();
      await fireEvent.press(
        screen.getByRole('link', { name: said(direction, 'common.action.clearAll') }),
      );
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: said(direction, 'common.a11y.filters') }),
        ).toBeTruthy(),
      );
      expect(screen.queryByRole('button', { name: 'حفص عن عاصم' })).toBeNull();
    });
  });

  it('offers no riwaya on the tab of all subjects', async () => {
    await renderIn('rtl', discovery());
    expect(await screen.findByText(ahmed.displayName)).toBeTruthy();
    await openFilters('rtl');
    expect(
      await screen.findByRole('button', { name: ar('student.discovery.filter.apply') }),
    ).toBeTruthy();
    expect(
      screen.queryByText(ar('student.discovery.filter.riwaya', { subject: QURAN.nameAr })),
    ).toBeNull();
    expect(mockApi.api.discovery.filters.query).not.toHaveBeenCalled();
  });

  it('says no teacher matches the filters, and clears them', async () => {
    mockApi.api.discovery.browse.query.mockImplementation(async (raw) => {
      const input = (raw ?? {}) as DiscoveryBrowseInput;
      return input.track === undefined ? answer(raw) : { tabs: TABS, cards: [] };
    });
    await inBothDirections(discovery, async (_rendered, direction) => {
      expect(await screen.findByText(ahmed.displayName)).toBeTruthy();
      await openFilters(direction);
      await fireEvent.press(
        await screen.findByRole('button', { name: said(direction, 'common.track.recitation') }),
      );
      await fireEvent.press(
        screen.getByRole('button', { name: said(direction, 'student.discovery.filter.apply') }),
      );
      expect(
        await screen.findByText(said(direction, 'student.discovery.empty.title')),
      ).toBeTruthy();
      expect(screen.getByText(said(direction, 'student.discovery.empty.text'))).toBeTruthy();
      expect(
        screen.getByRole('button', { name: said(direction, 'common.track.recitation') }),
      ).toBeTruthy();
      await fireEvent.press(
        screen.getByRole('button', {
          name: said(direction, 'student.discovery.empty.clearFilters'),
        }),
      );
      expect(await screen.findByText(ahmed.displayName)).toBeTruthy();
    });
  });

  it('says a section with no filter in force is empty, naming no filter and clearing none', async () => {
    mockApi.api.discovery.browse.query.mockImplementation(async (raw) => {
      const input = (raw ?? {}) as DiscoveryBrowseInput;
      return input.subjectId === undefined ? answer(raw) : { cards: [] };
    });
    await inBothDirections(discovery, async (_rendered, direction) => {
      expect(await screen.findByText(ahmed.displayName)).toBeTruthy();
      await fireEvent.press(screen.getAllByRole('tab')[1]!);
      expect(
        await screen.findByText(said(direction, 'student.discovery.empty.sectionTitle')),
      ).toBeTruthy();
      expect(screen.getByText(said(direction, 'student.discovery.empty.sectionText'))).toBeTruthy();
      expect(screen.queryByText(said(direction, 'student.discovery.empty.title'))).toBeNull();
      expect(
        screen.queryByRole('button', {
          name: said(direction, 'student.discovery.empty.clearFilters'),
        }),
      ).toBeNull();
    });
  });
});

describe('DiscoveryNoTeachers and the shared states', () => {
  it('says no teacher is available yet, with no search or tabs, and refreshes', async () => {
    mockApi.api.discovery.browse.query.mockResolvedValue({
      tabs: [{ subjectId: null, count: 0 }],
      cards: [],
    });
    await inBothDirections(discovery, async (_rendered, direction) => {
      expect(
        await screen.findByText(said(direction, 'student.discovery.noTeachers.title')),
      ).toBeTruthy();
      expect(screen.getByText(said(direction, 'student.discovery.noTeachers.text'))).toBeTruthy();
      expect(
        screen.queryByPlaceholderText(said(direction, 'student.discovery.searchPlaceholder')),
      ).toBeNull();
      expect(screen.queryAllByRole('tab')).toHaveLength(0);
      const before = browse().mock.calls.length;
      await fireEvent.press(
        screen.getByRole('button', {
          name: said(direction, 'student.discovery.noTeachers.refresh'),
        }),
      );
      await waitFor(() => expect(browse().mock.calls.length).toBeGreaterThan(before));
    });
  });

  it('says a failed read with its retry, then draws the cards', async () => {
    mockApi.api.discovery.browse.query.mockRejectedValueOnce(new Error('down'));
    await renderIn('rtl', discovery());
    expect(await screen.findByText(ar('common.state.loadError'))).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: ar('common.action.retry') }));
    expect(await screen.findByText(ahmed.displayName)).toBeTruthy();
  });

  it('says there is no connection when nothing is cached', async () => {
    onlineManager.setOnline(false);
    await renderIn('rtl', discovery());
    expect(await screen.findByText(ar('common.state.offline'))).toBeTruthy();
    expect(screen.queryByText(ahmed.displayName)).toBeNull();
  });

  it('keeps the cached cards under the offline banner', async () => {
    queries.setQueryData(browseQueryKey({}), {
      pages: [{ tabs: TABS, cards: [ahmed] }],
      pageParams: [undefined],
    });
    onlineManager.setOnline(false);
    await renderIn('rtl', discovery());
    expect(await screen.findByText(ahmed.displayName)).toBeTruthy();
    expect(screen.getByText(ar('common.state.offline'))).toBeTruthy();
  });
});

type Instance = ReturnType<typeof screen.getByText>;

/** Brings the list holding `inside` to its end, as the student does scrolling to read the next page. */
async function reachEnd(inside: Instance) {
  let list: Instance | null = inside;
  while (list !== null && list.props['onEndReached'] === undefined) list = list.parent;
  if (list === null) throw new Error('no list pages');
  await fireEvent(list, 'endReached', { distanceFromEnd: 0 });
}
