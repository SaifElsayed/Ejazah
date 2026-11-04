// T050 (FR-383, FR-384, FR-390, FR-393, SC-312; screens.md §6): the student's enrollments on the
// phone, in both languages. The active tab draws each enrollment with its package, track, teacher,
// status, next session in the student's zone and the teacher's, and its upcoming, completed and
// remaining sessions; the ended tab pages its own; the detail lists every session with its status.
// An enrollment awaiting its payment's confirmation is Confirming: the screen reads it every
// `confirmingPollSeconds` for at most `confirmingPollWindowMinutes`, then says FR-384's message with
// the order reference, the support address and «تحقق مرة أخرى», and reads no more on its own. Each
// screen decides only on an answer read since it opened (the owner's decision of 2026-11-04): a
// failed read on opening draws the retry state, never the cached answer; a failed read inside the
// window draws the retry state over the answer and claims nothing.
import type {
  CheckoutStatusOutput,
  EnrollmentsGetOutput,
  EnrollmentsListOutput,
  ListedSession,
  MeOutput,
  StudentEnrollmentItem,
} from '@ijazah/contracts';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { cityOf } from '@ijazah/time/cities';
import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { inBothDirections, renderIn } from '../../../design/primitives/__tests__/harness';
import { type Locale, type MessageKey, type MessageValues, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import {
  formatDate,
  formatNumber,
  formatTime,
  formatWeekday,
  formatWeekdayDate,
  weekdayIn,
} from '../../../lib/formatters';
import { apiError, CHECKOUT_POLLING, fakeApi } from '../../shared/__tests__/api-double';
import {
  ACTIVE_ENROLLMENTS_QUERY_KEY,
  ENDED_ENROLLMENTS_QUERY_KEY,
  enrollmentQueryKey,
} from './api';
import { EnrollmentDetail, Enrollments, EnrollmentsEnded } from './index';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));

const mockPush = jest.fn();
const mockNavigate = jest.fn();
const mockBack = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: {
    push: (route: unknown) => mockPush(route),
    navigate: (route: unknown) => mockNavigate(route),
    replace: (route: unknown) => mockNavigate(route),
    back: () => mockBack(),
  },
  useLocalSearchParams: () => mockParams,
}));

type Direction = 'rtl' | 'ltr';

const ENROLLMENT_ID = '0193a6f0-0000-7000-8000-0000000000e1';
const SECOND_ENROLLMENT_ID = '0193a6f0-0000-7000-8000-0000000000e2';
const ENDED_ID = '0193a6f0-0000-7000-8000-0000000000e3';
const TEACHER_ID = '0193a6f0-0000-7000-8000-0000000000d1';
const QURAN = { id: '0193a6f0-0000-7000-8000-0000000000a1', nameAr: 'حفظ القرآن', nameEn: 'Quran' };
const TEACHER = 'الشيخ أحمد المصري';
const REFERENCE = 'IJZ-7Q4K2M';
const SUPPORT = 'support@ijazah.test';
/** A left-to-right run as the screen writes it, isolated (`Text`'s `ltr`). */
const ltrRun = (text: string) => `⁦${text}⁩`;

/** The sessions are in Cairo's zone; the student lives in Riyadh, an hour ahead. */
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

