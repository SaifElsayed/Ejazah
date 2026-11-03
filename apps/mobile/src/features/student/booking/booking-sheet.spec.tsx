// T044 (FR-350, FR-351, FR-386; screens.md §5 BookingSheet and SlotTaken): the booking sheet over the
// teacher's page, in both languages. It shows the package, then the slots of its length as
// `booking.slots` answers them, each as the teacher set it in the teacher's zone and, where the
// student lives in another zone, as it falls in the student's (ADR 0009 D5); the selected slot's first
// and last session dates; «متابعة إلى الدفع» disabled until a free slot is chosen, which places the
// hold keyed (FR-106) and goes to the checkout. `SLOT_TAKEN` keeps the sheet with the taken slot
// marked and disabled; `PREVIOUS_CHECKOUT` goes to `CheckoutPrevious`. Each case waits for the
// slots themselves before reading them (PR #120's pipeline).
import type { BookingSlotsOutput, DiscoveryTeacherPackage, MeOutput } from '@ijazah/contracts';
import { cityOf } from '@ijazah/time/cities';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { inBothDirections, renderIn } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, type MessageValues, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import {
  formatDate,
  formatTime,
  formatWallClock,
  formatWeekday,
  weekdayIn,
} from '../../../lib/formatters';
import { apiError, fakeApi } from '../../shared/__tests__/api-double';
import { BookingSheet } from './index';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));

const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    push: (route: unknown) => mockNavigate(route),
    back: () => mockNavigate('back'),
  },
}));

let mockKey = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `hold-key-${String(++mockKey)}` }));

type Direction = 'rtl' | 'ltr';

const TEACHER_ZONE = 'Africa/Cairo';
const RIYADH = 'Asia/Riyadh';
const QURAN = {
  id: '0193a6f0-0000-7000-8000-0000000000a1',
  nameAr: 'حفظ القرآن',
  nameEn: 'Quran memorization',
};

const item: DiscoveryTeacherPackage = {
  packageId: '0193a6f0-0000-7000-8000-0000000000b1',
  subject: QURAN,
  track: 'recitation',
  sessionCount: 8,
  sessionDurationMinutes: 45,
  price_piasters: 120_000,
  perSession_piasters: 15_000,
};

/** Thursday 20:00 in Cairo (18:00 UTC in November): Thursday 21:00 in Riyadh. */
const thursday = {
  slotId: '0193a6f0-0000-7000-8000-0000000000e1',
  dayOfWeek: 4,
  startTimeLocal: '20:00',
  durationMinutes: 45,
  firstSession: { localDate: '2026-11-12', startsAt: '2026-11-12T18:00:00.000Z' },
  lastSession: { localDate: '2026-12-31', startsAt: '2026-12-31T18:00:00.000Z' },
} as const;
/** Saturday 23:30 in Cairo: past midnight in Riyadh, so a Sunday there. */
const saturday = {
  slotId: '0193a6f0-0000-7000-8000-0000000000e2',
  dayOfWeek: 6,
  startTimeLocal: '23:30',
  durationMinutes: 45,
  firstSession: { localDate: '2026-11-07', startsAt: '2026-11-07T21:30:00.000Z' },
  lastSession: { localDate: '2026-12-26', startsAt: '2026-12-26T21:30:00.000Z' },
} as const;

const answer: BookingSlotsOutput = { teacherTimezone: TEACHER_ZONE, slots: [thursday, saturday] };

const me = (timezone: string): MeOutput => ({
  userId: '0193a6f0-0000-7000-8000-000000000001',
  role: 'student',
  displayName: 'أمل حسن',
  email: 'amal@example.com',
  gender: 'female',
  dateOfBirth: '2004-03-12',
  preferredLanguage: 'ar',
  timezone,
  signInMethod: 'google',
  memberSince: '2026-02-02T09:00:00Z',
  accountStatus: 'active',
  landing: 'student_home',
});

const localeOf = (direction: Direction) => (direction === 'rtl' ? 'ar' : 'en');
const said = (direction: Direction, key: MessageKey, values?: MessageValues) =>
  translate(localeOf(direction), key, values);
const ar = (key: MessageKey, values?: MessageValues) => translate('ar', key, values);

type Slot = typeof thursday | typeof saturday;

/** A slot as the teacher set it, in the teacher's zone: «الخميس · 8:00 م». */
const slotLabel = (direction: Direction, slot: Slot) =>
  said(direction, 'common.format.dateTime', {
    date: formatWeekday(slot.dayOfWeek, localeOf(direction)),
    time: formatWallClock(slot.startTimeLocal, localeOf(direction)),
  });

