// T041 of specs/004-sessions (FR-495; the note under T041, Q3 (a)): the teacher's enrollment screen
// draws the lists' per-session `pendingCancellation` on that session's row, in Arabic and English:
// the session stands on a row of its own, never inside a range (`session-rows.ts`), and no other
// row says it.
import type { ListedSession, TeacherStudentsGetOutput } from '@ijazah/contracts';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, screen } from '@testing-library/react-native';

import { inBothDirections } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import type { Direction } from '../../../lib/direction';
import { formatWeekdayDate } from '../../../lib/formatters';
import { fakeApi } from '../../shared/__tests__/api-double';
import { TeacherEnrollment } from './index';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({ enrollmentId: '0193a6f0-0000-7000-8000-0000000000e1' }),
}));

const ENROLLMENT_ID = '0193a6f0-0000-7000-8000-0000000000e1';
const CAIRO = 'Africa/Cairo';

/** Wednesdays at 18:00 in Cairo (16:00 UTC) from 2026-11-11. */
const WEDNESDAYS = ['2026-11-11', '2026-11-18', '2026-11-25', '2026-12-02', '2026-12-09'];

function wednesday(n: number, of: Partial<ListedSession> = {}): ListedSession {
  const date = WEDNESDAYS[n - 1]!;
  return {
    sessionId: `0193a6f0-0000-7000-8000-0000000005${String(n).padStart(2, '0')}`,
    sequenceNumber: n,
    localDate: date,
    startTimeLocal: '18:00',
    timezone: CAIRO,
    startsAt: `${date}T16:00:00.000Z`,
    endsAt: `${date}T16:45:00.000Z`,
    status: 'scheduled',
    pendingCancellation: false,
    disputed: false,
    ...of,
  };
}

/** Four scheduled sessions after the next: the third has a request pending. */
const SESSIONS = [1, 2, 3, 4, 5].map((n) => wednesday(n, { pendingCancellation: n === 3 }));

const enrollment: TeacherStudentsGetOutput = {
  enrollmentId: ENROLLMENT_ID,
  student: { displayName: 'يوسف أحمد', displayNameOrNull: 'يوسف أحمد', deleted: false },
  summary: {
    subject: { id: '0193a6f0-0000-7000-8000-0000000000a1', nameAr: 'حفظ القرآن', nameEn: 'Quran' },
    track: 'recitation',
    sessionCount: 5,
    sessionDurationMinutes: 45,
  },
  status: 'confirmed',
  paused: false,
  next: SESSIONS[0],
  last: SESSIONS[4],
  upcoming: 5,
  completed: 0,
  remaining: 5,
  sessions: SESSIONS,
  ijazahRequest: null,
};

const localeOf = (direction: Direction) => (direction === 'rtl' ? 'ar' : 'en');
const said = (direction: Direction, key: MessageKey, values?: Record<string, string | number>) =>
  translate(localeOf(direction), key, values);

let queries: QueryClient;
const ui = () => (
  <QueryClientProvider client={queries}>
    <TeacherEnrollment />
  </QueryClientProvider>
);

beforeEach(() => {
  mockApi = fakeApi();
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, {
    userId: '0193a6f0-0000-7000-8000-000000000002',
    timezone: CAIRO,
  });
});

afterEach(async () => {
  await cleanup();
  queries.clear();
});

describe('TeacherEnrollment: a pending cancellation request (T041, FR-495)', () => {
  it('draws the session with a request pending on its own row, saying so, and no other row', async () => {
    mockApi.api.teacher.students.get.query.mockResolvedValue(enrollment);
    await inBothDirections(ui, async (_rendered, direction) => {
      expect(await screen.findByText('يوسف أحمد')).toBeTruthy();
      const third = SESSIONS[2]!;
      expect(
        screen.getByText(
          said(direction, 'teacher.enrollment.sessions.row', {
            n: 3,
            date: formatWeekdayDate(third.startsAt, CAIRO, localeOf(direction)),
          }),
        ),
      ).toBeTruthy();
      expect(screen.getAllByText(said(direction, 'session.cancellation.row.pending'))).toHaveLength(
        1,
      );
    });
  });

  it('says nothing of a request when no session has one pending', async () => {
    mockApi.api.teacher.students.get.query.mockResolvedValue({
      ...enrollment,
      sessions: SESSIONS.map((one) => ({ ...one, pendingCancellation: false })),
    });
    await inBothDirections(ui, async (_rendered, direction) => {
      expect(await screen.findByText('يوسف أحمد')).toBeTruthy();
      expect(screen.queryByText(said(direction, 'session.cancellation.row.pending'))).toBeNull();
    });
  });
});
