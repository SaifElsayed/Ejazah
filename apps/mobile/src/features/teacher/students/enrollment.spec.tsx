// T051 (FR-391, FR-393; screens.md §14): `TeacherEnrollment` against its boards, in both languages.
// The student by initial and name, the package line, the status and the track (the ijazah track's
// accent badge being its state as far as this phase has data); what is done and what is to come;
// the weekly time in the session's zone with its city, until the last session, and the next session
// in the teacher's own zone when that is another (ADR 0009 D5); the sessions by number, three or more
// of one status in one range and the next one on its own. Ended, the weekly time says from when to
// when. The screen decides only on what it read since it opened (the owner's decision of
// 2026-11-04; T086).
import type { ListedSession, TeacherStudentsGetOutput } from '@ijazah/contracts';
import { cityOf } from '@ijazah/time/cities';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { inBothDirections, renderIn } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import type { Direction } from '../../../lib/direction';
import {
  formatDate,
  formatTime,
  formatWallClock,
  formatWeekday,
  formatWeekdayDate,
  weekdayIn,
} from '../../../lib/formatters';
import { apiError, fakeApi } from '../../shared/__tests__/api-double';
import { enrollmentQueryKey, TeacherEnrollment } from './index';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));

const ENROLLMENT_ID = '0193a6f0-0000-7000-8000-0000000000e1';
const mockBack = jest.fn();
let mockParams: Record<string, string> = { enrollmentId: ENROLLMENT_ID };
jest.mock('expo-router', () => ({
  router: { back: () => mockBack() },
  useLocalSearchParams: () => mockParams,
}));

const CAIRO = 'Africa/Cairo';
const DUBAI = 'Asia/Dubai';
const QURAN = {
  id: '0193a6f0-0000-7000-8000-0000000000a1',
  nameAr: 'حفظ القرآن',
  nameEn: 'Quran memorization',
};

/** Wednesdays at 18:00 in Cairo (16:00 UTC) from 2026-11-11, one a week. */
function wednesday(n: number, timezone = CAIRO): ListedSession {
  const day = 11 + (n - 1) * 7;
  const month = day > 30 ? '12' : '11';
  const date = `2026-${month}-${String(day > 30 ? day - 30 : day).padStart(2, '0')}`;
  return {
    sequenceNumber: n,
    localDate: date,
    startTimeLocal: '18:00',
    timezone,
    startsAt: `${date}T16:00:00.000Z`,
    endsAt: `${date}T16:45:00.000Z`,
    status: 'scheduled',
  };
}

const SESSIONS = [1, 2, 3, 4, 5].map((n) => wednesday(n));

function enrollment(of: Partial<TeacherStudentsGetOutput> = {}): TeacherStudentsGetOutput {
  return {
    enrollmentId: ENROLLMENT_ID,
    student: { displayName: 'يوسف أحمد', displayNameOrNull: 'يوسف أحمد', deleted: false },
    summary: { subject: QURAN, track: 'recitation', sessionCount: 5, sessionDurationMinutes: 45 },
    status: 'confirmed',
    next: SESSIONS[0],
    last: SESSIONS[4],
    upcoming: 5,
    completed: 0,
    remaining: 5,
    sessions: SESSIONS,
    ...of,
  };
}

const me = { userId: '0193a6f0-0000-7000-8000-000000000002', timezone: CAIRO };

const localeOf = (direction: Direction) => (direction === 'rtl' ? 'ar' : 'en');
const said = (direction: Direction, key: MessageKey, values?: Record<string, string | number>) =>
  translate(localeOf(direction), key, values);
const ar = (key: MessageKey, values?: Record<string, string | number>) =>
  translate('ar', key, values);
const city = (direction: Direction, zone = CAIRO) => cityOf(zone, localeOf(direction)) ?? zone;

let queries: QueryClient;
const withQueries = (ui: () => ReactElement) => () => (
  <QueryClientProvider client={queries}>{ui()}</QueryClientProvider>
);
const detail = withQueries(() => <TeacherEnrollment />);
const get = () => mockApi.api.teacher.students.get.query;

beforeEach(() => {
  mockApi = fakeApi();
  mockBack.mockReset();
  mockParams = { enrollmentId: ENROLLMENT_ID };
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, me);
});

