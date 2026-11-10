// T050 (FR-390, FR-393, FR-383, FR-384; screens.md §3): the student's home. `Main` draws the next
// session, the earliest of the active enrollments the server orders by next session, in the
// student's zone and the teacher's, with the active enrollments under it; with no active enrollment
// it is `StudentHomeEmpty`; with no connection, `MainOffline`: the cached home under the offline
// banner with the time it was last read. It decides only on an answer read since it opened (the
// owner's decision of 2026-11-04), and reads a Confirming enrollment on FR-383's schedule.
import type {
  EnrollmentsListOutput,
  ListedSession,
  MeOutput,
  StudentEnrollmentItem,
} from '@ijazah/contracts';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { cityOf } from '@ijazah/time/cities';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Text } from 'react-native';

import { inBothDirections, renderIn } from '../../../design/primitives/__tests__/harness';
import { type Locale, type MessageKey, type MessageValues, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import { formatTime, formatWeekdayDate } from '../../../lib/formatters';
import { apiError, CHECKOUT_POLLING, fakeApi } from '../../shared/__tests__/api-double';
import { ACTIVE_ENROLLMENTS_QUERY_KEY } from '../enrollments/api';
import { Main } from './index';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));

const mockPush = jest.fn();
const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    push: (route: unknown) => mockPush(route),
    navigate: (route: unknown) => mockNavigate(route),
  },
}));

type Direction = 'rtl' | 'ltr';

const ENROLLMENT_ID = '0193a6f0-0000-7000-8000-0000000000e1';
const TEACHER_ID = '0193a6f0-0000-7000-8000-0000000000d1';
const QURAN = { id: '0193a6f0-0000-7000-8000-0000000000a1', nameAr: 'حفظ القرآن', nameEn: 'Quran' };
const TEACHER = 'الشيخ أحمد المصري';
const TEACHER_ZONE = 'Africa/Cairo';
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

const next: ListedSession = {
  sessionId: '0193a6f0-0000-7000-8000-000000000503',
  sequenceNumber: 3,
  localDate: '2026-11-26',
  startTimeLocal: '20:00',
  timezone: TEACHER_ZONE,
  startsAt: '2026-11-26T18:00:00Z',
  endsAt: '2026-11-26T18:45:00Z',
  status: 'scheduled',
  pendingCancellation: false,
  disputed: false,
};
const ongoing: StudentEnrollmentItem = {
  enrollmentId: ENROLLMENT_ID,
  teacher: {
    teacherId: TEACHER_ID,
    displayName: TEACHER,
    displayNameOrNull: TEACHER,
    deleted: false,
  },
  summary: { subject: QURAN, track: 'recitation', sessionCount: 8, sessionDurationMinutes: 45 },
  status: 'confirmed',
  next,
  last: { ...next, sequenceNumber: 8, localDate: '2026-12-31', startsAt: '2026-12-31T18:00:00Z' },
  upcoming: 6,
  completed: 2,
  remaining: 6,
};
const list = (...items: StudentEnrollmentItem[]): EnrollmentsListOutput => ({ items });

const localeOf = (direction: Direction): Locale => (direction === 'rtl' ? 'ar' : 'en');
const said = (direction: Direction, key: MessageKey, values?: MessageValues) =>
  translate(localeOf(direction), key, values);
const ar = (key: MessageKey, values?: MessageValues) => translate('ar', key, values);
const when = (direction: Direction, zone: string) => {
  const locale = localeOf(direction);
  return said(direction, 'student.enrollments.sessionTime', {
    date: formatWeekdayDate(next.startsAt, zone, locale),
    start: formatTime(next.startsAt, zone, locale),
    end: formatTime(next.endsAt, zone, locale),
    city: cityOf(zone, locale) ?? zone,
  });
};

let queries: QueryClient;
const within = (ui: ReactElement) => () => (
  <QueryClientProvider client={queries}>{ui}</QueryClientProvider>
);

beforeEach(() => {
  mockApi = fakeApi();
  mockPush.mockReset();
  mockNavigate.mockReset();
  onlineManager.setOnline(true);
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, me);
});
afterEach(async () => {
  // Unmounted before the cache is cleared, so no observer schedules a collection after it.
  await cleanup();
  onlineManager.setOnline(true);
  queries.clear();
  jest.useRealTimers();
});

