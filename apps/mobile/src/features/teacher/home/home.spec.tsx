// T051 (FR-391, FR-393; screens.md §14): the teacher's «اليوم» against its boards, in both languages.
// The day's date and its line (the sessions, their hours and the teacher's city), what is done and
// what is left today, and the agenda by start: each row with its time in the session's own zone,
// the student, the package line, and a badge once the session has an outcome; a row in another zone
// than the teacher's also says it there (ADR 0009 D5). A day without sessions is `TeacherHomeEmpty`
// with the same date and line. The screen decides only on what it read since it opened (the owner's
// decision of 2026-11-04; T086): a failed read on opening is the retry state, never the earlier
// answer cached; offline, the cached day stays under the offline banner (002:T138).
import type { TeacherTodayOutput, TeacherTodaySession } from '@ijazah/contracts';
import { cityOf } from '@ijazah/time/cities';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Text } from 'react-native';

import { inBothDirections, renderIn } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, translate } from '../../../i18n';
import type { Direction } from '../../../lib/direction';
import {
  formatCalendarWeekdayDate,
  formatDate,
  formatHoursMinutes,
  formatTime,
} from '../../../lib/formatters';
import { apiError, fakeApi } from '../../shared/__tests__/api-double';
import { TEACHER_TODAY_QUERY_KEY, TeacherHome } from './index';

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

const CAIRO = 'Africa/Cairo';
const DUBAI = 'Asia/Dubai';
const QURAN = {
  id: '0193a6f0-0000-7000-8000-0000000000a1',
  nameAr: 'حفظ القرآن',
  nameEn: 'Quran memorization',
};

function session(
  enrollment: string,
  student: string,
  of: { n: number; total: number; minutes: 30 | 45 | 60; startsAt: string; endsAt: string },
  status: TeacherTodaySession['status'] = 'scheduled',
  timezone = CAIRO,
): TeacherTodaySession {
  return {
    enrollmentId: `0193a6f0-0000-7000-8000-0000000000${enrollment}`,
    student: { displayName: student, displayNameOrNull: student, deleted: false },
    summary: {
      subject: QURAN,
      track: 'recitation',
      sessionCount: of.total,
      sessionDurationMinutes: of.minutes,
    },
    sessionId: `0193a6f0-0000-7000-8000-0000000006${String(of.n).padStart(2, '0')}`,
    sequenceNumber: of.n,
    localDate: '2026-11-04',
    startTimeLocal: '00:00',
    timezone,
    startsAt: of.startsAt,
    endsAt: of.endsAt,
    status,
    pendingCancellation: false,
    disputed: false,
  };
}

const DONE = session(
  'e1',
  'عبد الرحمن علي',
  {
    n: 6,
    total: 8,
    minutes: 45,
    startsAt: '2026-11-04T07:00:00.000Z',
    endsAt: '2026-11-04T07:45:00.000Z',
  },
  'done',
);
const NEXT = session('e2', 'نور سمير', {
  n: 4,
  total: 12,
  minutes: 60,
  startsAt: '2026-11-04T12:00:00.000Z',
  endsAt: '2026-11-04T13:00:00.000Z',
});
const day = (sessions: readonly TeacherTodaySession[]): TeacherTodayOutput => ({
  localDate: '2026-11-04',
  timezone: CAIRO,
  sessions: [...sessions],
});

const localeOf = (direction: Direction) => (direction === 'rtl' ? 'ar' : 'en');
const said = (direction: Direction, key: MessageKey, values?: Record<string, string | number>) =>
  translate(localeOf(direction), key, values);
const ar = (key: MessageKey, values?: Record<string, string | number>) =>
  translate('ar', key, values);
const city = (direction: Direction, zone = CAIRO) => cityOf(zone, localeOf(direction)) ?? zone;
const rowMeta = (direction: Direction, of: TeacherTodaySession) =>
  said(direction, 'teacher.today.rowMeta', {
    subject: direction === 'rtl' ? QURAN.nameAr : QURAN.nameEn,
    n: of.sequenceNumber,
    total: of.summary.sessionCount,
    minutes: of.summary.sessionDurationMinutes,
  });

let queries: QueryClient;
const withQueries = (ui: () => ReactElement) => () => (
  <QueryClientProvider client={queries}>{ui()}</QueryClientProvider>
);
const home = withQueries(() => <TeacherHome notice={<Text>notice</Text>} />);
const today = () => mockApi.api.teacher.today.query;