describe('TeacherEnrollment (FR-391, FR-393)', () => {
  it('draws the student, the package, the counts, the weekly time and the sessions', async () => {
    get().mockResolvedValue(enrollment());
    await inBothDirections(detail, async (_rendered, direction) => {
      const locale = localeOf(direction);
      expect(await screen.findByText('يوسف أحمد')).toBeTruthy();
      expect(screen.getByText(said(direction, 'teacher.enrollment.title'))).toBeTruthy();
      expect(screen.getByText('ي')).toBeTruthy();
      expect(
        screen.getByText(
          said(direction, 'common.package.full', {
            subject: direction === 'rtl' ? QURAN.nameAr : QURAN.nameEn,
            sessions: 5,
            minutes: 45,
          }),
        ),
      ).toBeTruthy();
      expect(screen.getByText(said(direction, 'status.enrollment.confirmed'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'common.track.recitation'))).toBeTruthy();
      // The tile «القادمة» and the badge «قادمة» are one word in English, "Upcoming".
      const upcomingTile = said(direction, 'teacher.enrollment.stats.upcoming');
      const upcomingBadge = said(direction, 'status.session.scheduled');
      expect(screen.getByText(said(direction, 'teacher.enrollment.stats.done'))).toBeTruthy();
      expect(screen.getAllByText(upcomingTile).length).toBeGreaterThan(0);
      expect(
        screen.getByText(
          said(direction, 'teacher.enrollment.schedule', {
            day: formatWeekday(weekdayIn(SESSIONS[0]!.startsAt, CAIRO), locale),
            time: formatWallClock('18:00', locale),
            city: city(direction),
            endDate: formatDate(SESSIONS[4]!.startsAt, CAIRO, locale),
          }),
        ),
      ).toBeTruthy();
      expect(screen.getByText(said(direction, 'teacher.enrollment.sessions.title'))).toBeTruthy();
      expect(
        screen.getByText(
          said(direction, 'teacher.enrollment.sessions.row', {
            n: 1,
            date: formatWeekdayDate(SESSIONS[0]!.startsAt, CAIRO, locale),
          }),
        ),
      ).toBeTruthy();
      expect(
        screen.getByText(
          said(direction, 'teacher.enrollment.sessions.range', {
            from: 2,
            to: 5,
            startDate: formatDate(SESSIONS[1]!.startsAt, CAIRO, locale),
            endDate: formatDate(SESSIONS[4]!.startsAt, CAIRO, locale),
          }),
        ),
      ).toBeTruthy();
      expect(screen.getAllByText(upcomingBadge)).toHaveLength(
        upcomingTile === upcomingBadge ? 3 : 2,
      );
      // Phase 3's and later rows are not drawn: no chat, no cancellation, no settlement.
      expect(screen.queryByText(said(direction, 'teacher.enrollment.chat'))).toBeNull();
      expect(screen.queryByText(said(direction, 'teacher.enrollment.requestCancel'))).toBeNull();
    });
    expect(get()).toHaveBeenCalledWith({ enrollmentId: ENROLLMENT_ID });
  });

  it('marks the ijazah track with its accent badge', async () => {
    get().mockResolvedValue(
      enrollment({
        summary: {
          subject: QURAN,
          track: 'ijazah_track',
          sessionCount: 5,
          sessionDurationMinutes: 45,
        },
      }),
    );
    await inBothDirections(detail, async (_rendered, direction) => {
      expect(await screen.findByText(said(direction, 'common.track.ijazahTrack'))).toBeTruthy();
    });
  });

  it('says the next session in the teacher’s own zone when the sessions keep another', async () => {
    const away = [1, 2, 3].map((n) => wednesday(n, DUBAI));
    get().mockResolvedValue(enrollment({ sessions: away, next: away[0], last: away[2] }));
    await inBothDirections(detail, async (_rendered, direction) => {
      expect(await screen.findByText('يوسف أحمد')).toBeTruthy();
      expect(
        screen.getByText(
          said(direction, 'teacher.students.inViewerZone', {
            date: formatDate(away[0]!.startsAt, CAIRO, localeOf(direction)),
            time: formatTime(away[0]!.startsAt, CAIRO, localeOf(direction)),
            city: city(direction),
          }),
        ),
      ).toBeTruthy();
    });
  });

  it('says from when to when an ended enrollment ran', async () => {
    const done = SESSIONS.map((one) => ({ ...one, status: 'done' as const }));
    get().mockResolvedValue(
      enrollment({
        status: 'completed',
        sessions: done,
        next: undefined,
        last: done[4],
        upcoming: 0,
        completed: 5,
        remaining: 0,
      }),
    );
    await inBothDirections(detail, async (_rendered, direction) => {
      const locale = localeOf(direction);
      expect(await screen.findByText(said(direction, 'status.enrollment.completed'))).toBeTruthy();
      expect(
        screen.getByText(
          said(direction, 'teacher.enrollment.scheduleEnded', {
            day: formatWeekday(weekdayIn(SESSIONS[0]!.startsAt, CAIRO), locale),
            time: formatWallClock('18:00', locale),
            startDate: formatDate(SESSIONS[0]!.startsAt, CAIRO, locale),
            endDate: formatDate(SESSIONS[4]!.startsAt, CAIRO, locale),
          }),
        ),
      ).toBeTruthy();
      expect(
        screen.getByText(
          said(direction, 'teacher.enrollment.sessions.range', {
            from: 1,
            to: 5,
            startDate: formatDate(SESSIONS[0]!.startsAt, CAIRO, locale),
            endDate: formatDate(SESSIONS[4]!.startsAt, CAIRO, locale),
          }),
        ),
      ).toBeTruthy();
      // «تمت» is both the tile's label and the range's badge.
      const doneWord = said(direction, 'status.session.done');
      expect(screen.getAllByText(doneWord)).toHaveLength(
        doneWord === said(direction, 'teacher.enrollment.stats.done') ? 2 : 1,
      );
    });
  });

  // T007 (FR-426): a deleted student has no name; the header draws the stand-in and an avatar with
  // no letter.
  it('draws a deleted student by the stand-in text, the avatar with no letter', async () => {
    get().mockResolvedValue(
      enrollment({ student: { displayName: '', displayNameOrNull: null, deleted: true } }),
    );
    await inBothDirections(detail, async (_rendered, direction) => {
      const standIn = said(direction, 'common.party.deletedStudent');
      expect(await screen.findByText(standIn)).toBeTruthy();
      expect(screen.getByText(said(direction, 'teacher.enrollment.title'))).toBeTruthy();
      expect(screen.queryByText(standIn.charAt(0))).toBeNull();
    });
  });

  it('goes back from its header', async () => {
    get().mockResolvedValue(enrollment());
    await renderIn('rtl', detail());
    expect(await screen.findByText('يوسف أحمد')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: ar('common.a11y.back') }));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe('TeacherEnrollment reads since it opened (the owner’s decision of 2026-11-04; T086)', () => {
  it('shows the retry state, not the cached enrollment, when the read on opening fails', async () => {
    queries.setQueryData(enrollmentQueryKey(ENROLLMENT_ID), enrollment());
    get().mockRejectedValue(apiError('INTERNAL'));
    await renderIn('rtl', detail());
    expect(await screen.findByText(ar('common.state.loadError'))).toBeTruthy();
    expect(screen.queryByText('يوسف أحمد')).toBeNull();
    get().mockResolvedValue(
      enrollment({
        student: {
          displayName: 'يوسف أحمد علي',
          displayNameOrNull: 'يوسف أحمد علي',
          deleted: false,
        },
      }),
    );
    await fireEvent.press(screen.getByRole('button', { name: ar('common.action.retry') }));
    expect(await screen.findByText('يوسف أحمد علي')).toBeTruthy();
  });
});

// T091 (PR #123's review, round 1, nit 4): a link whose enrollment id is missing or is not one is
// never read; the screen draws what the student's detail draws for it, the load error, and its
// retry sends nothing the API could only refuse.
describe('TeacherEnrollment checks the enrollment id before reading (T091)', () => {
  it.each([
    ['missing', {}],
    ['empty', { enrollmentId: '' }],
    ['not an id', { enrollmentId: 'not-an-enrollment' }],
  ])('an id %s: no read, the load error, and a retry that reads nothing', async (_name, params) => {
    mockParams = params;
    await renderIn('rtl', detail());
    expect(await screen.findByText(ar('common.state.loadError'))).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: ar('common.action.retry') }));
    expect(get()).not.toHaveBeenCalled();
  });
});