describe('Main', () => {
  it('draws the next session in the student’s zone and the teacher’s, and the active enrollments', async () => {
    mockApi.api.enrollments.list.query.mockResolvedValue(list(ongoing));
    await inBothDirections(within(<Main />), async (_rendered, direction) => {
      expect(await screen.findByText(said(direction, 'student.home.nextSession'))).toBeTruthy();
      expect(
        screen.getByText(
          said(direction, 'student.home.sessionTitle', {
            subject: direction === 'rtl' ? QURAN.nameAr : QURAN.nameEn,
            teacher: TEACHER,
          }),
        ),
      ).toBeTruthy();
      expect(screen.getAllByText(when(direction, STUDENT_ZONE)).length).toBeGreaterThan(0);
      expect(screen.getAllByText(when(direction, TEACHER_ZONE)).length).toBeGreaterThan(0);
      expect(screen.getByText(TEACHER)).toBeTruthy();
      expect(screen.getByText(said(direction, 'status.enrollment.confirmed'))).toBeTruthy();
    });
    expect(mockApi.api.enrollments.list.query).toHaveBeenCalledWith({ tab: 'active' });
    await renderIn('rtl', within(<Main />)());
    await fireEvent.press(await screen.findByText(TEACHER));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(student)/enrollments/[id]',
      params: { id: ENROLLMENT_ID },
    });
  });

  // T007 (FR-426): a deleted teacher has no name; the next session's title names the stand-in.
  it('names a deleted teacher by the stand-in text in the next session’s title', async () => {
    mockApi.api.enrollments.list.query.mockResolvedValue(
      list({
        ...ongoing,
        teacher: { teacherId: TEACHER_ID, displayName: '', displayNameOrNull: null, deleted: true },
      }),
    );
    await inBothDirections(within(<Main />), async (_rendered, direction) => {
      expect(
        await screen.findByText(
          said(direction, 'student.home.sessionTitle', {
            subject: direction === 'rtl' ? QURAN.nameAr : QURAN.nameEn,
            teacher: said(direction, 'common.party.deletedTeacher'),
          }),
        ),
      ).toBeTruthy();
    });
  });

  it('with no active enrollment: StudentHomeEmpty, with the notice it is given', async () => {
    mockApi.api.enrollments.list.query.mockResolvedValue(list());
    await inBothDirections(
      within(<Main notice={<Text>notice</Text>} />),
      async (_rendered, direction) => {
        expect(await screen.findByText(said(direction, 'student.home.empty.kicker'))).toBeTruthy();
        expect(screen.getByText('notice')).toBeTruthy();
      },
    );
  });

  it('MainOffline: the cached home under the offline banner, with the time it was read', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-25T09:30:00Z') });
    queries.setQueryData(ACTIVE_ENROLLMENTS_QUERY_KEY, list(ongoing));
    onlineManager.setOnline(false);
    await renderIn('rtl', within(<Main />)());
    expect(await screen.findByText(ar('common.state.offline'))).toBeTruthy();
    expect(screen.getByText(ar('student.home.nextSession'))).toBeTruthy();
    expect(
      screen.getByText(
        ar('student.home.lastUpdated', {
          time: formatTime('2026-11-25T09:30:00.000Z', STUDENT_ZONE, 'ar'),
        }),
      ),
    ).toBeTruthy();
    expect(mockApi.api.enrollments.list.query).not.toHaveBeenCalled();
  });

  it('a failed read on opening, with an earlier answer cached: the retry state, never the cached answer', async () => {
    queries.setQueryData(ACTIVE_ENROLLMENTS_QUERY_KEY, list(ongoing));
    mockApi.api.enrollments.list.query.mockRejectedValue(apiError('INTERNAL_SERVER_ERROR'));
    await renderIn('rtl', within(<Main />)());
    expect(await screen.findByText(ar('common.state.loadError'))).toBeTruthy();
    expect(screen.queryByText(ar('student.home.nextSession'))).toBeNull();
    expect(screen.queryByText(ar('student.home.empty.kicker'))).toBeNull();
  });

  it('reads a Confirming enrollment on the schedule, then says FR-384’s message', async () => {
    jest.useFakeTimers();
    const confirming: StudentEnrollmentItem = {
      ...ongoing,
      status: 'pending_payment',
      upcoming: 0,
      completed: 0,
      remaining: 8,
    };
    delete (confirming as { next?: unknown }).next;
    delete (confirming as { last?: unknown }).last;
    mockApi.api.enrollments.list.query.mockResolvedValue(list(confirming));
    mockApi.api.checkout.status.query.mockResolvedValue({
      status: 'pending_payment',
      lastOrder: { status: 'created', reference: 'IJZ-7Q4K2M' },
      summary: { ...ongoing.summary, teacher: ongoing.teacher, price_piasters: 120_000 },
    });
    await renderIn('rtl', within(<Main />)());
    expect(await screen.findByText(ar('status.enrollment.confirming'))).toBeTruthy();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(CHECKOUT_POLLING.confirmingPollSeconds * 1_000);
    });
    expect(mockApi.api.enrollments.list.query.mock.calls.length).toBe(2);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(CHECKOUT_POLLING.confirmingPollWindowMinutes * 60_000);
    });
    expect(await screen.findByText(ar('student.enrollments.confirming.title'))).toBeTruthy();
  });
});