/** Eight Thursdays at 20:00 in Cairo (UTC+2 in November and December 2026). */
const WEEKS = [
  ['2026-11-12', '2026-11-12T18:00:00Z', '2026-11-12T18:45:00Z'],
  ['2026-11-19', '2026-11-19T18:00:00Z', '2026-11-19T18:45:00Z'],
  ['2026-11-26', '2026-11-26T18:00:00Z', '2026-11-26T18:45:00Z'],
  ['2026-12-03', '2026-12-03T18:00:00Z', '2026-12-03T18:45:00Z'],
  ['2026-12-10', '2026-12-10T18:00:00Z', '2026-12-10T18:45:00Z'],
  ['2026-12-17', '2026-12-17T18:00:00Z', '2026-12-17T18:45:00Z'],
  ['2026-12-24', '2026-12-24T18:00:00Z', '2026-12-24T18:45:00Z'],
  ['2026-12-31', '2026-12-31T18:00:00Z', '2026-12-31T18:45:00Z'],
] as const;
const sessions: ListedSession[] = WEEKS.map(([localDate, startsAt, endsAt], index) => ({
  sequenceNumber: index + 1,
  localDate,
  startTimeLocal: '20:00',
  timezone: TEACHER_ZONE,
  startsAt,
  endsAt,
  status: index < 2 ? 'done' : 'scheduled',
}));
const third = sessions[2]!;
const last = sessions[7]!;

const terms: StudentEnrollmentItem['summary'] = {
  subject: QURAN,
  track: 'ijazah_track',
  sessionCount: 8,
  sessionDurationMinutes: 45,
};

/** Two sessions held, the third next. */
const ongoing: StudentEnrollmentItem = {
  enrollmentId: ENROLLMENT_ID,
  teacher: { teacherId: TEACHER_ID, displayName: TEACHER },
  summary: terms,
  status: 'confirmed',
  next: third,
  last,
  upcoming: 6,
  completed: 2,
  remaining: 6,
};
/** Paid, not confirmed yet: no sessions until it is. */
const confirming: StudentEnrollmentItem = {
  enrollmentId: SECOND_ENROLLMENT_ID,
  teacher: { teacherId: TEACHER_ID, displayName: 'الشيخ يوسف' },
  summary: { ...terms, track: 'recitation', sessionCount: 4 },
  status: 'pending_payment',
  upcoming: 0,
  completed: 0,
  remaining: 4,
};
const confirmedNow: StudentEnrollmentItem = {
  ...confirming,
  status: 'confirmed',
  next: { ...sessions[0]!, status: 'scheduled' },
  last: { ...sessions[3]!, status: 'scheduled' },
  upcoming: 4,
};
const completed: StudentEnrollmentItem = {
  ...ongoing,
  enrollmentId: ENDED_ID,
  status: 'completed',
  next: undefined,
  upcoming: 0,
  completed: 8,
  remaining: 0,
};
delete (completed as { next?: unknown }).next;

const list = (...items: StudentEnrollmentItem[]): EnrollmentsListOutput => ({ items });
const statusOf: CheckoutStatusOutput = {
  status: 'pending_payment',
  lastOrder: { status: 'created', reference: REFERENCE },
  summary: {
    teacher: { teacherId: TEACHER_ID, displayName: 'الشيخ يوسف' },
    subject: QURAN,
    track: 'recitation',
    sessionCount: 4,
    sessionDurationMinutes: 45,
    price_piasters: 60_000,
  },
};

const localeOf = (direction: Direction): Locale => (direction === 'rtl' ? 'ar' : 'en');
const said = (direction: Direction, key: MessageKey, values?: MessageValues) =>
  translate(localeOf(direction), key, values);
const ar = (key: MessageKey, values?: MessageValues) => translate('ar', key, values);
const named = (direction: Direction) => (direction === 'rtl' ? QURAN.nameAr : QURAN.nameEn);

/** A session's line in `zone`, as the cards, the home and the detail write it (FR-393). */
const when = (direction: Direction, session: ListedSession, zone: string) => {
  const locale = localeOf(direction);
  return said(direction, 'student.enrollments.sessionTime', {
    date: formatWeekdayDate(session.startsAt, zone, locale),
    start: formatTime(session.startsAt, zone, locale),
    end: formatTime(session.endsAt, zone, locale),
    city: cityOf(zone, locale) ?? zone,
  });
};

const listCalls = () => mockApi.api.enrollments.list.query.mock.calls.length;
const getCalls = () => mockApi.api.enrollments.get.query.mock.calls.length;

