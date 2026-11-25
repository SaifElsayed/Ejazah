// 006:T019 (FR-701, FR-704; DEC-93, DEC-94): a programme package on the teacher's profile and its
// assessment's booking, in Arabic and English. The profile's card shows the subject with the
// track's badge, the per-session range (lowest to highest of the three prices) and the assessment's
// fee, all in pounds from piasters, and its bar opens the booking sheet. The sheet offers only the
// weekly times `booking.slots` answers (none inside a pending window: the server leaves them out),
// each with its own length, and the time chosen says the programme's sessions there last up to that
// length, and when the assessment falls; continuing holds that time for the package.
import type {
  BookingSlotsOutput,
  DiscoveryTeacherOutput,
  DiscoveryTeacherPackage,
  MeOutput,
} from '@ijazah/contracts';
import { cityOf } from '@ijazah/time/cities';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { piasters } from '@ijazah/money';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, screen } from '@testing-library/react-native';

import { inBothDirections, renderIn } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, type MessageValues, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import type { Direction } from '../../../lib/direction';
import {
  formatDate,
  formatPounds,
  formatTime,
  formatWallClock,
  formatWeekday,
} from '../../../lib/formatters';
import { fakeApi } from '../../shared/__tests__/api-double';
import { BookingSheet } from '../booking';
import { TeacherProfile } from '../discovery';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));
const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    push: (route: unknown) => mockNavigate(route),
    back: () => mockNavigate('back'),
  },
  useLocalSearchParams: () => ({ teacherId: '0193a6f0-0000-7000-8000-0000000000d1' }),
}));
let mockKey = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `hold-key-${++mockKey}` }));

const TEACHER_ZONE = 'Africa/Cairo';
const QURAN = {
  id: '0193a6f0-0000-7000-8000-0000000000a1',
  nameAr: 'حفظ القرآن',
  nameEn: 'Quran memorization',
};

const programmePackage: DiscoveryTeacherPackage = {
  packageId: '0193a6f0-0000-7000-8000-0000000000b9',
  subject: QURAN,
  track: 'ijazah_track',
  isProgramme: true,
  prices: { m30_piasters: 15_000, m45_piasters: 20_000, m60_piasters: 25_000 },
  priceRange: { lowest_piasters: 15_000, highest_piasters: 25_000 },
  assessmentPrice_piasters: 50_000,
};

const teacher: DiscoveryTeacherOutput = {
  teacherId: '0193a6f0-0000-7000-8000-0000000000d1',
  displayName: 'الشيخ أحمد المصري',
  gender: 'male',
  bio: 'أدرّس الحفظ والمراجعة.',
  qualificationSummary: 'إجازة في القراءات',
  subjects: [QURAN],
  reviewCount: 0,
  packages: [programmePackage],
};

/** Monday 20:00 in Cairo, 60 minutes; Thursday 18:00, 45 minutes. One session as both previews. */
const monday = {
  slotId: '0193a6f0-0000-7000-8000-0000000000e1',
  dayOfWeek: 1,
  startTimeLocal: '20:00',
  durationMinutes: 60,
  firstSession: { localDate: '2026-11-30', startsAt: '2026-11-30T18:00:00.000Z' },
  lastSession: { localDate: '2026-11-30', startsAt: '2026-11-30T18:00:00.000Z' },
} as const;
const thursday = {
  slotId: '0193a6f0-0000-7000-8000-0000000000e2',
  dayOfWeek: 4,
  startTimeLocal: '18:00',
  durationMinutes: 45,
  firstSession: { localDate: '2026-11-26', startsAt: '2026-11-26T16:00:00.000Z' },
  lastSession: { localDate: '2026-11-26', startsAt: '2026-11-26T16:00:00.000Z' },
} as const;
const answer: BookingSlotsOutput = { teacherTimezone: TEACHER_ZONE, slots: [monday, thursday] };

const me = { userId: '0193a6f0-0000-7000-8000-000000000001', timezone: TEACHER_ZONE } as MeOutput;
const localeOf = (direction: Direction) => (direction === 'rtl' ? 'ar' : 'en');
const said = (direction: Direction, key: MessageKey, values?: MessageValues) =>
  translate(localeOf(direction), key, values);
const named = (direction: Direction) => (direction === 'rtl' ? QURAN.nameAr : QURAN.nameEn);
const pounds = (direction: Direction, amount: number) =>
  formatPounds(piasters(amount), localeOf(direction));

type Slot = typeof monday | typeof thursday;
/** A weekly time as the teacher set it, with its own length. */
const slotLabel = (direction: Direction, slot: Slot) =>
  said(direction, 'programme.student.booking.slot', {
    slot: said(direction, 'common.format.dateTime', {
      date: formatWeekday(slot.dayOfWeek, localeOf(direction)),
      time: formatWallClock(slot.startTimeLocal, localeOf(direction)),
    }),
    minutes: slot.durationMinutes,
  });

