// T046 (FR-495; contracts/app-surface.md, "Phase 2's lists, widened additively"): the student's ended
// tab, the `(student)/enrollments/ended` route, in both languages. It draws each status the ended tab
// holds as its badge: `completed`, `terminated_no_show`, and `cancelled`, which is how an enrollment
// the administration, the teacher's suspension or an account's deletion ended reads (the lists
// answer no `cancellationReason`; the note under T046, Q9 (a)). A failed read says its words through
// `genericErrorKey` (T065): a `RATE_LIMITED` refusal reads «طلبات كثيرة…», on opening and on the next
// page.
import type { MeOutput, StudentEnrollmentItem } from '@ijazah/contracts';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import EnrollmentsEndedRoute from '../../../app/(student)/enrollments/ended';
import { inBothDirections, renderIn } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, type MessageValues, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import type { Direction } from '../../../lib/direction';
import { apiError, fakeApi } from '../../shared/__tests__/api-double';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), navigate: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
}));

const TEACHER = 'الشيخ أحمد المصري';
const CURSOR = '0193a6f0-0000-7000-8000-0000000000e1';

const me: MeOutput = {
  userId: '0193a6f0-0000-7000-8000-000000000001',
  role: 'student',
  displayName: 'أمل حسن',
  email: 'amal@example.com',
  gender: 'female',
  dateOfBirth: '2004-03-12',
  preferredLanguage: 'ar',
  timezone: 'Asia/Riyadh',
  signInMethod: 'google',
  memberSince: '2026-02-02T09:00:00Z',
  accountStatus: 'active',
  landing: 'student_home',
};

type EndedStatus = 'completed' | 'terminated_no_show' | 'cancelled';

/** An ended enrollment of `status`, with no session ahead. */
function endedAs(status: EndedStatus, id = 'e1'): StudentEnrollmentItem {
  return {
    enrollmentId: `0193a6f0-0000-7000-8000-0000000000${id}`,
    teacher: {
      teacherId: '0193a6f0-0000-7000-8000-0000000000d1',
      displayName: TEACHER,
      displayNameOrNull: TEACHER,
      deleted: false,
    },
    summary: {
      subject: {
        id: '0193a6f0-0000-7000-8000-0000000000a1',
        nameAr: 'حفظ القرآن',
        nameEn: 'Quran',
      },
      track: 'recitation',
      sessionCount: 8,
      sessionDurationMinutes: 45,
    },
    status,
    upcoming: 0,
    completed: 3,
    remaining: 5,
  };
}

const said = (direction: Direction, key: MessageKey, values?: MessageValues) =>
  translate(direction === 'rtl' ? 'ar' : 'en', key, values);
/** A `RATE_LIMITED` refusal; with `seconds`, the time until its window ends (T062's detail). */
const rateLimited = (seconds?: string) =>
  apiError(
    'RATE_LIMITED',
    seconds === undefined ? [] : [{ path: 'retryAfterSeconds', code: seconds }],
  );
const list = () => mockApi.api.enrollments.list.query;

let queries: QueryClient;
const ended = (): ReactElement => (
  <QueryClientProvider client={queries}>
    <EnrollmentsEndedRoute />
  </QueryClientProvider>
);

beforeEach(() => {
  mockApi = fakeApi();
  onlineManager.setOnline(true);
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, me);
});
afterEach(async () => {
  await cleanup();
  onlineManager.setOnline(true);
  queries.clear();
});

describe('the student’s ended tab draws each status as its badge (T046, FR-495)', () => {
  it.each<[string, EndedStatus, MessageKey]>([
    ['completed', 'completed', 'status.enrollment.completed'],
    ['terminated_no_show', 'terminated_no_show', 'status.enrollment.terminatedNoShow'],
    [
      'cancelled: ended by the administration, the teacher’s suspension or an account’s deletion',
      'cancelled',
      'status.enrollment.cancelled',
    ],
  ])('an enrollment %s', async (_name, status, badge) => {
    list().mockResolvedValue({ items: [endedAs(status)] });
    await inBothDirections(ended, async (_rendered, direction) => {
      expect(await screen.findByText(TEACHER)).toBeTruthy();
      expect(screen.getByText(said(direction, badge))).toBeTruthy();
    });
    expect(list()).toHaveBeenCalledWith({ tab: 'ended' });
  });
});

describe('the student’s ended tab says a failed read through genericErrorKey (T046, T065)', () => {
  it('a read on opening refused RATE_LIMITED: «طلبات كثيرة…», never the generic error', async () => {
    list().mockRejectedValue(rateLimited());
    await inBothDirections(ended, async (_rendered, direction) => {
      expect(await screen.findByText(said(direction, 'common.state.rateLimited'))).toBeTruthy();
      expect(screen.queryByText(said(direction, 'common.state.loadError'))).toBeNull();
    });
  });

  it.each<Direction>(['rtl', 'ltr'])(
    'a next page refused RATE_LIMITED says when to try again (%s)',
    async (direction) => {
      list()
        .mockResolvedValueOnce({ items: [endedAs('completed')], nextCursor: CURSOR })
        .mockRejectedValueOnce(rateLimited('61'));
      await renderIn(direction, ended());
      expect(await screen.findByText(TEACHER)).toBeTruthy();
      await fireEvent(screen.getByTestId('ended-enrollments'), 'onEndReached');
      expect(
        await screen.findByText(said(direction, 'common.state.rateLimitedIn', { count: 2 })),
      ).toBeTruthy();
      expect(screen.queryByText(said(direction, 'common.state.loadError'))).toBeNull();
      expect(list()).toHaveBeenLastCalledWith({ tab: 'ended', cursor: CURSOR });
    },
  );
});