let queries: QueryClient;
const within = (ui: ReactElement) => () => (
  <QueryClientProvider client={queries}>{ui}</QueryClientProvider>
);

beforeEach(() => {
  mockApi = fakeApi();
  mockPush.mockReset();
  mockNavigate.mockReset();
  mockBack.mockReset();
  mockParams = { id: ENROLLMENT_ID };
  onlineManager.setOnline(true);
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, me);
  mockApi.api.checkout.status.query.mockResolvedValue(statusOf);
});
afterEach(async () => {
  // Unmounted before the cache is cleared, so no observer schedules a collection after it.
  await cleanup();
  onlineManager.setOnline(true);
  queries.clear();
  jest.useRealTimers();
  focusManager.setFocused(undefined);
});

/** Advances the fake clock by `ms` and lets the reads it starts settle. */
async function elapse(ms: number): Promise<void> {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

const POLL_MS = CHECKOUT_POLLING.confirmingPollSeconds * 1_000;
const WINDOW_MS = CHECKOUT_POLLING.confirmingPollWindowMinutes * 60 * 1_000;

describe('Enrollments', () => {
  it('draws each active enrollment: package, track, teacher, status, the next session in both zones and the counts', async () => {
    mockApi.api.enrollments.list.query.mockResolvedValue(list(ongoing));
    await inBothDirections(within(<Enrollments />), async (_rendered, direction) => {
      const locale = localeOf(direction);
      expect(await screen.findByText(TEACHER)).toBeTruthy();
      expect(screen.getByText(said(direction, 'student.enrollments.title'))).toBeTruthy();
      expect(
        screen.getByText(
          said(direction, 'common.format.packageFull', {
            subject: named(direction),
            count: 8,
            minutes: 45,
          }),
        ),
      ).toBeTruthy();
      expect(screen.getByText(said(direction, 'common.track.ijazahTrack'))).toBeTruthy();
      // In English the badge's «Active» is the tab's word too.
      expect(
        screen.getAllByText(said(direction, 'status.enrollment.confirmed')).length,
      ).toBeGreaterThan(0);
      expect(
        screen.getByText(said(direction, 'student.enrollments.card.nextSession')),
      ).toBeTruthy();
      expect(screen.getByText(when(direction, third, STUDENT_ZONE))).toBeTruthy();
      expect(screen.getByText(when(direction, third, TEACHER_ZONE))).toBeTruthy();
      expect(screen.getByText(said(direction, 'student.enrollments.stat.completed'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'student.enrollments.stat.upcoming'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'student.enrollments.stat.remaining'))).toBeTruthy();
      expect(screen.getByText(formatNumber(2, locale))).toBeTruthy();
      expect(screen.getAllByText(formatNumber(6, locale))).toHaveLength(2);
      expect(
        screen.getByText(
          said(direction, 'student.enrollments.card.until', {
            date: formatDate(last.startsAt, STUDENT_ZONE, locale),
          }),
        ),
      ).toBeTruthy();
    });
    expect(mockApi.api.enrollments.list.query).toHaveBeenCalledWith({ tab: 'active' });
  });

  it('says the first session of an enrollment that has not started', async () => {
    mockApi.api.enrollments.list.query.mockResolvedValue(list(confirmedNow));
    await renderIn('rtl', within(<Enrollments />)());
    expect(await screen.findByText(ar('student.enrollments.card.firstSession'))).toBeTruthy();
    expect(screen.queryByText(ar('student.enrollments.card.nextSession'))).toBeNull();
  });

  it('opens an enrollment’s detail from its card and the ended tab from «منتهية»', async () => {
    mockApi.api.enrollments.list.query.mockResolvedValue(list(ongoing));
    await renderIn('rtl', within(<Enrollments />)());
    await fireEvent.press(await screen.findByText(TEACHER));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(student)/enrollments/[id]',
      params: { id: ENROLLMENT_ID },
    });
    await fireEvent.press(screen.getByRole('tab', { name: ar('student.enrollments.tabs.ended') }));
    expect(mockPush).toHaveBeenCalledWith('/(student)/enrollments/ended');
  });

  it('a Confirming enrollment: its badge, read every confirmingPollSeconds, until it is confirmed', async () => {
    jest.useFakeTimers();
    mockApi.api.enrollments.list.query.mockResolvedValue(list(ongoing, confirming));
    await renderIn('rtl', within(<Enrollments />)());
    expect(await screen.findByText(ar('status.enrollment.confirming'))).toBeTruthy();
    expect(listCalls()).toBe(1);
    await elapse(POLL_MS - 100);
    expect(listCalls()).toBe(1);
    await elapse(100);
    expect(listCalls()).toBe(2);

    mockApi.api.enrollments.list.query.mockResolvedValue(list(ongoing, confirmedNow));
    await elapse(POLL_MS);
    expect(listCalls()).toBe(3);
    await waitFor(() => expect(screen.queryByText(ar('status.enrollment.confirming'))).toBeNull());
    expect(screen.getAllByText(ar('status.enrollment.confirmed'))).toHaveLength(2);
    await elapse(POLL_MS * 4);
    expect(listCalls()).toBe(3);
  });

  it('takes its schedule from the public configuration', async () => {
    jest.useFakeTimers();
    mockApi.value.client.publicConfig.mockResolvedValue({
      supportEmail: SUPPORT,
      termsVersion: '2026-10',
      checkout: { ...CHECKOUT_POLLING, confirmingPollSeconds: 5, confirmingPollWindowMinutes: 1 },
    });
    mockApi.api.enrollments.list.query.mockResolvedValue(list(confirming));
    await renderIn('rtl', within(<Enrollments />)());
    expect(await screen.findByText(ar('status.enrollment.confirming'))).toBeTruthy();
    await elapse(5_000);
    expect(listCalls()).toBe(2);
    expect(screen.queryByText(ar('student.enrollments.confirming.title'))).toBeNull();
    await elapse(55_000);
    expect(await screen.findByText(ar('student.enrollments.confirming.title'))).toBeTruthy();
  });

  it('after the window, still Confirming: FR-384’s message, the reference, the support address, no more reads, and «تحقق مرة أخرى»', async () => {
    jest.useFakeTimers();
    mockApi.api.enrollments.list.query.mockResolvedValue(list(confirming));
    await renderIn('rtl', within(<Enrollments />)());
    expect(await screen.findByText(ar('status.enrollment.confirming'))).toBeTruthy();
    expect(screen.queryByText(ar('student.enrollments.confirming.title'))).toBeNull();
    await elapse(WINDOW_MS);

    expect(await screen.findByText(ar('student.enrollments.confirming.title'))).toBeTruthy();
    expect(screen.getByText(ar('student.enrollments.confirming.text'))).toBeTruthy();
    expect(await screen.findByText(ltrRun(REFERENCE))).toBeTruthy();
    expect(screen.getByText(ltrRun(SUPPORT))).toBeTruthy();
    expect(mockApi.api.checkout.status.query).toHaveBeenCalledWith({
      enrollmentId: SECOND_ENROLLMENT_ID,
    });
    expect(screen.queryByText(ar('student.checkoutFailed.title'))).toBeNull();
    expect(screen.getByText(ar('status.enrollment.confirming'))).toBeTruthy();
    const reads = listCalls();
    await elapse(WINDOW_MS);
    expect(listCalls()).toBe(reads);

    mockApi.api.enrollments.list.query.mockResolvedValue(list(confirmedNow));
    await fireEvent.press(screen.getByText(ar('student.enrollments.confirming.checkAgain')));
    await elapse(0);
    expect(listCalls()).toBe(reads + 1);
    await waitFor(() =>
      expect(screen.queryByText(ar('student.enrollments.confirming.title'))).toBeNull(),
    );
    expect(screen.getByText(ar('status.enrollment.confirmed'))).toBeTruthy();
  });

  it('a failed read on opening, with an earlier answer cached: the retry state, never the cached answer', async () => {
    queries.setQueryData(ACTIVE_ENROLLMENTS_QUERY_KEY, list(ongoing));
    mockApi.api.enrollments.list.query.mockRejectedValue(apiError('INTERNAL_SERVER_ERROR'));
    await renderIn('rtl', within(<Enrollments />)());
    expect(await screen.findByText(ar('common.state.loadError'))).toBeTruthy();
    expect(screen.queryByText(TEACHER)).toBeNull();

    mockApi.api.enrollments.list.query.mockResolvedValue(list(ongoing));
    await fireEvent.press(screen.getByRole('button', { name: ar('common.action.retry') }));
    expect(await screen.findByText(TEACHER)).toBeTruthy();
    expect(screen.queryByText(ar('common.state.loadError'))).toBeNull();
  });

  it('a failed read inside the window: the retry state over the enrollment, no claim, and the schedule goes on', async () => {
    jest.useFakeTimers();
    mockApi.api.enrollments.list.query.mockResolvedValueOnce(list(confirming));
    await renderIn('rtl', within(<Enrollments />)());
    expect(await screen.findByText(ar('status.enrollment.confirming'))).toBeTruthy();

    mockApi.api.enrollments.list.query.mockRejectedValueOnce(apiError('INTERNAL_SERVER_ERROR'));
    await elapse(POLL_MS);
    expect(await screen.findByText(ar('common.state.loadError'))).toBeTruthy();
    expect(screen.getByText(ar('status.enrollment.confirming'))).toBeTruthy();
    expect(screen.queryByText(ar('student.enrollments.confirming.title'))).toBeNull();
    expect(screen.queryByText(ar('student.checkoutFailed.title'))).toBeNull();

    mockApi.api.enrollments.list.query.mockResolvedValue(list(confirmedNow));
    await elapse(POLL_MS);
    await waitFor(() => expect(screen.queryByText(ar('common.state.loadError'))).toBeNull());
    expect(screen.getByText(ar('status.enrollment.confirmed'))).toBeTruthy();
  });

  it('reads again on a return to the foreground', async () => {
    mockApi.api.enrollments.list.query.mockResolvedValue(list(confirming));
    await renderIn('rtl', within(<Enrollments />)());
    expect(await screen.findByText(ar('status.enrollment.confirming'))).toBeTruthy();
    const reads = listCalls();
    mockApi.api.enrollments.list.query.mockResolvedValue(list(confirmedNow));
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(listCalls()).toBe(reads + 1));
    expect(await screen.findByText(ar('status.enrollment.confirmed'))).toBeTruthy();
  });

  it('no enrollment on either tab: EnrollmentsEmpty, without the tabs', async () => {
    mockApi.api.enrollments.list.query.mockResolvedValue(list());
    await renderIn('rtl', within(<Enrollments />)());
    expect(await screen.findByText(ar('student.enrollments.empty.title'))).toBeTruthy();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(mockApi.api.enrollments.list.query).toHaveBeenCalledWith({ tab: 'ended' });
  });

  it('no active enrollment but ended ones: the tabs, and none active said plainly', async () => {
    mockApi.api.enrollments.list.query.mockImplementation(async (input) =>
      (input as { tab: string }).tab === 'active' ? list() : list(completed),
    );
    await renderIn('rtl', within(<Enrollments />)());
    expect(await screen.findByText(ar('student.enrollments.activeEmpty.title'))).toBeTruthy();
    expect(screen.getByRole('tab', { name: ar('student.enrollments.tabs.ended') })).toBeTruthy();
    expect(screen.queryByText(ar('student.enrollments.empty.title'))).toBeNull();
  });

  it('with no connection: the cached enrollments under the offline banner', async () => {
    queries.setQueryData(ACTIVE_ENROLLMENTS_QUERY_KEY, list(ongoing));
    onlineManager.setOnline(false);
    await renderIn('rtl', within(<Enrollments />)());
    expect(await screen.findByText(ar('common.state.offline'))).toBeTruthy();
    expect(screen.getByText(TEACHER)).toBeTruthy();
  });
});