beforeEach(() => {
  mockApi = fakeApi();
  mockPush.mockReset();
  mockNavigate.mockReset();
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => onlineManager.setOnline(true));

describe('TeacherHome (FR-391, FR-393)', () => {
  it('draws the day, what is done and left, and the agenda by start in the session’s zone', async () => {
    today().mockResolvedValue(day([DONE, NEXT]));
    await inBothDirections(home, async (_rendered, direction) => {
      expect(await screen.findByText(NEXT.student.displayName)).toBeTruthy();
      expect(screen.getByText('notice')).toBeTruthy();
      expect(screen.getByText(said(direction, 'teacher.today.title'))).toBeTruthy();
      expect(
        screen.getByText(formatCalendarWeekdayDate('2026-11-04', localeOf(direction))),
      ).toBeTruthy();
      expect(
        screen.getByText(
          said(direction, 'teacher.today.summary', {
            count: 2,
            hours: formatHoursMinutes(105, localeOf(direction)),
            city: city(direction),
          }),
        ),
      ).toBeTruthy();
      // «تمت» is both the tile's label and the done session's badge.
      const doneWord = said(direction, 'teacher.today.stats.done');
      expect(screen.getAllByText(doneWord)).toHaveLength(
        doneWord === said(direction, 'status.session.done') ? 2 : 1,
      );
      expect(screen.getByText(said(direction, 'teacher.today.stats.remaining'))).toBeTruthy();
      for (const row of [DONE, NEXT]) {
        expect(screen.getByText(row.student.displayName)).toBeTruthy();
        expect(screen.getByText(rowMeta(direction, row))).toBeTruthy();
        expect(screen.getByText(formatTime(row.startsAt, CAIRO, localeOf(direction)))).toBeTruthy();
      }
      // A session with an outcome carries its badge; one still to come does not.
      expect(screen.getAllByText(said(direction, 'status.session.done')).length).toBeGreaterThan(0);
      expect(screen.queryByText(said(direction, 'status.session.scheduled'))).toBeNull();
      expect(screen.queryByText(said(direction, 'teacher.today.empty.title'))).toBeNull();
    });
  });

  // T007 (FR-426): a deleted student has no name; the row draws the stand-in, never an empty line.
  it('draws a deleted student by the stand-in text', async () => {
    const deleted: TeacherTodaySession = {
      ...NEXT,
      student: { displayName: '', displayNameOrNull: null, deleted: true },
    };
    today().mockResolvedValue(day([deleted]));
    await inBothDirections(home, async (_rendered, direction) => {
      expect(await screen.findByText(said(direction, 'common.party.deletedStudent'))).toBeTruthy();
      expect(screen.getByText(rowMeta(direction, deleted))).toBeTruthy();
    });
  });

  it('opens the enrollment from a row', async () => {
    today().mockResolvedValue(day([NEXT]));
    await renderIn('rtl', home());
    await fireEvent.press(await screen.findByText(NEXT.student.displayName));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(teacher)/students/[enrollmentId]',
      params: { enrollmentId: NEXT.enrollmentId },
    });
  });

  it('says a session of another zone in the teacher’s too (ADR 0009 D5)', async () => {
    const away = { ...NEXT, timezone: DUBAI };
    today().mockResolvedValue(day([away]));
    await inBothDirections(home, async (_rendered, direction) => {
      expect(await screen.findByText(away.student.displayName)).toBeTruthy();
      expect(screen.getByText(formatTime(away.startsAt, DUBAI, localeOf(direction)))).toBeTruthy();
      expect(
        screen.getByText(
          said(direction, 'teacher.students.inViewerZone', {
            date: formatDate(away.startsAt, CAIRO, localeOf(direction)),
            time: formatTime(away.startsAt, CAIRO, localeOf(direction)),
            city: city(direction),
          }),
        ),
      ).toBeTruthy();
    });
  });

  it('draws TeacherHomeEmpty with the day’s date and line when the day has no session', async () => {
    today().mockResolvedValue(day([]));
    await inBothDirections(home, async (_rendered, direction) => {
      expect(await screen.findByText(said(direction, 'teacher.today.empty.title'))).toBeTruthy();
      expect(
        screen.getByText(formatCalendarWeekdayDate('2026-11-04', localeOf(direction))),
      ).toBeTruthy();
      expect(
        screen.getByText(said(direction, 'teacher.today.emptySummary', { city: city(direction) })),
      ).toBeTruthy();
      expect(screen.getByText('notice')).toBeTruthy();
      await fireEvent.press(
        screen.getByRole('button', { name: said(direction, 'teacher.today.empty.availability') }),
      );
    });
    expect(mockNavigate).toHaveBeenCalledWith('/(teacher)/(tabs)/availability');
  });
});

describe('TeacherHome reads since it opened (the owner’s decision of 2026-11-04; T086)', () => {
  it('shows the retry state, not the earlier day cached, when the read on opening fails', async () => {
    queries.setQueryData(TEACHER_TODAY_QUERY_KEY, day([DONE]));
    today().mockRejectedValue(apiError('INTERNAL'));
    await renderIn('rtl', home());
    expect(await screen.findByText(ar('common.state.loadError'))).toBeTruthy();
    expect(screen.queryByText(DONE.student.displayName)).toBeNull();
    expect(screen.queryByText(ar('teacher.today.empty.title'))).toBeNull();
    today().mockResolvedValue(day([NEXT]));
    await fireEvent.press(screen.getByRole('button', { name: ar('common.action.retry') }));
    expect(await screen.findByText(NEXT.student.displayName)).toBeTruthy();
  });

  it('does not decide on the cached day while its own read is on the way', async () => {
    queries.setQueryData(TEACHER_TODAY_QUERY_KEY, day([]));
    today().mockReturnValue(new Promise(() => undefined));
    await renderIn('rtl', home());
    expect(screen.queryByText(ar('teacher.today.empty.title'))).toBeNull();
    expect(screen.queryByText(ar('common.state.loadError'))).toBeNull();
  });

  it('keeps the cached day under the offline banner with no connection (002:T138)', async () => {
    queries.setQueryData(TEACHER_TODAY_QUERY_KEY, day([NEXT]));
    onlineManager.setOnline(false);
    await renderIn('rtl', home());
    expect(screen.getByText(ar('common.state.offline'))).toBeTruthy();
    expect(screen.getByText(NEXT.student.displayName)).toBeTruthy();
  });
});