let queries: QueryClient;
const onClose = jest.fn();
const profile = () => (
  <QueryClientProvider client={queries}>
    <TeacherProfile />
  </QueryClientProvider>
);
const sheet = () => (
  <QueryClientProvider client={queries}>
    <BookingSheet item={programmePackage} onClose={onClose} />
  </QueryClientProvider>
);

beforeEach(() => {
  mockApi = fakeApi();
  mockApi.api.discovery.teacher.query.mockResolvedValue(teacher);
  mockApi.api.booking.slots.query.mockResolvedValue(answer);
  mockApi.api.checkout.hold.mutate.mockResolvedValue({});
  mockNavigate.mockReset();
  onClose.mockReset();
  mockKey = 0;
  onlineManager.setOnline(true);
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, me);
});
afterEach(async () => {
  await cleanup();
  queries.clear();
});

describe('the profile’s programme card (FR-704)', () => {
  it('shows the subject, the track, the per-session range and the assessment’s fee', async () => {
    await inBothDirections(profile, async (_rendered, direction) => {
      // The subject: on the card, beside the subjects line under the name.
      expect(await screen.findAllByText(named(direction))).toHaveLength(2);
      expect(screen.getByText(said(direction, 'common.track.ijazahTrack'))).toBeTruthy();
      expect(
        screen.getByText(
          said(direction, 'programme.student.profile.range', {
            lowest: pounds(direction, 15_000),
            highest: pounds(direction, 25_000),
          }),
        ),
      ).toBeTruthy();
      expect(
        screen.getByText(
          said(direction, 'programme.student.profile.fee', { fee: pounds(direction, 50_000) }),
        ),
      ).toBeTruthy();
    });
  });

  it('its bar names the assessment and opens the booking sheet for the package', async () => {
    await inBothDirections(profile, async (_rendered, direction) => {
      const bar = await screen.findByRole('button', {
        name: said(direction, 'programme.student.profile.chooseSlot', {
          subject: named(direction),
        }),
      });
      await fireEvent.press(bar);
      expect(await screen.findByText(slotLabel(direction, monday))).toBeTruthy();
    });
    expect(mockApi.api.booking.slots.query).toHaveBeenCalledWith({
      packageId: programmePackage.packageId,
    });
  });
});

describe('the assessment’s booking (FR-701)', () => {
  it('the package line, and each weekly time the server answers with its own length, no other', async () => {
    await inBothDirections(sheet, async (_rendered, direction) => {
      expect(await screen.findByText(slotLabel(direction, monday))).toBeTruthy();
      expect(screen.getByText(slotLabel(direction, thursday))).toBeTruthy();
      expect(
        screen.getByText(
          said(direction, 'programme.student.booking.packageLine', {
            subject: named(direction),
            city: cityOf(TEACHER_ZONE, localeOf(direction)) ?? TEACHER_ZONE,
          }),
        ),
      ).toBeTruthy();
      // Hidden times: only what `booking.slots` answered is offered.
      const offered = screen
        .getAllByRole('button')
        .filter((node) => node.props.accessibilityState?.selected !== undefined);
      expect(offered).toHaveLength(answer.slots.length);
    });
  });

  it('the time chosen: the sessions there last up to its length, and the assessment’s date', async () => {
    await inBothDirections(sheet, async (_rendered, direction) => {
      await fireEvent.press(await screen.findByText(slotLabel(direction, thursday)));
      expect(
        screen.getByText(said(direction, 'programme.student.booking.upTo', { minutes: 45 })),
      ).toBeTruthy();
      expect(
        screen.getByText(
          said(direction, 'programme.student.booking.assessmentAt', {
            date: formatDate(thursday.firstSession.startsAt, TEACHER_ZONE, localeOf(direction)),
            time: formatTime(thursday.firstSession.startsAt, TEACHER_ZONE, localeOf(direction)),
          }),
        ),
      ).toBeTruthy();
      await fireEvent.press(screen.getByText(slotLabel(direction, monday)));
      expect(
        screen.getByText(said(direction, 'programme.student.booking.upTo', { minutes: 60 })),
      ).toBeTruthy();
      expect(
        screen.queryByText(said(direction, 'programme.student.booking.upTo', { minutes: 45 })),
      ).toBeNull();
    });
  });

  it('continuing holds the chosen time for the package and goes to the checkout', async () => {
    await renderIn('rtl', sheet());
    await fireEvent.press(await screen.findByText(slotLabel('rtl', monday)));
    await fireEvent.press(
      screen.getByRole('button', { name: said('rtl', 'student.booking.continueToPayment') }),
    );
    expect(mockApi.api.checkout.hold.mutate).toHaveBeenCalledWith({
      packageId: programmePackage.packageId,
      slotId: monday.slotId,
      idempotencyKey: 'hold-key-1',
    });
    expect(mockNavigate).toHaveBeenCalledWith('/(student)/checkout');
  });
});