describe('EnrollmentsEnded', () => {
  it('draws each ended enrollment with its status and the date it completed', async () => {
    mockApi.api.enrollments.list.query.mockResolvedValue(list(completed));
    await inBothDirections(within(<EnrollmentsEnded />), async (_rendered, direction) => {
      const locale = localeOf(direction);
      expect(
        await screen.findByText(
          said(direction, 'student.enrollments.card.completedOn', {
            teacher: TEACHER,
            date: formatDate(last.startsAt, STUDENT_ZONE, locale),
          }),
        ),
      ).toBeTruthy();
      expect(screen.getByText(said(direction, 'status.enrollment.completed'))).toBeTruthy();
    });
    expect(mockApi.api.enrollments.list.query).toHaveBeenCalledWith({ tab: 'ended' });
    await renderIn('ltr', within(<EnrollmentsEnded />)());
    await fireEvent.press(await screen.findByRole('tab', { name: 'Active' }));
    expect(mockNavigate).toHaveBeenCalledWith('/(student)/(tabs)/enrollments');
  });

  it('asks the next page with the cursor the last answered', async () => {
    mockApi.api.enrollments.list.query
      .mockResolvedValueOnce({ items: [completed], nextCursor: ENDED_ID })
      .mockResolvedValueOnce(list({ ...completed, enrollmentId: ENROLLMENT_ID }));
    await renderIn('rtl', within(<EnrollmentsEnded />)());
    const line = ar('student.enrollments.card.completedOn', {
      teacher: TEACHER,
      date: formatDate(last.startsAt, STUDENT_ZONE, 'ar'),
    });
    expect(await screen.findByText(line)).toBeTruthy();
    await fireEvent(screen.getByTestId('ended-enrollments'), 'onEndReached');
    await waitFor(() => expect(screen.getAllByText(line)).toHaveLength(2));
    expect(mockApi.api.enrollments.list.query).toHaveBeenLastCalledWith({
      tab: 'ended',
      cursor: ENDED_ID,
    });
  });

  it('none ended: EnrollmentsEndedEmpty under the tabs', async () => {
    mockApi.api.enrollments.list.query.mockResolvedValue(list());
    await inBothDirections(within(<EnrollmentsEnded />), async (_rendered, direction) => {
      expect(
        await screen.findByText(said(direction, 'student.enrollments.endedEmpty.title')),
      ).toBeTruthy();
      expect(screen.getByText(said(direction, 'student.enrollments.endedEmpty.text'))).toBeTruthy();
      expect(
        screen.getByRole('tab', { name: said(direction, 'student.enrollments.tabs.active') }),
      ).toBeTruthy();
    });
  });

  it('a failed read on opening, with an earlier answer cached: the retry state, never the cached answer', async () => {
    queries.setQueryData(ENDED_ENROLLMENTS_QUERY_KEY, {
      pages: [list(completed)],
      pageParams: [undefined],
    });
    mockApi.api.enrollments.list.query.mockRejectedValue(apiError('INTERNAL_SERVER_ERROR'));
    await renderIn('rtl', within(<EnrollmentsEnded />)());
    expect(await screen.findByText(ar('common.state.loadError'))).toBeTruthy();
    expect(screen.queryByText(ar('status.enrollment.completed'))).toBeNull();
  });
});