/** The slot's first session as it falls in `zone`, the student's. */
const inZone = (direction: Direction, slot: Slot, zone: string) =>
  said(direction, 'student.booking.inYourZone', {
    slot: said(direction, 'common.format.dateTime', {
      date: formatWeekday(weekdayIn(slot.firstSession.startsAt, zone), localeOf(direction)),
      time: formatTime(slot.firstSession.startsAt, zone, localeOf(direction)),
    }),
  });

const rangeOf = (direction: Direction, slot: Slot) =>
  said(direction, 'student.booking.range', {
    firstDate: formatDate(slot.firstSession.startsAt, TEACHER_ZONE, localeOf(direction)),
    time: formatTime(slot.firstSession.startsAt, TEACHER_ZONE, localeOf(direction)),
    lastDate: formatDate(slot.lastSession.startsAt, TEACHER_ZONE, localeOf(direction)),
  });

const continueButton = (direction: Direction = 'rtl') =>
  screen.getByRole('button', { name: said(direction, 'student.booking.continueToPayment') });

const onClose = jest.fn();
let queries: QueryClient;
const sheet = (): ReactElement => (
  <QueryClientProvider client={queries}>
    <BookingSheet item={item} onClose={onClose} />
  </QueryClientProvider>
);

beforeEach(() => {
  mockApi = fakeApi();
  mockApi.api.booking.slots.query.mockResolvedValue(answer);
  mockApi.api.checkout.hold.mutate.mockResolvedValue({});
  mockNavigate.mockReset();
  onClose.mockReset();
  mockKey = 0;
  onlineManager.setOnline(true);
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, me(TEACHER_ZONE));
});
afterEach(() => onlineManager.setOnline(true));