describe('EnrollmentDetail', () => {
  const detail: EnrollmentsGetOutput = { ...ongoing, sessions };

  it('draws the enrollment, its weekly time in both zones, its progress and every session with its status', async () => {
    mockApi.api.enrollments.get.query.mockResolvedValue(detail);
    await inBothDirections(within(<EnrollmentDetail />), async (_rendered, direction) => {
      const locale = localeOf(direction);
      expect(await screen.findByText(TEACHER)).toBeTruthy();
      expect(screen.getByText(said(direction, 'student.enrollmentDetail.title'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'common.track.ijazahTrack'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'status.enrollment.confirmed'))).toBeTruthy();
      for (const zone of [STUDENT_ZONE, TEACHER_ZONE]) {
        expect(
          screen.getByText(
            said(direction, 'student.enrollmentDetail.weekly', {
              weekday: formatWeekday(weekdayIn(third.startsAt, zone), locale),
              time: formatTime(third.startsAt, zone, locale),
              city: cityOf(zone, locale) ?? zone,
            }),
          ),
        ).toBeTruthy();
      }
      expect(
        screen.getByText(
          said(direction, 'student.enrollmentDetail.progressUntil', {
            done: 2,
            total: 8,
            date: formatDate(last.startsAt, STUDENT_ZONE, locale),
          }),
        ),
      ).toBeTruthy();
      expect(screen.getByText(said(direction, 'student.enrollmentDetail.sessions'))).toBeTruthy();
      for (const session of sessions) {
        expect(
          screen.getByText(
            said(direction, 'student.enrollmentDetail.session.labelled', {
              n: session.sequenceNumber,
              date: formatDate(session.startsAt, STUDENT_ZONE, locale),
            }),
          ),
        ).toBeTruthy();
        expect(screen.getAllByText(when(direction, session, TEACHER_ZONE)).length).toBeGreaterThan(
          0,
        );
      }
      // The counts' «تمت» (and, in English, «Upcoming») are the badges' words too.
      expect(screen.getAllByText(said(direction, 'status.session.done'))).toHaveLength(2 + 1);
      expect(screen.getAllByText(said(direction, 'status.session.scheduled'))).toHaveLength(
        direction === 'rtl' ? 6 : 6 + 1,
      );
    });
    expect(mockApi.api.enrollments.get.query).toHaveBeenCalledWith({
      enrollmentId: ENROLLMENT_ID,
    });
  });

  it('a Confirming enrollment is read on the schedule, then FR-384’s message', async () => {
    jest.useFakeTimers();
    mockParams = { id: SECOND_ENROLLMENT_ID };
    mockApi.api.enrollments.get.query.mockResolvedValue({ ...confirming, sessions: [] });
    await renderIn('rtl', within(<EnrollmentDetail />)());
    expect(await screen.findByText(ar('status.enrollment.confirming'))).toBeTruthy();
    await elapse(WINDOW_MS);
    expect(getCalls()).toBeGreaterThan(1);
    expect(await screen.findByText(ar('student.enrollments.confirming.title'))).toBeTruthy();
    expect(await screen.findByText(ltrRun(REFERENCE))).toBeTruthy();
    const reads = getCalls();
    await elapse(POLL_MS * 4);
    expect(getCalls()).toBe(reads);
  });

  it('a failed read on opening, with an earlier answer cached: the retry state, never the cached answer', async () => {
    queries.setQueryData(enrollmentQueryKey(ENROLLMENT_ID), detail);
    mockApi.api.enrollments.get.query.mockRejectedValue(apiError('INTERNAL_SERVER_ERROR'));
    await renderIn('rtl', within(<EnrollmentDetail />)());
    expect(await screen.findByText(ar('common.state.loadError'))).toBeTruthy();
    expect(screen.queryByText(TEACHER)).toBeNull();
  });

  it('goes back where it was opened from', async () => {
    mockApi.api.enrollments.get.query.mockResolvedValue(detail);
    await renderIn('rtl', within(<EnrollmentDetail />)());
    expect(await screen.findByText(TEACHER)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: ar('common.a11y.back') }));
    expect(mockBack).toHaveBeenCalled();
  });
});