describe('BookingSheet (FR-350, FR-386)', () => {
  it("shows the package, then its slots in the teacher's zone, with continue disabled", async () => {
    await inBothDirections(sheet, async (_rendered, direction) => {
      expect(await screen.findByText(slotLabel(direction, thursday))).toBeTruthy();
      expect(screen.getByText(slotLabel(direction, saturday))).toBeTruthy();
      expect(screen.getByText(said(direction, 'student.booking.title'))).toBeTruthy();
      expect(
        screen.getByText(
          said(direction, 'student.booking.packageLine', {
            subject: direction === 'rtl' ? QURAN.nameAr : QURAN.nameEn,
            sessions: item.sessionCount,
            minutes: item.sessionDurationMinutes,
            city: cityOf(TEACHER_ZONE, localeOf(direction)) ?? TEACHER_ZONE,
          }),
        ),
      ).toBeTruthy();
      expect(screen.getByText(said(direction, 'common.track.recitation'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'student.booking.availableSlots'))).toBeTruthy();
      // The student lives in the teacher's zone: one time each, no second line.
      expect(screen.queryByText(inZone(direction, thursday, TEACHER_ZONE))).toBeNull();
      expect(continueButton(direction).props.accessibilityState).toMatchObject({ disabled: true });
    });
    expect(mockApi.api.booking.slots.query).toHaveBeenCalledWith({ packageId: item.packageId });
  });

  it("adds each slot as it falls in the student's own zone when it is another (ADR 0009 D5)", async () => {
    queries.setQueryData(ME_QUERY_KEY, me(RIYADH));
    await inBothDirections(sheet, async (_rendered, direction) => {
      expect(await screen.findByText(slotLabel(direction, thursday))).toBeTruthy();
      expect(screen.getByText(inZone(direction, thursday, RIYADH))).toBeTruthy();
      // 23:30 in Cairo is past midnight in Riyadh: the day the student sees is Sunday.
      const sunday = inZone(direction, saturday, RIYADH);
      expect(sunday).toContain(formatWeekday(0, localeOf(direction)));
      expect(screen.getByText(sunday)).toBeTruthy();
    });
  });

  it('shows the chosen slot’s first and last session dates and enables continue', async () => {
    await inBothDirections(sheet, async (_rendered, direction) => {
      await fireEvent.press(await screen.findByText(slotLabel(direction, thursday)));
      expect(screen.getByText(rangeOf(direction, thursday))).toBeTruthy();
      expect(continueButton(direction).props.accessibilityState).toMatchObject({ disabled: false });
      await fireEvent.press(screen.getByText(slotLabel(direction, saturday)));
      expect(screen.getByText(rangeOf(direction, saturday))).toBeTruthy();
      expect(screen.queryByText(rangeOf(direction, thursday))).toBeNull();
    });
  });

  it('places the hold keyed, closes the sheet and goes to the checkout (FR-351)', async () => {
    await renderIn('rtl', sheet());
    await fireEvent.press(await screen.findByText(slotLabel('rtl', thursday)));
    await fireEvent.press(continueButton());
    expect(mockApi.api.checkout.hold.mutate).toHaveBeenCalledWith({
      packageId: item.packageId,
      slotId: thursday.slotId,
      idempotencyKey: 'hold-key-1',
    });
    expect(onClose).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/(student)/checkout');
  });

  it('sends the same key again after a failure, and a new one for another slot', async () => {
    mockApi.api.checkout.hold.mutate.mockRejectedValue(apiError('INTERNAL'));
    await renderIn('rtl', sheet());
    await fireEvent.press(await screen.findByText(slotLabel('rtl', thursday)));
    await fireEvent.press(continueButton());
    expect(await screen.findByText(ar('common.state.actionError'))).toBeTruthy();
    await fireEvent.press(continueButton());
    await fireEvent.press(screen.getByText(slotLabel('rtl', saturday)));
    await fireEvent.press(continueButton());
    const keys = mockApi.api.checkout.hold.mutate.mock.calls.map(
      ([input]) => (input as { idempotencyKey: string }).idempotencyKey,
    );
    expect(keys).toEqual(['hold-key-1', 'hold-key-1', 'hold-key-2']);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('on SLOT_TAKEN says so, marks the slot booked and disabled, and waits for another', async () => {
    mockApi.api.checkout.hold.mutate.mockRejectedValueOnce(apiError('SLOT_TAKEN'));
    await inBothDirections(sheet, async (_rendered, direction) => {
      await fireEvent.press(await screen.findByText(slotLabel(direction, thursday)));
      await fireEvent.press(continueButton(direction));
      const label = slotLabel(direction, thursday);
      expect(
        await screen.findByText(said(direction, 'student.booking.slotTaken', { slot: label })),
      ).toBeTruthy();
      const taken = screen.getByRole('button', {
        name: said(direction, 'student.booking.slotBooked', { slot: label }),
      });
      expect(taken.props.accessibilityState).toMatchObject({ disabled: true });
      expect(screen.queryByText(rangeOf(direction, thursday))).toBeNull();
      expect(continueButton(direction).props.accessibilityState).toMatchObject({ disabled: true });
      await fireEvent.press(screen.getByText(slotLabel(direction, saturday)));
      expect(continueButton(direction).props.accessibilityState).toMatchObject({ disabled: false });
      mockApi.api.checkout.hold.mutate.mockRejectedValueOnce(apiError('SLOT_TAKEN'));
    });
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('on PREVIOUS_CHECKOUT closes the sheet and goes to the unfinished payment (FR-BOOK-12)', async () => {
    mockApi.api.checkout.hold.mutate.mockRejectedValue(apiError('PREVIOUS_CHECKOUT'));
    await renderIn('rtl', sheet());
    await fireEvent.press(await screen.findByText(slotLabel('rtl', saturday)));
    await fireEvent.press(continueButton());
    expect(mockNavigate).toHaveBeenCalledWith('/(student)/checkout/previous');
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByText(ar('common.state.actionError'))).toBeNull();
  });

  it('with no free slot of the package’s length, says so and offers another package', async () => {
    mockApi.api.booking.slots.query.mockResolvedValue({ teacherTimezone: TEACHER_ZONE, slots: [] });
    await inBothDirections(sheet, async (_rendered, direction) => {
      expect(
        await screen.findByText(said(direction, 'student.booking.noSlots.title')),
      ).toBeTruthy();
      expect(screen.getByText(said(direction, 'student.booking.noSlots.text'))).toBeTruthy();
      expect(
        screen.queryByRole('button', {
          name: said(direction, 'student.booking.continueToPayment'),
        }),
      ).toBeNull();
    });
    await renderIn('rtl', sheet());
    await fireEvent.press(
      await screen.findByRole('button', { name: ar('student.booking.noSlots.action') }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('says so and reads again on retry when the slots cannot be read', async () => {
    mockApi.api.booking.slots.query.mockRejectedValueOnce(apiError('INTERNAL'));
    await renderIn('rtl', sheet());
    expect(await screen.findByText(ar('common.state.loadError'))).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: ar('common.action.retry') }));
    expect(await screen.findByText(slotLabel('rtl', thursday))).toBeTruthy();
    expect(mockApi.api.booking.slots.query).toHaveBeenCalledTimes(2);
  });

  it('closes from its close button', async () => {
    await renderIn('rtl', sheet());
    expect(await screen.findByText(slotLabel('rtl', thursday))).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: ar('common.a11y.close') }));
    expect(onClose).toHaveBeenCalled();
  });
});
